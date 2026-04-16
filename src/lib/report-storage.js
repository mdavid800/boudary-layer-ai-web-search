import { createHash } from 'node:crypto';
import { extractFactsFromReport } from './fact-extraction.js';

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Store a research report and its extracted facts in the database.
 *
 * @param {import('pg').Client} client - Connected pg client
 * @param {object} options
 * @param {number} options.windFarmId - FK to core_wind_farms.id
 * @param {string} options.reportMarkdown - Full markdown report
 * @param {string} options.modelUsed - OpenRouter model identifier
 * @param {string} options.finalPrompt - The prompt used (hashed for dedup)
 * @param {string} [options.reviewStatus='draft'] - 'draft' or 'published'
 * @returns {Promise<{reportId: number, factsInserted: number}>}
 */
export async function storeResearchReport(client, {
  windFarmId,
  reportMarkdown,
  modelUsed,
  finalPrompt,
  reviewStatus = 'draft',
}) {
  const promptHash = sha256(finalPrompt);

  // Upsert report — on conflict update the markdown and metadata
  const reportResult = await client.query(
    `INSERT INTO research_wind_farm_reports
       (wind_farm_id, report_markdown, model_used, prompt_hash, researched_at, review_status)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (wind_farm_id, prompt_hash)
     DO UPDATE SET
       report_markdown = EXCLUDED.report_markdown,
       model_used      = EXCLUDED.model_used,
       researched_at   = EXCLUDED.researched_at,
       review_status   = EXCLUDED.review_status,
       updated_at      = now()
     RETURNING id`,
    [windFarmId, reportMarkdown, modelUsed, promptHash, reviewStatus],
  );

  const reportId = reportResult.rows[0].id;

  // Extract facts from the markdown table
  const facts = extractFactsFromReport(reportMarkdown);

  let factsInserted = 0;

  for (const fact of facts) {
    await client.query(
      `INSERT INTO wind_farm_facts
         (wind_farm_id, field_name, value, source_type, source_detail, citation_url, report_id, status)
       VALUES ($1, $2, $3, 'research', $4, $5, $6, 'active')
       ON CONFLICT ON CONSTRAINT uq_wind_farm_facts_emodnet
       DO UPDATE SET
         value         = EXCLUDED.value,
         source_detail = EXCLUDED.source_detail,
         citation_url  = EXCLUDED.citation_url,
         report_id     = EXCLUDED.report_id`,
      [
        windFarmId,
        fact.fieldName,
        fact.value,
        `AI research ${new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
        fact.citationUrl,
        reportId,
      ],
    );
    factsInserted += 1;
  }

  return { reportId, factsInserted };
}
