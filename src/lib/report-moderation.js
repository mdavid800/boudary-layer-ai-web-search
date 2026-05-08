import { requestBlockedRowRepair } from './openrouter.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_SEARCH_ENGINE,
} from './runtime-config.js';
import { updateResearchReport } from './report-storage.js';
import { verifyDraftReports } from '../verify-reports.js';
import { publishDraftReports } from '../publish-reports.js';
import { verifyReportEvidence } from './evidence-verifier.js';

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

export async function saveDraftResearchReport(client, {
  reportId,
  reportMarkdown,
  modelUsed = null,
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

  return {
    reportId,
    windFarmId: report.wind_farm_id,
    factsInserted: result.factsInserted,
  };
}

export async function verifyDraftResearchReport(client, {
  reportId,
  repair = false,
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  return verifyDraftReports({
    client,
    reportIds: [reportId],
    repair,
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
} = {}) {
  if (!Number.isInteger(reportId)) {
    throw new Error('reportId must be an integer.');
  }

  return publishDraftReports({
    client,
    reportIds: [reportId],
  });
}