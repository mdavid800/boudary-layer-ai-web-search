import path from 'node:path';
import { createDatabaseClient } from './lib/database.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_SEARCH_ENGINE,
} from './lib/runtime-config.js';
import { verifyReportEvidence } from './lib/evidence-verifier.js';
import { requestBlockedRowRepair } from './lib/openrouter.js';
import { saveReport, slugifyFileSegment } from './lib/report-output.js';
import { pruneObsoleteDraftReports, updateResearchReport } from './lib/report-storage.js';
import { getWindFarmSourceTableName } from './lib/windfarm-database.js';

function buildReportOutputPath({ sourceTableName, windFarmId, windFarmName }) {
  return path.join(
    'reports',
    sourceTableName,
    `${windFarmId}-${slugifyFileSegment(windFarmName || `windfarm-${windFarmId}`)}.md`,
  );
}

export async function publishDraftReports({
  client,
  apiKey = process.env.OPENROUTER_API_KEY,
  verifyReportEvidenceFn = verifyReportEvidence,
  requestBlockedRowRepairFn = requestBlockedRowRepair,
  updateResearchReportFn = updateResearchReport,
  pruneObsoleteDraftReportsFn = pruneObsoleteDraftReports,
  saveReportFn = saveReport,
  sourceTableName = getWindFarmSourceTableName(),
  searchEngine = DEFAULT_SEARCH_ENGINE,
  maxResults = DEFAULT_MAX_RESULTS,
  maxTotalResults = DEFAULT_MAX_TOTAL_RESULTS,
  referer = process.env.OPENROUTER_SITE_URL,
  title = process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
} = {}) {
  const draftResult = await client.query(
    `SELECT r.id, r.wind_farm_id, r.report_markdown, r.model_used, w.name
     FROM research_wind_farm_reports r
     JOIN ${sourceTableName} w ON w.id = r.wind_farm_id
     WHERE r.review_status = 'draft'
     ORDER BY r.researched_at ASC`,
  );
  const draftReports = draftResult.rows;
  const draftCount = draftReports.length;

  if (draftCount === 0) {
    console.error('No draft reports to publish.');
    return {
      publishedReportIds: [],
      draftCount: 0,
    };
  }

  console.error(`Found ${draftCount} draft report(s). Verifying evidence before publish...`);

  const publishableReportIds = [];

  for (const report of draftReports) {
    let verification = await verifyReportEvidenceFn(client, report.id);

    if (!verification.passed && verification.blockedRows.length > 0 && apiKey?.trim()) {
      console.error(`Attempting blocked-row repair for report #${report.id} (${verification.blockedRows.length} blocked row(s))...`);

      try {
        const repairedReport = await requestBlockedRowRepairFn({
          apiKey,
          model: report.model_used || DEFAULT_MODEL,
          reportMarkdown: report.report_markdown,
          blockedRows: verification.blockedRows,
          searchEngine,
          maxResults,
          maxTotalResults,
          referer,
          title,
        });

        await updateResearchReportFn(client, {
          reportId: report.id,
          windFarmId: report.wind_farm_id,
          reportMarkdown: repairedReport,
          modelUsed: report.model_used || DEFAULT_MODEL,
          reviewStatus: 'draft',
        });

        await saveReportFn(
          buildReportOutputPath({
            sourceTableName,
            windFarmId: report.wind_farm_id,
            windFarmName: report.name,
          }),
          repairedReport,
        ).catch((error) => {
          console.error(`Warning: failed to save repaired markdown for report #${report.id}: ${error.message}`);
        });

        verification = await verifyReportEvidenceFn(client, report.id);
      } catch (error) {
        console.error(`Repair failed for report #${report.id}: ${error.message}`);
      }
    }

    if (verification.passed) {
      publishableReportIds.push(report.id);
      continue;
    }

    console.error(`Blocked report #${report.id} for wind farm ${report.wind_farm_id}:`);
    for (const blockedRow of verification.blockedRows) {
      console.error(`  - ${blockedRow.status}: ${blockedRow.error}`);
    }
  }

  if (publishableReportIds.length === 0) {
    console.error('No draft reports passed evidence verification. Nothing was published.');
    return {
      publishedReportIds: [],
      draftCount,
    };
  }

  const reportResult = await client.query(
    `UPDATE research_wind_farm_reports
     SET review_status = 'published', updated_at = now()
     WHERE review_status = 'draft'
       AND id = ANY($1)
     RETURNING id, wind_farm_id`,
    [publishableReportIds],
  );

  const publishedReportIds = reportResult.rows.map((r) => r.id);
  const publishedWindFarmIds = [...new Set(reportResult.rows.map((r) => r.wind_farm_id))];

  console.error(`Published ${publishedReportIds.length} report(s).`);

  const factResult = await client.query(
    `UPDATE wind_farm_facts
     SET status = 'active'
     WHERE source_type = 'research'
       AND status = 'draft'
       AND report_id = ANY($1)`,
    [publishedReportIds],
  );

  for (const windFarmId of publishedWindFarmIds) {
    await pruneObsoleteDraftReportsFn(client, { windFarmId });
  }

  console.error(`Activated ${factResult.rowCount} research fact(s).`);
  console.error(`Blocked ${draftCount - publishedReportIds.length} draft report(s) that failed evidence verification.`);

  const summaryResult = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'published') AS published_reports,
       (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'draft') AS remaining_drafts,
       (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'active') AS active_research_facts,
       (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'draft') AS draft_research_facts`,
  );

  const summary = summaryResult.rows[0];
  console.error('\nDatabase summary:');
  console.error(`  Published reports:       ${summary.published_reports}`);
  console.error(`  Remaining draft reports: ${summary.remaining_drafts}`);
  console.error(`  Active research facts:   ${summary.active_research_facts}`);
  console.error(`  Draft research facts:    ${summary.draft_research_facts}`);

  return {
    publishedReportIds,
    draftCount,
  };
}

export async function main() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await publishDraftReports({ client });
  } finally {
    await client.end();
  }
}
