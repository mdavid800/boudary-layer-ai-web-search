import { parseStructuredReport } from './report-structure.js';

const PROFILE_TABLE_HEADER = '| Item | Value | Research summary | Sources |';
const RECENT_DEVELOPMENTS_HEADING = 'Recent developments';
const RECENT_DEVELOPMENTS_HEADING_NORMALIZED = RECENT_DEVELOPMENTS_HEADING.toLowerCase();
const RECENT_DEVELOPMENTS_TABLE_HEADER = '| Date | Development | Why it matters | Sources |';
const PROVENANCE_APPENDIX_HEADING = 'Provenance appendix';
const TARGET_PROFILE_ITEM_LABELS = ['Developer / owners', 'Ownership history'];

function normalizeMarkdown(markdown) {
  return String(markdown).replace(/\r\n/g, '\n');
}

function splitMarkdownLines(markdown) {
  return normalizeMarkdown(markdown).split('\n');
}

function findLineIndex(lines, predicate, startIndex = 0) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (predicate(lines[index], index)) {
      return index;
    }
  }

  return -1;
}

function isMarkdownTableLine(line) {
  const trimmedLine = line.trim();
  return trimmedLine.startsWith('|') && trimmedLine.endsWith('|');
}

function getTableRange(lines, headerLine) {
  const startIndex = findLineIndex(lines, (line) => line.trim() === headerLine);

  if (startIndex === -1) {
    throw new Error(`Missing required table header: ${headerLine}`);
  }

  let endIndex = startIndex;

  while (endIndex + 1 < lines.length && isMarkdownTableLine(lines[endIndex + 1])) {
    endIndex += 1;
  }

  return { startIndex, endIndex };
}

function getRecentDevelopmentsSectionRange(lines) {
  const headingIndex = findLineIndex(
    lines,
    (line) => line.trim().toLowerCase() === RECENT_DEVELOPMENTS_HEADING_NORMALIZED,
  );

  if (headingIndex === -1) {
    throw new Error('Missing Recent developments heading.');
  }

  const appendixIndex = findLineIndex(
    lines,
    (line) => line.trim().toLowerCase() === PROVENANCE_APPENDIX_HEADING.toLowerCase(),
    headingIndex + 1,
  );

  if (appendixIndex === -1) {
    throw new Error('Missing Provenance appendix heading.');
  }

  let sectionEndIndex = appendixIndex - 1;
  while (sectionEndIndex >= headingIndex && lines[sectionEndIndex].trim() === '') {
    sectionEndIndex -= 1;
  }

  return {
    startIndex: headingIndex,
    endIndex: Math.max(headingIndex, sectionEndIndex),
  };
}

function getProvenanceAppendixRange(lines) {
  const headingIndex = findLineIndex(
    lines,
    (line) => line.trim().toLowerCase() === PROVENANCE_APPENDIX_HEADING.toLowerCase(),
  );

  if (headingIndex === -1) {
    throw new Error('Missing Provenance appendix heading.');
  }

  return {
    startIndex: headingIndex,
    endIndex: lines.length - 1,
  };
}

function getProfileTableRowLineIndexes(lines) {
  const tableRange = getTableRange(lines, PROFILE_TABLE_HEADER);
  const rowIndexesByItemLabel = new Map();

  for (let index = tableRange.startIndex + 2; index <= tableRange.endIndex; index += 1) {
    const cells = lines[index]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 4) {
      continue;
    }

    rowIndexesByItemLabel.set(cells[0], index);
  }

  return rowIndexesByItemLabel;
}

function getRefreshProfileRowLines(refreshMarkdown) {
  const lines = splitMarkdownLines(refreshMarkdown);
  const tableRange = getTableRange(lines, PROFILE_TABLE_HEADER);
  const rowLinesByItemLabel = new Map();

  for (let index = tableRange.startIndex + 2; index <= tableRange.endIndex; index += 1) {
    const cells = lines[index]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 4) {
      continue;
    }

    rowLinesByItemLabel.set(cells[0], lines[index]);
  }

  return rowLinesByItemLabel;
}

function replaceLineRange(lines, startIndex, endIndex, replacementLines) {
  lines.splice(startIndex, endIndex - startIndex + 1, ...replacementLines);
}

