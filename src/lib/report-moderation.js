import { requestBlockedRowRepair } from './openrouter.js';
import { buildReportOutputPath, saveReport } from './report-output.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_SEARCH_ENGINE,
} from './runtime-config.js';
import { pruneObsoleteDraftReports, updateResearchReport } from './report-storage.js';
import { verifyReportEvidence } from './evidence-verifier.js';
import { getWindFarmSourceTableName } from './windfarm-database.js';

async function getDraftReportRow(client, reportId) {
  const result = await client.query(
    `SELECT id, wind_farm_id, report_markdown, model_used
     FROM research_wind_farm_reports
     WHERE id = $1::int
       AND review_status = 'draft'
     LIMIT 1`,
    [reportId],
  );

  return result.rows[0] ?? null;
}

export async function listDraftResearchReports(client, {
  reportIds = [],
  sourceTableName = getWindFarmSourceTableName(),
} = {}) {
  if (reportIds.length > 0) {
    const result = await client.query(
      `SELECT r.id, r.wind_farm_id, r.report_markdown, r.model_used, w.name
       FROM research_wind_farm_reports r
       JOIN ${sourceTableName} w ON w.id = r.wind_farm_id
       WHERE review_status = 'draft'
         AND r.id = ANY($1::int[])
       ORDER BY r.researched_at ASC`,
      [reportIds],
    );

    return result.rows;
  }

  const result = await client.query(
    `SELECT r.id, r.wind_farm_id, r.report_markdown, r.model_used, w.name
     FROM research_wind_farm_reports r
     JOIN ${sourceTableName} w ON w.id = r.wind_farm_id
     WHERE review_status = 'draft'
     ORDER BY r.researched_at ASC`,
  );

  return result.rows;
}

async function attemptDraftReportRepair({
  report,
  verification,
  apiKey,
  client,
  requestBlockedRowRepairFn,
  updateResearchReportFn,
  saveReportFn,
  verifyReportEvidenceFn,
  sourceTableName,
  searchEngine,
  maxResults,
  maxTotalResults,
  referer,
  title,
  log,
}) {
  if (verification.blockedRows.length === 0) {
    return { verification, repaired: false, repairFailure: null };
  }

  if (!apiKey?.trim()) {
    log(`Skipping repair for report #${report.id}: OPENROUTER_API_KEY is not configured.`);
    return {
      verification,
      repaired: false,
      repairFailure: 'OPENROUTER_API_KEY is not configured.',
    };
  }

  log(`Attempting blocked-row repair for report #${report.id} (${verification.blockedRows.length} blocked row(s))...`);

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
      log(`Warning: failed to save repaired markdown for report #${report.id}: ${error.message}`);
    });

    return {
      verification: await verifyReportEvidenceFn(client, report.id),
      repaired: true,
      repairFailure: null,
    };
  } catch (error) {
    log(`Repair failed for report #${report.id}: ${error.message}`);

    return {
      verification,
      repaired: false,
      repairFailure: error.message,
    };
  }
}

export async function runDraftResearchReportVerification(client, {
  report,
  repair = false,
  apiKey = process.env.OPENROUTER_API_KEY,
  verifyReportEvidenceFn = verifyReportEvidence,
  requestBlockedRowRepairFn = requestBlockedRowRepair,
  updateResearchReportFn = updateResearchReport,
  saveReportFn = saveReport,
  sourceTableName = getWindFarmSourceTableName(),
  searchEngine = DEFAULT_SEARCH_ENGINE,
  maxResults = DEFAULT_MAX_RESULTS,
  maxTotalResults = DEFAULT_MAX_TOTAL_RESULTS,
  referer = process.env.OPENROUTER_SITE_URL,
  title = process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
  log = console.error,
} = {}) {
  const verification = await verifyReportEvidenceFn(client, report.id);

  if (!verification.passed && repair) {
    return attemptDraftReportRepair({
      report,
      verification,
      apiKey,
      client,
      requestBlockedRowRepairFn,
      updateResearchReportFn,
      saveReportFn,
      verifyReportEvidenceFn,
      sourceTableName,
      searchEngine,
      maxResults,
      maxTotalResults,
      referer,
      title,
      log,
    });
  }

  return {
    verification,
    repaired: false,
    repairFailure: null,
  };
}

