import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_PATH,
  DEFAULT_SEARCH_ENGINE,
  requireValue,
} from './lib/runtime-config.js';
import { createDatabaseClient } from './lib/database.js';
import {
  getTurbineCountValidationContext,
  getLinkedTurbineMetadata,
  getPublishedResearchRunState,
  getWindFarmReportsDirectory,
  getWindFarmSourceTableName,
  listWindFarmRows,
} from './lib/windfarm-database.js';
import { requestResearchReport } from './lib/openrouter.js';
import { buildOfficialSourceContext } from './lib/official-source-hints.js';
import {
  buildOperationalRefreshContext,
  mergeOperationalRefreshReport,
} from './lib/operational-refresh.js';
import { buildProjectContext, buildResearchPrompt, loadPromptTemplate } from './lib/prompt.js';
import {
  getPromptTraceDirectory,
  isPromptTraceEnabled,
  saveReport,
  saveTextFile,
  slugifyFileSegment,
} from './lib/report-output.js';
import {
  getLatestPublishedResearchReport,
  storeResearchReport,
} from './lib/report-storage.js';

const OPERATIONAL_REFRESH_PROMPT_PATH = path.resolve(process.cwd(), 'prompt-operational-refresh.md');

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * Parse research-db runner flags from process.argv.
 *   --ids 259,272,345       → [259, 272, 345]
 *   --country "United Kingdom"  → "United Kingdom"
 *   --wind-farm-type "Offshore wind farm" → "Offshore wind farm"
 *   --skip-existing-reports → true
 */
export function parseResearchDatabaseArgs(argv) {
  let ids = null;
  let country = null;
  let windFarmType = null;
  let skipExistingReports = false;
  let publish = false;
  let forceRefresh = false;
  let operationalRefresh = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ids' && argv[i + 1]) {
      ids = argv[i + 1].split(',').map((s) => {
        const n = Number.parseInt(s.trim(), 10);
        if (Number.isNaN(n)) throw new Error(`Invalid ID in --ids: ${s}`);
        return n;
      });
      i += 1;
    }
    if (argv[i] === '--country' && argv[i + 1]) {
      country = argv[i + 1].trim();
      i += 1;
    }
    if (argv[i] === '--wind-farm-type' && argv[i + 1]) {
      windFarmType = argv[i + 1].trim();
      i += 1;
    }
    if (argv[i] === '--skip-existing-reports') {
      skipExistingReports = true;
    }
    if (argv[i] === '--publish') {
      publish = true;
    }
    if (argv[i] === '--force-refresh') {
      forceRefresh = true;
    }
    if (argv[i] === '--operational-refresh') {
      operationalRefresh = true;
    }
  }

  return {
    ids,
    country,
    windFarmType,
    skipExistingReports,
    publish,
    forceRefresh,
    operationalRefresh,
  };
}

export function shouldSkipPublishedOperationalReport(runState, reportState) {
  if (runState.forceRefresh) {
    return false;
  }

  return reportState?.hasOperationalPublishedReport === true;
}

