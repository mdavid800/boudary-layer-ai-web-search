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
import {
  getPublishedResearchRunState,
  getWindFarmSourceTableName,
  listWindFarmRows,
} from '../src/lib/windfarm-database.js';
import {
  buildOperationalRefreshContext,
  mergeOperationalRefreshReport,
} from '../src/lib/operational-refresh.js';
import {
  buildBlockedRowRepairPrompt,
  extractTextContent,
  getResearchReportQualityIssues,
  hasFreshOwnershipEvidence,
  isCompletedResearchReport,
  requestBlockedRowRepair,
  requestResearchReport,
} from '../src/lib/openrouter.js';
import { buildProjectContext, buildResearchPrompt } from '../src/lib/prompt.js';
import {
  parseResearchDatabaseArgs,
  runDatabaseResearch,
  shouldSkipPublishedOperationalReport,
} from '../src/research-from-database.js';
import { buildOfficialSourceContext } from '../src/lib/official-source-hints.js';
import { normalizeCanonicalWindFarmStatus } from '../src/lib/status.js';
import { extractFactsFromReport } from '../src/lib/fact-extraction.js';
import { buildReportEvidenceRows } from '../src/lib/report-evidence.js';
import { parseStructuredReport } from '../src/lib/report-structure.js';
import { pruneObsoleteDraftReports } from '../src/lib/report-storage.js';
import { EUROWINDWAKES_ZENODO_RECORD_URL } from '../src/lib/source-of-record.js';
import { verifyEvidenceRecord, verifyReportEvidence } from '../src/lib/evidence-verifier.js';
import { publishDraftReports } from '../src/publish-reports.js';
import {
  publishDraftResearchReport,
  rejectDraftResearchReport,
  suggestDraftResearchReportRepair,
  verifyDraftResearchReport,
} from '../src/lib/report-moderation.js';
import {
  formatVerifyReportsHelp,
  parseVerifyReportsArgs,
  verifyDraftReports,
} from '../src/verify-reports.js';

function createSourceOfRecord(overrides = {}) {
  return {
    source_url: 'https://example.com/source-of-record',
    source_name: 'Example source',
    source_type: 'official project',
    licence: 'unknown',
    retrieved_at: '2026-04-21T00:00:00Z',
    evidence_quote: 'Example evidence quote.',
    confidence: 'high',
    derived_by_ai: true,
    human_verified: false,
    verification_status: 'unverified',
    ...overrides,
  };
}

function createProvenanceAppendix({ profileRows = [], recentDevelopments = [] } = {}) {
  return [
    '',
    'Provenance appendix',
    '```json',
    JSON.stringify({
      profile_rows: profileRows,
      recent_developments: recentDevelopments,
    }, null, 2),
    '```',
  ].join('\n');
}

function createPublishedOperationalReportMarkdown() {
  return [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Project identity | Beatrice Offshore Wind Farm | Confirms the built project identity. | [Owner](https://example.com/project-1), [Regulator](https://example.com/project-2) |',
    '| Developer / owners | SSE 40%, Red Rock Renewables 25%, TRIG 17.5%, Equitix 17.5% | SSE portfolio page updated November 2024 confirms the current ownership split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE, Red Rock Renewables, TRIG and Equitix have remained the published owners since the latest portfolio update. | Owner materials updated January 2025 indicate no later equity change. | [History](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Status | Operational | Current owner and regulator sources both confirm operations. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '| Capacity | 588 MW | Current project pages confirm 588 MW. | [Owner](https://example.com/capacity-1), [Regulator](https://example.com/capacity-2) |',
    '',
    'A short nuance paragraph that should survive a targeted refresh merge.',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| 15/05/2024 | OFTO transfer closed | Marks a post-operations ownership and transmission milestone. | [Ofgem](https://example.com/event-1), [Industry](https://example.com/event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Project identity',
          field_name: null,
          value: 'Beatrice Offshore Wind Farm',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/project-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/project-2' }],
        },
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, Red Rock Renewables 25%, TRIG 17.5%, Equitix 17.5%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE, Red Rock Renewables, TRIG and Equitix have remained the published owners since the latest portfolio update.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/status-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/status-2' }],
        },
        {
          item_label: 'Capacity',
          field_name: 'capacity_mw',
          value: '588 MW',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/capacity-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/capacity-2' }],
        },
      ],
      recentDevelopments: [
        {
          date: '15/05/2024',
          development: 'OFTO transfer closed',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Industry', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');
}

function createOperationalRefreshReportMarkdown() {
  return [
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, Red Rock Renewables 25%, TRIG 17.5%, Equitix 17.5% | SSE portfolio page updated February 2026 and operator material updated March 2026 confirm the current ownership split. | [Owner](https://example.com/refresh-owner-1), [Operator](https://example.com/refresh-owner-2) |',
    '| Ownership history | SSE, Red Rock Renewables, TRIG and Equitix remain the owners, and refreshed 2026 sources do not indicate a later transfer. | SSE portfolio material updated February 2026 and operator material updated March 2026 show no subsequent equity change. | [History](https://example.com/refresh-history-1), [Operator](https://example.com/refresh-history-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| 10/03/2026 | Operator portfolio page refreshed the Beatrice ownership description | Provides a dated current-state ownership check inside the monitoring window. | [Operator](https://example.com/refresh-event-1), [Owner](https://example.com/refresh-event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, Red Rock Renewables 25%, TRIG 17.5%, Equitix 17.5%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/refresh-owner-1' }),
          supporting_context: [{ label: 'Operator', url: 'https://example.com/refresh-owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE, Red Rock Renewables, TRIG and Equitix remain the owners, and refreshed 2026 sources do not indicate a later transfer.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/refresh-history-1' }),
          supporting_context: [{ label: 'Operator', url: 'https://example.com/refresh-history-2' }],
        },
      ],
      recentDevelopments: [
        {
          date: '10/03/2026',
          development: 'Operator portfolio page refreshed the Beatrice ownership description',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/refresh-event-1' }),
          supporting_context: [{ label: 'Owner', url: 'https://example.com/refresh-event-2' }],
        },
      ],
    }),
  ].join('\n');
}

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

  assert.match(result, /Cleaned EMODnet fallback row metadata \(core_wind_farms, lower-confidence for turbine technical fields\):/);
  assert.match(result, /- Name: Seagreen Phase 1 Windfarm/);
  assert.match(result, /Core row source-policy context/);
  assert.match(result, /- Primary row source: Not provided/);
  assert.match(result, /EuroWindWakes European Offshore Dataset \(2025\) linked project turbine metadata \(required fallback for turbine specs and hub height when project-specific web evidence is inconclusive; do not replace it with generic turbine-model pages or specs from other sites\):/);
  assert.match(result, /- OEM manufacturer: Vestas/);
});

test('buildProjectContext describes authoritative regional primary rows without treating EMODnet as the baseline', () => {
  const result = buildProjectContext({
    sourceTableName: 'core_wind_farms',
    windFarmMetadata: {
      name: 'Moray East',
      type: 'Offshore wind farm',
      nTurbines: 100,
      powerMw: 950,
      status: 'Operational',
      primarySourceType: 'crown_estate_scotland',
      geometrySourceType: 'crown_estate_scotland',
      sourcePolicyKey: 'uk_crown_estate_scotland_wind_farms',
    },
    turbineMetadata: null,
  });

  assert.match(result, /Authoritative regional source-of-record row metadata/);
  assert.match(result, /- Primary row source: Crown Estate Scotland/);
  assert.match(result, /- Geometry source: Crown Estate Scotland/);
  assert.match(result, /- Source precedence policy: uk_crown_estate_scotland_wind_farms/);
  assert.match(result, /Cleaned EMODnet values should be treated only as matched enrichment/);
});

test('buildProjectContext warns against silently substituting a similarly named project', () => {
  const result = buildProjectContext({
    sourceTableName: 'core_wind_farms',
    windFarmMetadata: {
      name: 'Hesselk',
      type: 'Offshore wind farm',
      nTurbines: 0,
      powerMw: null,
      status: 'Unknown',
    },
    turbineMetadata: null,
  });

  assert.match(result, /- Exact target project name from the core row: Hesselk/);
  assert.match(result, /Do not silently rewrite, normalize, or substitute this project to a different wind farm/);
  assert.match(result, /explicitly say there is an identity mismatch and keep unsupported fields as Not confirmed/);
});

