import dotenv from 'dotenv';
import { createDatabaseClient } from './lib/database.js';
import { parseStructuredReport } from './lib/report-structure.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    const result = await client.query(`
      SELECT id, report_markdown
      FROM research_wind_farm_reports
      ORDER BY id ASC
    `);

    let updatedCount = 0;

    for (const row of result.rows) {
      const structured = parseStructuredReport(row.report_markdown);

      await client.query(
        `
          UPDATE research_wind_farm_reports
          SET
            profile_rows_json = $2::jsonb,
            recent_developments_json = $3::jsonb,
            updated_at = now()
          WHERE id = $1
        `,
        [
          row.id,
          JSON.stringify(structured.profileRows),
          JSON.stringify(structured.recentDevelopments),
        ],
      );

      updatedCount += 1;
    }

    console.error(`Backfilled structured report data for ${updatedCount} report(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