export async function runDatabaseResearch({
  argv = process.argv,
  createClient = createDatabaseClient,
  loadPromptTemplateFn = loadPromptTemplate,
  requestResearchReportFn = requestResearchReport,
  getPublishedResearchRunStateFn = getPublishedResearchRunState,
  listWindFarmRowsFn = listWindFarmRows,
  getLinkedTurbineMetadataFn = getLinkedTurbineMetadata,
  getTurbineCountValidationContextFn = getTurbineCountValidationContext,
  getLatestPublishedResearchReportFn = getLatestPublishedResearchReport,
  buildOfficialSourceContextFn = buildOfficialSourceContext,
  buildOperationalRefreshContextFn = buildOperationalRefreshContext,
  mergeOperationalRefreshReportFn = mergeOperationalRefreshReport,
  buildResearchPromptFn = buildResearchPrompt,
  saveTextFileFn = saveTextFile,
  saveReportFn = saveReport,
  storeResearchReportFn = storeResearchReport,
} = {}) {
  const apiKey = requireValue(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY');
  const sourceTableName = getWindFarmSourceTableName();
  const reportsDirectory = path.join(getWindFarmReportsDirectory(), sourceTableName);
  const promptTraceEnabled = isPromptTraceEnabled();
  const promptTraceDirectory = path.join(getPromptTraceDirectory(), sourceTableName);
  const {
    ids,
    country,
    windFarmType,
    skipExistingReports,
    publish,
    forceRefresh,
    operationalRefresh,
  } = parseResearchDatabaseArgs(argv);

  if (operationalRefresh && publish) {
    throw new Error('Operational refresh mode creates a draft for review and does not support --publish.');
  }

  if (operationalRefresh && forceRefresh) {
    throw new Error('Use either --operational-refresh or --force-refresh, not both.');
  }

  const promptTemplate = await loadPromptTemplateFn(
    operationalRefresh ? OPERATIONAL_REFRESH_PROMPT_PATH : DEFAULT_PROMPT_PATH,
  );
  const reviewStatus = publish ? 'published' : 'draft';
  const client = createClient();

  await client.connect();

  try {
    const windFarmRows = await listWindFarmRowsFn(client, sourceTableName, {
      ids,
      country,
      windFarmType,
      skipExistingReports,
    });
    const publishedResearchRunState = await getPublishedResearchRunStateFn(
      client,
      windFarmRows.map((row) => row.id),
    );
    let completedCount = 0;
    let skippedCount = 0;
    const failedRows = [];

    console.error(`Starting database-backed research run for ${windFarmRows.length} rows.`);
    console.error(`Using OpenRouter model: ${DEFAULT_MODEL}`);
    if (ids) console.error(`Filtering by IDs: ${ids.join(', ')}`);
    if (country) console.error(`Filtering by country: ${country}`);
    if (windFarmType) console.error(`Filtering by wind farm type: ${windFarmType}`);
    if (skipExistingReports) console.error('Filtering to rows without any existing research reports.');
    console.error(`Source table: ${sourceTableName}`);
    console.error(`Reports directory: ${reportsDirectory}`);

    if (promptTraceEnabled) {
      console.error(`Prompt trace: enabled (${promptTraceDirectory})`);
    } else {
      console.error('Prompt trace: disabled');
    }

    console.error(`Review status: ${reviewStatus}`);
    console.error(
      operationalRefresh
        ? 'Run mode: operational refresh; published Operational reports will be refreshed into new drafts.'
        : forceRefresh
          ? 'Run mode: force refresh enabled; published operational reports will be rerun.'
          : 'Run mode: default; published operational reports will be skipped.',
    );

    for (const [index, windFarmRow] of windFarmRows.entries()) {
      const reportState = publishedResearchRunState.get(windFarmRow.id);

      if (operationalRefresh) {
        if (reportState?.hasOperationalPublishedReport !== true) {
          skippedCount += 1;
          console.error(
            `[${index + 1}/${windFarmRows.length}] Skipping ${windFarmRow.name} (ID ${windFarmRow.id}) because operational refresh only applies to wind farms with a published Operational report.`,
          );
          continue;
        }
      }

      if (!operationalRefresh && shouldSkipPublishedOperationalReport({ forceRefresh }, reportState)) {
        skippedCount += 1;
        console.error(
          `[${index + 1}/${windFarmRows.length}] Skipping ${windFarmRow.name} (ID ${windFarmRow.id}) because a published Operational report already exists. Use --force-refresh to rerun it.`,
        );
        continue;
      }

      console.error(
        operationalRefresh
          ? `[${index + 1}/${windFarmRows.length}] Running operational refresh for ${windFarmRow.name} (ID ${windFarmRow.id})`
          : `[${index + 1}/${windFarmRows.length}] Running research for ${windFarmRow.name} (ID ${windFarmRow.id})`,
      );
      try {
        const fileStem = `${windFarmRow.id}-${slugifyFileSegment(
          windFarmRow.name || `windfarm-${windFarmRow.id}`,
        )}`;
        const turbineMetadata = await getLinkedTurbineMetadataFn(client, windFarmRow.id, sourceTableName);
        const turbineCountValidation = await getTurbineCountValidationContextFn(
          client,
          windFarmRow.id,
          sourceTableName,
        );
        const projectContext = buildProjectContext({
          sourceTableName,
          turbineMetadata,
          turbineCountValidation,
          windFarmMetadata: {
            name: windFarmRow.name,
            type: windFarmRow.type,
            nTurbines: windFarmRow.n_turbines,
            powerMw: windFarmRow.power_mw,
            status: windFarmRow.status,
            primarySourceType: windFarmRow.primary_source_type,
            geometrySourceType: windFarmRow.geometry_source_type,
            sourcePolicyKey: windFarmRow.source_policy_key,
          },
        });
        const publishedReport = operationalRefresh
          ? await getLatestPublishedResearchReportFn(client, { windFarmId: windFarmRow.id })
          : null;

        if (operationalRefresh && !publishedReport?.report_markdown) {
          throw new Error(
            `Operational refresh requires a published report for ${windFarmRow.name} (ID ${windFarmRow.id}), but none could be loaded.`,
          );
        }

        const officialSourceContext = await buildOfficialSourceContextFn(windFarmRow.name);
        const promptContext = operationalRefresh
          ? buildOperationalRefreshContextFn({
              projectContext,
              publishedReportMarkdown: publishedReport.report_markdown,
            })
          : projectContext;
        const finalPrompt = buildResearchPromptFn(
          promptTemplate,
          [promptContext, officialSourceContext].filter(Boolean).join('\n'),
        );

        if (promptTraceEnabled) {
          const promptTracePath = path.join(
            promptTraceDirectory,
            `${fileStem}${operationalRefresh ? '-operational-refresh' : ''}.prompt.md`,
          );
          const savedPromptTracePath = await saveTextFileFn(promptTracePath, finalPrompt);
          console.error(
            `[${index + 1}/${windFarmRows.length}] Saved prompt trace for ${windFarmRow.name} to ${savedPromptTracePath}`,
          );
        }

        const report = await requestResearchReportFn({
          apiKey,
          model: DEFAULT_MODEL,
          prompt: finalPrompt,
          searchEngine: DEFAULT_SEARCH_ENGINE,
          maxResults: DEFAULT_MAX_RESULTS,
          maxTotalResults: DEFAULT_MAX_TOTAL_RESULTS,
          referer: process.env.OPENROUTER_SITE_URL,
          title: process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
        });
        const finalReport = operationalRefresh
          ? mergeOperationalRefreshReportFn({
              publishedReportMarkdown: publishedReport.report_markdown,
              refreshReportMarkdown: report,
            })
          : report;
        const outputPath = path.join(
          reportsDirectory,
          `${fileStem}.md`,
        );
        const savedPath = await saveReportFn(outputPath, finalReport);

        console.error(
          `[${index + 1}/${windFarmRows.length}] Saved ${windFarmRow.name} from ${sourceTableName} to ${savedPath}`,
        );

        const { reportId, factsInserted } = await storeResearchReportFn(client, {
          windFarmId: windFarmRow.id,
          reportMarkdown: finalReport,
          modelUsed: DEFAULT_MODEL,
          finalPrompt,
          reviewStatus,
        });

        console.error(
          `[${index + 1}/${windFarmRows.length}] Stored report #${reportId} with ${factsInserted} facts for ${windFarmRow.name}`,
        );

        completedCount += 1;
      } catch (error) {
        failedRows.push({
          id: windFarmRow.id,
          name: windFarmRow.name,
          message: error.message,
        });
        console.error(
          `[${index + 1}/${windFarmRows.length}] Failed ${windFarmRow.name} (ID ${windFarmRow.id}): ${error.message}`,
        );
      }
    }

    console.error(
      `Completed database-backed research run: ${completedCount} saved, ${skippedCount} skipped, ${failedRows.length} failed, ${windFarmRows.length} total.`,
    );

    if (failedRows.length > 0) {
      const failureSummary = failedRows
        .map((failure) => `${failure.name} (ID ${failure.id}): ${failure.message}`)
        .join(' | ');
      throw new Error(
        `Database-backed research run completed with ${failedRows.length} failed row(s): ${failureSummary}`,
      );
    }
  } finally {
    await client.end();
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  runDatabaseResearch().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
