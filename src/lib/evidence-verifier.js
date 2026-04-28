import { PDFParse } from 'pdf-parse';
import { canonicalizeSourceOfRecord, isEuroWindWakesSource } from './source-of-record.js';

const VERIFIER_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};
const VERIFIER_FETCH_ATTEMPTS = 2;

const NUMERIC_FIELD_LABEL_TERMS = {
  capacity_mw: ['capacity', 'installed capacity'],
  mec_mw: ['mec', 'maximum export capacity', 'export capacity', 'transmission entry capacity'],
  rated_power_mw: ['rated power', 'individual rated power', 'turbine rating'],
  rotor_diameter_m: ['rotor diameter', 'rotor'],
  hub_height_m: ['hub height', 'hub'],
  turbine_count: ['turbine count', 'turbines', 'wtg', 'wtgs'],
};

const DATE_FIELD_LABEL_TERMS = {
  consent_date: ['consent', 'approval', 'approved'],
  fid_date: ['fid', 'final investment decision'],
  first_power_date: ['first power', 'first electricity', 'began generating'],
  commissioning_date: ['commissioning', 'commissioned', 'operation start', 'full output'],
};

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

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

function getNormalizedFieldName(evidenceRecord) {
  return typeof evidenceRecord?.report_field_name === 'string'
    ? evidenceRecord.report_field_name.trim().toLowerCase()
    : null;
}

function hasAnyTerm(pageText, terms = []) {
  return terms.some((term) => pageText.includes(term));
}

function getTermVariants(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return [];
  }

  return [...new Set([
    normalizedValue,
    normalizedValue.replace(/\s+/g, ''),
  ])];
}

function getNumericValueTerms(reportedValue, fieldName) {
  const normalizedValue = normalizeText(reportedValue);

  if (!normalizedValue) {
    return [];
  }

  const numericTerms = [
    ...normalizedValue.matchAll(/\b\d+(?:\.\d+)?\s*(?:mw|mva|kv|m|%|turbines?|wtgs?)\b/g),
  ].map((match) => match[0]);

  if (fieldName === 'turbine_count') {
    const rawNumber = normalizedValue.match(/\b\d+(?:\.\d+)?\b/)?.[0];

    if (rawNumber) {
      numericTerms.push(rawNumber);
    }
  }

  return [...new Set(numericTerms.flatMap((term) => getTermVariants(term)))];
}

function getNumericLabelTerms(evidenceRecord, fieldName) {
  const configuredTerms = NUMERIC_FIELD_LABEL_TERMS[fieldName] ?? [];
  const itemLabelTerms = getSignificantTerms(evidenceRecord?.report_item_label ?? '');

  return [...new Set([
    ...configuredTerms.flatMap((term) => getTermVariants(term)),
    ...itemLabelTerms.flatMap((term) => getTermVariants(term)),
  ])];
}

function hasNumericFieldSupport(pageText, evidenceRecord) {
  const fieldName = getNormalizedFieldName(evidenceRecord);

  if (!fieldName || !(fieldName in NUMERIC_FIELD_LABEL_TERMS)) {
    return false;
  }

  const labelTerms = getNumericLabelTerms(evidenceRecord, fieldName);
  const valueTerms = getNumericValueTerms(evidenceRecord?.reported_value, fieldName);

  if (labelTerms.length === 0 || valueTerms.length === 0) {
    return false;
  }

  return hasAnyTerm(pageText, labelTerms) && hasAnyTerm(pageText, valueTerms);
}

function getDateVariants(rawDate) {
  if (typeof rawDate !== 'string') {
    return [];
  }

  const match = rawDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return [];
  }

  const [, day, month, year] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];

  if (!monthName) {
    return [];
  }

  const numericDay = String(Number(day));
  const variants = [
    `${day}/${month}/${year}`,
    `${numericDay} ${monthName} ${year}`,
    `${day} ${monthName} ${year}`,
    `${monthName} ${year}`,
  ];

  return [...new Set(variants.flatMap((term) => getTermVariants(term)))];
}

function getDateLabelTerms(evidenceRecord, fieldName) {
  const configuredTerms = DATE_FIELD_LABEL_TERMS[fieldName] ?? [];
  const itemLabelTerms = getSignificantTerms(evidenceRecord?.report_item_label ?? '');

  return [...new Set([
    ...configuredTerms.flatMap((term) => getTermVariants(term)),
    ...itemLabelTerms.flatMap((term) => getTermVariants(term)),
  ])];
}

function hasDateFieldSupport(pageText, evidenceRecord) {
  const fieldName = getNormalizedFieldName(evidenceRecord);

  if (!fieldName || !(fieldName in DATE_FIELD_LABEL_TERMS)) {
    return false;
  }

  const labelTerms = getDateLabelTerms(evidenceRecord, fieldName);
  const dateTerms = getDateVariants(evidenceRecord?.report_date ?? evidenceRecord?.reported_value);

  if (labelTerms.length === 0 || dateTerms.length === 0) {
    return false;
  }

  return hasAnyTerm(pageText, labelTerms) && hasAnyTerm(pageText, dateTerms);
}

function hasFieldAwareSupport(pageText, evidenceRecord) {
  return hasNumericFieldSupport(pageText, evidenceRecord)
    || hasDateFieldSupport(pageText, evidenceRecord);
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
    } catch {
      return buffer.toString('latin1');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  return buffer.toString('utf8');
}

async function fetchEvidenceResponse(sourceUrl, fetchImpl) {
  let lastError = null;

  for (let attempt = 1; attempt <= VERIFIER_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImpl(sourceUrl, {
        headers: VERIFIER_REQUEST_HEADERS,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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
    const response = await fetchEvidenceResponse(normalizedRecord.source_url, fetchImpl);
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

    if (hasFieldAwareSupport(pageText, evidenceRecord)) {
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
    `SELECT id, fact_id, report_item_label, report_field_name, report_date, report_development, reported_value,
            source_url, source_name, source_type, licence, evidence_quote, provenance_mode, human_verified
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
        report_item_label: row.report_item_label ?? null,
        report_field_name: row.report_field_name ?? null,
        report_date: row.report_date ?? null,
        report_development: row.report_development ?? null,
        reported_value: row.reported_value ?? null,
        source_url: row.source_url ?? null,
        source_name: row.source_name ?? null,
      });
    }
  }

  return {
    passed: blockedRows.length === 0,
    blockedRows,
  };
}