test('buildProjectContext includes turbine-count validation and approved community signals when available', () => {
  const result = buildProjectContext({
    sourceTableName: 'core_wind_farms',
    windFarmMetadata: {
      name: 'Seagreen Phase 1 Windfarm',
      nTurbines: 75,
      powerMw: 1140,
      status: 'Operational',
    },
    turbineMetadata: null,
    turbineCountValidation: {
      winningFact: {
        value: '114',
        sourceDetail: 'community note #12',
      },
      calculatedFact: {
        value: '114',
        sourceDetail: 'Calculated from 114 linked EuroWindWakes turbine locations',
      },
      emodnetFact: {
        value: '75',
      },
      communitySummary: {
        approvedNoteCount: 2,
        totalUpvotes: 9,
        topProposedValues: [
          {
            value: '114',
            noteCount: 2,
            totalUpvotes: 9,
            promotedNoteCount: 1,
          },
        ],
      },
    },
  });

  assert.match(result, /Structured turbine-count validation context/);
  assert.match(result, /Current database winner candidate: 114 \(community note #12\)/);
  assert.match(result, /EuroWindWakes calculated linked-turbine count: 114/);
  assert.match(result, /EMODnet turbine-count hint: 75/);
  assert.match(result, /Approved community turbine-count notes: 2 note\(s\), 9 total upvote\(s\)/);
});

test('buildProjectContext warns against generic turbine-model inference when no linked turbine metadata exists', () => {
  const result = buildProjectContext({
    sourceTableName: 'core_wind_farms',
    windFarmMetadata: {
      name: 'Morven',
      nTurbines: 0,
      powerMw: 2907,
      status: 'Planned',
    },
    turbineMetadata: null,
  });

  assert.match(result, /No linked turbine metadata was found for this wind farm boundary\./);
  assert.match(result, /use Not confirmed rather than inferring from another site that uses the same turbine model\./);
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

  const result = await buildOfficialSourceContext('Beatrice', {
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

test('buildOfficialSourceContext matches project aliases for UK ownership hints', async () => {
  const html = [
    '<html><body>',
    '<div>The Dogger Bank offshore wind farm is a joint venture partnership between SSE (40%), Equinor (40%) and Vårgrønn (20%).</div>',
    '</body></html>',
  ].join('');

  const result = await buildOfficialSourceContext('Dogger Bank A', {
    fetchImpl: async () => ({
      ok: true,
      text: async () => html,
    }),
  });

  assert.match(result, /High-priority official source hints/);
  assert.match(result, /SSE \(40%\), Equinor \(40%\) and Vårgrønn \(20%\)/);
});

test('normalizeCanonicalWindFarmStatus maps legacy and planning aliases into canonical statuses', () => {
  assert.equal(normalizeCanonicalWindFarmStatus('Production'), 'Operational');
  assert.equal(normalizeCanonicalWindFarmStatus('Dismantled'), 'Decommissioned');
  assert.equal(normalizeCanonicalWindFarmStatus('consented'), 'Consented');
  assert.equal(
    normalizeCanonicalWindFarmStatus('in planning'),
    'In Planning / Consent Application Submitted',
  );
  assert.equal(
    normalizeCanonicalWindFarmStatus('lease awarded, pre-planning'),
    'Lease Awarded, Pre-Planning',
  );
  assert.equal(normalizeCanonicalWindFarmStatus('planned'), 'Concept');
  assert.equal(normalizeCanonicalWindFarmStatus('lease area'), 'Development Zone / lease area');
  assert.equal(normalizeCanonicalWindFarmStatus('cancelled'), 'Archive');
  assert.equal(normalizeCanonicalWindFarmStatus('archived'), 'Archive');
  assert.equal(normalizeCanonicalWindFarmStatus('unsupported'), null);
});

test('normalizeCanonicalWindFarmStatus treats Princess Elisabeth lots as development zones', () => {
  assert.equal(
    normalizeCanonicalWindFarmStatus('lease awarded, pre-planning', {
      windFarmName: 'Princess Elisabeth Zone Lot 1',
    }),
    'Development Zone / lease area',
  );
  assert.equal(
    normalizeCanonicalWindFarmStatus('planned', {
      windFarmName: 'Princess Elisabeth Zone Lot 3',
    }),
    'Development Zone / lease area',
  );
  assert.equal(
    normalizeCanonicalWindFarmStatus('lease awarded, pre-planning', {
      windFarmName: 'Dogger Bank A',
    }),
    'Lease Awarded, Pre-Planning',
  );
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
    'auto',
    '--max-results',
    '7',
    '--max-total-results=21',
  ]);

  assert.deepEqual(result, {
    engine: 'auto',
    help: false,
    maxResults: 7,
    maxTotalResults: 21,
    model: 'openai/gpt-4.1-mini',
    outputPath: 'reports\\dogger-bank-a.md',
    promptPath: null,
    provider: null,
    windFarmName: 'Dogger Bank A',
  });
});

test('formatHelp includes the main usage line', () => {
  const helpText = formatHelp({
    defaultPromptPath: 'C:\\repo\\prompt.md',
    defaultModel: 'openai/gpt-4.1',
    defaultCodexModel: 'gpt-5.4-2026-03-05',
    defaultSearchEngine: 'auto',
    defaultMaxResults: 6,
    defaultMaxTotalResults: 18,
    defaultResearchProvider: 'openrouter',
  });

  assert.match(helpText, /npm run research -- "<wind farm name>" \[options\]/);
  assert.match(helpText, /Research model override \(defaults: openrouter=openai\/gpt-4\.1, codex=gpt-5\.4-2026-03-05\)/);
  assert.match(helpText, /Search engine \(default: auto\)/);
  assert.match(helpText, /Research provider: openrouter\|codex/);
});

test('parseResearchDatabaseArgs supports filters and force refresh', () => {
  const result = parseResearchDatabaseArgs([
    'node',
    'src/research-from-database.js',
    '--ids',
    '259,272',
    '--country',
    'United Kingdom',
    '--wind-farm-type',
    'Offshore wind farm',
    '--skip-existing-reports',
    '--publish',
    '--force-refresh',
    '--provider',
    'codex',
  ]);

  assert.deepEqual(result, {
    ids: [259, 272],
    country: 'United Kingdom',
    windFarmType: 'Offshore wind farm',
    skipExistingReports: true,
    publish: true,
    forceRefresh: true,
    operationalRefresh: false,
    provider: 'codex',
  });
});

test('parseResearchDatabaseArgs supports operational refresh mode', () => {
  const result = parseResearchDatabaseArgs([
    'node',
    'src/research-from-database.js',
    '--operational-refresh',
  ]);

  assert.deepEqual(result, {
    ids: null,
    country: null,
    windFarmType: null,
    skipExistingReports: false,
    publish: false,
    forceRefresh: false,
    operationalRefresh: true,
    provider: null,
  });
});

test('parseVerifyReportsArgs supports ids and json output', () => {
  const result = parseVerifyReportsArgs([
    '--ids',
    '208,209,208',
    '--json',
    '--repair',
  ]);

  assert.deepEqual(result, {
    help: false,
    ids: [208, 209],
    json: true,
    repair: true,
  });
});

test('parseVerifyReportsArgs rejects invalid ids', () => {
  assert.throws(
    () => parseVerifyReportsArgs(['--ids', '208,nope']),
    /--ids must be a comma-separated list of positive integers/,
  );
});

test('formatVerifyReportsHelp includes the verify-reports usage line', () => {
  const helpText = formatVerifyReportsHelp();

  assert.match(helpText, /npm run verify-reports -- \[options\]/);
  assert.match(helpText, /Verify only the selected draft report ids/);
  assert.match(helpText, /Repair blocked draft rows and re-verify without publishing/);
});

test('buildOperationalRefreshContext summarizes current ownership and recent developments', () => {
  const result = buildOperationalRefreshContext({
    projectContext: 'Beatrice Offshore Wind Farm',
    publishedReportMarkdown: createPublishedOperationalReportMarkdown(),
  });

  assert.match(result, /Developer \/ owners: SSE 40%, Red Rock Renewables 25%, TRIG 17\.5%, Equitix 17\.5%/);
  assert.match(result, /Ownership history: SSE, Red Rock Renewables, TRIG and Equitix have remained/);
  assert.match(result, /15\/05\/2024: OFTO transfer closed/);
});

test('mergeOperationalRefreshReport replaces targeted sections and keeps static profile rows', () => {
  const merged = mergeOperationalRefreshReport({
    publishedReportMarkdown: createPublishedOperationalReportMarkdown(),
    refreshReportMarkdown: createOperationalRefreshReportMarkdown(),
  });
  const parsed = parseStructuredReport(merged);

  assert.match(merged, /A short nuance paragraph that should survive a targeted refresh merge\./);
  assert.equal(
    parsed.profileRows.find((row) => row.item_label === 'Developer / owners')?.research_summary,
    'SSE portfolio page updated February 2026 and operator material updated March 2026 confirm the current ownership split.',
  );
  assert.equal(
    parsed.profileRows.find((row) => row.item_label === 'Ownership history')?.value,
    'SSE, Red Rock Renewables, TRIG and Equitix remain the owners, and refreshed 2026 sources do not indicate a later transfer.',
  );
  assert.equal(
    parsed.profileRows.find((row) => row.item_label === 'Capacity')?.value,
    '588 MW',
  );
  assert.equal(parsed.recentDevelopments.length, 1);
  assert.equal(parsed.recentDevelopments[0].date, '10/03/2026');
  assert.equal(
    parsed.recentDevelopments[0].development,
    'Operator portfolio page refreshed the Beatrice ownership description',
  );
  assert.equal(parsed.provenanceAppendix.profile_rows.length, 5);
});

test('shouldSkipPublishedOperationalReport skips only when default mode sees an operational published report', () => {
  assert.equal(
    shouldSkipPublishedOperationalReport(
      { forceRefresh: false },
      { hasPublishedReport: true, hasOperationalPublishedReport: true },
    ),
    true,
  );

  assert.equal(
    shouldSkipPublishedOperationalReport(
      { forceRefresh: false },
      { hasPublishedReport: true, hasOperationalPublishedReport: false },
    ),
    false,
  );

  assert.equal(
    shouldSkipPublishedOperationalReport(
      { forceRefresh: true },
      { hasPublishedReport: true, hasOperationalPublishedReport: true },
    ),
    false,
  );
});

test('getPublishedResearchRunState returns latest published report state by wind farm', async () => {
  let capturedValues = null;
  const fakeClient = {
    query: async (_text, values = []) => {
      capturedValues = values;
      return {
        rows: [
          {
            wind_farm_id: 6646,
            has_published_report: true,
            has_operational_published_report: true,
          },
          {
            wind_farm_id: 6653,
            has_published_report: true,
            has_operational_published_report: false,
          },
        ],
      };
    },
  };

  const result = await getPublishedResearchRunState(fakeClient, [6646, 6653]);

  assert.deepEqual(capturedValues, [[6646, 6653]]);
  assert.deepEqual(result.get(6646), {
    hasPublishedReport: true,
    hasOperationalPublishedReport: true,
  });
  assert.deepEqual(result.get(6653), {
    hasPublishedReport: true,
    hasOperationalPublishedReport: false,
  });
});

test('runDatabaseResearch skips published operational reports unless forced', async () => {
  const loggedMessages = [];
  const originalConsoleError = console.error;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  let requestCallCount = 0;
  let storeCallCount = 0;

  console.error = (message) => loggedMessages.push(String(message));
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fakeClient = {
    connect: async () => {},
    end: async () => {},
  };

  try {
    await runDatabaseResearch({
      argv: ['node', 'src/research-from-database.js'],
      createClient: () => fakeClient,
      loadPromptTemplateFn: async () => 'Research this project:\n{PROJECT_CONTEXT}\n',
      listWindFarmRowsFn: async () => ([
        {
          id: 6646,
          name: 'Beatrice Offshore Wind Farm',
          type: 'Offshore wind farm',
          n_turbines: 84,
          power_mw: 588,
          status: 'Operational',
        },
        {
          id: 6653,
          name: 'Seagreen Phase 1 Windfarm',
          type: 'Offshore wind farm',
          n_turbines: 114,
          power_mw: 1075,
          status: 'Operational',
        },
      ]),
      getPublishedResearchRunStateFn: async () => new Map([
        [6646, { hasPublishedReport: true, hasOperationalPublishedReport: true }],
        [6653, { hasPublishedReport: true, hasOperationalPublishedReport: false }],
      ]),
      getLinkedTurbineMetadataFn: async () => null,
      getTurbineCountValidationContextFn: async () => null,
      buildOfficialSourceContextFn: async () => '',
      requestResearchReportFn: async () => {
        requestCallCount += 1;
        return '# Report';
      },
      saveReportFn: async () => 'saved-path',
      saveTextFileFn: async () => 'prompt-trace-path',
      storeResearchReportFn: async () => {
        storeCallCount += 1;
        return { reportId: 77, factsInserted: 1 };
      },
    });
  } finally {
    console.error = originalConsoleError;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }

  assert.equal(requestCallCount, 1);
  assert.equal(storeCallCount, 1);
  assert.equal(
    loggedMessages.some((message) => message.includes('Skipping Beatrice Offshore Wind Farm')),
    true,
  );
  assert.equal(
    loggedMessages.some((message) => message.includes('Running research for Seagreen Phase 1 Windfarm')),
    true,
  );
  assert.equal(
    loggedMessages.some((message) => message.includes('1 saved, 1 skipped, 0 failed, 2 total')),
    true,
  );
});

test('runDatabaseResearch auto-verifies stored draft reports and logs ready-to-publish status', async () => {
  const loggedMessages = [];
  const originalConsoleError = console.error;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const verifiedReportIds = [];

  console.error = (message) => loggedMessages.push(String(message));
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fakeClient = {
    connect: async () => {},
    end: async () => {},
  };

  try {
    await runDatabaseResearch({
      argv: ['node', 'src/research-from-database.js'],
      createClient: () => fakeClient,
      loadPromptTemplateFn: async () => 'Research this project:\n{PROJECT_CONTEXT}\n',
      listWindFarmRowsFn: async () => ([
        {
          id: 7001,
          name: 'Test Farm',
          type: 'Offshore wind farm',
          n_turbines: 10,
          power_mw: 100,
          status: 'Operational',
        },
      ]),
      getPublishedResearchRunStateFn: async () => new Map(),
      getLinkedTurbineMetadataFn: async () => null,
      getTurbineCountValidationContextFn: async () => null,
      buildOfficialSourceContextFn: async () => '',
      requestResearchReportFn: async () => '# Report',
      saveReportFn: async () => 'saved-path',
      saveTextFileFn: async () => 'prompt-trace-path',
      storeResearchReportFn: async () => ({ reportId: 321, factsInserted: 3 }),
      verifyReportEvidenceFn: async (_client, reportId) => {
        verifiedReportIds.push(reportId);
        return { passed: true, blockedRows: [] };
      },
    });
  } finally {
    console.error = originalConsoleError;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }

  assert.deepEqual(verifiedReportIds, [321]);
  assert.equal(
    loggedMessages.some((message) => message.includes('moderation queue status: Ready to publish')),
    true,
  );
});

test('runDatabaseResearch logs needs-review status when auto-verification cannot complete', async () => {
  const loggedMessages = [];
  const originalConsoleError = console.error;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  console.error = (message) => loggedMessages.push(String(message));
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fakeClient = {
    connect: async () => {},
    end: async () => {},
  };

  try {
    await runDatabaseResearch({
      argv: ['node', 'src/research-from-database.js'],
      createClient: () => fakeClient,
      loadPromptTemplateFn: async () => 'Research this project:\n{PROJECT_CONTEXT}\n',
      listWindFarmRowsFn: async () => ([
        {
          id: 7002,
          name: 'Fallback Farm',
          type: 'Offshore wind farm',
          n_turbines: 10,
          power_mw: 100,
          status: 'Operational',
        },
      ]),
      getPublishedResearchRunStateFn: async () => new Map(),
      getLinkedTurbineMetadataFn: async () => null,
      getTurbineCountValidationContextFn: async () => null,
      buildOfficialSourceContextFn: async () => '',
      requestResearchReportFn: async () => '# Report',
      saveReportFn: async () => 'saved-path',
      saveTextFileFn: async () => 'prompt-trace-path',
      storeResearchReportFn: async () => ({ reportId: 654, factsInserted: 2 }),
      verifyReportEvidenceFn: async () => {
        throw new Error('network timeout');
      },
    });
  } finally {
    console.error = originalConsoleError;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }

  assert.equal(
    loggedMessages.some((message) => message.includes('moderation queue status: Needs review')),
    true,
  );
});

test('runDatabaseResearch operational refresh mode merges the refreshed sections into a draft report', async () => {
  const loggedMessages = [];
  const originalConsoleError = console.error;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const publishedReportMarkdown = createPublishedOperationalReportMarkdown();
  const refreshReportMarkdown = createOperationalRefreshReportMarkdown();
  const loadedPromptPaths = [];
  const storedReports = [];

  console.error = (message) => loggedMessages.push(String(message));
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fakeClient = {
    connect: async () => {},
    end: async () => {},
  };

  try {
    await runDatabaseResearch({
      argv: ['node', 'src/research-from-database.js', '--operational-refresh'],
      createClient: () => fakeClient,
      loadPromptTemplateFn: async (filePath) => {
        loadedPromptPaths.push(filePath);
        return 'Refresh this project:\n{PROJECT_CONTEXT}\n';
      },
      listWindFarmRowsFn: async () => ([
        {
          id: 6646,
          name: 'Beatrice Offshore Wind Farm',
          type: 'Offshore wind farm',
          n_turbines: 84,
          power_mw: 588,
          status: 'Operational',
        },
      ]),
      getPublishedResearchRunStateFn: async () => new Map([
        [6646, { hasPublishedReport: true, hasOperationalPublishedReport: true }],
      ]),
      getLatestPublishedResearchReportFn: async () => ({
        id: 50,
        report_markdown: publishedReportMarkdown,
        model_used: 'openai/gpt-5.4',
      }),
      getLinkedTurbineMetadataFn: async () => null,
      getTurbineCountValidationContextFn: async () => null,
      buildOfficialSourceContextFn: async () => '',
      requestResearchReportFn: async () => refreshReportMarkdown,
      saveReportFn: async (_path, markdown) => markdown,
      saveTextFileFn: async () => 'prompt-trace-path',
      storeResearchReportFn: async (_client, options) => {
        storedReports.push(options);
        return { reportId: 88, factsInserted: 2 };
      },
    });
  } finally {
    console.error = originalConsoleError;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }

  assert.equal(loadedPromptPaths.some((filePath) => /prompt-operational-refresh\.md$/.test(filePath)), true);
  assert.equal(storedReports.length, 1);
  assert.equal(storedReports[0].reviewStatus, 'draft');
  assert.match(storedReports[0].reportMarkdown, /Capacity \| 588 MW/);
  assert.match(storedReports[0].reportMarkdown, /10\/03\/2026 \| Operator portfolio page refreshed the Beatrice ownership description/);
  assert.equal(
    loggedMessages.some((message) => message.includes('Running operational refresh for Beatrice Offshore Wind Farm')),
    true,
  );
});

test('requestResearchReport explicitly passes auto engine when no search engine is configured', async () => {
  const payload = {
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
            createProvenanceAppendix({
              profileRows: [
                {
                  item_label: 'Developer / owners',
                  field_name: 'developer',
                  value: 'SSE Renewables 50%, Equinor 50%',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-0',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-0b' }],
                },
                {
                  item_label: 'Ownership history',
                  field_name: null,
                  value: 'SSE and Equinor remain the project owners.',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-0c',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-0d' }],
                },
                {
                  item_label: 'Status',
                  field_name: 'status',
                  value: 'Operational',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-1',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-2' }],
                },
              ],
              recentDevelopments: [
                {
                  date: 'April 2024',
                  development: 'Licence granted',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-3',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-4' }],
                },
              ],
            }),
          ],
        },
      },
    ],
  };
  const calls = [];

  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));

    return {
      ok: true,
      text: async () => JSON.stringify(payload),
    };
  };

  await requestResearchReport({
    apiKey: 'test-key',
    fetchImpl,
    model: 'openai/gpt-4.1',
    prompt: 'Prompt',
    referer: '',
    title: '',
    searchEngine: null,
    maxResults: 6,
    maxTotalResults: 18,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tools[0].parameters.engine, 'auto');
  assert.deepEqual(calls[0].tools[0].parameters.excluded_domains, [
    'tgs.com',
    '4coffshore.com',
    'windpowermonthly.com',
  ]);
});

