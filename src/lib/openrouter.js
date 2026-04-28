import { parseStructuredReport } from './report-structure.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPORT_TABLE_HEADERS = [
  '| Item | Value | Research summary | Sources |',
  '| Date | Development | Why it matters | Sources |',
];
const OWNERSHIP_ITEM_LABELS = ['Developer / owners', 'Ownership history'];
const FRESHNESS_RETRY_NOTE = [
  '',
  'Critical correction for this retry:',
  '- For current owners, operator, ownership split, and status, the important freshness signal is the source page\'s own published or last-updated date, not the date of search.',
  '- Re-check those fields using the newest dated authoritative sources you can find.',
  '- If an official project page is old or undated and a newer authoritative source exists, prefer the newer dated source for current facts.',
  '- For current ownership, prefer the official project website, official JV website, or official operator page over a single partner or investor asset page.',
  '- Do not infer the full ownership split from one partner page alone; verify the full partnership and that percentages reconcile.',
  '- In the Research summary for Developer / owners and Ownership history, explicitly state the freshest source date relied on.',
  '- Do not use access dates or phrasing like "as accessed 2026" as freshness evidence.',
].join('\n');
const SOURCE_ACCESSIBILITY_RETRY_NOTE = [
  '',
  'Critical correction for this retry:',
  '- Do not use paywalled, login-gated, bot-blocked, or third-party database pages as the primary source_of_record when an official, regulator, owner, operator, supplier, or open-dataset source can support the same value.',
  '- If a risky news or third-party database source is still useful, keep it only as supporting context and choose an openly accessible primary source for source_of_record.',
  '- Prefer current live official or regulator URLs over older moved or stale announcement links when selecting source_of_record.',
  '- For harder-to-source fields such as MEC, FID, consent date, first power date, commissioning date, turbine model, rotor diameter, hub height, and foundations, one authoritative accessible source_of_record is acceptable when stronger corroboration is hard to obtain.',
  '- Do not reach for blocked, paywalled, or opaque magazine/PDF sources just to add a second or third citation for those hard fields.',
].join('\n');
const BLOCKED_SOURCE_DOMAIN_NOTE = [
  '',
  'Hard blocked source rule:',
  '- Never use TGS, 4C Offshore, or Windpower Monthly anywhere in the report.',
  '- Do not cite those domains in the visible Sources column, supporting_context, or source_of_record.',
  '- Replace any fact that only used those domains with another accessible authoritative source or open dataset.',
].join('\n');
const VERIFIER_FRIENDLY_EVIDENCE_NOTE = [
  '',
  'Critical evidence correction:',
  '- In source_of_record.evidence_quote, use a short verbatim machine-checkable fragment copied closely from the page text, not a paraphrase.',
  '- Prefer compact label-plus-value fragments such as "Installed capacity 588 MW", "114 turbines", "Final investment decision June 2018", or owner names with percentages.',
  '- For dates, include the milestone label and the date in the quote whenever possible.',
  '- For ownership rows, include the entity names and percentages in the quote whenever possible.',
  '- Avoid long prose summaries in evidence_quote when a shorter precise fragment exists on the source page.',
].join('\n');
const BLOCKED_SOURCE_DOMAINS = [
  'tgs.com',
  '4coffshore.com',
  'windpowermonthly.com',
];
const BLOCKED_SOURCE_DOMAIN_PATTERNS = [
  /(^|\.)tgs\.com$/i,
  /(^|\.)4coffshore\.com$/i,
  /(^|\.)windpowermonthly\.com$/i,
];
const RISKY_SOURCE_OF_RECORD_DOMAIN_PATTERNS = [
  /(^|\.)windpowermonthly\.com$/i,
  /(^|\.)4coffshore\.com$/i,
  /(^|\.)rechargenews\.com$/i,
  /(^|\.)upstreamonline\.com$/i,
  /(^|\.)bloomberg\.com$/i,
  /(^|\.)wsj\.com$/i,
  /(^|\.)ft\.com$/i,
];
const SYSTEM_MESSAGE = [
  'You are an offshore wind research analyst.',
  'You must use current web sources via the available web search tool before answering.',
  'Never infer site-specific turbine specifications from a generic turbine product page or from another wind farm that uses the same turbine model.',
  'Follow the user prompt exactly and keep the final answer in markdown.',
  'Return only the final completed report, not search-planning narration or intermediate search steps.',
].join(' ');

