import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  getResearchReportQualityIssues,
  hasFreshOwnershipEvidence,
  isCompletedResearchReport,
  normalizeSearchMode,
  requestResearchReport,
} from '../src/lib/openrouter.js';
import { buildProjectContext, buildResearchPrompt } from '../src/lib/prompt.js';
import { buildOfficialSourceContext } from '../src/lib/official-source-hints.js';
import { normalizeCanonicalWindFarmStatus } from '../src/lib/status.js';
import { extractFactsFromReport } from '../src/lib/fact-extraction.js';
import { parseStructuredReport } from '../src/lib/report-structure.js';

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
    sourceTableName: 'core_wind_farms',
    windFarmMetadata: {
      name: 'Seagreen Phase 1 Windfarm',
      nTurbines: 75,
      powerMw: 1140,
      status: 'Operational',
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

  assert.match(result, /Emodnet wind farm database metadata \(core_wind_farms\):/);
  assert.match(result, /- Name: Seagreen Phase 1 Windfarm/);
  assert.match(result, /EuroWindWakes European Offshore Dataset \(2025\) turbine database metadata:/);
  assert.match(result, /- OEM manufacturer: Vestas/);
});

test('buildOfficialSourceContext injects official ownership hints for Beatrice', async () => {
  const html = [
    '<html><body>',
    '<div>Beatrice Offshore Windfarm Ltd is a joint venture partnership between:</div>',
    '<div>SSE Renewables (40% share)</div>',
    '<div>Red Rock Renewables (25% share)</div>',
    '<div>TRIG (17.5% share)</div>',
    '<div>Equitix (17.5% share)</div>',
    '</body></html>',
  ].join('');

  const result = await buildOfficialSourceContext('Beatrice Offshore Wind Farm', {
    fetchImpl: async () => ({
      ok: true,
      text: async () => html,
    }),
  });

  assert.match(result, /High-priority official source hints/);
  assert.match(result, /SSE Renewables \(40% share\)/);
  assert.match(result, /Red Rock Renewables \(25% share\)/);
  assert.match(result, /TRIG \(17\.5% share\)/);
  assert.match(result, /Equitix \(17\.5% share\)/);
});

test('normalizeCanonicalWindFarmStatus maps legacy and planning aliases into canonical statuses', () => {
  assert.equal(normalizeCanonicalWindFarmStatus('Production'), 'Operational');
  assert.equal(normalizeCanonicalWindFarmStatus('consented'), 'Consent Authorised');
  assert.equal(normalizeCanonicalWindFarmStatus('in planning'), 'Consent Application Submitted');
  assert.equal(normalizeCanonicalWindFarmStatus('lease area'), 'Development Zone / lease area');
  assert.equal(normalizeCanonicalWindFarmStatus('unsupported'), null);
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

test('runtime-config loads OPENROUTER_MODEL from .env before exporting defaults', () => {
  const childEnv = { ...process.env };
  delete childEnv.OPENROUTER_MODEL;

  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { DEFAULT_MODEL } from './src/lib/runtime-config.js'; console.log(DEFAULT_MODEL);",
    ],
    {
      cwd: process.cwd(),
      env: childEnv,
      encoding: 'utf8',
    },
  );

  assert.equal(output.trim(), 'openai/gpt-5.4');
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
        '| Item | Value | Research summary | Sources |',
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
            '| Item | Value | Research summary | Sources |\n',
            '|---|---|---|---|\n',
            '| Developer / owners | SSE Renewables 50%, Equinor 50% | SSE portfolio page updated November 2024 and Equinor asset page updated January 2025 confirm the current ownership split. | [Source 1](https://example.com/source-0), [Source 2](https://example.com/source-0b) |\n',
            '| Ownership history | SSE and Equinor remain the project owners. | Owner pages updated November 2024 and January 2025 do not indicate a later ownership change. | [Source 1](https://example.com/source-0c), [Source 2](https://example.com/source-0d) |\n',
            '| Status | Operational | Confirmed by owner and regulator materials. | [Source 1](https://example.com/source-1), [Source 2](https://example.com/source-2) |\n',
            'Recent developments\n\n',
            '| Date | Development | Why it matters | Sources |\n',
            '|---|---|---|---|\n',
            '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/source-3), [Source 2](https://example.com/source-4) |\n',
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
  assert.equal(calls.length, 3);
  assert.ok(calls[0].tools);
  assert.ok(calls[1].tools);
  assert.ok(calls[2].plugins);
});

