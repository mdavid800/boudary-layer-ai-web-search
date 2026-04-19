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

  const { profileRows, recentDevelopments } = parseStructuredReport(content);
  const qualityIssues = [];

  if (hasInvalidSourceLinks(profileRows, recentDevelopments)) {
    qualityIssues.push('invalid-source-links');
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

  return recentDevelopments.some((row) => {
    const datedRecently = recentYears.some((year) => row.date.includes(year));
    const mentionsOwnership = /(owner|ownership|operator|equity|stake)/i.test(
      `${row.development} ${row.why_it_matters}`,
    );

    return datedRecently && mentionsOwnership;
  });
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
    prompt: buildFreshnessRetryPrompt(requestOptions.prompt),
  });

  return {
    report: retryReport,
    qualityIssues: getResearchReportQualityIssues(retryReport),
  };
}

function buildFreshnessRetryPrompt(prompt) {
  return `${prompt.trim()}\n\n${FRESHNESS_RETRY_NOTE}`;
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
  return {
    engine: searchEngine || 'auto',
    max_results: maxResults,
    max_total_results: maxTotalResults,
  };
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
