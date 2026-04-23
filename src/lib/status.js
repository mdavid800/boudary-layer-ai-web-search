export const CANONICAL_WIND_FARM_STATUSES = [
  'Operational',
  'Decommissioned',
  'Under Construction',
  'FID Taken, Pre-Construction',
  'Consented',
  'In Planning / Consent Application Submitted',
  'Lease Awarded, Pre-Planning',
  'Development Zone / lease area',
  'Concept',
];

const STATUS_ALIASES = new Map([
  ['operational', 'Operational'],
  ['production', 'Operational'],
  ['decommissioned', 'Decommissioned'],
  ['dismantled', 'Decommissioned'],
  ['under construction', 'Under Construction'],
  ['construction', 'Under Construction'],
  ['consented', 'Consented'],
  ['consent authorised', 'Consented'],
  ['consent authorized', 'Consented'],
  ['approved', 'Consented'],
  ['fid taken, pre-construction', 'FID Taken, Pre-Construction'],
  ['fid taken pre-construction', 'FID Taken, Pre-Construction'],
  ['fid taken / pre-construction', 'FID Taken, Pre-Construction'],
  ['in planning / consent application submitted', 'In Planning / Consent Application Submitted'],
  ['consent application submitted', 'In Planning / Consent Application Submitted'],
  ['consent / planning application submitted', 'In Planning / Consent Application Submitted'],
  ['planning application submitted', 'In Planning / Consent Application Submitted'],
  ['in planning', 'In Planning / Consent Application Submitted'],
  ['lease awarded, pre-planning', 'Lease Awarded, Pre-Planning'],
  ['lease awarded , pre-planning', 'Lease Awarded, Pre-Planning'],
  ['lease awarded, pre planning', 'Lease Awarded, Pre-Planning'],
  ['lease awarded', 'Lease Awarded, Pre-Planning'],
  ['lease awarded, pre-planning submission', 'Lease Awarded, Pre-Planning'],
  ['lease awarded , pre-planning submission', 'Lease Awarded, Pre-Planning'],
  ['lease awarded, pre-planning submittion', 'Lease Awarded, Pre-Planning'],
  ['lease awarded , pre-planning submittion', 'Lease Awarded, Pre-Planning'],
  ['development zone / lease area', 'Development Zone / lease area'],
  ['development zone', 'Development Zone / lease area'],
  ['lease area', 'Development Zone / lease area'],
  ['concept', 'Concept'],
  ['planned', 'Concept'],
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