test('requestResearchReport omits excluded domains for firecrawl engine', async () => {
  const payload = {
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
            createProvenanceAppendix({
              profileRows: [
                {
                  item_label: 'Developer / owners',
                  field_name: 'developer',
                  value: 'SSE Renewables 50%, Equinor 50%',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-0',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-0b' }],
                },
                {
                  item_label: 'Ownership history',
                  field_name: null,
                  value: 'SSE and Equinor remain the project owners.',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-0c',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-0d' }],
                },
                {
                  item_label: 'Status',
                  field_name: 'status',
                  value: 'Operational',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-1',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-2' }],
                },
              ],
              recentDevelopments: [
                {
                  date: 'April 2024',
                  development: 'Licence granted',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-3',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-4' }],
                },
              ],
            }),
          ],
        },
      },
    ],
  };
  const calls = [];

  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));

    return {
      ok: true,
      text: async () => JSON.stringify(payload),
    };
  };

  await requestResearchReport({
    apiKey: 'test-key',
    fetchImpl,
    model: 'openai/gpt-4.1',
    prompt: 'Prompt',
    referer: '',
    title: '',
    searchEngine: 'firecrawl',
    maxResults: 6,
    maxTotalResults: 18,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tools[0].parameters.engine, 'firecrawl');
  assert.equal('excluded_domains' in calls[0].tools[0].parameters, false);
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

test('runtime-config uses gpt-5.4-2026-03-05 as the default codex model when unset', () => {
  const childEnv = { ...process.env };
  childEnv.CODEX_MODEL = '';
  childEnv.OPENAI_MODEL = '';

  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { getDefaultModelForProvider } from './src/lib/runtime-config.js'; console.log(getDefaultModelForProvider('codex'));",
    ],
    {
      cwd: process.cwd(),
      env: childEnv,
      encoding: 'utf8',
    },
  );

  assert.equal(output.trim(), 'gpt-5.4-2026-03-05');
});

test('runtime-config defaults to auto engine with server-tool mode when unset', () => {
  const childEnv = { ...process.env };
  childEnv.OPENROUTER_SEARCH_ENGINE = '';

  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { DEFAULT_SEARCH_ENGINE } from './src/lib/runtime-config.js'; console.log(JSON.stringify({ engine: DEFAULT_SEARCH_ENGINE }));",
    ],
    {
      cwd: process.cwd(),
      env: childEnv,
      encoding: 'utf8',
    },
  );

  assert.equal(output.trim(), '{"engine":"auto"}');
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

