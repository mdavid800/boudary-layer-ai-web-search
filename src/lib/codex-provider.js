const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export async function requestResearchReportCodex({
  apiKey,
  model,
  prompt,
  referer,
  title,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      ...(title ? { 'X-Title': title } : {}),
    },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
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

  const payload = await response.json();
  const outputText = payload.output_text || extractOutputText(payload);

  if (!outputText?.trim()) {
    throw new Error('Codex response did not contain report text.');
  }

  return outputText;
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
