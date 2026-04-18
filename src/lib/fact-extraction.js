import { parseStructuredReport } from './report-structure.js';

/**
 * Parse the first markdown table from a report and return structured facts.
 *
 * @param {string} markdown - Full report markdown
 * @returns {Array<{fieldName: string, value: string, citationUrl: string|null}>}
 */
export function extractFactsFromReport(markdown) {
  return parseStructuredReport(markdown)
    .profileRows
    .filter((row) => row.field_name && !row.is_not_confirmed)
    .map((row) => ({
      fieldName: row.field_name,
      value: row.value,
      citationUrl: row.sources[0]?.url ?? null,
    }));
}