function mergeProfileRowProvenance(existingRows, refreshRows) {
  const rowsByItemLabel = new Map(existingRows.map((row) => [row.item_label, row]));

  for (const itemLabel of TARGET_PROFILE_ITEM_LABELS) {
    const refreshRow = refreshRows.find((row) => row.item_label === itemLabel);

    if (!refreshRow) {
      throw new Error(`Operational refresh report is missing the ${itemLabel} row.`);
    }

    rowsByItemLabel.set(itemLabel, refreshRow);
  }

  return existingRows.map((row) => rowsByItemLabel.get(row.item_label) ?? row);
}

function renderProvenanceAppendix(provenanceAppendix) {
  return [
    PROVENANCE_APPENDIX_HEADING,
    '```json',
    JSON.stringify(provenanceAppendix, null, 2),
    '```',
  ];
}

function formatExistingRowContext(label, parsedReport) {
  const row = parsedReport.profileRows.find((candidate) => candidate.item_label === label);

  if (!row) {
    return `- ${label}: Not available in the current published report.`;
  }

  return `- ${label}: ${row.value} (${row.research_summary})`;
}

export function buildOperationalRefreshContext({
  projectContext,
  publishedReportMarkdown,
}) {
  const parsedReport = parseStructuredReport(publishedReportMarkdown);
  const recentDevelopmentLines = parsedReport.recentDevelopments.length > 0
    ? parsedReport.recentDevelopments.map((row) =>
        `- ${row.date}: ${row.development} (${row.why_it_matters})`
      )
    : ['- No recent developments were listed in the current published report.'];

  return [
    projectContext,
    '',
    'Current published operational-report context for this targeted refresh. Treat this as background only and re-check current web sources before answering:',
    formatExistingRowContext('Developer / owners', parsedReport),
    formatExistingRowContext('Ownership history', parsedReport),
    formatExistingRowContext('Status', parsedReport),
    '',
    'Existing recent developments listed in the current published report:',
    ...recentDevelopmentLines,
  ].join('\n');
}

export function mergeOperationalRefreshReport({
  publishedReportMarkdown,
  refreshReportMarkdown,
}) {
  const existingLines = splitMarkdownLines(publishedReportMarkdown);
  const refreshLines = splitMarkdownLines(refreshReportMarkdown);
  const existingParsedReport = parseStructuredReport(publishedReportMarkdown);
  const refreshParsedReport = parseStructuredReport(refreshReportMarkdown);
  const existingProfileRowIndexes = getProfileTableRowLineIndexes(existingLines);
  const refreshProfileRowLines = getRefreshProfileRowLines(refreshReportMarkdown);

  for (const itemLabel of TARGET_PROFILE_ITEM_LABELS) {
    const existingRowIndex = existingProfileRowIndexes.get(itemLabel);
    const refreshRowLine = refreshProfileRowLines.get(itemLabel);

    if (existingRowIndex == null) {
      throw new Error(`Published report is missing the ${itemLabel} row.`);
    }

    if (!refreshRowLine) {
      throw new Error(`Operational refresh report is missing the ${itemLabel} row.`);
    }

    existingLines[existingRowIndex] = refreshRowLine;
  }

  const refreshRecentDevelopmentsRange = getRecentDevelopmentsSectionRange(refreshLines);
  const existingRecentDevelopmentsRange = getRecentDevelopmentsSectionRange(existingLines);
  replaceLineRange(
    existingLines,
    existingRecentDevelopmentsRange.startIndex,
    existingRecentDevelopmentsRange.endIndex,
    refreshLines.slice(
      refreshRecentDevelopmentsRange.startIndex,
      refreshRecentDevelopmentsRange.endIndex + 1,
    ),
  );

  const mergedProvenanceAppendix = {
    profile_rows: mergeProfileRowProvenance(
      existingParsedReport.provenanceAppendix?.profile_rows ?? [],
      refreshParsedReport.provenanceAppendix?.profile_rows ?? [],
    ),
    recent_developments: refreshParsedReport.provenanceAppendix?.recent_developments ?? [],
  };

  const existingProvenanceAppendixRange = getProvenanceAppendixRange(existingLines);
  replaceLineRange(
    existingLines,
    existingProvenanceAppendixRange.startIndex,
    existingProvenanceAppendixRange.endIndex,
    renderProvenanceAppendix(mergedProvenanceAppendix),
  );

  return existingLines.join('\n');
}

export {
  RECENT_DEVELOPMENTS_HEADING,
  RECENT_DEVELOPMENTS_TABLE_HEADER,
  TARGET_PROFILE_ITEM_LABELS,
};