test('requestResearchReport fails when the server-tool output is incomplete', async () => {
  const serverToolPayload = {
    choices: [
      {
        message: {
          content: "I'll search for current information about Dogger Bank A.",
        },
      },
    ],
  };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const parsedBody = JSON.parse(options.body);

    calls.push(parsedBody);

    return {
      ok: true,
      text: async () => JSON.stringify(serverToolPayload),
    };
  };

  await assert.rejects(
    () =>
      requestResearchReport({
        apiKey: 'test-key',
        fetchImpl,
        model: 'openai/gpt-4.1',
        prompt: 'Prompt',
        referer: '',
        title: '',
        searchEngine: 'auto',
        maxResults: 6,
        maxTotalResults: 18,
      }),
    /missing-required-tables/,
  );

  assert.equal(calls.length, 2);
  assert.ok(calls[0].tools);
  assert.ok(calls[1].tools);
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

test('hasFreshOwnershipEvidence accepts stable legacy ownership summaries without recent dated events', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      research_summary: 'Current ownership split remains Vattenfall 51% and AMF 49% based on owner and investor project pages.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      research_summary: 'The published project materials do not indicate a later ownership change, and the current partnership remains in place.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
  ];

  assert.equal(hasFreshOwnershipEvidence(profileRows, [], new Date('2026-04-17T00:00:00Z')), true);
});

test('hasFreshOwnershipEvidence skips freshness checks for decommissioned projects', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      value: 'Historic owners not relevant to current operations.',
      research_summary: 'Historic ownership sources identify the project sponsors at the time the wind farm operated.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      value: 'Historic ownership chain recorded before decommissioning.',
      research_summary: 'Historic materials describe the ownership chain before decommissioning.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
    {
      item_label: 'Status',
      value: 'Decommissioned',
      research_summary: 'Government material confirms the project is decommissioned.',
      sources: [{ url: 'https://example.com/5' }, { url: 'https://example.com/6' }],
    },
  ];

  assert.equal(hasFreshOwnershipEvidence(profileRows, [], new Date('2026-04-17T00:00:00Z')), true);
});

test('hasFreshOwnershipEvidence accepts freshest-source ownership wording used by the model', () => {
  const profileRows = [
    {
      item_label: 'Developer / owners',
      research_summary: 'Freshest ownership source used here is the operator’s current portfolio page plus partner ownership announcements. The current structure reconciles to 100%.',
      sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
    },
    {
      item_label: 'Ownership history',
      research_summary: 'Freshest source relied on for the later ownership change is the partner acquisition announcement; the current portfolio page confirms the operating partner and current structure.',
      sources: [{ url: 'https://example.com/3' }, { url: 'https://example.com/4' }],
    },
  ];

  assert.equal(hasFreshOwnershipEvidence(profileRows, [], new Date('2026-04-17T00:00:00Z')), true);
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
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE, CIP and Red Rock Power have remained owners.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/status-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/status-2' }],
        },
      ],
      recentDevelopments: [
        {
          date: 'November 2024',
          development: 'Portfolio reporting update',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['stale-ownership-evidence'],
  );
});

test('requestResearchReport retries when the first server-tool report lacks fresh ownership evidence', async () => {
  const staleServerToolPayload = {
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
            createProvenanceAppendix({
              profileRows: [
                {
                  item_label: 'Developer / owners',
                  field_name: 'developer',
                  value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-1' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-2' }],
                },
                {
                  item_label: 'Ownership history',
                  field_name: null,
                  value: 'SSE, CIP and Red Rock Power have remained owners.',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-3' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-4' }],
                },
                {
                  item_label: 'Status',
                  field_name: 'status',
                  value: 'Operational',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-5' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-6' }],
                },
              ],
              recentDevelopments: [
                {
                  date: 'April 2024',
                  development: 'Licence granted',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-7' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-8' }],
                },
              ],
            }),
          ],
        },
      },
    ],
  };
  const freshServerToolPayload = {
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
            createProvenanceAppendix({
              profileRows: [
                {
                  item_label: 'Developer / owners',
                  field_name: 'developer',
                  value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-1' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-2' }],
                },
                {
                  item_label: 'Ownership history',
                  field_name: null,
                  value: 'SSE, CIP and Red Rock Power have remained owners.',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-3' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-4' }],
                },
                {
                  item_label: 'Status',
                  field_name: 'status',
                  value: 'Operational',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-5' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-6' }],
                },
              ],
              recentDevelopments: [
                {
                  date: 'April 2024',
                  development: 'Licence granted',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-7' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-8' }],
                },
              ],
            }),
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
      text: async () => JSON.stringify(callCount === 1 ? staleServerToolPayload : freshServerToolPayload),
    };
  };

  const result = await requestResearchReport({
    apiKey: 'test-key',
    fetchImpl,
    model: 'openai/gpt-4.1',
    prompt: 'Prompt',
    referer: '',
    title: '',
    searchEngine: 'auto',
    maxResults: 6,
    maxTotalResults: 18,
  });

  assert.match(result, /November 2024/);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Critical correction for this retry:/);
});

test('buildBlockedRowRepairPrompt asks for minimal row-scoped repair and verifier-friendly evidence', () => {
  const prompt = buildBlockedRowRepairPrompt(
    [
      '| Item | Value | Research summary | Sources |',
      '|---|---|---|---|',
      '| Capacity | 588 MW | Current summary. | [Source 1](https://example.com/beatrice), [Source 2](https://example.com/fallback-capacity) |',
      'Recent developments',
      '',
      '| Date | Development | Why it matters | Sources |',
      '|---|---|---|---|',
      '| 01/05/2024 | Milestone | Why it matters. | [Source 1](https://example.com/dev-1), [Source 2](https://example.com/dev-2) |',
      createProvenanceAppendix({
        profileRows: [
          {
            item_label: 'Capacity',
            field_name: 'capacity_mw',
            value: '588 MW',
            provenance_mode: 'web_source',
            source_of_record: createSourceOfRecord({
              source_url: 'https://example.com/beatrice',
              source_name: 'SSE page',
              source_type: 'official project',
              evidence_quote: 'Installed capacity about 600 MW',
            }),
            supporting_context: [{ label: 'Source 2', url: 'https://example.com/fallback-capacity' }],
          },
        ],
      }),
    ].join('\n'),
    [
      {
        id: 847,
        status: 'failed',
        report_item_label: 'Capacity',
        report_field_name: 'capacity_mw',
        reported_value: '588 MW',
        source_name: 'SSE page',
        source_url: 'https://example.com/beatrice',
        source_type: 'official project',
        evidence_quote: 'Installed capacity about 600 MW',
        http_status: 403,
        error: 'Fetched source-of-record page did not contain the expected evidence quote.',
      },
    ],
  );

  assert.match(prompt, /Preserve every table row, recent-development row, and appendix entry that is not listed as blocked below\./);
  assert.match(prompt, /Use short verbatim machine-checkable evidence_quote fragments/);
  assert.match(prompt, /do not reuse that URL as the new source_of_record/);
  assert.match(prompt, /treat them as one source-replacement task/);
  assert.match(prompt, /Grouped dead-source issues to repair once per source_url:/);
  assert.match(prompt, /candidate_replacement_urls/);
  assert.match(prompt, /fallback-capacity/);
  assert.match(prompt, /change that row to Not confirmed instead of preserving an unsupported fact/);
  assert.match(prompt, /"Capacity"/);
  assert.match(prompt, /"http_status": 403/);
  assert.match(prompt, /Current summary/);
});

test('requestBlockedRowRepair returns the repaired report when quality checks pass', async () => {
  const repairedPayload = {
    choices: [
      {
        message: {
          content: [
            'This profile assesses Beatrice Offshore Wind Farm.\n\n',
            '| Item | Value | Research summary | Sources |\n',
            '|---|---|---|---|\n',
            '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | SSE portfolio page updated November 2024 confirms the current split. | [Source 1](https://example.com/source-1), [Source 2](https://example.com/source-2) |\n',
            '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | SSE materials updated January 2025 indicate no later change. | [Source 1](https://example.com/source-3), [Source 2](https://example.com/source-4) |\n',
            '| Status | Operational | Confirmed by owner and regulator materials. | [Source 1](https://example.com/source-5), [Source 2](https://example.com/source-6) |\n',
            '| Capacity | 588 MW | SSE project page shows the installed capacity. | [Source 1](https://example.com/source-7), [Source 2](https://example.com/source-8) |\n',
            'Recent developments\n\n',
            '| Date | Development | Why it matters | Sources |\n',
            '|---|---|---|---|\n',
            '| 01/05/2024 | Regulatory update | Marks a current milestone. | [Source 1](https://example.com/source-9), [Source 2](https://example.com/source-10) |\n',
            createProvenanceAppendix({
              profileRows: [
                {
                  item_label: 'Developer / owners',
                  field_name: 'developer',
                  value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-1' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-2' }],
                },
                {
                  item_label: 'Ownership history',
                  field_name: null,
                  value: 'SSE, CIP and Red Rock Power have remained owners.',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-3' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-4' }],
                },
                {
                  item_label: 'Status',
                  field_name: 'status',
                  value: 'Operational',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-5' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-6' }],
                },
                {
                  item_label: 'Capacity',
                  field_name: 'capacity_mw',
                  value: '588 MW',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({
                    source_url: 'https://example.com/source-7',
                    evidence_quote: 'Installed capacity 588 MW',
                  }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-8' }],
                },
              ],
              recentDevelopments: [
                {
                  date: '01/05/2024',
                  development: 'Regulatory update',
                  provenance_mode: 'web_source',
                  source_of_record: createSourceOfRecord({ source_url: 'https://example.com/source-9' }),
                  supporting_context: [{ label: 'Source 2', url: 'https://example.com/source-10' }],
                },
              ],
            }),
          ],
        },
      },
    ],
  };

  const result = await requestBlockedRowRepair({
    apiKey: 'test-key',
    model: 'openai/gpt-4.1',
    reportMarkdown: 'Current report markdown',
    blockedRows: [
      {
        id: 847,
        report_item_label: 'Capacity',
        report_field_name: 'capacity_mw',
        reported_value: '588 MW',
        source_name: 'SSE page',
        source_url: 'https://example.com/beatrice',
        error: 'Fetched source-of-record page did not contain the expected evidence quote.',
      },
    ],
    searchEngine: 'auto',
    maxResults: 6,
    maxTotalResults: 18,
    referer: '',
    title: '',
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify(repairedPayload),
    }),
  });

  assert.match(result, /Installed capacity 588 MW/);
});