export async function requestResearchReport({
  apiKey,
  model,
  prompt,
  searchEngine,
  maxResults,
  maxTotalResults,
  referer,
  title,
  fetchImpl = fetch,
}) {
  const serverToolResult = await requestWithRetry({
    requestFn: requestWithServerTool,
    requestOptions: {
      apiKey,
      fetchImpl,
      model,
      prompt,
      referer,
      searchEngine,
      title,
      maxResults,
      maxTotalResults,
    },
  });

  if (serverToolResult.qualityIssues.length === 0) {
    return serverToolResult.report;
  }

  throw new Error(
    buildIncompleteReportError({
      serverToolReport: serverToolResult.report,
      qualityIssues: serverToolResult.qualityIssues,
    }),
  );
}

export async function requestBlockedRowRepair({
  apiKey,
  model,
  reportMarkdown,
  blockedRows,
  searchEngine,
  maxResults,
  maxTotalResults,
  referer,
  title,
  fetchImpl = fetch,
}) {
  const repairPrompt = buildBlockedRowRepairPrompt(reportMarkdown, blockedRows);
  const repairResult = await requestWithRetry({
    requestFn: requestWithServerTool,
    requestOptions: {
      apiKey,
      fetchImpl,
      model,
      prompt: repairPrompt,
      referer,
      searchEngine,
      title,
      maxResults,
      maxTotalResults,
    },
  });

  if (repairResult.qualityIssues.length === 0) {
    return repairResult.report;
  }

  throw new Error(
    buildIncompleteReportError({
      serverToolReport: repairResult.report,
      qualityIssues: repairResult.qualityIssues,
    }),
  );
}

export function isCompletedResearchReport(content) {
  if (typeof content !== 'string') {
    return false;
  }

  const normalizedContent = content.replace(/\r\n/g, '\n');

  return REPORT_TABLE_HEADERS.every((header) => normalizedContent.includes(header));
}

export function getResearchReportQualityIssues(content, referenceDate = new Date()) {
  if (!isCompletedResearchReport(content)) {
    return ['missing-required-tables'];
  }

  const {
    profileRows,
    recentDevelopments,
    provenanceAppendix,
    provenanceAppendixError,
  } = parseStructuredReport(content);
  const qualityIssues = [];

  if (provenanceAppendixError) {
    qualityIssues.push(provenanceAppendixError);
    return qualityIssues;
  }

  if (hasInvalidProvenanceAppendix(profileRows, recentDevelopments, provenanceAppendix)) {
    qualityIssues.push('invalid-provenance-appendix');
  }

  if (hasMissingSourceOfRecord(profileRows)) {
    qualityIssues.push('missing-source-of-record');
  }

  if (hasInvalidSourceLinks(profileRows, recentDevelopments)) {
    qualityIssues.push('invalid-source-links');
  }

  if (hasBlockedSourceDomain(profileRows, recentDevelopments)) {
    qualityIssues.push('blocked-source-domain');
  }

  if (hasRiskySourceOfRecord(profileRows, recentDevelopments)) {
    qualityIssues.push('risky-source-of-record');
  }

  if (recentDevelopments.length === 0) {
    qualityIssues.push('missing-recent-developments');
  }

  if (!hasFreshOwnershipEvidence(profileRows, recentDevelopments, referenceDate)) {
    qualityIssues.push('stale-ownership-evidence');
  }

  return qualityIssues;
}

