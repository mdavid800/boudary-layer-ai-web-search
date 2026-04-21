import { canonicalizeSourceOfRecord } from './source-of-record.js';

function normalizeSourceName(source, fallbackLabel = null) {
  if (typeof source?.source_name === 'string' && source.source_name.trim()) {
    return source.source_name.trim();
  }

  if (typeof source?.label === 'string' && source.label.trim()) {
    return source.label.trim();
  }

  return fallbackLabel;
}

function normalizeMetadata(metadata = {}) {
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function createEvidenceRow({
  reportId,
  factId = null,
  reportSection,
  reportItemLabel = null,
  reportFieldName = null,
  reportDate = null,
  reportDevelopment = null,
  reportedValue = null,
  evidenceRole,
  provenanceMode = null,
  sourceUrl,
  sourceName = null,
  sourceType = null,
  licence = null,
  retrievedAt = null,
  evidenceQuote = null,
  confidence = null,
  derivedByAi = true,
  humanVerified = false,
  verificationStatus = 'unverified',
  metadata = {},
}) {
  return {
    report_id: reportId,
    fact_id: factId,
    report_section: reportSection,
    report_item_label: reportItemLabel,
    report_field_name: reportFieldName,
    report_date: reportDate,
    report_development: reportDevelopment,
    reported_value: reportedValue,
    evidence_role: evidenceRole,
    provenance_mode: provenanceMode,
    source_url: sourceUrl,
    source_name: sourceName,
    source_type: sourceType,
    licence,
    retrieved_at: retrievedAt,
    evidence_quote: evidenceQuote,
    confidence,
    derived_by_ai: derivedByAi,
    human_verified: humanVerified,
    verification_status: verificationStatus,
    metadata_json: normalizeMetadata(metadata),
  };
}

function buildProfileRowEvidence(reportId, profileRow, factId) {
  if (!profileRow?.provenance) {
    return [];
  }

  const evidenceRows = [];
  const sourceOfRecord = canonicalizeSourceOfRecord(profileRow.provenance.source_of_record);

  if (sourceOfRecord?.source_url) {
    evidenceRows.push(
      createEvidenceRow({
        reportId,
        factId,
        reportSection: 'profile_row',
        reportItemLabel: profileRow.item_label,
        reportFieldName: profileRow.field_name,
        reportedValue: profileRow.value,
        evidenceRole: 'source_of_record',
        provenanceMode: profileRow.provenance.provenance_mode,
        sourceUrl: sourceOfRecord.source_url,
        sourceName: normalizeSourceName(sourceOfRecord),
        sourceType: sourceOfRecord.source_type,
        licence: sourceOfRecord.licence,
        retrievedAt: sourceOfRecord.retrieved_at,
        evidenceQuote: sourceOfRecord.evidence_quote,
        confidence: sourceOfRecord.confidence,
        derivedByAi: sourceOfRecord.derived_by_ai ?? true,
        humanVerified: sourceOfRecord.human_verified ?? false,
        verificationStatus: sourceOfRecord.verification_status ?? 'unverified',
        metadata: {
          research_summary: profileRow.research_summary,
        },
      }),
    );
  }

  for (const link of profileRow.provenance.supporting_context ?? []) {
    if (!link?.url) {
      continue;
    }

    evidenceRows.push(
      createEvidenceRow({
        reportId,
        factId,
        reportSection: 'profile_row',
        reportItemLabel: profileRow.item_label,
        reportFieldName: profileRow.field_name,
        reportedValue: profileRow.value,
        evidenceRole: 'supporting_context',
        provenanceMode: profileRow.provenance.provenance_mode,
        sourceUrl: link.url,
        sourceName: normalizeSourceName(link, link.label ?? 'Supporting context'),
        metadata: {
          research_summary: profileRow.research_summary,
        },
      }),
    );
  }

  return evidenceRows;
}

function buildRecentDevelopmentEvidence(reportId, recentDevelopment) {
  if (!recentDevelopment?.provenance) {
    return [];
  }

  const evidenceRows = [];
  const sourceOfRecord = canonicalizeSourceOfRecord(recentDevelopment.provenance.source_of_record);

  if (sourceOfRecord?.source_url) {
    evidenceRows.push(
      createEvidenceRow({
        reportId,
        factId: null,
        reportSection: 'recent_development',
        reportDate: recentDevelopment.date,
        reportDevelopment: recentDevelopment.development,
        evidenceRole: 'source_of_record',
        provenanceMode: recentDevelopment.provenance.provenance_mode,
        sourceUrl: sourceOfRecord.source_url,
        sourceName: normalizeSourceName(sourceOfRecord),
        sourceType: sourceOfRecord.source_type,
        licence: sourceOfRecord.licence,
        retrievedAt: sourceOfRecord.retrieved_at,
        evidenceQuote: sourceOfRecord.evidence_quote,
        confidence: sourceOfRecord.confidence,
        derivedByAi: sourceOfRecord.derived_by_ai ?? true,
        humanVerified: sourceOfRecord.human_verified ?? false,
        verificationStatus: sourceOfRecord.verification_status ?? 'unverified',
        metadata: {
          why_it_matters: recentDevelopment.why_it_matters,
        },
      }),
    );
  }

  for (const link of recentDevelopment.provenance.supporting_context ?? []) {
    if (!link?.url) {
      continue;
    }

    evidenceRows.push(
      createEvidenceRow({
        reportId,
        factId: null,
        reportSection: 'recent_development',
        reportDate: recentDevelopment.date,
        reportDevelopment: recentDevelopment.development,
        evidenceRole: 'supporting_context',
        provenanceMode: recentDevelopment.provenance.provenance_mode,
        sourceUrl: link.url,
        sourceName: normalizeSourceName(link, link.label ?? 'Supporting context'),
        metadata: {
          why_it_matters: recentDevelopment.why_it_matters,
        },
      }),
    );
  }

  return evidenceRows;
}

export function buildReportEvidenceRows({ reportId, profileRows = [], recentDevelopments = [], factIdsByFieldName = new Map() }) {
  const evidenceRows = [];

  for (const profileRow of profileRows) {
    const factId = profileRow.field_name ? factIdsByFieldName.get(profileRow.field_name) ?? null : null;
    evidenceRows.push(...buildProfileRowEvidence(reportId, profileRow, factId));
  }

  for (const recentDevelopment of recentDevelopments) {
    evidenceRows.push(...buildRecentDevelopmentEvidence(reportId, recentDevelopment));
  }

  return evidenceRows;
}