/**
 * Extracts structured facts from a markdown research report table.
 * Uses line-by-line parsing — no LLM involved.
 */

/**
 * Maps report table "Item" labels (lowercased) to standardised field names.
 * Some items map to multiple fields (e.g. Developer / owners).
 */
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

/**
 * Values that indicate the field was not confirmed by research.
 * These are skipped and not written as facts.
 */
const SKIP_PREFIXES = ['not confirmed', 'not available', 'n/a', 'unknown'];

/**
 * Extract the first URL from a markdown sources cell.
 * Matches [text](url) patterns and returns the first href.
 */
function extractFirstCitationUrl(sourcesCell) {
  if (!sourcesCell) return null;
  const match = sourcesCell.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : null;
}

/**
 * Parse the first markdown table from a report and return structured facts.
 *
 * @param {string} markdown - Full report markdown
 * @returns {Array<{fieldName: string, value: string, citationUrl: string|null}>}
 */
export function extractFactsFromReport(markdown) {
  const lines = markdown.split('\n');
  const facts = [];

  let inTable = false;
  let headerParsed = false;
  let valueColumnIndex = 1; // default: second column

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table header row (starts and ends with |)
    if (!inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true;

      // Determine which column holds the value based on header count
      const headers = splitTableRow(trimmed);
      // 3 cols: Item | Completed detail | Sources  → value at index 1
      // 4 cols: Item | Value | Research summary | Sources  → value at index 1
      valueColumnIndex = 1;
      continue;
    }

    // Skip separator row (|---|---|...)
    if (inTable && !headerParsed && /^\|[\s-:|]+\|$/.test(trimmed)) {
      headerParsed = true;
      continue;
    }

    // Parse data rows
    if (inTable && headerParsed && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = splitTableRow(trimmed);
      if (cells.length < 2) continue;

      const itemLabel = cells[0].trim();
      const rawValue = cells[valueColumnIndex]?.trim();
      const sourcesCell = cells[cells.length - 1]?.trim();

      if (!itemLabel || !rawValue) continue;

      const fieldName = ITEM_TO_FIELD.get(itemLabel.toLowerCase());
      if (!fieldName) continue;

      // Skip values that indicate the field was not confirmed
      const lowerValue = rawValue.toLowerCase();
      if (SKIP_PREFIXES.some((prefix) => lowerValue.startsWith(prefix))) continue;

      const citationUrl = extractFirstCitationUrl(sourcesCell);

      facts.push({ fieldName, value: stripMarkdownFormatting(rawValue), citationUrl });
    }

    // Stop at the end of the first table (non-table line after we started)
    if (inTable && headerParsed && !trimmed.startsWith('|') && trimmed.length > 0) {
      break;
    }
  }

  return facts;
}

/**
 * Split a markdown table row into cell values.
 * "|  a  | b | c |" → ["a", "b", "c"]
 */
function splitTableRow(row) {
  return row
    .split('|')
    .slice(1, -1) // drop leading/trailing empty strings from split
    .map((cell) => cell.trim());
}

/**
 * Strip markdown inline formatting from a value.
 * Removes bold, italic, inline code, and link syntax.
 */
function stripMarkdownFormatting(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/\*\*(.+?)\*\*/g, '$1')          // **bold** → bold
    .replace(/__(.+?)__/g, '$1')               // __bold__ → bold
    .replace(/\*(.+?)\*/g, '$1')               // *italic* → italic
    .replace(/_(.+?)_/g, '$1')                 // _italic_ → italic
    .replace(/`(.+?)`/g, '$1')                 // `code` → code
    .trim();
}
