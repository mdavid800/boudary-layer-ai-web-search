import { createHash } from 'node:crypto';
import { extractFactsFromReport } from './fact-extraction.js';
import { buildReportEvidenceRows } from './report-evidence.js';
import { parseStructuredReport } from './report-structure.js';
import { normalizeCanonicalWindFarmStatus } from './status.js';

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function pruneObsoleteDraftReports(client, {
  windFarmId,
  keepDraftReportId = null,
} = {}) {
  if (!Number.isInteger(windFarmId)) {
    throw new Error('windFarmId is required to prune obsolete draft reports.');
  }

  const draftResult = await client.query(
    `SELECT id
     FROM research_wind_farm_reports
     WHERE wind_farm_id = $1
       AND review_status = 'draft'
     ORDER BY researched_at DESC, id DESC`,
    [windFarmId],
  );
  const draftIds = draftResult.rows.map((row) => row.id);

  if (draftIds.length === 0) {
    return [];
  }

  let replacementReportId = keepDraftReportId;
  let replacementStatus = keepDraftReportId != null ? 'draft' : null;
  let draftIdsToDelete;

  if (keepDraftReportId != null) {
    draftIdsToDelete = draftIds.filter((draftId) => draftId !== keepDraftReportId);
  } else {
    const publishedResult = await client.query(
      `SELECT id
       FROM research_wind_farm_reports
       WHERE wind_farm_id = $1
         AND review_status = 'published'
       ORDER BY researched_at DESC, id DESC
       LIMIT 1`,
      [windFarmId],
    );
    const latestPublishedId = publishedResult.rows[0]?.id ?? null;

    if (latestPublishedId != null) {
      replacementReportId = latestPublishedId;
      replacementStatus = 'published';
      draftIdsToDelete = draftIds;
    } else {
      const [latestDraftId, ...olderDraftIds] = draftIds;
      replacementReportId = latestDraftId ?? null;
      replacementStatus = latestDraftId != null ? 'draft' : null;
      draftIdsToDelete = olderDraftIds;
    }
  }

  if (draftIdsToDelete.length === 0) {
    return [];
  }

  await client.query(
    `DELETE FROM research_report_evidence
     WHERE report_id = ANY($1)`,
    [draftIdsToDelete],
  );

  if (replacementReportId != null) {
    await client.query(
      `UPDATE wind_farm_facts
       SET report_id = $2,
           status = CASE
             WHEN source_type = 'research' AND $3 = 'published' THEN 'active'
             ELSE status
           END
       WHERE report_id = ANY($1)
         AND EXISTS (
           SELECT 1
           FROM research_report_evidence
           WHERE fact_id = wind_farm_facts.id
         )`,
      [draftIdsToDelete, replacementReportId, replacementStatus],
    );
  }

  await client.query(
    `DELETE FROM wind_farm_facts
     WHERE report_id = ANY($1)
       AND source_type = 'research'
       AND NOT EXISTS (
         SELECT 1
         FROM research_report_evidence
         WHERE fact_id = wind_farm_facts.id
       )`,
    [draftIdsToDelete],
  );

  await client.query(
    `DELETE FROM research_wind_farm_reports
     WHERE id = ANY($1)
       AND review_status = 'draft'`,
    [draftIdsToDelete],
  );

  return draftIdsToDelete;
}

