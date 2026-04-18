import dotenv from 'dotenv';
import { createDatabaseClient } from './lib/database.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    // Count drafts before promoting
    const countResult = await client.query(
      `SELECT COUNT(*) AS cnt FROM research_wind_farm_reports WHERE review_status = 'draft'`,
    );
    const draftCount = parseInt(countResult.rows[0].cnt, 10);

    if (draftCount === 0) {
      console.error('No draft reports to publish.');
      return;
    }

    console.error(`Found ${draftCount} draft report(s). Publishing...`);

    // Promote reports: draft → published
    const reportResult = await client.query(
      `UPDATE research_wind_farm_reports
       SET review_status = 'published', updated_at = now()
       WHERE review_status = 'draft'
       RETURNING id, wind_farm_id`,
    );

    const publishedReportIds = reportResult.rows.map((r) => r.id);

    console.error(`Published ${publishedReportIds.length} report(s).`);

    // Activate draft facts linked to those reports
    const factResult = await client.query(
      `UPDATE wind_farm_facts
       SET status = 'active'
       WHERE source_type = 'research'
         AND status = 'draft'
         AND report_id = ANY($1)`,
      [publishedReportIds],
    );

    console.error(`Activated ${factResult.rowCount} research fact(s).`);

    // Summary
    const summaryResult = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'published') AS published_reports,
         (SELECT COUNT(*) FROM research_wind_farm_reports WHERE review_status = 'draft') AS remaining_drafts,
         (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'active') AS active_research_facts,
         (SELECT COUNT(*) FROM wind_farm_facts WHERE source_type = 'research' AND status = 'draft') AS draft_research_facts`,
    );

    const summary = summaryResult.rows[0];
    console.error('\nDatabase summary:');
    console.error(`  Published reports:       ${summary.published_reports}`);
    console.error(`  Remaining draft reports: ${summary.remaining_drafts}`);
    console.error(`  Active research facts:   ${summary.active_research_facts}`);
    console.error(`  Draft research facts:    ${summary.draft_research_facts}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