test('hasFreshOwnershipEvidence requires recent dated evidence in both ownership rows', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      research_summary: 'SSE portfolio page updated November 2024 confirms SSE 40%, CIP 35%, Red Rock Power 25%.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      research_summary: 'Beatrice ownership page updated January 2025 shows no subsequent change to the equity split.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
  ];

  assert.equal(hasFreshOwnershipEvidence(profileRows, [], new Date('2026-04-17T00:00:00Z')), true);
});

test('hasFreshOwnershipEvidence accepts a recent dated ownership development signal', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      research_summary: 'Current owner pages describe the project ownership structure.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      research_summary: 'Current sources suggest no later equity change.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
  ];
  const recentDevelopments = [
    {
      date: '2025',
      development: 'No confirmed ownership change identified in current sources',
      why_it_matters: 'Supports the current ownership split remaining unchanged.',
    },
  ];

  assert.equal(
    hasFreshOwnershipEvidence(profileRows, recentDevelopments, new Date('2026-04-17T00:00:00Z')),
    true,
  );
});

test('hasFreshOwnershipEvidence rejects access-date language as freshness evidence', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      research_summary: 'SSE portfolio page current as accessed 2026 confirms the ownership split.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      research_summary: 'Project site current as accessed 2026 indicates no later equity change.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
  ];

  assert.equal(hasFreshOwnershipEvidence(profileRows, [], new Date('2026-04-17T00:00:00Z')), false);
});

test('getResearchReportQualityIssues flags stale ownership evidence', () => {
  const markdown = [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | Owner pages describe the current ownership structure. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Current sources suggest no change. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Status | Operational | Current owner pages describe the project as operational. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| November 2024 | Portfolio reporting update | Confirms the project remains operational. | [Owner](https://example.com/event-1), [Investor](https://example.com/event-2) |',
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['stale-ownership-evidence'],
  );
});

test('requestResearchReport retries when the first plugin report lacks fresh ownership evidence', async () => {
  const stalePluginPayload = {
    choices: [
      {
        message: {
          content: [
            'This profile assesses Beatrice Offshore Wind Farm.\n\n',
            '| Item | Value | Research summary | Sources |\n',
            '|---|---|---|---|\n',
            '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | Owner pages describe the current ownership structure. | [Source 1](https://example.com/source-1), [Source 2](https://example.com/source-2) |\n',
            '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Current sources suggest no change. | [Source 1](https://example.com/source-3), [Source 2](https://example.com/source-4) |\n',
            '| Status | Operational | Confirmed by owner and regulator materials. | [Source 1](https://example.com/source-5), [Source 2](https://example.com/source-6) |\n',
            'Recent developments\n\n',
            '| Date | Development | Why it matters | Sources |\n',
            '|---|---|---|---|\n',
            '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/source-7), [Source 2](https://example.com/source-8) |\n',
          ],
        },
      },
    ],
  };
  const freshPluginPayload = {
    choices: [
      {
        message: {
          content: [
            'This profile assesses Beatrice Offshore Wind Farm.\n\n',
            '| Item | Value | Research summary | Sources |\n',
            '|---|---|---|---|\n',
            '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | SSE portfolio page updated November 2024 and Beatrice ownership page updated January 2025 confirm SSE 40%, CIP 35%, and Red Rock Power 25%. | [Source 1](https://example.com/source-1), [Source 2](https://example.com/source-2) |\n',
            '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Beatrice ownership material updated January 2025 indicates no later equity change after construction. | [Source 1](https://example.com/source-3), [Source 2](https://example.com/source-4) |\n',
            '| Status | Operational | Confirmed by owner and regulator materials. | [Source 1](https://example.com/source-5), [Source 2](https://example.com/source-6) |\n',
            'Recent developments\n\n',
            '| Date | Development | Why it matters | Sources |\n',
            '|---|---|---|---|\n',
            '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/source-7), [Source 2](https://example.com/source-8) |\n',
          ],
        },
      },
    ],
  };
  const prompts = [];
  let callCount = 0;

  const fetchImpl = async (_url, options) => {
    const parsedBody = JSON.parse(options.body);
    prompts.push(parsedBody.messages[1].content);
    callCount += 1;

    return {
      ok: true,
      text: async () => JSON.stringify(callCount === 1 ? stalePluginPayload : freshPluginPayload),
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
    searchMode: 'plugin',
    maxResults: 6,
    maxTotalResults: 18,
  });

  assert.match(result, /November 2024/);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Critical correction for this retry:/);
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
  assert.equal(getWindFarmSourceTableName(), 'core_wind_farms');
});