test('suggestDraftResearchReportRepair returns a non-destructive markdown proposal', async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM research_wind_farm_reports')) {
        return {
          rows: [
            {
              id: 218,
              wind_farm_id: 6431,
              report_markdown: 'Current report markdown',
              model_used: 'openai/gpt-5.4',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await suggestDraftResearchReportRepair(client, {
    reportId: 218,
    apiKey: 'test-key',
    verifyReportEvidenceFn: async () => ({
      passed: false,
      blockedRows: [
        {
          id: 847,
          status: 'failed',
          error: 'Fetched source-of-record page did not contain the expected evidence quote.',
          report_item_label: 'Capacity',
          report_field_name: 'capacity_mw',
          report_date: null,
          report_development: null,
          reported_value: '588 MW',
          source_url: 'https://example.com/beatrice',
          source_name: 'SSE page',
        },
      ],
    }),
    requestBlockedRowRepairFn: async ({ reportMarkdown, blockedRows }) => {
      assert.equal(reportMarkdown, 'Current report markdown');
      assert.equal(blockedRows.length, 1);
      return 'Suggested repaired markdown';
    },
  });

  assert.equal(result.reportId, 218);
  assert.equal(result.windFarmId, 6431);
  assert.equal(result.modelUsed, 'openai/gpt-5.4');
  assert.equal(result.suggestedReportMarkdown, 'Suggested repaired markdown');
  assert.equal(result.blockedRows.length, 1);
  assert.equal(queries.length, 1);
});

test('verifyDraftResearchReport returns the moderation summary for one draft report', async () => {
  const logLines = [];
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes("WHERE review_status = 'draft'") && text.includes('id = ANY')) {
        assert.deepEqual(values, [[218]]);

        return {
          rows: [
            {
              id: 218,
              wind_farm_id: 6431,
              report_markdown: 'Current report markdown',
              model_used: 'openai/gpt-5.4',
              name: 'Horns Rev II',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await verifyDraftResearchReport(fakeClient, {
    reportId: 218,
    verifyReportEvidenceFn: async () => ({
      passed: false,
      blockedRows: [
        {
          id: 847,
          status: 'failed',
          error: 'Fetched source-of-record page did not contain the expected evidence quote.',
        },
      ],
    }),
    log: (line) => logLines.push(line),
  });

  assert.deepEqual(result, {
    draftCount: 1,
    passedReportIds: [],
    blockedReports: [
      {
        reportId: 218,
        windFarmId: 6431,
        blockedRows: [
          {
            id: 847,
            status: 'failed',
            error: 'Fetched source-of-record page did not contain the expected evidence quote.',
          },
        ],
      },
    ],
    repairedReportIds: [],
    repairFailures: [],
    matchedReportIds: [218],
    missingReportIds: [],
  });
  assert.ok(logLines.some((line) => line.includes('Blocked report #218 for wind farm 6431:')));
});

test('publishDraftResearchReport publishes a single clean draft for moderation', async () => {
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes("WHERE review_status = 'draft'") && text.includes('id = ANY')) {
        assert.deepEqual(values, [[50]]);

        return {
          rows: [
            {
              id: 50,
              wind_farm_id: 6646,
              report_markdown: 'Current report markdown',
              model_used: 'openai/gpt-5.4',
              name: 'Beatrice Offshore Wind Farm',
            },
          ],
        };
      }

      if (text.includes("SET review_status = 'published'")) {
        return {
          rows: [{ id: 50, wind_farm_id: 6646 }],
        };
      }

      if (text.includes("SET status = 'active'")) {
        return { rowCount: 7 };
      }

      if (text.includes('published_reports')) {
        return {
          rows: [{
            published_reports: 166,
            remaining_drafts: 0,
            active_research_facts: 1498,
            draft_research_facts: 0,
          }],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await publishDraftResearchReport(fakeClient, {
    reportId: 50,
    verifyReportEvidenceFn: async () => ({
      passed: true,
      blockedRows: [],
    }),
    pruneObsoleteDraftReportsFn: async () => [],
    log: () => {},
  });

  assert.deepEqual(result, {
    publishedReportIds: [50],
    draftCount: 1,
  });
});

test('rejectDraftResearchReport removes draft artifacts and keeps cleanup localized to the rejected draft', async () => {
  const queries = [];
  const fakeClient = {
    query: async (text, values = []) => {
      queries.push({ text, values });

      if (text.includes('SELECT id, wind_farm_id, report_markdown, model_used')) {
        assert.deepEqual(values, [220]);

        return {
          rows: [
            {
              id: 220,
              wind_farm_id: 6646,
              report_markdown: 'Current report markdown',
              model_used: 'openai/gpt-5.4',
            },
          ],
        };
      }

      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rowCount: null, rows: [] };
      }

      if (text.includes('SELECT id') && text.includes('FROM wind_farm_facts') && text.includes('WHERE report_id = $1')) {
        assert.deepEqual(values, [220]);
        return { rows: [{ id: 901 }, { id: 902 }] };
      }

      if (text.includes('FROM research_wind_farm_reports') && text.includes('id <> $2')) {
        assert.deepEqual(values, [6646, 220]);
        return { rows: [] };
      }

      if (text.includes('SELECT id') && text.includes('AND NOT EXISTS')) {
        assert.deepEqual(values, [[901, 902]]);
        return { rows: [{ id: 901 }, { id: 902 }] };
      }

      if (text.includes('UPDATE wind_farm_community_notes') && text.includes('SET fact_id = NULL')) {
        assert.deepEqual(values, [[901, 902]]);
        return { rowCount: 1, rows: [] };
      }

      if (text.includes('UPDATE wind_farm_community_notes') && text.includes('SET promoted_to_fact_id = NULL')) {
        assert.deepEqual(values, [[901, 902]]);
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('DELETE FROM wind_farm_fact_confirmations')) {
        assert.deepEqual(values, [[901, 902]]);
        return { rowCount: 2, rows: [] };
      }

      if (text.includes('DELETE FROM research_report_evidence')) {
        assert.deepEqual(values, [220]);
        return { rowCount: 8, rows: [] };
      }

      if (text.includes('DELETE FROM wind_farm_facts')) {
        assert.deepEqual(values, [[901, 902]]);
        return { rowCount: 2, rows: [] };
      }

      if (text.includes('DELETE FROM research_wind_farm_reports')) {
        assert.deepEqual(values, [220]);
        return { rowCount: 1, rows: [{ id: 220 }] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await rejectDraftResearchReport(fakeClient, {
    reportId: 220,
    log: () => {},
  });

  assert.deepEqual(result, {
    reportId: 220,
    windFarmId: 6646,
    deletedEvidenceCount: 8,
    deletedFactCount: 2,
    detachedNoteCount: 1,
    detachedPromotedNoteCount: 0,
    deletedConfirmationCount: 2,
  });
  assert.equal(queries[1].text, 'BEGIN');
  assert.equal(queries.at(-1)?.text, 'COMMIT');
});

test('rejectDraftResearchReport restores shared facts to the published baseline before deleting orphaned draft facts', async () => {
  const queries = [];
  const fakeClient = {
    query: async (text, values = []) => {
      queries.push({ text, values });

      if (text.includes('SELECT id, wind_farm_id, report_markdown, model_used')) {
        assert.deepEqual(values, [271]);
        return {
          rows: [
            {
              id: 271,
              wind_farm_id: 6646,
              report_markdown: 'Replacement candidate',
              model_used: 'openai/gpt-5.4',
            },
          ],
        };
      }

      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rowCount: null, rows: [] };
      }

      if (text.includes('SELECT id') && text.includes('FROM wind_farm_facts') && text.includes('WHERE report_id = $1')) {
        assert.deepEqual(values, [271]);
        return { rows: [{ id: 33818 }, { id: 33819 }] };
      }

      if (text.includes('FROM research_wind_farm_reports') && text.includes('id <> $2')) {
        assert.deepEqual(values, [6646, 271]);
        return { rows: [{ id: 190, review_status: 'published' }] };
      }

      if (text.includes('DELETE FROM research_report_evidence')) {
        assert.deepEqual(values, [271]);
        return { rowCount: 9, rows: [] };
      }

      if (text.includes('UPDATE wind_farm_facts') && text.includes('SET report_id = $2')) {
        assert.deepEqual(values, [[33818, 33819], 190, 'published']);
        return { rowCount: 1, rows: [] };
      }

      if (text.includes('SELECT id') && text.includes('AND NOT EXISTS')) {
        assert.deepEqual(values, [[33818, 33819]]);
        return { rows: [{ id: 33819 }] };
      }

      if (text.includes('UPDATE wind_farm_community_notes') && text.includes('SET fact_id = NULL')) {
        assert.deepEqual(values, [[33819]]);
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('UPDATE wind_farm_community_notes') && text.includes('SET promoted_to_fact_id = NULL')) {
        assert.deepEqual(values, [[33819]]);
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('DELETE FROM wind_farm_fact_confirmations')) {
        assert.deepEqual(values, [[33819]]);
        return { rowCount: 1, rows: [] };
      }

      if (text.includes('DELETE FROM wind_farm_facts')) {
        assert.deepEqual(values, [[33819]]);
        return { rowCount: 1, rows: [] };
      }

      if (text.includes('DELETE FROM research_wind_farm_reports')) {
        assert.deepEqual(values, [271]);
        return { rowCount: 1, rows: [{ id: 271 }] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await rejectDraftResearchReport(fakeClient, {
    reportId: 271,
    log: () => {},
  });

  assert.deepEqual(result, {
    reportId: 271,
    windFarmId: 6646,
    deletedEvidenceCount: 9,
    deletedFactCount: 1,
    detachedNoteCount: 0,
    detachedPromotedNoteCount: 0,
    deletedConfirmationCount: 1,
  });
  assert.ok(queries.some((call) => call.text.includes('SET report_id = $2')));
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

test('getWindFarmSourceTableName rejects the legacy table', () => {
  assert.throws(
    () => getWindFarmSourceTableName('windfarm_database'),
    /Unsupported WIND_FARM_SOURCE_TABLE: windfarm_database\. Use core_wind_farms\./,
  );
});

test('getWindFarmSourceTableName rejects unsupported tables', () => {
  assert.throws(
    () => getWindFarmSourceTableName('windfarm_database_archive'),
    /Unsupported WIND_FARM_SOURCE_TABLE: windfarm_database_archive/,
  );
});

test('listWindFarmRows excludes archived rows from default research selection', async () => {
  let capturedText = '';
  let capturedValues = [];
  const fakeClient = {
    query: async (text, values = []) => {
      capturedText = text;
      capturedValues = values;
      return {
        rows: [
          {
            id: 101,
            name: 'Morven',
            type: 'Offshore wind farm',
            n_turbines: 60,
            power_mw: 882,
            status: 'Consented',
          },
        ],
      };
    },
  };

  const rows = await listWindFarmRows(fakeClient, 'core_wind_farms', {
    ids: [101, 102],
    country: 'United Kingdom',
    windFarmType: 'Offshore wind farm',
    skipExistingReports: true,
  });

  assert.equal(rows.length, 1);
  assert.match(capturedText, /record_status = 'active'/);
  assert.match(capturedText, /COALESCE\(status, ''\) <> 'Archive'/);
  assert.match(capturedText, /type = \$3/);
  assert.match(capturedText, /primary_source_type/);
  assert.match(capturedText, /geometry_source_type/);
  assert.match(capturedText, /source_policy_key/);
  assert.match(capturedText, /NOT EXISTS \(/);
  assert.match(capturedText, /research_wind_farm_reports report/);
  assert.deepEqual(capturedValues, [[101, 102], 'United Kingdom', 'Offshore wind farm']);
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
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Project identity',
          field_name: null,
          value: 'Seagreen Phase 1 Wind Farm',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/regulator' }],
        },
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/status-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/status-2' }],
        },
        {
          item_label: 'Maximum Export Capacity (MEC)',
          field_name: 'mec_mw',
          value: 'Not confirmed',
          provenance_mode: 'web_source',
          source_of_record: null,
          supporting_context: [
            { label: 'Owner', url: 'https://example.com/mec-1' },
            { label: 'Regulator', url: 'https://example.com/mec-2' },
          ],
        },
      ],
      recentDevelopments: [
        {
          date: 'April 2024',
          development: 'OFTO licences granted',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Industry', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  const result = parseStructuredReport(markdown);

  assert.equal(result.profileRows.length, 3);
  assert.deepEqual(result.profileRows[0], {
    item_label: 'Project identity',
    field_name: 'project_identity',
    value: 'Seagreen Phase 1 Wind Farm',
    research_summary: 'Distinguishes Phase 1 from later concepts.',
    sources: [
      { label: 'Owner', url: 'https://example.com/owner' },
      { label: 'Regulator', url: 'https://example.com/regulator' },
    ],
    invalid_source_links: [],
    is_not_confirmed: false,
    provenance: {
      item_label: 'Project identity',
      field_name: null,
      value: 'Seagreen Phase 1 Wind Farm',
      provenance_mode: 'web_source',
      source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner' }),
      supporting_context: [{ label: 'Regulator', url: 'https://example.com/regulator' }],
    },
  });
  assert.equal(result.profileRows[1].field_name, 'status');
  assert.equal(result.profileRows[2].field_name, 'mec_mw');
  assert.equal(result.profileRows[2].is_not_confirmed, true);
  assert.equal(result.provenanceAppendix.profile_rows.length, 3);
  assert.deepEqual(result.recentDevelopments, [
    {
      date: 'April 2024',
      development: 'OFTO licences granted',
      why_it_matters: 'Confirms a post-COD regulatory milestone.',
      sources: [
        { label: 'Ofgem', url: 'https://example.com/event-1' },
        { label: 'Industry', url: 'https://example.com/event-2' },
      ],
      invalid_source_links: [],
      provenance: {
        date: 'April 2024',
        development: 'OFTO licences granted',
        provenance_mode: 'web_source',
        source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
        supporting_context: [{ label: 'Industry', url: 'https://example.com/event-2' }],
      },
    },
  ]);
});

test('getResearchReportQualityIssues flags invalid source links', () => {
  const markdown = [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | SSE portfolio page updated November 2024 confirms the split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Project materials updated January 2025 indicate no later change. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Rotor diameter | 154 m | Project-specific web evidence was inconclusive so a fallback was used. | [EuroWindWakes](#), [Project](https://example.com/rotor-1) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/event-1), [Source 2](https://example.com/event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE, CIP and Red Rock Power have remained owners.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Rotor diameter',
          field_name: 'rotor_diameter_m',
          value: '154 m',
          provenance_mode: 'dataset_fallback',
          source_of_record: createSourceOfRecord({
            source_url: 'https://example.com/dataset/rotor-diameter',
            source_type: 'open dataset',
            source_name: 'EuroWindWakes 2025',
            verification_status: 'dataset_fallback',
            confidence: 'medium',
          }),
          supporting_context: [{ label: 'Project', url: 'https://example.com/rotor-1' }],
        },
      ],
      recentDevelopments: [
        {
          date: 'April 2024',
          development: 'Licence granted',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Source 2', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['invalid-source-links'],
  );
});

test('getResearchReportQualityIssues flags missing provenance appendix', () => {
  const markdown = [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | SSE portfolio page updated November 2024 confirms the split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Project materials updated January 2025 indicate no later change. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/event-1), [Source 2](https://example.com/event-2) |',
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['missing-provenance-appendix'],
  );
});

test('getResearchReportQualityIssues flags a missing source of record for confirmed values', () => {
  const markdown = [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, CIP 35%, Red Rock Power 25% | SSE portfolio page updated November 2024 confirms the split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE, CIP and Red Rock Power have remained owners. | Project materials updated January 2025 indicate no later change. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Status | Operational | Owner and regulator pages confirm the project is operational. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | Licence granted | Marks the latest milestone. | [Source 1](https://example.com/event-1), [Source 2](https://example.com/event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, CIP 35%, Red Rock Power 25%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE, CIP and Red Rock Power have remained owners.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: null,
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/status-2' }],
        },
      ],
      recentDevelopments: [
        {
          date: 'April 2024',
          development: 'Licence granted',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Source 2', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['missing-source-of-record'],
  );
});

test('getResearchReportQualityIssues flags risky source-of-record domains', () => {
  const markdown = [
    'This profile assesses Beatrice Offshore Wind Farm.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | SSE 40%, Red Rock Power 25%, TRIG 17.5%, Equitix 17.5% | SSE materials updated April 2026 confirm the current ownership split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | SSE led development and later partner ownership changes were completed by 2021. | Project materials updated January 2025 summarize the current end-state and earlier ownership history. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Turbine model | SWT-7.0-154 | Project-specific sources tie this turbine model to Beatrice. | [Open source](https://example.com/turbine-open), [Dataset](https://example.com/turbine-dataset) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| 28/05/2024 | Regulatory payment agreed | Marks a material project-level regulatory development. | [Regulator](https://example.com/event-1), [Archive](https://example.com/event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'SSE 40%, Red Rock Power 25%, TRIG 17.5%, Equitix 17.5%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'SSE led development and later partner ownership changes were completed by 2021.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Turbine model',
          field_name: 'turbine_model',
          value: 'SWT-7.0-154',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({
            source_url: 'https://www.windpowermonthly.com/article/1487890/first-turbine-installed-first-power-beatrice',
            source_name: 'Windpower Monthly',
            source_type: 'industry news',
          }),
          supporting_context: [{ label: 'Open source', url: 'https://example.com/turbine-open' }],
        },
      ],
      recentDevelopments: [
        {
          date: '28/05/2024',
          development: 'Regulatory payment agreed',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Archive', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['blocked-source-domain', 'risky-source-of-record'],
  );
});

test('getResearchReportQualityIssues allows Orsted sources but still flags other blocked domains', () => {
  const markdown = [
    'This profile assesses Horns Rev I.',
    '',
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Developer / owners | Vattenfall 60%, Orsted 40% | Owner pages updated 2025 confirm the current ownership split. | [Owner](https://example.com/owner-1), [Investor](https://example.com/owner-2) |',
    '| Ownership history | Partnership interests were later rebalanced into the current split. | Project materials updated January 2025 summarize the later ownership structure. | [Owner](https://example.com/history-1), [Investor](https://example.com/history-2) |',
    '| Status | Operational | Owner and regulator pages confirm the project is operational. | [Owner](https://example.com/status-1), [Regulator](https://example.com/status-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| 01/03/2024 | Ownership page still listed the asset at a 40% share. | A current project-level ownership update. | [Blocked](https://tgs.com/project-source), [Archive](https://orsted.com/en/Our-business/Offshore-wind/Our-offshore-wind-farms) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Developer / owners',
          field_name: 'developer',
          value: 'Vattenfall 60%, Orsted 40%',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/owner-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/owner-2' }],
        },
        {
          item_label: 'Ownership history',
          field_name: null,
          value: 'Partnership interests were later rebalanced into the current split.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/history-1' }),
          supporting_context: [{ label: 'Investor', url: 'https://example.com/history-2' }],
        },
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/status-1' }),
          supporting_context: [{ label: 'Regulator', url: 'https://example.com/status-2' }],
        },
      ],
      recentDevelopments: [
        {
          date: '01/03/2024',
          development: 'Ownership page still listed the asset at a 40% share.',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [
            { label: 'Blocked', url: 'https://tgs.com/project-source' },
            { label: 'Archive', url: 'https://orsted.com/en/Our-business/Offshore-wind/Our-offshore-wind-farms' },
          ],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(
    getResearchReportQualityIssues(markdown, new Date('2026-04-17T00:00:00Z')),
    ['blocked-source-domain'],
  );
});

test('runDatabaseResearch continues after a row failure and reports the batch failure at the end', async () => {
  const loggedMessages = [];
  const originalConsoleError = console.error;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  let requestCallCount = 0;
  let storeCallCount = 0;

  console.error = (message) => loggedMessages.push(String(message));
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fakeClient = {
    connect: async () => {},
    end: async () => {},
  };

  try {
    await assert.rejects(
      () =>
        runDatabaseResearch({
          argv: ['node', 'src/research-from-database.js'],
          createClient: () => fakeClient,
          loadPromptTemplateFn: async () => 'Research this project:\n{PROJECT_CONTEXT}\n',
          listWindFarmRowsFn: async () => ([
            {
              id: 6670,
              name: 'Walney 1',
              type: 'Offshore wind farm',
              n_turbines: 51,
              power_mw: 183.6,
              status: 'Operational',
            },
            {
              id: 6671,
              name: 'West of Duddon Sands',
              type: 'Offshore wind farm',
              n_turbines: 108,
              power_mw: 389,
              status: 'Operational',
            },
          ]),
          getPublishedResearchRunStateFn: async () => new Map(),
          getLinkedTurbineMetadataFn: async () => null,
          getTurbineCountValidationContextFn: async () => null,
          buildOfficialSourceContextFn: async () => '',
          requestResearchReportFn: async ({ prompt }) => {
            requestCallCount += 1;

            if (prompt.includes('Walney 1')) {
              throw new Error('blocked-source-domain');
            }

            return '# Report';
          },
          saveReportFn: async () => 'saved-path',
          saveTextFileFn: async () => 'prompt-trace-path',
          storeResearchReportFn: async () => {
            storeCallCount += 1;
            return { reportId: 99, factsInserted: 2 };
          },
        }),
      /1 failed row\(s\): Walney 1 \(ID 6670\): blocked-source-domain/,
    );
  } finally {
    console.error = originalConsoleError;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }

  assert.equal(requestCallCount, 2);
  assert.equal(storeCallCount, 1);
  assert.equal(
    loggedMessages.some((message) => message.includes('Failed Walney 1 (ID 6670): blocked-source-domain')),
    true,
  );
  assert.equal(
    loggedMessages.some((message) => message.includes('Running research for West of Duddon Sands')),
    true,
  );
  assert.equal(
    loggedMessages.some((message) => message.includes('1 saved, 0 skipped, 1 failed, 2 total')),
    true,
  );
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
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Status',
          field_name: 'status',
          value: 'Operational',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/status-primary' }),
          supporting_context: [
            { label: 'Owner', url: 'https://example.com/status-1' },
            { label: 'Regulator', url: 'https://example.com/status-2' },
          ],
        },
        {
          item_label: 'Maximum Export Capacity (MEC)',
          field_name: 'mec_mw',
          value: 'Not confirmed',
          provenance_mode: 'web_source',
          source_of_record: null,
          supporting_context: [
            { label: 'Owner', url: 'https://example.com/mec-1' },
            { label: 'Regulator', url: 'https://example.com/mec-2' },
          ],
        },
      ],
      recentDevelopments: [
        {
          date: 'April 2024',
          development: 'OFTO licences granted',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Industry', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(extractFactsFromReport(markdown), [
    {
      fieldName: 'status',
      value: 'Operational',
      citationUrl: 'https://example.com/status-primary',
      sourceOfRecord: createSourceOfRecord({ source_url: 'https://example.com/status-primary' }),
    },
  ]);
});

test('extractFactsFromReport uses dataset provenance as the source of record for fallback values', () => {
  const markdown = [
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Hub height | 101 m | Project-specific web sources were inconclusive so the linked EuroWindWakes value was used. | [Beatrice design statement](https://example.com/beatrice-design), [Beatrice history](https://example.com/beatrice-history) |',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    '| April 2024 | OFTO licences granted | Confirms a milestone. | [Ofgem](https://example.com/event-1), [Industry](https://example.com/event-2) |',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Hub height',
          field_name: 'hub_height_m',
          value: '101 m',
          provenance_mode: 'dataset_fallback',
          source_of_record: createSourceOfRecord({
            source_url: 'https://example.com/datasets/eurowindwakes/beatrice#hub_height_m',
            source_name: 'EuroWindWakes 2025 linked turbine dataset',
            source_type: 'open dataset',
            licence: 'unknown',
            confidence: 'medium',
            verification_status: 'dataset_fallback',
            evidence_quote: 'Linked project turbine metadata hub_height_m = 101',
          }),
          supporting_context: [
            { label: 'Beatrice design statement', url: 'https://example.com/beatrice-design' },
            { label: 'Beatrice history', url: 'https://example.com/beatrice-history' },
          ],
        },
      ],
      recentDevelopments: [
        {
          date: 'April 2024',
          development: 'OFTO licences granted',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({ source_url: 'https://example.com/event-1' }),
          supporting_context: [{ label: 'Industry', url: 'https://example.com/event-2' }],
        },
      ],
    }),
  ].join('\n');

  assert.deepEqual(extractFactsFromReport(markdown), [
    {
      fieldName: 'hub_height_m',
      value: '101 m',
      citationUrl: EUROWINDWAKES_ZENODO_RECORD_URL,
      sourceOfRecord: createSourceOfRecord({
        source_url: EUROWINDWAKES_ZENODO_RECORD_URL,
        source_name: 'EuroWindWakes 2025 linked turbine dataset',
        source_type: 'open dataset',
        licence: 'ODC Open Database License v1.0',
        confidence: 'medium',
        verification_status: 'dataset_fallback',
        evidence_quote: 'Linked project turbine metadata hub_height_m = 101',
      }),
    },
  ]);
});

test('buildReportEvidenceRows persists source-of-record and supporting-context rows', () => {
  const evidenceRows = buildReportEvidenceRows({
    reportId: 42,
    factIdsByFieldName: new Map([["hub_height_m", 7]]),
    profileRows: [
      {
        item_label: 'Hub height',
        field_name: 'hub_height_m',
        value: '101 m',
        research_summary: 'Dataset fallback used.',
        provenance: {
          provenance_mode: 'dataset_fallback',
          source_of_record: createSourceOfRecord({
            source_url: 'https://example.com/datasets/eurowindwakes/beatrice#hub_height_m',
            source_name: 'EuroWindWakes 2025 linked turbine dataset',
            source_type: 'open dataset',
            verification_status: 'dataset_fallback',
          }),
          supporting_context: [{ label: 'Beatrice history', url: 'https://example.com/beatrice-history' }],
        },
      },
    ],
    recentDevelopments: [],
  });

  assert.equal(evidenceRows.length, 2);
  assert.equal(evidenceRows[0].fact_id, 7);
  assert.equal(evidenceRows[0].evidence_role, 'source_of_record');
  assert.equal(evidenceRows[0].source_url, EUROWINDWAKES_ZENODO_RECORD_URL);
  assert.equal(evidenceRows[1].evidence_role, 'supporting_context');
});

test('parseStructuredReport normalizes unsupported verification_status values', () => {
  const markdown = [
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Total turbine count | 46 | Regulator filing and layout plan support this value. | [Regulator](https://example.com/macoll-count-1), [Supporting](https://example.com/macoll-count-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Total turbine count',
          field_name: 'turbine_count',
          value: '46',
          provenance_mode: 'web_source',
          source_of_record: createSourceOfRecord({
            source_url: 'https://example.com/macoll-count-1',
            verification_status: 'derived_from_authoritative_source',
          }),
          supporting_context: [{ label: 'Supporting', url: 'https://example.com/macoll-count-2' }],
        },
      ],
      recentDevelopments: [],
    }),
  ].join('\n');

  const { profileRows } = parseStructuredReport(markdown);

  assert.equal(profileRows[0].provenance.source_of_record.verification_status, 'unverified');
});

test('parseStructuredReport normalizes unsupported provenance_mode values', () => {
  const markdown = [
    '| Item | Value | Research summary | Sources |',
    '|---|---|---|---|',
    '| Capacity | 323 MW | Combined-project evidence and context were used. | [Primary](https://example.com/stevenson-capacity-1), [Supporting](https://example.com/stevenson-capacity-2) |',
    '',
    'Recent developments',
    '',
    '| Date | Development | Why it matters | Sources |',
    '|---|---|---|---|',
    createProvenanceAppendix({
      profileRows: [
        {
          item_label: 'Capacity',
          field_name: 'capacity_mw',
          value: '323 MW',
          provenance_mode: 'mixed_inference_from_context_and_web',
          source_of_record: createSourceOfRecord({
            source_url: 'https://example.com/stevenson-capacity-1',
          }),
          supporting_context: [{ label: 'Supporting', url: 'https://example.com/stevenson-capacity-2' }],
        },
      ],
      recentDevelopments: [],
    }),
  ].join('\n');

  const { profileRows } = parseStructuredReport(markdown);

  assert.equal(profileRows[0].provenance.provenance_mode, 'web_source');
});

test('verifyEvidenceRecord canonicalizes EuroWindWakes dataset placeholders to the Zenodo record', async () => {
  let requestedUrl = null;

  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.invalid/eurowindwakes/beatrice-linked-turbine-metadata',
      source_name: 'EuroWindWakes 2025 linked turbine dataset',
      source_type: 'open dataset',
      evidence_quote: 'Linked project turbine metadata hub_height_m = 101',
      provenance_mode: 'dataset_fallback',
      human_verified: false,
    },
    {
      fetchImpl: async (url) => {
        requestedUrl = url;

        return {
          ok: true,
          status: 200,
          headers: {
            get: () => 'text/html; charset=utf-8',
          },
          arrayBuffer: async () => Buffer.from('<html><body>Open European offshore wind turbine database. EuroWindWakes dataset.</body></html>', 'utf8'),
        };
      },
    },
  );

  assert.equal(requestedUrl, EUROWINDWAKES_ZENODO_RECORD_URL);
  assert.equal(result.status, 'passed');
  assert.equal(result.normalizedRecord.source_url, EUROWINDWAKES_ZENODO_RECORD_URL);
  assert.equal(result.normalizedRecord.licence, 'ODC Open Database License v1.0');
});

test('verifyEvidenceRecord passes when the source page contains the evidence quote', async () => {
  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The installed capacity is 588 MW.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body>The installed capacity is 588 MW.</body></html>', 'utf8'),
      }),
    },
  );

  assert.deepEqual(result, {
    status: 'passed',
    httpStatus: 200,
    error: null,
    normalizedRecord: {
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The installed capacity is 588 MW.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
  });
});