function hasInvalidSourceLinks(profileRows = [], recentDevelopments = []) {
  return [...profileRows, ...recentDevelopments].some((row) =>
    Array.isArray(row.invalid_source_links) && row.invalid_source_links.length > 0,
  );
}

function hasInvalidProvenanceAppendix(profileRows = [], recentDevelopments = [], provenanceAppendix) {
  if (!provenanceAppendix) {
    return true;
  }

  const hasProfileMismatch = profileRows.some((row) => {
    if (!row.provenance) {
      return true;
    }

    return row.provenance.item_label !== row.item_label || row.provenance.value !== row.value;
  });

  if (hasProfileMismatch) {
    return true;
  }

  return recentDevelopments.some((row) => {
    if (!row.provenance) {
      return true;
    }

    return row.provenance.date !== row.date || row.provenance.development !== row.development;
  });
}

function hasMissingSourceOfRecord(profileRows = []) {
  return profileRows.some((row) => {
    if (row.is_not_confirmed) {
      return false;
    }

    const sourceOfRecord = row.provenance?.source_of_record;
    return !sourceOfRecord?.source_url || !sourceOfRecord?.source_type;
  });
}

function isBlockedSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
    return false;
  }

  try {
    const hostname = new URL(sourceUrl).hostname;
    return BLOCKED_SOURCE_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

function getRowSourceUrls(row) {
  const visibleSources = Array.isArray(row?.sources)
    ? row.sources.map((source) => source?.url)
    : [];
  const supportingContext = Array.isArray(row?.provenance?.supporting_context)
    ? row.provenance.supporting_context.map((source) => source?.url)
    : [];

  return [
    ...visibleSources,
    row?.provenance?.source_of_record?.source_url,
    ...supportingContext,
  ].filter(Boolean);
}

function hasBlockedSourceDomain(profileRows = [], recentDevelopments = []) {
  return [...profileRows, ...recentDevelopments].some((row) =>
    getRowSourceUrls(row).some((sourceUrl) => isBlockedSourceUrl(sourceUrl)),
  );
}

function isRiskySourceOfRecordUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
    return false;
  }

  try {
    const hostname = new URL(sourceUrl).hostname;
    return RISKY_SOURCE_OF_RECORD_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

function hasRiskySourceOfRecord(profileRows = [], recentDevelopments = []) {
  return [...profileRows, ...recentDevelopments].some((row) => {
    if (row.is_not_confirmed) {
      return false;
    }

    return isRiskySourceOfRecordUrl(row.provenance?.source_of_record?.source_url);
  });
}

export function hasFreshOwnershipEvidence(
  profileRows,
  recentDevelopments = [],
  referenceDate = new Date(),
) {
  if (!Array.isArray(profileRows) || profileRows.length === 0) {
    return false;
  }

  const recentYears = getRecentYearStrings(referenceDate);
  const hasRequiredOwnershipRows = OWNERSHIP_ITEM_LABELS.every((itemLabel) => {
    const row = profileRows.find((candidate) => candidate.item_label === itemLabel);

    return row && row.sources.length >= 2;
  });

  if (!hasRequiredOwnershipRows) {
    return false;
  }

  const hasDatedOwnershipSummaries = OWNERSHIP_ITEM_LABELS.every((itemLabel) => {
    const row = profileRows.find((candidate) => candidate.item_label === itemLabel);

    return rowHasUsableFreshnessDate(row.research_summary, recentYears);
  });

  if (hasDatedOwnershipSummaries) {
    return true;
  }

  if (hasStableOwnershipFallback(profileRows)) {
    return true;
  }

  return recentDevelopments.some((row) => {
    const datedRecently = recentYears.some((year) => row.date.includes(year));
    const mentionsOwnership = /(owner|ownership|operator|equity|stake)/i.test(
      `${row.development} ${row.why_it_matters}`,
    );

    return datedRecently && mentionsOwnership;
  });
}

function hasStableOwnershipFallback(profileRows = []) {
  const developerOwnersRow = profileRows.find(
    (candidate) => candidate.item_label === 'Developer / owners',
  );
  const ownershipHistoryRow = profileRows.find(
    (candidate) => candidate.item_label === 'Ownership history',
  );

  return (
    rowHasCurrentOwnershipNarrative(developerOwnersRow?.research_summary)
    && rowHasStableOwnershipNarrative(ownershipHistoryRow?.research_summary)
  );
}

async function requestWithRetry({ requestFn, requestOptions }) {
  const initialReport = await requestFn(requestOptions);
  const initialQualityIssues = getResearchReportQualityIssues(initialReport);

  if (initialQualityIssues.length === 0) {
    return {
      report: initialReport,
      qualityIssues: [],
    };
  }

  const retryReport = await requestFn({
    ...requestOptions,
    prompt: buildRetryPrompt(requestOptions.prompt, initialQualityIssues),
  });

  return {
    report: retryReport,
    qualityIssues: getResearchReportQualityIssues(retryReport),
  };
}

function buildRetryPrompt(prompt, qualityIssues = []) {
  const retryNotes = [];

  if (qualityIssues.includes('stale-ownership-evidence')) {
    retryNotes.push(FRESHNESS_RETRY_NOTE);
  }

  if (qualityIssues.includes('risky-source-of-record')) {
    retryNotes.push(SOURCE_ACCESSIBILITY_RETRY_NOTE);
  }

  if (qualityIssues.includes('blocked-source-domain')) {
    retryNotes.push(BLOCKED_SOURCE_DOMAIN_NOTE);
  }

  retryNotes.push(VERIFIER_FRIENDLY_EVIDENCE_NOTE);

  if (retryNotes.length === 0) {
    retryNotes.push(FRESHNESS_RETRY_NOTE);
  }

  return `${prompt.trim()}\n\n${retryNotes.join('\n')}`;
}

export function buildBlockedRowRepairPrompt(reportMarkdown, blockedRows = []) {
  const blockedRowSummary = blockedRows.map((row) => ({
    id: row.id,
    report_item_label: row.report_item_label ?? null,
    report_field_name: row.report_field_name ?? null,
    report_date: row.report_date ?? null,
    report_development: row.report_development ?? null,
    reported_value: row.reported_value ?? null,
    source_name: row.source_name ?? null,
    source_url: row.source_url ?? null,
    error: row.error ?? null,
  }));

  return [
    'You are repairing an existing offshore wind research report that failed source-of-record verification on a small number of rows.',
    'Search the web again and return the full corrected markdown report in the exact same parser contract format.',
    'Preserve every table row, recent-development row, and appendix entry that is not listed as blocked below.',
    'Only replace blocked rows and the matching provenance appendix entries unless a minimal adjacent edit is strictly required for internal consistency.',
    'For repaired rows, prefer openly accessible official, regulator, owner, operator, supplier, or open-dataset pages over PDFs or risky third-party pages when available.',
    'Never use TGS, 4C Offshore, or Windpower Monthly anywhere in the repaired report.',
    'Use short verbatim machine-checkable evidence_quote fragments copied closely from the source page text.',
    'Prefer label-plus-value fragments such as "Installed capacity 588 MW", "114 turbines", "Final investment decision June 2018", or owner names with percentages.',
    'Do not paraphrase the evidence_quote.',
    'Return only the full repaired markdown report with the two tables and the Provenance appendix JSON block.',
    '',
    'Blocked rows to repair:',
    '```json',
    JSON.stringify(blockedRowSummary, null, 2),
    '```',
    '',
    'Current report to repair:',
    '```markdown',
    reportMarkdown.trim(),
    '```',
  ].join('\n');
}

async function requestWithServerTool({
  apiKey,
  fetchImpl,
  model,
  prompt,
  referer,
  searchEngine,
  title,
  maxResults,
  maxTotalResults,
}) {
  return requestChatCompletion({
    apiKey,
    fetchImpl,
    referer,
    title,
    body: {
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'openrouter:web_search',
          parameters: buildWebSearchParameters({
            searchEngine,
            maxResults,
            maxTotalResults,
          }),
        },
      ],
    },
  });
}

