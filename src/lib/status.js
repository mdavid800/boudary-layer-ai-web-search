export const CANONICAL_WIND_FARM_STATUSES = [
  'Operational',
  'Under Construction',
  'Consent Authorised',
  'FID Taken, Pre-Construction',
  'Consent Application Submitted',
  'Development Zone / lease area',
  'Concept',
];

const STATUS_ALIASES = new Map([
  ['operational', 'Operational'],
  ['production', 'Operational'],
  ['under construction', 'Under Construction'],
  ['construction', 'Under Construction'],
  ['consent authorised', 'Consent Authorised'],
  ['approved', 'Consent Authorised'],
  ['consented', 'Consent Authorised'],
  ['fid taken, pre-construction', 'FID Taken, Pre-Construction'],
  ['fid taken pre-construction', 'FID Taken, Pre-Construction'],
  ['fid taken / pre-construction', 'FID Taken, Pre-Construction'],
  ['consent application submitted', 'Consent Application Submitted'],
  ['in planning', 'Consent Application Submitted'],
  ['planned', 'Consent Application Submitted'],
  ['development zone / lease area', 'Development Zone / lease area'],
  ['development zone', 'Development Zone / lease area'],
  ['lease area', 'Development Zone / lease area'],
  ['concept', 'Concept'],
  ['test site', 'Concept'],
  ['test-site', 'Concept'],
  ['testsite', 'Concept'],
]);

export function normalizeCanonicalWindFarmStatus(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = STATUS_ALIASES.get(value.trim().toLowerCase());
  return normalized ?? null;
}
