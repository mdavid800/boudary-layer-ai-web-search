const OFFICIAL_SOURCE_HINTS = [
  {
    normalizedProjectName: 'beatriceoffshorewindfarm',
    sources: [
      {
        label: 'Official Beatrice project about page',
        url: 'https://www.beatricewind.com/about/',
        anchorText: 'joint venture partnership between',
        ownershipPartners: [
          { name: 'SSE Renewables' },
          { name: 'Red Rock Renewables' },
          { name: 'TRIG', aliases: ['The Renewables Infrastructure Group'] },
          { name: 'Equitix' },
        ],
      },
    ],
  },
];

export async function buildOfficialSourceContext(projectName, { fetchImpl = fetch } = {}) {
  const hint = getOfficialSourceHint(projectName);

  if (!hint) {
    return '';
  }

  const snippets = [];

  for (const source of hint.sources) {
    try {
      const response = await fetchImpl(source.url);

      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const snippet = source.ownershipPartners
        ? extractOwnershipPartnerSnippet(html, source.ownershipPartners)
        : extractRelevantSnippet(html, source.anchorText);

      if (!snippet) {
        continue;
      }

      snippets.push(`- ${source.label} (${source.url}): ${snippet}`);
    } catch {
      // Ignore network failures and fall back to the normal prompt.
    }
  }

  if (snippets.length === 0) {
    return '';
  }

  return [
    '',
    'High-priority official source hints for current facts:',
    'Use these official project/operator hints before relying on secondary databases or a single partner asset page, especially for ownership and operator details.',
    ...snippets,
  ].join('\n');
}

function getOfficialSourceHint(projectName) {
  const normalizedProjectName = normalizeProjectName(projectName);
  return OFFICIAL_SOURCE_HINTS.find((entry) => entry.normalizedProjectName === normalizedProjectName) ?? null;
}

function normalizeProjectName(projectName) {
  return String(projectName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractRelevantSnippet(html, anchorText) {
  const text = stripHtml(html);

  if (!text) {
    return '';
  }

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const lowerText = normalizedText.toLowerCase();
  const lowerAnchor = anchorText.toLowerCase();
  const anchorIndex = lowerText.indexOf(lowerAnchor);

  if (anchorIndex === -1) {
    return '';
  }

  return normalizedText.slice(anchorIndex, anchorIndex + 600).trim();
}

function extractOwnershipPartnerSnippet(html, ownershipPartners) {
  const text = stripHtml(html);

  if (!text) {
    return '';
  }

  const partnerSummaries = ownershipPartners
    .map((partner) => {
      const share = findNearestShare(text, partner);

      if (!share) {
        return null;
      }

      return `${partner.name} (${share})`;
    })
    .filter(Boolean);

  if (partnerSummaries.length < 2) {
    return '';
  }

  return `Official project page ownership cards indicate ${partnerSummaries.join('; ')}.`;
}

function findNearestShare(text, partner) {
  const variants = [partner.name, ...(partner.aliases || [])];
  const lowerText = text.toLowerCase();

  for (const variant of variants) {
    const index = lowerText.indexOf(variant.toLowerCase());

    if (index === -1) {
      continue;
    }

    const afterWindow = text.slice(index, Math.min(text.length, index + 150));
    const afterMatch = afterWindow.match(/\((\d+(?:\.\d+)?% share)\)/i);

    if (afterMatch) {
      return afterMatch[1];
    }

    const beforeWindow = text.slice(Math.max(0, index - 150), index);
    const beforeMatches = [...beforeWindow.matchAll(/\((\d+(?:\.\d+)?% share)\)/gi)];

    if (beforeMatches.length > 0) {
      return beforeMatches[beforeMatches.length - 1][1];
    }
  }

  return null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}