test('verifyEvidenceRecord fails when the source page does not support the evidence quote', async () => {
  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The installed capacity is 588 MW.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body>This page does not include the claimed figure.</body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.httpStatus, 200);
});

test('verifyEvidenceRecord passes numeric fields when page supports the labeled value', async () => {
  const result = await verifyEvidenceRecord(
    {
      report_item_label: 'Capacity',
      report_field_name: 'capacity_mw',
      reported_value: '588 MW',
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The project has a net generating capacity of five hundred and eighty-eight megawatts.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body><dt>Installed capacity</dt><dd>588MW</dd></body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.httpStatus, 200);
});

test('verifyEvidenceRecord passes date fields when page supports the labeled date', async () => {
  const result = await verifyEvidenceRecord(
    {
      report_item_label: 'Final investment decision (FID)',
      report_field_name: 'fid_date',
      reported_value: '01/06/2018',
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The project reached FID in early summer 2018.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body><p>Final investment decision: June 2018</p></body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.httpStatus, 200);
});

test('verifyEvidenceRecord still fails numeric fields without label support', async () => {
  const result = await verifyEvidenceRecord(
    {
      report_item_label: 'Capacity',
      report_field_name: 'capacity_mw',
      reported_value: '588 MW',
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The project has a net generating capacity of five hundred and eighty-eight megawatts.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body><p>Project summary reference 588MW portfolio overview.</p></body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.httpStatus, 200);
});

test('verifyEvidenceRecord keeps not-confirmed rows publishable when the source page is reachable', async () => {
  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'research database',
      evidence_quote: 'timeline lists consent and operations milestones but no FID date',
      provenance_mode: 'web_source',
      reported_value: 'Not confirmed',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body>Project timeline: consent authorized, construction start, operation start.</body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'value_not_confirmed');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.error, null);
});

test('verifyEvidenceRecord sends browser-like headers and retries transient fetch errors', async () => {
  const requestHeaders = [];
  let callCount = 0;

  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.com/source',
      source_name: 'Example source',
      source_type: 'official project',
      evidence_quote: 'The installed capacity is 588 MW.',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async (_url, options = {}) => {
        requestHeaders.push(options.headers);
        callCount += 1;

        if (callCount === 1) {
          throw new Error('fetch failed');
        }

        return {
          ok: true,
          status: 200,
          headers: {
            get: () => 'text/html; charset=utf-8',
          },
          arrayBuffer: async () => Buffer.from('<html><body>The installed capacity is 588 MW.</body></html>', 'utf8'),
        };
      },
    },
  );

  assert.equal(callCount, 2);
  assert.equal(requestHeaders[0]['User-Agent'].includes('Mozilla/5.0'), true);
  assert.equal(result.status, 'passed');
  assert.equal(result.httpStatus, 200);
});