function buildWebSearchParameters({ searchEngine, maxResults, maxTotalResults }) {
  const parameters = {
    engine: searchEngine || 'auto',
    max_results: maxResults,
    max_total_results: maxTotalResults,
  };

  // Firecrawl rejects domain filters; other supported engines accept them,
  // and unsupported native providers will ignore or vary by provider.
  if (parameters.engine !== 'firecrawl') {
    parameters.excluded_domains = BLOCKED_SOURCE_DOMAINS;
  }

  return parameters;
}

async function requestChatCompletion({
  apiKey,
  fetchImpl,
  referer,
  title,
  body,
}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (referer) {
    headers['HTTP-Referer'] = referer;
  }

  if (title) {
    headers['X-Title'] = title;
  }

  const response = await fetchImpl(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const { parsedBody, rawBody } = await readBody(response);

  if (!response.ok) {
    throw new Error(buildOpenRouterError(response.status, parsedBody, rawBody));
  }

  const content = extractTextContent(parsedBody);

  if (!content) {
    throw new Error('OpenRouter returned no assistant content.');
  }

  return content.trim();
}

export function extractTextContent(payload) {
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (typeof messageContent === 'string') {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part?.type === 'text' || part?.type === 'output_text') {
          return part.text || '';
        }

        return '';
      })
      .join('')
      .trim();
  }

  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();
  }

  return '';
}

