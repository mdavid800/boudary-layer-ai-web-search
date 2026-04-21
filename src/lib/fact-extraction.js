import { parseStructuredReport } from './report-structure.js';
import { canonicalizeSourceOfRecord } from './source-of-record.js';

/**
 * Parse the first markdown table from a report and return structured facts.
 *
 * @param {string} markdown - Full report markdown
 * @returns {Array<{fieldName: string, value: string, citationUrl: string|null, sourceOfRecord: object|null}>}
 */
export function extractFactsFromReport(markdown) {
  return parseStructuredReport(markdown)
    .profileRows
    .filter((row) => row.field_name && !row.is_not_confirmed)
    .map((row) => {
      const sourceOfRecord = canonicalizeSourceOfRecord(row.provenance?.source_of_record ?? null);

      return {
        fieldName: row.field_name,
        value: row.value,
        citationUrl: sourceOfRecord?.source_url ?? row.sources[0]?.url ?? null,
        sourceOfRecord,
      };
    });
}
