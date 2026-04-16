import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHelp, parseCliArgs } from '../src/lib/args.js';
import {
  buildDatabaseConnectionString,
  createDatabaseClient,
} from '../src/lib/database.js';
import {
  getPromptTraceDirectory,
  isPromptTraceEnabled,
  slugifyFileSegment,
} from '../src/lib/report-output.js';
import { getWindFarmSourceTableName } from '../src/lib/windfarm-database.js';
import {
  extractTextContent,
  isCompletedResearchReport,
  normalizeSearchMode,
  requestResearchReport,
} from '../src/lib/openrouter.js';
import { buildProjectContext, buildResearchPrompt } from '../src/lib/prompt.js';

test('buildResearchPrompt replaces the project context placeholder', () => {
  const template = 'Research this project:\n{PROJECT_CONTEXT}\n';
  const result = buildResearchPrompt(template, 'Hornsea 3');

  assert.equal(result, 'Research this project:\nHornsea 3\n');
});

test('buildResearchPrompt still supports the legacy wind farm placeholder', () => {
  const template = 'Research this project:\n{WIND_FARM_NAME}\n';
  const result = buildResearchPrompt(template, 'Hornsea 3');

  assert.equal(result, 'Research this project:\nHornsea 3\n');
});

test('buildResearchPrompt rejects templates without a supported placeholder', () => {
  assert.throws(
    () => buildResearchPrompt('No placeholder here', 'Hornsea 3'),
    /Prompt template must include the \{PROJECT_CONTEXT\} or \{WIND_FARM_NAME\} placeholder\./,
  );
});

test('buildProjectContext formats wind farm and linked turbine metadata', () => {
  const result = buildProjectContext({
    sourceTableName: 'windfarm_database_test',
    windFarmMetadata: {
      name: 'Seagreen Phase 1 Windfarm',
      nTurbines: 75,
      powerMw: 1140,
      status: 'Production',
    },
    turbineMetadata: {
      oemManufacturer: 'Vestas',
      ratedPower: 15.0,
      rotorDiameter: 236,
      hubHeight: 125,
      turbineType: 'V236-15.0 MW',
      commissioningDate: '2023',
    },
  });

  assert.match(result, /Emodnet wind farm database metadata \(windfarm_database_test\):/);
  assert.match(result, /- Name: Seagreen Phase 1 Windfarm/);
  assert.match(result, /EuroWindWakes European Offshore Dataset \(2025\) turbine database metadata:/);
  assert.match(result, /- OEM manufacturer: Vestas/);
});

test('parseCliArgs supports positional names and flags', () => {
  const result = parseCliArgs([
    'Dogger',
    'Bank',
    'A',
    '--output',
    'reports\\dogger-bank-a.md',
    '--model=openai/gpt-4.1-mini',
    '--engine',
    'firecrawl',
    '--search-mode',
    'auto',
    '--max-results',
    '7',
    '--max-total-results=21',
  ]);

  assert.deepEqual(result, {
    engine: 'firecrawl',
    help: false,
    maxResults: 7,
    maxTotalResults: 21,
    model: 'openai/gpt-4.1-mini',
    outputPath: 'reports\\dogger-bank-a.md',
    promptPath: null,
    searchMode: 'auto',
    windFarmName: 'Dogger Bank A',
  });
});

test('formatHelp includes the main usage line', () => {
  const helpText = formatHelp({
    defaultPromptPath: 'C:\\repo\\prompt.md',
    defaultModel: 'openai/gpt-4.1',
    defaultSearchEngine: 'firecrawl',
    defaultSearchMode: 'plugin',
    defaultMaxResults: 6,
    defaultMaxTotalResults: 18,
  });

  assert.match(helpText, /npm run research -- "<wind farm name>" \[options\]/);
});

test('extractTextContent returns plain string content', () => {
  const result = extractTextContent({
    choices: [
      {
        message: {
          content: 'markdown report',
        },
      },
    ],
  });

  assert.equal(result, 'markdown report');
});

test('extractTextContent joins array content parts', () => {
  const result = extractTextContent({
    choices: [
      {
        message: {
          content: [
            { type: 'text', text: 'part one' },
            { type: 'output_text', text: '\npart two' },
          ],
        },
      },
    ],
  });

  assert.equal(result, 'part one\npart two');
});

