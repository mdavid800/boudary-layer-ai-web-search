const ITEM_TO_FIELD = new Map([
  ['capacity', 'capacity_mw'],
  ['status', 'status'],
  ['turbine model', 'turbine_model'],
  ['turbine manufacturer', 'turbine_oem'],
  ['turbine manufacturer (oem)', 'turbine_oem'],
  ['individual rated power', 'rated_power_mw'],
  ['rotor diameter', 'rotor_diameter_m'],
  ['hub height', 'hub_height_m'],
  ['total turbine count', 'turbine_count'],
  ['foundations', 'foundation_type'],
  ['consent date', 'consent_date'],
  ['final investment decision (fid)', 'fid_date'],
  ['fid', 'fid_date'],
  ['first power date', 'first_power_date'],
  ['full commissioning date', 'commissioning_date'],
  ['developer / owners', 'developer'],
  ['developer/owners', 'developer'],
  ['maximum export capacity (mec)', 'mec_mw'],
  ['mec', 'mec_mw'],
]);

const NOT_CONFIRMED_VALUES = new Set([
  'not confirmed',
  'not available',
  'n/a',
  'unknown',
]);

const PROVENANCE_APPENDIX_HEADING_PATTERN =
  /(?:^|\n)(?:#{1,6}\s*)?Provenance appendix\s*\n+```json\s*\n([\s\S]*?)\n```/i;

function splitTableRow(row) {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function stripMarkdownFormatting(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMarkdownLinks(cell) {
  if (!cell) {
    return [];
  }

  const matches = [...cell.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  return matches.map((match) => ({
    label: stripMarkdownFormatting(match[1]),
    url: match[2].trim(),
  }));
}

function extractSources(cell) {
  return extractMarkdownLinks(cell).filter((link) => /^https?:\/\//i.test(link.url));
}

function extractInvalidSourceLinks(cell) {
  return extractMarkdownLinks(cell).filter((link) => !/^https?:\/\//i.test(link.url));
}

function parseTables(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tables = [];
  let currentRows = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      currentRows.push(splitTableRow(trimmed));
      continue;
    }

    if (currentRows.length > 0) {
      tables.push(currentRows);
      currentRows = [];
    }
  }

  if (currentRows.length > 0) {
    tables.push(currentRows);
  }

  return tables;
}

function normalizeSourceLink(link) {
  if (!link || typeof link !== 'object') {
    return null;
  }

  const label = stripMarkdownFormatting(String(link.label || ''));
  const url = typeof link.url === 'string' ? link.url.trim() : '';

  if (!url) {
    return null;
  }

  return {
    label: label || 'Source',
    url,
  };
}

function normalizeSourceOfRecord(sourceOfRecord) {
  if (!sourceOfRecord || typeof sourceOfRecord !== 'object') {
    return null;
  }

  const sourceUrl = typeof sourceOfRecord.source_url === 'string'
    ? sourceOfRecord.source_url.trim()
    : '';

  return {
    source_url: sourceUrl || null,
    source_name: typeof sourceOfRecord.source_name === 'string'
      ? sourceOfRecord.source_name.trim() || null
      : null,
    source_type: typeof sourceOfRecord.source_type === 'string'
      ? sourceOfRecord.source_type.trim() || null
      : null,
    licence: typeof sourceOfRecord.licence === 'string'
      ? sourceOfRecord.licence.trim() || null
      : null,
    retrieved_at: typeof sourceOfRecord.retrieved_at === 'string'
      ? sourceOfRecord.retrieved_at.trim() || null
      : null,
    evidence_quote: typeof sourceOfRecord.evidence_quote === 'string'
      ? sourceOfRecord.evidence_quote.trim() || null
      : null,
    confidence: typeof sourceOfRecord.confidence === 'string' || typeof sourceOfRecord.confidence === 'number'
      ? String(sourceOfRecord.confidence)
      : null,
    derived_by_ai: typeof sourceOfRecord.derived_by_ai === 'boolean'
      ? sourceOfRecord.derived_by_ai
      : null,
    human_verified: typeof sourceOfRecord.human_verified === 'boolean'
      ? sourceOfRecord.human_verified
      : null,
    verification_status: typeof sourceOfRecord.verification_status === 'string'
      ? sourceOfRecord.verification_status.trim() || null
      : null,
  };
}

function normalizeProvenanceRow(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const itemLabel = stripMarkdownFormatting(String(entry.item_label || ''));
  const fieldName = typeof entry.field_name === 'string' ? entry.field_name.trim() : null;
  const value = stripMarkdownFormatting(String(entry.value || ''));
  const sourceOfRecord = normalizeSourceOfRecord(entry.source_of_record);
  const supportingContext = Array.isArray(entry.supporting_context)
    ? entry.supporting_context.map(normalizeSourceLink).filter(Boolean)
    : [];

  if (!itemLabel && !fieldName) {
    return null;
  }

  return {
    item_label: itemLabel || null,
    field_name: fieldName || null,
    value,
    provenance_mode: typeof entry.provenance_mode === 'string'
      ? entry.provenance_mode.trim() || null
      : null,
    source_of_record: sourceOfRecord,
    supporting_context: supportingContext,
  };
}

function normalizeRecentDevelopmentProvenance(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const date = stripMarkdownFormatting(String(entry.date || ''));
  const development = stripMarkdownFormatting(String(entry.development || ''));

  if (!date || !development) {
    return null;
  }

  return {
    date,
    development,
    provenance_mode: typeof entry.provenance_mode === 'string'
      ? entry.provenance_mode.trim() || null
      : null,
    source_of_record: normalizeSourceOfRecord(entry.source_of_record),
    supporting_context: Array.isArray(entry.supporting_context)
      ? entry.supporting_context.map(normalizeSourceLink).filter(Boolean)
      : [],
  };
}

function parseProvenanceAppendix(markdown) {
  const match = markdown.match(PROVENANCE_APPENDIX_HEADING_PATTERN);

  if (!match) {
    return {
      data: null,
      error: 'missing-provenance-appendix',
    };
  }

  try {
    const parsed = JSON.parse(match[1]);
    const profileRows = Array.isArray(parsed?.profile_rows)
      ? parsed.profile_rows.map(normalizeProvenanceRow).filter(Boolean)
      : [];
    const recentDevelopments = Array.isArray(parsed?.recent_developments)
      ? parsed.recent_developments.map(normalizeRecentDevelopmentProvenance).filter(Boolean)
      : [];

    return {
      data: {
        profile_rows: profileRows,
        recent_developments: recentDevelopments,
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: 'invalid-provenance-appendix',
    };
  }
}

function buildProvenanceRowIndex(provenanceRows = []) {
  const byItemLabel = new Map();
  const byFieldName = new Map();

  for (const row of provenanceRows) {
    if (row.item_label && !byItemLabel.has(row.item_label)) {
      byItemLabel.set(row.item_label, row);
    }

    if (row.field_name && !byFieldName.has(row.field_name)) {
      byFieldName.set(row.field_name, row);
    }
  }

  return { byItemLabel, byFieldName };
}

function buildRecentDevelopmentProvenanceIndex(provenanceRows = []) {
  return new Map(
    provenanceRows.map((row) => [`${row.date}::${row.development}`, row]),
  );
}

function getMatchingProvenance(index, itemLabel, fieldName) {
  return index.byItemLabel.get(itemLabel) ?? (fieldName ? index.byFieldName.get(fieldName) ?? null : null);
}

function normalizeProfileRows(tableRows, provenanceIndex) {
  if (!tableRows || tableRows.length < 2) {
    return [];
  }

  const dataRows = tableRows.slice(1).filter((row) => !isSeparatorRow(row));

  return dataRows
    .filter((row) => row.length >= 4)
    .map((row) => {
      const itemLabel = stripMarkdownFormatting(row[0]);
      const value = stripMarkdownFormatting(row[1]);
      const researchSummary = stripMarkdownFormatting(row[2]);
      const fieldName = ITEM_TO_FIELD.get(itemLabel.toLowerCase()) ?? null;
      const sources = extractSources(row[row.length - 1]);
      const invalidSourceLinks = extractInvalidSourceLinks(row[row.length - 1]);
      const normalizedValue = value.toLowerCase();
      const isNotConfirmed = NOT_CONFIRMED_VALUES.has(normalizedValue);
      const provenance = provenanceIndex
        ? getMatchingProvenance(provenanceIndex, itemLabel, fieldName)
        : null;

      return {
        item_label: itemLabel,
        field_name: fieldName,
        value,
        research_summary: researchSummary,
        sources,
        invalid_source_links: invalidSourceLinks,
        is_not_confirmed: isNotConfirmed,
        provenance,
      };
    });
}

function normalizeRecentDevelopments(tableRows, provenanceIndex) {
  if (!tableRows || tableRows.length < 2) {
    return [];
  }

  return tableRows
    .slice(1)
    .filter((row) => !isSeparatorRow(row))
    .filter((row) => row.length >= 4)
    .map((row) => {
      const date = stripMarkdownFormatting(row[0]);
      const development = stripMarkdownFormatting(row[1]);

      return {
        date,
        development,
        why_it_matters: stripMarkdownFormatting(row[2]),
        sources: extractSources(row[row.length - 1]),
        invalid_source_links: extractInvalidSourceLinks(row[row.length - 1]),
        provenance: provenanceIndex?.get(`${date}::${development}`) ?? null,
      };
    });
}

export function parseStructuredReport(markdown) {
  const tables = parseTables(markdown);
  const provenanceAppendix = parseProvenanceAppendix(markdown);
  const profileRowProvenanceIndex = provenanceAppendix.data
    ? buildProvenanceRowIndex(provenanceAppendix.data.profile_rows)
    : null;
  const recentDevelopmentProvenanceIndex = provenanceAppendix.data
    ? buildRecentDevelopmentProvenanceIndex(provenanceAppendix.data.recent_developments)
    : null;

  return {
    profileRows: normalizeProfileRows(tables[0] ?? [], profileRowProvenanceIndex),
    recentDevelopments: normalizeRecentDevelopments(tables[1] ?? [], recentDevelopmentProvenanceIndex),
    provenanceAppendix: provenanceAppendix.data,
    provenanceAppendixError: provenanceAppendix.error,
  };
}
