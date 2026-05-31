import './proxy.js';
const DEFAULT_CODEX_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export async function requestResearchReportCodex({
  apiKey,
  baseUrl,
  model,
  prompt,
  referer,
  title,
  fetchImpl = fetch,
}) {
  const responsesUrl = resolveCodexResponsesUrl(baseUrl);
  const useStreamingBackend = responsesUrl.includes('chatgpt.com/backend-api/codex/');
  const webSearchToolType = useStreamingBackend ? 'web_search' : 'web_search_preview';
  const response = await fetchImpl(responsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      ...(title ? { 'X-Title': title } : {}),
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
      store: false,
      ...(useStreamingBackend ? { stream: true } : {}),
      tools: [{ type: webSearchToolType }],
      instructions: [
        'You are an offshore wind research analyst.',
        'Use web search before answering.',
        'Return only the final completed report in markdown.',
      ].join(' '),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Codex request failed (${response.status}): ${errorText}`);
  }

  const payload = useStreamingBackend
    ? await parseStreamingCodexResponse(response)
    : await response.json();
  const outputText = payload.output_text || extractOutputText(payload);

  if (!outputText?.trim()) {
    throw new Error('Codex response did not contain report text.');
  }

  return outputText;
}

function resolveCodexResponsesUrl(baseUrl) {
  if (!baseUrl?.trim()) {
    return DEFAULT_CODEX_RESPONSES_URL;
  }

  return `${baseUrl.trim().replace(/\/$/, '')}/responses`;
}

async function parseStreamingCodexResponse(response) {
  const rawText = await response.text();
  const events = parseServerSentEvents(rawText);
  const textDeltas = [];
  let completedPayload = null;

  for (const event of events) {
    if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      textDeltas.push(event.delta);
      continue;
    }

    if (event?.type === 'response.completed') {
      completedPayload = event.response || event;
    }
  }

  if (completedPayload) {
    if (typeof completedPayload.output_text === 'string' && completedPayload.output_text.trim()) {
      return completedPayload;
    }

    const completedText = extractOutputText(completedPayload);
    if (completedText) {
      return { ...completedPayload, output_text: completedText };
    }
  }

  const deltaText = textDeltas.join('').trim();
  if (deltaText) {
    return { output_text: deltaText };
  }

  throw new Error('Codex streaming response did not contain report text.');
}

function parseServerSentEvents(rawText) {
  return rawText
    .split(/\r?\n\r?\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const dataLines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        return null;
      }

      const data = dataLines.join('\n');
      if (data === '[DONE]') {
        return null;
      }

      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const textParts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
        textParts.push(contentItem.text);
      }
    }
  }

  return textParts.join('\n').trim();
}