test('isCompletedResearchReport validates the expected table headers', () => {
  assert.equal(
    isCompletedResearchReport(
      [
        '| Item | Completed detail | Sources |',
        '|---|---|---|',
        '| Date | Development | Why it matters | Sources |',
      ].join('\n'),
    ),
    true,
  );

  assert.equal(
    isCompletedResearchReport("I'll search for more information"),
    false,
  );
});

test('normalizeSearchMode accepts supported modes', () => {
  assert.equal(normalizeSearchMode('PLUGIN'), 'plugin');
  assert.equal(normalizeSearchMode('server-tool'), 'server-tool');
  assert.equal(normalizeSearchMode('auto'), 'auto');
});

test('requestResearchReport falls back to the web plugin when server-tool output is incomplete', async () => {
  const serverToolPayload = {
    choices: [
      {
        message: {
          content: "I'll search for current information about Dogger Bank A",
        },
      },
    ],
  };
  const pluginPayload = {
    choices: [
      {
        message: {
          content: [
            'This profile assesses Dogger Bank A.\n\n',
            '| Item | Completed detail | Sources |\n',
            '|---|---|---|\n',
            '| Date | Development | Why it matters | Sources |\n',
          ],
        },
      },
    ],
  };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const parsedBody = JSON.parse(options.body);

    calls.push(parsedBody);

    const payload = parsedBody.tools ? serverToolPayload : pluginPayload;

    return {
      ok: true,
      text: async () => JSON.stringify(payload),
    };
  };

  const result = await requestResearchReport({
    apiKey: 'test-key',
    fetchImpl,
    model: 'openai/gpt-4.1',
    prompt: 'Prompt',
    referer: '',
    title: '',
    searchEngine: 'firecrawl',
    searchMode: 'auto',
    maxResults: 6,
    maxTotalResults: 18,
  });

  assert.match(result, /Dogger Bank A/);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].tools);
  assert.ok(calls[1].plugins);
});

test('buildDatabaseConnectionString adds a no-verify sslmode when missing', () => {
  const result = buildDatabaseConnectionString(
    'postgresql://user:pass@example.supabase.co:5432/postgres',
  );

  assert.match(result, /sslmode=no-verify/);
});

test('buildDatabaseConnectionString forces no-verify sslmode for Supabase scripts', () => {
  const result = buildDatabaseConnectionString(
    'postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=require',
  );

  assert.match(result, /sslmode=no-verify/);
  assert.doesNotMatch(result, /sslmode=require/);
});

test('createDatabaseClient throws when DATABASE_URL is missing', () => {
  assert.throws(
    () => createDatabaseClient(''),
    /Missing DATABASE_URL\. Add your Supabase Postgres URL to \.env before running the linkage or database-backed research workflows\./,
  );
});

test('getWindFarmSourceTableName defaults to the live table', () => {
  assert.equal(getWindFarmSourceTableName(), 'windfarm_database');
});

test('getWindFarmSourceTableName allows the test table', () => {
  assert.equal(getWindFarmSourceTableName('windfarm_database_test'), 'windfarm_database_test');
});

test('getWindFarmSourceTableName rejects unsupported tables', () => {
  assert.throws(
    () => getWindFarmSourceTableName('windfarm_database_archive'),
    /Unsupported WIND_FARM_SOURCE_TABLE: windfarm_database_archive\. Use windfarm_database or windfarm_database_test\./,
  );
});

test('slugifyFileSegment normalizes report file names', () => {
  assert.equal(slugifyFileSegment('Fécamp Offshore Hautes Falaises'), 'fecamp-offshore-hautes-falaises');
});

test('isPromptTraceEnabled defaults to false and accepts true-like values', () => {
  assert.equal(isPromptTraceEnabled(), false);
  assert.equal(isPromptTraceEnabled('true'), true);
  assert.equal(isPromptTraceEnabled('1'), true);
});

test('getPromptTraceDirectory uses the configured directory', () => {
  const result = getPromptTraceDirectory('custom-traces');
  assert.match(result, /custom-traces$/);
});