export async function verifyDraftResearchReports(client, {
  reportIds = [],
  repair = false,
  apiKey = process.env.OPENROUTER_API_KEY,
  verifyReportEvidenceFn = verifyReportEvidence,
  requestBlockedRowRepairFn = requestBlockedRowRepair,
  updateResearchReportFn = updateResearchReport,
  saveReportFn = saveReport,
  sourceTableName = getWindFarmSourceTableName(),
  searchEngine = DEFAULT_SEARCH_ENGINE,
  maxResults = DEFAULT_MAX_RESULTS,
  maxTotalResults = DEFAULT_MAX_TOTAL_RESULTS,
  referer = process.env.OPENROUTER_SITE_URL,
  title = process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
  log = console.error,
} = {}) {
  const draftReports = await listDraftResearchReports(client, { reportIds, sourceTableName });
  const matchedReportIds = draftReports.map((report) => report.id);
  const missingReportIds = reportIds.filter((reportId) => !matchedReportIds.includes(reportId));

  if (draftReports.length === 0) {
    log(
      reportIds.length > 0
        ? `No matching draft reports found for requested ids: ${reportIds.join(', ')}.`
        : 'No draft reports to verify.',
    );

    return {
      draftCount: 0,
      passedReportIds: [],
      blockedReports: [],
      repairedReportIds: [],
      repairFailures: [],
      matchedReportIds,
      missingReportIds,
    };
  }

  log(
    reportIds.length > 0
      ? `Found ${draftReports.length} draft report(s) to verify for requested ids.`
      : `Found ${draftReports.length} draft report(s) to verify.`,
  );

  if (missingReportIds.length > 0) {
    log(`Requested ids not found as draft reports: ${missingReportIds.join(', ')}.`);
  }

  const passedReportIds = [];
  const blockedReports = [];
  const repairedReportIds = [];
  const repairFailures = [];

  for (const report of draftReports) {
    const processedVerification = await runDraftResearchReportVerification(client, {
      report,
      repair,
      apiKey,
      verifyReportEvidenceFn,
      requestBlockedRowRepairFn,
      updateResearchReportFn,
      saveReportFn,
      sourceTableName,
      searchEngine,
      maxResults,
      maxTotalResults,
      referer,
      title,
      log,
    });

    if (processedVerification.repaired) {
      repairedReportIds.push(report.id);
    }

    if (processedVerification.repairFailure) {
      repairFailures.push({
        reportId: report.id,
        windFarmId: report.wind_farm_id,
        error: processedVerification.repairFailure,
      });
    }

    if (processedVerification.verification.passed) {
      passedReportIds.push(report.id);
      log(`Verified report #${report.id} for wind farm ${report.wind_farm_id}.`);
      continue;
    }

    blockedReports.push({
      reportId: report.id,
      windFarmId: report.wind_farm_id,
      blockedRows: processedVerification.verification.blockedRows,
    });

    log(`Blocked report #${report.id} for wind farm ${report.wind_farm_id}:`);
    for (const blockedRow of processedVerification.verification.blockedRows) {
      log(`  - ${blockedRow.status}: ${blockedRow.error}`);
    }
  }

  log('');
  log('Verification summary:');
  log(`  Checked draft reports: ${draftReports.length}`);
  log(`  Passed:                ${passedReportIds.length}`);
  log(`  Blocked:               ${blockedReports.length}`);
  if (repair) {
    log(`  Repaired:              ${repairedReportIds.length}`);
  }

  return {
    draftCount: draftReports.length,
    passedReportIds,
    blockedReports,
    repairedReportIds,
    repairFailures,
    matchedReportIds,
    missingReportIds,
  };
}

