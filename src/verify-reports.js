import { createDatabaseClient } from './lib/database.js';
import { requestBlockedRowRepair } from './lib/openrouter.js';
import { buildReportOutputPath, saveReport } from './lib/report-output.js';
import { updateResearchReport } from './lib/report-storage.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_SEARCH_ENGINE,
} from './lib/runtime-config.js';
import { verifyReportEvidence } from './lib/evidence-verifier.js';
import { getWindFarmSourceTableName } from './lib/windfarm-database.js';

export function parseVerifyReportsArgs(argv = []) {
  const options = {
    help: false,
    ids: [],
    json: false,
    repair: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '--repair') {
      options.repair = true;
      continue;
    }

    if (argument.startsWith('--ids')) {
      const inlineValue = argument.startsWith('--ids=') ? argument.slice('--ids='.length) : null;
      const rawValue = inlineValue ?? readNextValue(argv, index, '--ids');

      if (inlineValue == null) {
        index += 1;
      }

      options.ids = parseIds(rawValue);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

export function formatVerifyReportsHelp() {
  return [
    'Usage:',
    '  npm run verify-reports -- [options]',
    '',
    'Options:',
    '  --ids <report-id[,report-id...]>  Verify only the selected draft report ids',
    '  --json                           Print the verification summary as JSON',
    '  --repair                         Repair blocked draft rows and re-verify without publishing',
    '  --help, -h                       Show this help text',
  ].join('\n');
}

export async function verifyDraftReports({
  client,
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
  const draftReports = await listDraftReports(client, { reportIds });
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
    const verification = await verifyReportEvidenceFn(client, report.id);

    if (!verification.passed && repair) {
      const repairedVerification = await attemptRepair({
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

      if (repairedVerification.repaired) {
        repairedReportIds.push(report.id);
      }

      if (repairedVerification.repairFailure) {
        repairFailures.push({
          reportId: report.id,
          windFarmId: report.wind_farm_id,
          error: repairedVerification.repairFailure,
        });
      }

      if (repairedVerification.verification.passed) {
        passedReportIds.push(report.id);
        log(`Verified report #${report.id} for wind farm ${report.wind_farm_id}.`);
        continue;
      }

      blockedReports.push({
        reportId: report.id,
        windFarmId: report.wind_farm_id,
        blockedRows: repairedVerification.verification.blockedRows,
      });

      log(`Blocked report #${report.id} for wind farm ${report.wind_farm_id}:`);
      for (const blockedRow of repairedVerification.verification.blockedRows) {
        log(`  - ${blockedRow.status}: ${blockedRow.error}`);
      }

      continue;
    }

    if (verification.passed) {
      passedReportIds.push(report.id);
      log(`Verified report #${report.id} for wind farm ${report.wind_farm_id}.`);
      continue;
    }

    blockedReports.push({
      reportId: report.id,
      windFarmId: report.wind_farm_id,
      blockedRows: verification.blockedRows,
    });

    log(`Blocked report #${report.id} for wind farm ${report.wind_farm_id}:`);
    for (const blockedRow of verification.blockedRows) {
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseVerifyReportsArgs(argv);

  if (options.help) {
    console.log(formatVerifyReportsHelp());
    return;
  }

  const client = createDatabaseClient();
  await client.connect();

  try {
    const summary = await verifyDraftReports({
      client,
      reportIds: options.ids,
      repair: options.repair,
    });

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    }

    if (summary.blockedReports.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

async function listDraftReports(client, { reportIds = [] } = {}) {
  if (reportIds.length > 0) {
    const result = await client.query(
      `SELECT r.id, r.wind_farm_id, r.report_markdown, r.model_used, w.name
       FROM research_wind_farm_reports r
       JOIN ${getWindFarmSourceTableName()} w ON w.id = r.wind_farm_id
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
     JOIN ${getWindFarmSourceTableName()} w ON w.id = r.wind_farm_id
     WHERE review_status = 'draft'
     ORDER BY r.researched_at ASC`,
  );

  return result.rows;
}

async function attemptRepair({
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

function readNextValue(argv, index, flag) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseIds(rawValue) {
  const ids = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = Number.parseInt(value, 10);

      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--ids must be a comma-separated list of positive integers. Invalid value: ${value}`);
      }

      return parsed;
    });

  if (ids.length === 0) {
    throw new Error('--ids must include at least one report id.');
  }

  return [...new Set(ids)];
}