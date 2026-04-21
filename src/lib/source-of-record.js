export const EUROWINDWAKES_ZENODO_RECORD_URL = 'https://zenodo.org/records/17311571';
export const EUROWINDWAKES_DATASET_LICENSE = 'ODC Open Database License v1.0';

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLicence(value) {
  const normalized = normalizeString(value);
  return normalized && normalized.toLowerCase() !== 'unknown' ? normalized : null;
}

export function isEuroWindWakesSource(source) {
  const sourceName = normalizeString(source?.source_name) ?? '';
  const sourceUrl = normalizeString(source?.source_url) ?? '';

  return /eurowindwakes/i.test(sourceName) || /example\.invalid\/eurowindwakes/i.test(sourceUrl);
}

export function canonicalizeSourceOfRecord(source) {
  if (!source || typeof source !== 'object') {
    return source;
  }

  if (!isEuroWindWakesSource(source)) {
    return source;
  }

  return {
    ...source,
    source_url: EUROWINDWAKES_ZENODO_RECORD_URL,
    source_type: normalizeString(source.source_type) ?? 'open dataset',
    licence: normalizeLicence(source.licence) ?? EUROWINDWAKES_DATASET_LICENSE,
  };
}