export function buildOpenRouterError(status, parsedBody, rawBody) {
  const message =
    parsedBody?.error?.message ||
    parsedBody?.message ||
    rawBody ||
    'Unknown error returned by OpenRouter.';

  return `OpenRouter request failed (${status}): ${message}`;
}

function buildIncompleteReportError({ serverToolReport, qualityIssues = [] }) {
  const serverToolPreview = summarizeContent(serverToolReport);

  return [
    'OpenRouter returned a research response that did not satisfy the report quality checks.',
    qualityIssues.length > 0 ? `Quality issues: ${qualityIssues.join(', ')}.` : '',
    `Server-tool preview: ${serverToolPreview}`,
  ].join(' ');
}

function summarizeContent(content) {
  if (!content) {
    return 'none';
  }

  return content.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function getRecentYearStrings(referenceDate) {
  const currentYear = referenceDate.getUTCFullYear();
  return [currentYear, currentYear - 1, currentYear - 2].map(String);
}

function rowHasUsableFreshnessDate(summary, recentYears) {
  if (typeof summary !== 'string' || /as accessed/i.test(summary)) {
    return false;
  }

  return recentYears.some((year) => summary.includes(year));
}

function rowHasCurrentOwnershipNarrative(summary) {
  if (typeof summary !== 'string' || /as accessed/i.test(summary)) {
    return false;
  }

  return /(current owner|current ownership|current ownership split|ownership split|owners include|owned by|operator|freshest (?:ownership )?source|current portfolio page|current structure)/i.test(
    summary,
  );
}

function rowHasStableOwnershipNarrative(summary) {
  if (typeof summary !== 'string' || /as accessed/i.test(summary)) {
    return false;
  }

  return /(remain(?:s|ed)?|no (?:later|subsequent|confirmed) (?:equity |ownership |transfer |stake |change)|unchanged|continue(?:s|d)? to own|still owned|later ownership change|current structure|operating partner|current split)/i.test(
    summary,
  );
}

async function readBody(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return {
      parsedBody: null,
      rawBody: '',
    };
  }

  try {
    return {
      parsedBody: JSON.parse(rawBody),
      rawBody,
    };
  } catch {
    return {
      parsedBody: null,
      rawBody,
    };
  }
}
