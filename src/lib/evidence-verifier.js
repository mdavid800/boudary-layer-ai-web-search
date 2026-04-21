import { PDFParse } from 'pdf-parse';
import { canonicalizeSourceOfRecord, isEuroWindWakesSource } from './source-of-record.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[^a-z0-9%./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSignificantTerms(value) {
  return normalizeText(value)
    .split(' ')
    .filter((term) => term.length >= 4);
}

function hasQuoteSupport(pageText, evidenceQuote) {
  const normalizedQuote = normalizeText(evidenceQuote);

  if (!normalizedQuote) {
    return false;
  }

  if (pageText.includes(normalizedQuote)) {
    return true;
  }

  const terms = getSignificantTerms(evidenceQuote);
  if (terms.length < 3) {
    return false;
  }

  const matchedTerms = terms.filter((term) => pageText.includes(term));
  return matchedTerms.length / terms.length >= 0.8;
}

function hasDatasetSupport(pageText, evidenceRecord) {
  if (isEuroWindWakesSource(evidenceRecord)) {
    return pageText.includes('open european offshore wind turbine database')
      || (pageText.includes('eurowindwakes') && pageText.includes('dataset'));
  }

  const sourceName = evidenceRecord.source_name;
  const terms = getSignificantTerms(sourceName);

  if (terms.length === 0) {
    return false;
  }

  return terms.every((term) => pageText.includes(term));
}

function isValueNotConfirmedRecord(evidenceRecord) {
  return normalizeText(evidenceRecord?.reported_value) === 'not confirmed';
}

function isPdfResponse(response, sourceUrl, buffer) {
  const contentType = response.headers?.get?.('content-type')?.toLowerCase?.() ?? '';

  return contentType.includes('application/pdf')
    || /\.pdf(?:$|[?#])/i.test(sourceUrl)
    || buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

async function readResponseText(response, sourceUrl) {
  if (typeof response.arrayBuffer !== 'function') {
    return typeof response.text === 'function' ? response.text() : '';
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (isPdfResponse(response, sourceUrl, buffer)) {
    const parser = new PDFParse({ data: buffer });

    try {
      const parsed = await parser.getText();
      return parsed.text ?? '';
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  return buffer.toString('utf8');
}

export async function verifyEvidenceRecord(evidenceRecord, { fetchImpl = fetch } = {}) {
  const normalizedRecord = canonicalizeSourceOfRecord(evidenceRecord);

  if (evidenceRecord.human_verified) {
    return {
      status: 'human_verified',
      httpStatus: null,
      error: null,
      normalizedRecord,
    };
  }

  if (!/^https?:\/\//i.test(normalizedRecord?.source_url || '')) {
    return {
      status: 'failed',
      httpStatus: null,
      error: 'Source-of-record URL must be an absolute http(s) URL.',
      normalizedRecord,
    };
  }

  try {
    const response = await fetchImpl(normalizedRecord.source_url);
    const bodyText = await readResponseText(response, normalizedRecord.source_url);
    const pageText = normalizeText(bodyText);

    if (!response.ok) {
      return {
        status: 'failed',
        httpStatus: response.status,
        error: `Source-of-record request returned HTTP ${response.status}.`,
        normalizedRecord,
      };
    }

    if (!pageText) {
      return {
        status: 'needs_human_review',
        httpStatus: response.status,
        error: 'Fetched source-of-record content could not be parsed into text.',
        normalizedRecord,
      };
    }

    const isDatasetFallback = normalizedRecord.provenance_mode === 'dataset_fallback'
      || normalizedRecord.source_type === 'open dataset';

    if (isDatasetFallback) {
      const datasetSupported = hasDatasetSupport(pageText, normalizedRecord);

      return {
        status: datasetSupported
          ? 'passed'
          : 'needs_human_review',
        httpStatus: response.status,
        error: datasetSupported
          ? null
          : 'Fetched dataset page did not clearly identify the dataset source of record.',
        normalizedRecord,
      };
    }

    if (isValueNotConfirmedRecord(evidenceRecord)) {
      return {
        status: 'value_not_confirmed',
        httpStatus: response.status,
        error: null,
        normalizedRecord,
      };
    }

    if (hasQuoteSupport(pageText, normalizedRecord.evidence_quote)) {
      return {
        status: 'passed',
        httpStatus: response.status,
        error: null,
        normalizedRecord,
      };
    }

    return {
      status: 'failed',
      httpStatus: response.status,
      error: 'Fetched source-of-record page did not contain the expected evidence quote.',
      normalizedRecord,
    };
  } catch (error) {
    return {
      status: 'failed',
      httpStatus: null,
      error: error instanceof Error ? error.message : 'Unknown verification error.',
      normalizedRecord,
    };
  }
}

export async function verifyReportEvidence(client, reportId, { fetchImpl = fetch } = {}) {
  const evidenceResult = await client.query(
    `SELECT id, fact_id, reported_value, source_url, source_name, source_type, licence, evidence_quote, provenance_mode, human_verified
     FROM research_report_evidence
     WHERE report_id = $1
       AND evidence_role = 'source_of_record'`,
    [reportId],
  );

  if (evidenceResult.rows.length === 0) {
    return {
      passed: false,
      blockedRows: [
        {
          id: null,
          status: 'failed',
          error: 'No source-of-record evidence rows were found for this report.',
        },
      ],
    };
  }

  const blockedRows = [];

  for (const row of evidenceResult.rows) {
    const result = await verifyEvidenceRecord(row, { fetchImpl });

    await client.query(
      `UPDATE research_report_evidence
       SET source_url = $2,
           source_name = $3,
           source_type = $4,
           licence = $5,
           verification_status = $6,
           last_verified_at = now(),
           last_http_status = $7,
           verification_error = $8,
           updated_at = now()
       WHERE id = $1`,
      [
        row.id,
        result.normalizedRecord?.source_url ?? row.source_url,
        result.normalizedRecord?.source_name ?? row.source_name,
        result.normalizedRecord?.source_type ?? row.source_type,
        result.normalizedRecord?.licence ?? row.licence,
        result.status,
        result.httpStatus,
        result.error,
      ],
    );

    if (row.fact_id && result.normalizedRecord?.source_url) {
      await client.query(
        `UPDATE wind_farm_facts
         SET citation_url = $2
         WHERE id = $1`,
        [row.fact_id, result.normalizedRecord.source_url],
      );
    }

    if (
      result.status !== 'passed'
      && result.status !== 'human_verified'
      && result.status !== 'value_not_confirmed'
    ) {
      blockedRows.push({
        id: row.id,
        status: result.status,
        error: result.error,
      });
    }
  }

  return {
    passed: blockedRows.length === 0,
    blockedRows,
  };
}