test('getWindFarmSourceTableName allows the legacy table', () => {
  assert.equal(getWindFarmSourceTableName('windfarm_database'), 'windfarm_database');
});

test('getWindFarmSourceTableName rejects unsupported tables', () => {
  assert.throws(
    () => getWindFarmSourceTableName('windfarm_database_archive'),
    /Unsupported WIND_FARM_SOURCE_TABLE: windfarm_database_archive/,
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

test('parseStructuredReport extracts ordered profile rows and recent developments', () => {
  const markdown = [
    'This profile assesses Seagreen Phase 1.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Project identity | **Seagreen Phase 1 Wind Farm** | Distinguishes Phase 1 from later concepts. | [Owner](https://example.com/owner), [Regulator](https://example.com/regulator) |',
    '| Status | Operational | Owner and regulator pages both treat the project as operational. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '| Maximum Export Capacity (MEC) | Not confirmed | Public sources reviewed do not publish a clear as-built MEC. | [Owner](https://example.com/mec-1), [Regulator](https://example.com/mec-2) |',
    '',
    'A short nuance paragraph.',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | OFTO licences granted | Confirms a post-COD regulatory milestone. | [Ofgem](https://example.com/event-1), [Industry](https://example.com/event-2) |',
  ].join('\n');

  const result = parseStructuredReport(markdown);

  assert.equal(result.profileRows.length, 3);
  assert.deepEqual(result.profileRows[0], {
    item_label: 'Project identity',
    field_name: null,
    value: 'Seagreen Phase 1 Wind Farm',
    research_summary: 'Distinguishes Phase 1 from later concepts.',
    sources: [
      { label: 'Owner', url: 'https://example.com/owner' },
      { label: 'Regulator', url: 'https://example.com/regulator' },
    ],
    is_not_confirmed: false,
  });
  assert.equal(result.profileRows[1].field_name, 'status');
  assert.equal(result.profileRows[2].field_name, 'mec_mw');
  assert.equal(result.profileRows[2].is_not_confirmed, true);
  assert.deepEqual(result.recentDevelopments, [
    {
      date: 'April 2024',
      development: 'OFTO licences granted',
      why_it_matters: 'Confirms a post-COD regulatory milestone.',
      sources: [
        { label: 'Ofgem', url: 'https://example.com/event-1' },
        { label: 'Industry', url: 'https://example.com/event-2' },
      ],
    },
  ]);
});

test('extractFactsFromReport skips not confirmed rows and keeps mapped rows', () => {
  const markdown = [
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Status | Operational | Confirmed by owner sources. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '| Maximum Export Capacity (MEC) | Not confirmed | No clear value found. | [Owner](https://example.com/mec-1), [Regulator](https://example.com/mec-2) |',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | OFTO licences granted | Confirms a milestone. | [Ofgem](https://example.com/event-1), [Industry](https://example.com/event-2) |',
  ].join('\n');

  assert.deepEqual(extractFactsFromReport(markdown), [
    {
      fieldName: 'status',
      value: 'Operational',
      citationUrl: 'https://example.com/status-1',
    },
  ]);
});
