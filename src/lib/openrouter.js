const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPORT_TABLE_HEADERS = [
  '| Item | Completed detail | Sources |',
  '| Date | Development | Why it matters | Sources |',
];
const SYSTEM_MESSAGE = [
  'You are an offshore wind research analyst.',
  'You must use current web sources via the available web search tool before answering.',
  'Follow the user prompt exactly and keep the final answer in markdown.',
  'Return only the final completed report, not search-planning narration or intermediate search steps.',
].join(' ');

export async function requestResearchReport({
  apiKey,
  model,
  prompt,
  searchEngine,
  searchMode,
  maxResults,
  maxTotalResults,
  referer,
  title,
  fetchImpl = fetch,
}) {
  const normalizedSearchMode = normalizeSearchMode(searchMode);
  const sharedOptions = {
    apiKey,
    fetchImpl,
    model,
    prompt,
    referer,
    searchEngine,
    title,
  };

  if (normalizedSearchMode === 'plugin') {
    return requestWithWebPlugin({
      ...sharedOptions,
      maxResults,
    });
  }

  if (normalizedSearchMode === 'server-tool') {
    const report = await requestWithServerTool({
      ...sharedOptions,
      maxResults,
      maxTotalResults,
    });

    if (!isCompletedResearchReport(report)) {
      throw new Error(
        'OpenRouter server-tool mode returned an incomplete response. Switch to OPENROUTER_SEARCH_MODE=plugin or --search-mode plugin for reliable report output.',
      );
    }

    return report;
  }

  let serverToolReport = '';

  try {
    serverToolReport = await requestWithServerTool({
      ...sharedOptions,
      maxResults,
      maxTotalResults,
    });

    if (isCompletedResearchReport(serverToolReport)) {
      return serverToolReport;
    }
  } catch {
    serverToolReport = '';
  }

  const pluginReport = await requestWithWebPlugin({
    ...sharedOptions,
    maxResults,
  });

  if (isCompletedResearchReport(pluginReport)) {
    return pluginReport;
  }

  throw new Error(
    buildIncompleteReportError({
      pluginReport,
      serverToolReport,
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

export function normalizeSearchMode(searchMode = 'plugin') {
  const normalizedSearchMode = searchMode.trim().toLowerCase();

  if (
    normalizedSearchMode !== 'plugin' &&
    normalizedSearchMode !== 'server-tool' &&
    normalizedSearchMode !== 'auto'
  ) {
    throw new Error(
      `Unsupported search mode: ${searchMode}. Use plugin, server-tool, or auto.`,
    );
  }

  return normalizedSearchMode;
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
          parameters: {
            engine: searchEngine,
            max_results: maxResults,
            max_total_results: maxTotalResults,
          },
        },
      ],
    },
  });
}

async function requestWithWebPlugin({
  apiKey,
  fetchImpl,
  model,
  prompt,
  referer,
  searchEngine,
  title,
  maxResults,
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
      plugins: [
        {
          id: 'web',
          engine: searchEngine,
          max_results: maxResults,
        },
      ],
    },
  });
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

function buildIncompleteReportError({ serverToolReport, pluginReport }) {
  const serverToolPreview = summarizeContent(serverToolReport);
  const pluginPreview = summarizeContent(pluginReport);

  return [
    'OpenRouter returned an incomplete research response.',
    `Server-tool preview: ${serverToolPreview}`,
    `Plugin preview: ${pluginPreview}`,
  ].join(' ');
}

function summarizeContent(content) {
  if (!content) {
    return 'none';
  }

  return content.replace(/\s+/g, ' ').trim().slice(0, 180);
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
