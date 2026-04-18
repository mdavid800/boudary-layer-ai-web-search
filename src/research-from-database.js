import dotenv from 'dotenv';
import path from 'node:path';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_PATH,
  DEFAULT_SEARCH_ENGINE,
  DEFAULT_SEARCH_MODE,
  requireValue,
} from './lib/runtime-config.js';
import { createDatabaseClient } from './lib/database.js';
import {
  getLinkedTurbineMetadata,
  getWindFarmReportsDirectory,
  getWindFarmSourceTableName,
  listWindFarmRows,
  resolveCoreWindFarmId,
} from './lib/windfarm-database.js';
import { requestResearchReport } from './lib/openrouter.js';
import { buildOfficialSourceContext } from './lib/official-source-hints.js';
import { buildProjectContext, buildResearchPrompt, loadPromptTemplate } from './lib/prompt.js';
import {
  getPromptTraceDirectory,
  isPromptTraceEnabled,
  saveReport,
  saveTextFile,
  slugifyFileSegment,
} from './lib/report-output.js';
import { storeResearchReport } from './lib/report-storage.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const publishFlag = process.argv.includes('--publish');

/**
 * Parse --ids and --country from process.argv.
 *   --ids 259,272,345       → [259, 272, 345]
 *   --country "United Kingdom"  → "United Kingdom"
 */
function parseFilterArgs(argv) {
  let ids = null;
  let country = null;

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
  }

  return { ids, country };
}

async function main() {
  const apiKey = requireValue(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY');
  const promptTemplate = await loadPromptTemplate(DEFAULT_PROMPT_PATH);
  const sourceTableName = getWindFarmSourceTableName();
  const reportsDirectory = path.join(getWindFarmReportsDirectory(), sourceTableName);
  const promptTraceEnabled = isPromptTraceEnabled();
  const promptTraceDirectory = path.join(getPromptTraceDirectory(), sourceTableName);
  const reviewStatus = publishFlag ? 'published' : 'draft';
  const { ids, country } = parseFilterArgs(process.argv);
  const client = createDatabaseClient();

  await client.connect();

  try {
    const windFarmRows = await listWindFarmRows(client, sourceTableName, { ids, country });
    let completedCount = 0;

    console.error(`Starting database-backed research run for ${windFarmRows.length} rows.`);
    console.error(`Using OpenRouter model: ${DEFAULT_MODEL}`);
    if (ids) console.error(`Filtering by IDs: ${ids.join(', ')}`);
    if (country) console.error(`Filtering by country: ${country}`);
    console.error(`Source table: ${sourceTableName}`);
    console.error(`Reports directory: ${reportsDirectory}`);

    if (promptTraceEnabled) {
      console.error(`Prompt trace: enabled (${promptTraceDirectory})`);
    } else {
      console.error('Prompt trace: disabled');
    }

    console.error(`Review status: ${reviewStatus}`);

    const isCore = sourceTableName === 'core_wind_farms';

    for (const [index, windFarmRow] of windFarmRows.entries()) {
      console.error(
        `[${index + 1}/${windFarmRows.length}] Running research for ${windFarmRow.name} (ID ${windFarmRow.id})`,
      );

      const fileStem = `${windFarmRow.id}-${slugifyFileSegment(
        windFarmRow.name || `windfarm-${windFarmRow.id}`,
      )}`;
      const turbineMetadata = await getLinkedTurbineMetadata(client, windFarmRow.id, sourceTableName);
      const projectContext = buildProjectContext({
        sourceTableName,
        turbineMetadata,
        windFarmMetadata: {
          name: windFarmRow.name,
          type: windFarmRow.type,
          nTurbines: windFarmRow.n_turbines,
          powerMw: windFarmRow.power_mw,
          status: windFarmRow.status,
        },
      });
      const officialSourceContext = await buildOfficialSourceContext(windFarmRow.name);
      const finalPrompt = buildResearchPrompt(
        promptTemplate,
        [projectContext, officialSourceContext].filter(Boolean).join('\n'),
      );

      if (promptTraceEnabled) {
        const promptTracePath = path.join(promptTraceDirectory, `${fileStem}.prompt.md`);
        const savedPromptTracePath = await saveTextFile(promptTracePath, finalPrompt);
        console.error(
          `[${index + 1}/${windFarmRows.length}] Saved prompt trace for ${windFarmRow.name} to ${savedPromptTracePath}`,
        );
      }

      const report = await requestResearchReport({
        apiKey,
        model: DEFAULT_MODEL,
        prompt: finalPrompt,
        searchEngine: DEFAULT_SEARCH_ENGINE,
        searchMode: DEFAULT_SEARCH_MODE,
        maxResults: DEFAULT_MAX_RESULTS,
        maxTotalResults: DEFAULT_MAX_TOTAL_RESULTS,
        referer: process.env.OPENROUTER_SITE_URL,
        title: process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
      });
      const outputPath = path.join(
        reportsDirectory,
        `${fileStem}.md`,
      );
      const savedPath = await saveReport(outputPath, report);

      console.error(
        `[${index + 1}/${windFarmRows.length}] Saved ${windFarmRow.name} from ${sourceTableName} to ${savedPath}`,
      );

      // Resolve the core_wind_farms.id for FK-constrained tables
      let coreWindFarmId = windFarmRow.id;
      if (!isCore) {
        const resolved = await resolveCoreWindFarmId(client, windFarmRow.name);
        if (!resolved) {
          console.error(
            `[${index + 1}/${windFarmRows.length}] ⚠ Skipping DB storage for ${windFarmRow.name} — no matching core_wind_farms row`,
          );
          completedCount += 1;
          continue;
        }
        coreWindFarmId = resolved;
      }

      const { reportId, factsInserted } = await storeResearchReport(client, {
        windFarmId: coreWindFarmId,
        reportMarkdown: report,
        modelUsed: DEFAULT_MODEL,
        finalPrompt,
        reviewStatus,
      });

      console.error(
        `[${index + 1}/${windFarmRows.length}] Stored report #${reportId} with ${factsInserted} facts for ${windFarmRow.name}`,
      );

      completedCount += 1;
    }

    console.error(
      `Completed database-backed research run: ${completedCount}/${windFarmRows.length} reports saved.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
