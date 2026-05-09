import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackfillReportTextEncodingArgs } from '../src/backfill-report-text-encoding.js';
import { normalizeResearchReportText } from '../src/lib/report-text-normalization.js';

test('normalizeResearchReportText repairs common mojibake and entity corruption', () => {
  const markdown = [
    '| Item | Value | Summary |',
    '| --- | --- | --- |',
    '| Foundation | monop\u251c\u2524\u00aale | Horns Rev II uses monop\u00c3\u00a6le &amp; export cables with a landing at Houstrup Strand. |',
    '| Owner | Vattenfall &amp; Partners | The project was described as \u00e2\u20ac\u0153Operational\u00e2\u20ac\u009d in the source. |',
  ].join('\n');

  assert.equal(
    normalizeResearchReportText(markdown),
    [
      '| Item | Value | Summary |',
      '| --- | --- | --- |',
      '| Foundation | monop\u00e6le | Horns Rev II uses monop\u00e6le & export cables with a landing at Houstrup Strand. |',
      '| Owner | Vattenfall & Partners | The project was described as "Operational" in the source. |',
    ].join('\n'),
  );
});

test('parseBackfillReportTextEncodingArgs supports ids and dry-run', () => {
  assert.deepEqual(
    parseBackfillReportTextEncodingArgs(['--ids', '219,221,222', '--dry-run']),
    {
      ids: [219, 221, 222],
      dryRun: true,
    },
  );
});

test('parseBackfillReportTextEncodingArgs rejects invalid ids', () => {
  assert.throws(
    () => parseBackfillReportTextEncodingArgs(['--ids', '222,nope']),
    /Invalid ID in --ids: nope/,
  );
});