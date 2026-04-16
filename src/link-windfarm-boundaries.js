import dotenv from 'dotenv';
import { createDatabaseClient } from './lib/database.js';
import { LINKAGE_SQL, LINKAGE_SUMMARY_SQL } from './lib/windfarm-linking.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const client = createDatabaseClient();

  await client.connect();

  try {
    await client.query(LINKAGE_SQL);
    const summary = await client.query(LINKAGE_SUMMARY_SQL);

    console.log('Created or refreshed public.turbine_windfarm_boundary_matches');
    console.log('Created or refreshed public.turbine_windfarm_boundary_links');

    for (const row of summary.rows) {
      console.log(`${row.metric}: ${row.value}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