test('verifyEvidenceRecord treats html error pages at pdf urls as HTTP failures, not PDF parse failures', async () => {
  const result = await verifyEvidenceRecord(
    {
      source_url: 'https://example.com/source.pdf',
      source_name: 'Example PDF source',
      source_type: 'official project pdf',
      evidence_quote: 'Barrow | 90 | Orsted',
      provenance_mode: 'web_source',
      human_verified: false,
    },
    {
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        arrayBuffer: async () => Buffer.from('<html><body>Not found</body></html>', 'utf8'),
      }),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.error, 'Source-of-record request returned HTTP 404.');
});

test('verifyReportEvidence blocks reports with failed source-of-record rows', async () => {
  const updates = [];
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes('FROM research_report_evidence')) {
        return {
          rows: [
            {
              id: 11,
              report_item_label: 'Capacity',
              report_field_name: 'capacity_mw',
              report_date: null,
              reported_value: '588 MW',
              source_url: 'https://example.com/source',
              source_name: 'Example source',
              source_type: 'official project',
              evidence_quote: 'The installed capacity is 588 MW.',
              provenance_mode: 'web_source',
              human_verified: false,
            },
          ],
        };
      }

      if (text.includes('UPDATE research_report_evidence')) {
        updates.push(values);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const result = await verifyReportEvidence(fakeClient, 99, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => 'text/html; charset=utf-8',
      },
      arrayBuffer: async () => Buffer.from('<html><body>Unsupported content.</body></html>', 'utf8'),
    }),
  });

  assert.equal(result.passed, false);
  assert.equal(result.blockedRows.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][5], 'failed');
});

