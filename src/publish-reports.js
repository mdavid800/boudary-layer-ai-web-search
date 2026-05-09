import { createDatabaseClient } from './lib/database.js';
import { publishDraftResearchReports } from './lib/report-moderation.js';

export async function publishDraftReports({
  client,
  reportIds = [],
  ...options
} = {}) {
  return publishDraftResearchReports(client, {
    reportIds,
    ...options,
  });
}

export async function main() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await publishDraftReports({ client });
  } finally {
    await client.end();
  }
}
