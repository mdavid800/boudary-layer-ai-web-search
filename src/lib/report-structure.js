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

function normalizeProfileRows(tableRows) {
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
      const sources = extractSources(row[row.length - 1]);
      const invalidSourceLinks = extractInvalidSourceLinks(row[row.length - 1]);
      const normalizedValue = value.toLowerCase();
      const isNotConfirmed = NOT_CONFIRMED_VALUES.has(normalizedValue);

      return {
        item_label: itemLabel,
        field_name: ITEM_TO_FIELD.get(itemLabel.toLowerCase()) ?? null,
        value,
        research_summary: researchSummary,
        sources,
        invalid_source_links: invalidSourceLinks,
        is_not_confirmed: isNotConfirmed,
      };
    });
}

function normalizeRecentDevelopments(tableRows) {
  if (!tableRows || tableRows.length < 2) {
    return [];
  }

  return tableRows
    .slice(1)
    .filter((row) => !isSeparatorRow(row))
    .filter((row) => row.length >= 4)
    .map((row) => ({
      date: stripMarkdownFormatting(row[0]),
      development: stripMarkdownFormatting(row[1]),
      why_it_matters: stripMarkdownFormatting(row[2]),
      sources: extractSources(row[row.length - 1]),
      invalid_source_links: extractInvalidSourceLinks(row[row.length - 1]),
    }));
}

export function parseStructuredReport(markdown) {
  const tables = parseTables(markdown);
  return {
    profileRows: normalizeProfileRows(tables[0] ?? []),
    recentDevelopments: normalizeRecentDevelopments(tables[1] ?? []),
  };
}