test('verifyReportEvidence does not block reachable not-confirmed rows', async () => {
  const updates = [];
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes('FROM research_report_evidence')) {
        return {
          rows: [
            {
              id: 17,
              fact_id: null,
              reported_value: 'Not confirmed',
              source_url: 'https://example.com/source',
              source_name: 'Example source',
              source_type: 'research database',
              evidence_quote: 'timeline lists consent and operations milestones but no FID date',
              provenance_mode: 'web_source',
              human_verified: false,
            },
          ],
        };
      }

      if (text.includes('UPDATE research_report_evidence')) {
        updates.push(values);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const result = await verifyReportEvidence(fakeClient, 101, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => 'text/html; charset=utf-8',
      },
      arrayBuffer: async () => Buffer.from('<html><body>Project timeline: consent authorized, construction start, operation start.</body></html>', 'utf8'),
    }),
  });

  assert.equal(result.passed, true);
  assert.equal(result.blockedRows.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][5], 'value_not_confirmed');
});

test('verifyDraftReports filters requested draft ids and reports blockers without publishing', async () => {
  const logLines = [];
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes("WHERE review_status = 'draft'") && text.includes('id = ANY')) {
        assert.deepEqual(values, [[208, 209, 210]]);

        return {
          rows: [
            { id: 208, wind_farm_id: 6339, report_markdown: 'A', model_used: 'openai/gpt-5.4', name: 'Fanm Bugt' },
            { id: 210, wind_farm_id: 6342, report_markdown: 'B', model_used: 'openai/gpt-5.4', name: 'Nordsoren II Vest' },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await verifyDraftReports({
    client: fakeClient,
    reportIds: [208, 209, 210],
    verifyReportEvidenceFn: async (_client, reportId) => {
      if (reportId === 208) {
        return {
          passed: true,
          blockedRows: [],
        };
      }

      return {
        passed: false,
        blockedRows: [
          {
            id: 901,
            status: 'failed',
            error: 'Fetched source-of-record page did not contain the expected evidence quote.',
          },
        ],
      };
    },
    log: (line) => logLines.push(line),
  });

  assert.deepEqual(result, {
    draftCount: 2,
    passedReportIds: [208],
    blockedReports: [
      {
        reportId: 210,
        windFarmId: 6342,
        blockedRows: [
          {
            id: 901,
            status: 'failed',
            error: 'Fetched source-of-record page did not contain the expected evidence quote.',
          },
        ],
      },
    ],
    repairedReportIds: [],
    repairFailures: [],
    matchedReportIds: [208, 210],
    missingReportIds: [209],
  });
  assert.ok(logLines.some((line) => line.includes('Requested ids not found as draft reports: 209.')));
  assert.ok(logLines.some((line) => line.includes('Blocked report #210 for wind farm 6342:')));
});

test('verifyDraftReports repairs blocked drafts and re-verifies without publishing', async () => {
  const logLines = [];
  let verifyCallCount = 0;
  const fakeClient = {
    query: async (text, values = []) => {
      if (text.includes("WHERE review_status = 'draft'") && text.includes('id = ANY')) {
        assert.deepEqual(values, [[208]]);

        return {
          rows: [
            {
              id: 208,
              wind_farm_id: 6339,
              report_markdown: 'Original markdown',
              model_used: 'openai/gpt-5.4',
              name: 'Fanm Bugt',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await verifyDraftReports({
    client: fakeClient,
    reportIds: [208],
    repair: true,
    apiKey: 'test-key',
    verifyReportEvidenceFn: async () => {
      verifyCallCount += 1;

      if (verifyCallCount === 1) {
        return {
          passed: false,
          blockedRows: [
            {
              id: 901,
              status: 'failed',
              error: 'Source-of-record request returned HTTP 404.',
            },
          ],
        };
      }

      return {
        passed: true,
        blockedRows: [],
      };
    },
    requestBlockedRowRepairFn: async ({ reportMarkdown, blockedRows }) => {
      assert.equal(reportMarkdown, 'Original markdown');
      assert.equal(blockedRows.length, 1);
      return 'Repaired markdown';
    },
    updateResearchReportFn: async (_client, payload) => {
      assert.equal(payload.reportId, 208);
      assert.equal(payload.windFarmId, 6339);
      assert.equal(payload.reportMarkdown, 'Repaired markdown');
      assert.equal(payload.reviewStatus, 'draft');
      return { reportId: 208, factsInserted: 4 };
    },
    saveReportFn: async (outputPath, reportMarkdown) => {
      assert.match(outputPath, /reports[\\/]core_wind_farms[\\/]6339-fanm-bugt\.md$/);
      assert.equal(reportMarkdown, 'Repaired markdown');
      return outputPath;
    },
    log: (line) => logLines.push(line),
  });

  assert.equal(verifyCallCount, 2);
  assert.deepEqual(result, {
    draftCount: 1,
    passedReportIds: [208],
    blockedReports: [],
    repairedReportIds: [208],
    repairFailures: [],
    matchedReportIds: [208],
    missingReportIds: [],
  });
  assert.ok(logLines.some((line) => line.includes('Attempting blocked-row repair for report #208')));
});

test('publishDraftReports repairs a blocked draft and publishes it when reverification passes', async () => {
  const fakeClient = {
    query: async (text) => {
      if (text.includes('FROM research_wind_farm_reports r')) {
        return {
          rows: [
            {
              id: 50,
              wind_farm_id: 6646,
              report_markdown: 'Original markdown',
              model_used: 'openai/gpt-5.4',
              name: 'Beatrice Offshore Wind Farm',
            },
          ],
        };
      }

      if (text.includes("SET review_status = 'published'")) {
        return {
          rows: [{ id: 50, wind_farm_id: 6646 }],
        };
      }

      if (text.includes("SET status = 'active'")) {
        return { rowCount: 15 };
      }

      if (text.includes('published_reports')) {
        return {
          rows: [{
            published_reports: 15,
            remaining_drafts: 5,
            active_research_facts: 64,
            draft_research_facts: 43,
          }],
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  let verifyCallCount = 0;

  const result = await publishDraftReports({
    client: fakeClient,
    apiKey: 'test-key',
    verifyReportEvidenceFn: async () => {
      verifyCallCount += 1;

      if (verifyCallCount === 1) {
        return {
          passed: false,
          blockedRows: [
            {
              id: 847,
              status: 'failed',
              error: 'Fetched source-of-record page did not contain the expected evidence quote.',
              report_item_label: 'Capacity',
              report_field_name: 'capacity_mw',
              report_date: null,
              report_development: null,
              reported_value: '588 MW',
              source_url: 'https://example.com/beatrice',
              source_name: 'SSE page',
            },
          ],
        };
      }

      return {
        passed: true,
        blockedRows: [],
      };
    },
    requestBlockedRowRepairFn: async () => 'Repaired markdown',
    updateResearchReportFn: async () => ({ reportId: 50, factsInserted: 15 }),
    pruneObsoleteDraftReportsFn: async () => [],
    saveReportFn: async () => 'saved-path',
    sourceTableName: 'core_wind_farms',
    searchEngine: 'auto',
    maxResults: 6,
    maxTotalResults: 18,
    referer: '',
    title: '',
  });

  assert.deepEqual(result.publishedReportIds, [50]);
  assert.equal(verifyCallCount, 2);
});

test('pruneObsoleteDraftReports prefers a published report and removes stale drafts', async () => {
  const calls = [];
  const fakeClient = {
    query: async (text, values = []) => {
      calls.push({ text, values });

      if (text.includes('WHERE wind_farm_id = $1') && text.includes("review_status = 'draft'")) {
        return {
          rows: [{ id: 44 }, { id: 41 }],
        };
      }

      if (text.includes("review_status = 'published'")) {
        return {
          rows: [{ id: 52 }],
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  const deletedDraftIds = await pruneObsoleteDraftReports(fakeClient, {
    windFarmId: 6425,
  });

  assert.deepEqual(deletedDraftIds, [44, 41]);
  assert.equal(calls[2].values[0][0], 44);
  assert.equal(calls[2].values[0][1], 41);
  assert.equal(calls[3].values[1], 52);
  assert.equal(calls[5].values[0][0], 44);
  assert.equal(calls[5].values[0][1], 41);
});
