import process from 'node:process';
import dotenv from 'dotenv';
import { createDatabaseClient } from './lib/database.js';
import { buildReportOutputPath, saveReport } from './lib/report-output.js';
import { normalizeStoredResearchReport } from './lib/report-storage.js';
import { normalizeResearchReportText } from './lib/report-text-normalization.js';
import { getWindFarmSourceTableName } from './lib/windfarm-database.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export function parseBackfillReportTextEncodingArgs(argv) {
  let ids = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--ids' && argv[index + 1]) {
      ids = argv[index + 1].split(',').map((value) => {
        const parsed = Number.parseInt(value.trim(), 10);

        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid ID in --ids: ${value}`);
        }

        return parsed;
      });
      index += 1;
      continue;
    }

    if (argv[index] === '--dry-run') {
      dryRun = true;
    }
  }

  return { ids, dryRun };
}

export async function backfillReportTextEncoding({
  argv = process.argv.slice(2),
  createClient = createDatabaseClient,
  normalizeStoredResearchReportFn = normalizeStoredResearchReport,
  saveReportFn = saveReport,
} = {}) {
  const { ids, dryRun } = parseBackfillReportTextEncodingArgs(argv);
  const sourceTableName = getWindFarmSourceTableName();
  const client = createClient();

  await client.connect();

  try {
    const queryParams = [];
    const whereClause = ids ? 'WHERE report.id = ANY($1::int[])' : '';

    if (ids) {
      queryParams.push(ids);
    }

    const result = await client.query(
      `SELECT report.id,
              report.wind_farm_id,
              report.report_markdown,
              source.name
       FROM public.research_wind_farm_reports AS report
       LEFT JOIN public.${sourceTableName} AS source
         ON source.id = report.wind_farm_id
       ${whereClause}
       ORDER BY report.id ASC`,
      queryParams,
    );

    let changedReportCount = 0;

    for (const row of result.rows) {
      if (normalizeResearchReportText(row.report_markdown) === row.report_markdown) {
        continue;
      }

      changedReportCount += 1;

      if (dryRun) {
        console.log(`Would normalize report #${row.id} for wind farm ${row.wind_farm_id}.`);
        continue;
      }

      const normalizedReport = await normalizeStoredResearchReportFn(client, {
        reportId: row.id,
      });

      await saveReportFn(
        buildReportOutputPath({
          sourceTableName,
          windFarmId: row.wind_farm_id,
          windFarmName: row.name,
        }),
        normalizedReport.reportMarkdown,
      ).catch((error) => {
        console.warn(`Warning: failed to save normalized markdown for report #${row.id}: ${error.message}`);
      });

      console.log(`Normalized report #${row.id} for wind farm ${row.wind_farm_id}.`);
    }

    console.log(
      dryRun
        ? `Dry run complete: ${changedReportCount} report(s) would be normalized out of ${result.rows.length} scanned.`
        : `Backfill complete: normalized ${changedReportCount} report(s) out of ${result.rows.length} scanned.`,
    );

    return {
      scannedReportCount: result.rows.length,
      changedReportCount,
      dryRun,
    };
  } finally {
    await client.end();
  }
}

export async function main() {
  await backfillReportTextEncoding();
}

if (import.meta.url === new URL(process.argv[1], 'file:///').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}