export async function publishDraftResearchReports(client, {
  reportIds = [],
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
  log = console.error,
} = {}) {
  const draftReports = await listDraftResearchReports(client, { reportIds, sourceTableName });
  const draftCount = draftReports.length;

  if (draftCount === 0) {
    log('No draft reports to publish.');
    return {
      publishedReportIds: [],
      draftCount: 0,
    };
  }

  log(`Found ${draftCount} draft report(s). Verifying evidence before publish...`);

  const publishableReportIds = [];

  for (const report of draftReports) {
    const processedVerification = await runDraftResearchReportVerification(client, {
      report,
      repair: Boolean(apiKey?.trim()),
      apiKey,
      verifyReportEvidenceFn,
      requestBlockedRowRepairFn,
      updateResearchReportFn,
      saveReportFn,
      sourceTableName,
      searchEngine,
      maxResults,
      maxTotalResults,
      referer,
      title,
      log,
    });

    if (processedVerification.verification.passed) {
      publishableReportIds.push(report.id);
      continue;
    }

    log(`Blocked report #${report.id} for wind farm ${report.wind_farm_id}:`);
    for (const blockedRow of processedVerification.verification.blockedRows) {
      log(`  - ${blockedRow.status}: ${blockedRow.error}`);
    }
  }

  if (publishableReportIds.length === 0) {
    log('No draft reports passed evidence verification. Nothing was published.');
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

  const publishedReportIds = reportResult.rows.map((row) => row.id);
  const publishedWindFarmIds = [...new Set(reportResult.rows.map((row) => row.wind_farm_id))];

  log(`Published ${publishedReportIds.length} report(s).`);

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

  log(`Activated ${factResult.rowCount} research fact(s).`);
  log(`Blocked ${draftCount - publishedReportIds.length} draft report(s) that failed evidence verification.`);

  const summaryResult = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'published') AS published_reports,
       (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'draft') AS remaining_drafts,
       (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'active') AS active_research_facts,
       (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'draft') AS draft_research_facts`,
  );

  const summary = summaryResult.rows[0];
  log('\nDatabase summary:');
  log(`  Published reports:       ${summary.published_reports}`);
  log(`  Remaining draft reports: ${summary.remaining_drafts}`);
  log(`  Active research facts:   ${summary.active_research_facts}`);
  log(`  Draft research facts:    ${summary.draft_research_facts}`);

  return {
    publishedReportIds,
    draftCount,
  };
}

export async function saveDraftResearchReport(client, {
  reportId,
  reportMarkdown,
  modelUsed = null,
  autoVerify = false,
  autoRepair = false,
  ...verifyOptions
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  if (typeof reportMarkdown !== 'string' || reportMarkdown.trim().length === 0) {
    throw new Error('reportMarkdown is required.');
  }

  const report = await getDraftReportRow(client, reportId);
  if (!report) {
    throw new Error(`Draft report #${reportId} was not found.`);
  }

  const result = await updateResearchReport(client, {
    reportId,
    windFarmId: report.wind_farm_id,
    reportMarkdown,
    modelUsed: typeof modelUsed === 'string' && modelUsed.trim()
      ? modelUsed.trim()
      : report.model_used || DEFAULT_MODEL,
    reviewStatus: 'draft',
  });

  const summary = {
    reportId,
    windFarmId: report.wind_farm_id,
    factsInserted: result.factsInserted,
  };

  if (!autoVerify) {
    return summary;
  }

  return {
    ...summary,
    verificationSummary: await verifyDraftResearchReport(client, {
      reportId,
      repair: autoRepair,
      ...verifyOptions,
    }),
  };
}

export async function verifyDraftResearchReport(client, {
  reportId,
  repair = false,
  ...options
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  return verifyDraftResearchReports(client, {
    reportIds: [reportId],
    repair,
    ...options,
  });
}

export async function suggestDraftResearchReportRepair(client, {
  reportId,
  apiKey = process.env.OPENROUTER_API_KEY,
  verifyReportEvidenceFn = verifyReportEvidence,
  requestBlockedRowRepairFn = requestBlockedRowRepair,
  searchEngine = DEFAULT_SEARCH_ENGINE,
  maxResults = DEFAULT_MAX_RESULTS,
  maxTotalResults = DEFAULT_MAX_TOTAL_RESULTS,
  referer = process.env.OPENROUTER_SITE_URL,
  title = process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  const report = await getDraftReportRow(client, reportId);
  if (!report) {
    throw new Error(`Draft report #${reportId} was not found.`);
  }

  const verification = await verifyReportEvidenceFn(client, reportId);
  const modelUsed = report.model_used || DEFAULT_MODEL;

  if (verification.blockedRows.length === 0) {
    return {
      reportId,
      windFarmId: report.wind_farm_id,
      modelUsed,
      blockedRows: [],
      suggestedReportMarkdown: null,
    };
  }

  if (!apiKey?.trim()) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const suggestedReportMarkdown = await requestBlockedRowRepairFn({
    apiKey,
    model: modelUsed,
    reportMarkdown: report.report_markdown,
    blockedRows: verification.blockedRows,
    searchEngine,
    maxResults,
    maxTotalResults,
    referer,
    title,
  });

  return {
    reportId,
    windFarmId: report.wind_farm_id,
    modelUsed,
    blockedRows: verification.blockedRows,
    suggestedReportMarkdown,
  };
}

export async function publishDraftResearchReport(client, {
  reportId,
  ...options
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  return publishDraftResearchReports(client, {
    reportIds: [reportId],
    ...options,
  });
}