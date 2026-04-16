import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { formatHelp, parseCliArgs } from './lib/args.js';
import { requestResearchReport } from './lib/openrouter.js';
import { buildResearchPrompt, loadPromptTemplate } from './lib/prompt.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_PATH,
  DEFAULT_SEARCH_ENGINE,
  DEFAULT_SEARCH_MODE,
  requireValue,
} from './lib/runtime-config.js';
import { saveReport as saveReportToFile } from './lib/report-output.js';

dotenv.config();

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      formatHelp({
        defaultPromptPath: DEFAULT_PROMPT_PATH,
        defaultModel: DEFAULT_MODEL,
        defaultSearchEngine: DEFAULT_SEARCH_ENGINE,
        defaultSearchMode: DEFAULT_SEARCH_MODE,
        defaultMaxResults: DEFAULT_MAX_RESULTS,
        defaultMaxTotalResults: DEFAULT_MAX_TOTAL_RESULTS,
      }),
    );
    return;
  }

  const apiKey = requireValue(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY');
  const windFarmName = await resolveWindFarmName(args.windFarmName);
  const promptPath = path.resolve(process.cwd(), args.promptPath || DEFAULT_PROMPT_PATH);
  const promptTemplate = await loadPromptTemplate(promptPath);
  const finalPrompt = buildResearchPrompt(promptTemplate, windFarmName);

  const report = await requestResearchReport({
    apiKey,
    model: args.model || DEFAULT_MODEL,
    prompt: finalPrompt,
    searchEngine: args.engine || DEFAULT_SEARCH_ENGINE,
    searchMode: args.searchMode || DEFAULT_SEARCH_MODE,
    maxResults: args.maxResults || DEFAULT_MAX_RESULTS,
    maxTotalResults: args.maxTotalResults || DEFAULT_MAX_TOTAL_RESULTS,
    referer: process.env.OPENROUTER_SITE_URL,
    title: process.env.OPENROUTER_SITE_NAME || 'boundary-layer-ai-web-search',
  });

  console.log(report);

  if (args.outputPath) {
    const savedPath = await saveReportToFile(args.outputPath, report);
    console.error(`Saved report to ${savedPath}`);
  }
}

async function resolveWindFarmName(initialValue) {
  if (initialValue?.trim()) {
    return initialValue.trim();
  }

  const cli = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await cli.question('Wind farm name: ');

    if (!answer.trim()) {
      throw new Error('A wind farm name is required.');
    }

    return answer.trim();
  } finally {
    cli.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
