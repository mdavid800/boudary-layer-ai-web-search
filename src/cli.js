import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { formatHelp, parseCliArgs } from './lib/args.js';
import { buildOfficialSourceContext } from './lib/official-source-hints.js';
import { requestResearchReportWithProvider } from './lib/research-provider.js';
import { buildResearchPrompt, loadPromptTemplate } from './lib/prompt.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_TOTAL_RESULTS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_PATH,
  DEFAULT_SEARCH_ENGINE,
  DEFAULT_RESEARCH_PROVIDER,
  getDefaultModelForProvider,
  getResearchProvider,
  getApiKeyForProvider,
} from './lib/runtime-config.js';
import { saveReport as saveReportToFile } from './lib/report-output.js';
import { formatErrorWithCause } from './lib/error-format.js';

dotenv.config();

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      formatHelp({
        defaultPromptPath: DEFAULT_PROMPT_PATH,
        defaultModel: DEFAULT_MODEL,
        defaultCodexModel: DEFAULT_CODEX_MODEL,
        defaultSearchEngine: DEFAULT_SEARCH_ENGINE,
        defaultMaxResults: DEFAULT_MAX_RESULTS,
        defaultMaxTotalResults: DEFAULT_MAX_TOTAL_RESULTS,
        defaultResearchProvider: DEFAULT_RESEARCH_PROVIDER,
      }),
    );
    return;
  }

  const provider = getResearchProvider(args.provider || DEFAULT_RESEARCH_PROVIDER);
  const apiKey = getApiKeyForProvider(provider);
  const windFarmName = await resolveWindFarmName(args.windFarmName);
  const promptPath = path.resolve(process.cwd(), args.promptPath || DEFAULT_PROMPT_PATH);
  const promptTemplate = await loadPromptTemplate(promptPath);
  const officialSourceContext = await buildOfficialSourceContext(windFarmName);
  const finalPrompt = buildResearchPrompt(
    promptTemplate,
    [windFarmName, officialSourceContext].filter(Boolean).join('\n'),
  );
  const model = args.model || getDefaultModelForProvider(provider);
  const searchEngine = args.engine || DEFAULT_SEARCH_ENGINE;

  console.error(`Using research provider: ${provider}`);
  console.error(`Using model: ${model}`);

  const report = await requestResearchReportWithProvider({
    provider,
    apiKey,
    model,
    prompt: finalPrompt,
    searchEngine,
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
  console.error(formatErrorWithCause(error));
  process.exitCode = 1;
});