async function syncResearchReportArtifacts(client, {
  reportId,
  windFarmId,
  reportMarkdown,
  reviewStatus,
}) {
  const { profileRows, recentDevelopments } = parseStructuredReport(reportMarkdown);
  const existingFactResult = await client.query(
    `SELECT id
     FROM wind_farm_facts
     WHERE report_id = $1
       AND source_type = 'research'`,
    [reportId],
  );
  const existingFactIds = existingFactResult.rows.map((row) => row.id);

  await client.query(
    `DELETE FROM research_report_evidence
     WHERE report_id = $1`,
    [reportId],
  );

  const facts = extractFactsFromReport(reportMarkdown);
  const factStatus = reviewStatus === 'published' ? 'active' : 'draft';

  let factsInserted = 0;
  const factIdsByFieldName = new Map();

  for (const fact of facts) {
    const normalizedValue =
      fact.fieldName === 'status'
        ? normalizeCanonicalWindFarmStatus(fact.value)
        : fact.value;

    if (fact.fieldName === 'status' && normalizedValue === null) {
      console.warn(`Skipping non-canonical research status "${fact.value}" for wind farm ${windFarmId}.`);
      continue;
    }

    const factResult = await client.query(
      `INSERT INTO wind_farm_facts
         (wind_farm_id, field_name, value, source_type, source_detail, citation_url, report_id, status)
       VALUES ($1, $2, $3, 'research', $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT uq_wind_farm_facts_emodnet
       DO UPDATE SET
         value         = EXCLUDED.value,
         source_detail = EXCLUDED.source_detail,
         citation_url  = EXCLUDED.citation_url,
         report_id     = EXCLUDED.report_id,
         status        = EXCLUDED.status
       RETURNING id`,
      [
        windFarmId,
        fact.fieldName,
        normalizedValue,
        `AI research ${new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
        fact.citationUrl,
        reportId,
        factStatus,
      ],
    );
    factIdsByFieldName.set(fact.fieldName, factResult.rows[0].id);
    factsInserted += 1;
  }

  const currentFactIds = new Set(factIdsByFieldName.values());
  const staleFactIds = existingFactIds.filter((factId) => !currentFactIds.has(factId));

  if (staleFactIds.length > 0) {
    await client.query(
      `DELETE FROM wind_farm_facts
       WHERE id = ANY($1)
         AND NOT EXISTS (
           SELECT 1
           FROM research_report_evidence
           WHERE fact_id = wind_farm_facts.id
         )`,
      [staleFactIds],
    );
  }

  const evidenceRows = buildReportEvidenceRows({
    reportId,
    profileRows,
    recentDevelopments,
    factIdsByFieldName,
  });

  for (const evidenceRow of evidenceRows) {
    await client.query(
      `INSERT INTO research_report_evidence
         (report_id, fact_id, report_section, report_item_label, report_field_name, report_date,
          report_development, reported_value, evidence_role, provenance_mode, source_url, source_name,
          source_type, licence, retrieved_at, evidence_quote, confidence, derived_by_ai,
          human_verified, verification_status, metadata_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21::jsonb, now(), now())`,
      [
        evidenceRow.report_id,
        evidenceRow.fact_id,
        evidenceRow.report_section,
        evidenceRow.report_item_label,
        evidenceRow.report_field_name,
        evidenceRow.report_date,
        evidenceRow.report_development,
        evidenceRow.reported_value,
        evidenceRow.evidence_role,
        evidenceRow.provenance_mode,
        evidenceRow.source_url,
        evidenceRow.source_name,
        evidenceRow.source_type,
        evidenceRow.licence,
        evidenceRow.retrieved_at,
        evidenceRow.evidence_quote,
        evidenceRow.confidence,
        evidenceRow.derived_by_ai,
        evidenceRow.human_verified,
        evidenceRow.verification_status,
        JSON.stringify(evidenceRow.metadata_json ?? {}),
      ],
    );
  }

  return { factsInserted };
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
    [
      windFarmId,
      reportMarkdown,
      modelUsed,
      promptHash,
      reviewStatus,
    ],
  );

  const reportId = reportResult.rows[0].id;

  const { factsInserted } = await syncResearchReportArtifacts(client, {
    reportId,
    windFarmId,
    reportMarkdown,
    reviewStatus,
  });

  if (reviewStatus === 'draft') {
    await pruneObsoleteDraftReports(client, {
      windFarmId,
      keepDraftReportId: reportId,
    });
  }

  return { reportId, factsInserted };
}

export async function updateResearchReport(client, {
  reportId,
  windFarmId,
  reportMarkdown,
  modelUsed,
  reviewStatus = 'draft',
}) {
  await client.query(
    `UPDATE research_wind_farm_reports
     SET report_markdown = $2,
         model_used = $3,
         researched_at = now(),
         review_status = $4,
         updated_at = now()
     WHERE id = $1`,
    [reportId, reportMarkdown, modelUsed, reviewStatus],
  );

  const { factsInserted } = await syncResearchReportArtifacts(client, {
    reportId,
    windFarmId,
    reportMarkdown,
    reviewStatus,
  });

  return { reportId, factsInserted };
}
