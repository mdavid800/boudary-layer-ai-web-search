const OFFICIAL_SOURCE_HINTS = [
  {
    normalizedProjectNames: ['beatriceoffshorewindfarm', 'beatrice'],
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
  {
    normalizedProjectNames: ['seagreen', 'seagreenphase1', 'seagreenphase1windfarm'],
    sources: [
      {
        label: 'Official Seagreen project page',
        url: 'https://www.seagreenwindenergy.com/',
        anchorText: 'Seagreen is a joint venture between SSE Renewables (49%), TotalEnergies (25.5%) and PTTEP (25.5%).',
      },
      {
        label: 'SSE Renewables Seagreen project page',
        url: 'https://www.sserenewables.com/offshore-wind/operational-wind-farms/seagreen/',
        anchorText: 'It is located around 27km off the coast of Angus in the North Sea and is a £3bn joint venture between SSE Renewables (49%), TotalEnergies (25.5%) and PTTEP (25.5%).',
      },
    ],
  },
  {
    normalizedProjectNames: [
      'doggerbank',
      'doggerbankwindfarm',
      'doggerbanka',
      'doggerbankb',
      'doggerbankc',
      'doggerbankawindfarm',
      'doggerbankbwindfarm',
      'doggerbankcwindfarm',
    ],
    sources: [
      {
        label: 'Official Dogger Bank project page',
        url: 'https://doggerbank.com/',
        anchorText: 'The Dogger Bank offshore wind farm is a joint venture partnership between SSE (40%), Equinor (40%) and Vårgrønn (20%).',
      },
      {
        label: 'SSE Renewables Dogger Bank project page',
        url: 'https://www.sserenewables.com/offshore-wind/projects/dogger-bank/',
        anchorText: 'The world-leading project under construction in the North Sea more than 130km off the North East coast of England is a joint venture between SSE (40%), Equinor (40%) and Vårgrønn (20%).',
      },
    ],
  },
  {
    normalizedProjectNames: ['morayeast', 'morayeastwindfarm', 'morayeastoffshorewindfarm'],
    sources: [
      {
        label: 'Official Moray East sponsors page',
        url: 'https://www.morayeast.com/project/sponsors',
        anchorText: 'The shareholder structure of Moray East includes Ocean Winds (40%), Diamond Green Limited (33.4%), and Equitix (26.6%).',
      },
    ],
  },
  {
    normalizedProjectNames: ['moraywest', 'moraywestwindfarm', 'moraywestoffshorewindfarm'],
    sources: [
      {
        label: 'Official Moray West sponsors page',
        url: 'https://www.moraywest.com/project/sponsors',
        anchorText: 'Moray West is principally owned by Ocean Winds (OW), a 50:50 joint venture between ENGIE and EDP Renewables. A small minority stake is held by UAB Ignitis renewables.',
      },
    ],
  },
  {
    normalizedProjectNames: ['eastangliaone', 'eastanglia1', 'eastangliaonewindfarm'],
    sources: [
      {
        label: 'ScottishPower Renewables East Anglia ONE page',
        url: 'https://www.scottishpowerrenewables.com/east-anglia-one',
        anchorText: 'East Anglia ONE, a joint venture between ScottishPower Renewables and Bilbao Offshore Holding Limited.',
      },
    ],
  },
  {
    normalizedProjectNames: ['eastangliatwo', 'eastanglia2', 'eastangliatwowindfarm'],
    sources: [
      {
        label: 'ScottishPower Renewables East Anglia TWO page',
        url: 'https://www.scottishpowerrenewables.com/east-anglia-two',
        anchorText: 'The East Anglia TWO project, which is wholly owned by ScottishPower Renewables, alongside East Anglia ONE North will be the last of our four East Anglia projects to be developed.',
      },
    ],
  },
  {
    normalizedProjectNames: ['eastangliathree', 'eastanglia3', 'eastangliathreewindfarm'],
    sources: [
      {
        label: 'ScottishPower Renewables East Anglia THREE page',
        url: 'https://www.scottishpowerrenewables.com/east-anglia-three',
        anchorText: 'The East Anglia THREE project is the second of our four East Anglia projects to be developed. It is being delivered as part of a 50/50 joint venture with our strategic investment partner, Masdar.',
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
  return (
    OFFICIAL_SOURCE_HINTS.find((entry) =>
      (entry.normalizedProjectNames ?? [entry.normalizedProjectName]).includes(normalizedProjectName),
    ) ?? null
  );
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