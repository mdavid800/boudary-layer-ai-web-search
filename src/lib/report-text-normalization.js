const HTML_ENTITY_REPLACEMENTS = new Map([
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['mdash', '-'],
  ['ndash', '-'],
  ['hellip', '...'],
  ['ldquo', '"'],
  ['rdquo', '"'],
  ['lsquo', "'"],
  ['rsquo', "'"],
  ['quot', '"'],
  ['apos', "'"],
  ['#39', "'"],
  ['#x27', "'"],
  ['aelig', '\u00e6'],
  ['aelg', '\u00e6'],
  ['aelig;', '\u00e6'],
  ['auml', '\u00e4'],
  ['aring', '\u00e5'],
  ['oslash', '\u00f8'],
  ['ouml', '\u00f6'],
  ['uuml', '\u00fc'],
  ['AElig', '\u00c6'],
  ['Auml', '\u00c4'],
  ['Aring', '\u00c5'],
  ['Oslash', '\u00d8'],
  ['Ouml', '\u00d6'],
  ['Uuml', '\u00dc'],
]);

const MOJIBAKE_REPLACEMENTS = new Map([
  ['\u0393\u00c7\u00a3', '"'],
  ['\u0393\u00c7\u00a5', '"'],
  ['\u0393\u00c7\u2013', "'"],
  ['\u0393\u00c7\u00bf', "'"],
  ['\u0393\u00c7\u00b4', '-'],
  ['\u0393\u00c7\u00f6', '-'],
  ['\u0393\u00c7\u00aa', '...'],
  ['\u00e2\u20ac\u0153', '"'],
  ['\u00e2\u20ac\u009d', '"'],
  ['\u00e2\u20ac\u02dc', "'"],
  ['\u00e2\u20ac\u2122', "'"],
  ['\u00e2\u20ac\u201c', '-'],
  ['\u00e2\u20ac\u201d', '-'],
  ['\u00e2\u20ac\u00a6', '...'],
  ['\u00c3\u00a6', '\u00e6'],
  ['\u00c3\u2020', '\u00c6'],
  ['\u00c3\u00b8', '\u00f8'],
  ['\u00c3\u02d8', '\u00d8'],
  ['\u00c3\u00a5', '\u00e5'],
  ['\u00c3\u2026', '\u00c5'],
  ['\u00c3\u00a9', '\u00e9'],
  ['\u00c3\u00b6', '\u00f6'],
  ['\u00c3\u00bc', '\u00fc'],
  ['\u251c\u2524\u00aa', '\u00e6'],
  ['\u251c\u2524\u00b8', '\u00f8'],
  ['\u251c\u2524\u00a5', '\u00e5'],
  ['\u251c\u2524\u2020', '\u00c6'],
  ['\u251c\u2524\u02d8', '\u00d8'],
  ['\u251c\u2524\u2026', '\u00c5'],
]);

function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalizedEntity = String(entity).toLowerCase();
    const replacement = HTML_ENTITY_REPLACEMENTS.get(normalizedEntity)
      ?? HTML_ENTITY_REPLACEMENTS.get(entity);

    if (replacement != null) {
      return replacement;
    }

    if (normalizedEntity.startsWith('#x')) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalizedEntity.startsWith('#')) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function repairMojibakeText(text) {
  let repaired = text;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let next = repaired;

    for (const [needle, replacement] of MOJIBAKE_REPLACEMENTS) {
      next = next.replaceAll(needle, replacement);
    }

    next = next
      .replace(/\u00c2(?=[\s"'%.,;:!?()\[\]\-])/g, '')
      .replace(/\u00a0/g, ' ');

    if (next === repaired) {
      break;
    }

    repaired = next;
  }

  return repaired;
}

export function normalizeResearchReportText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  let normalized = text;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = repairMojibakeText(decodeHtmlEntities(normalized));

    if (next === normalized) {
      break;
    }

    normalized = next;
  }

  return normalized;
}