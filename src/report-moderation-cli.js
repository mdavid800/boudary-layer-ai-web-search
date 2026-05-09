import process from 'node:process';
import dotenv from 'dotenv';

import { createDatabaseClient } from './lib/database.js';
import {
  publishDraftResearchReport,
  saveDraftResearchReport,
  suggestDraftResearchReportRepair,
  verifyDraftResearchReport,
} from './lib/report-moderation.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function parseArgs(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  const options = {
    action,
    reportId: null,
    repair: false,
  };

  for (const argument of rest) {
    if (argument === '--repair') {
      options.repair = true;
      continue;
    }

    if (argument.startsWith('--report-id=')) {
      const rawValue = argument.slice('--report-id='.length);
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid report id: ${rawValue}`);
      }
      options.reportId = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.action) {
    throw new Error('An action is required: save, verify, suggest-fix, or publish.');
  }

  return options;
}

async function readJsonFromStdin() {
  if (process.stdin.isTTY) {
    return {};
  }

  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    return {};
  }

  return JSON.parse(input);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const payload = await readJsonFromStdin();
  const client = createDatabaseClient();
  await client.connect();

  try {
    if (!Number.isInteger(options.reportId)) {
      throw new Error('Use --report-id=<id>.');
    }

    let result;

    if (options.action === 'save') {
      result = await saveDraftResearchReport(client, {
        reportId: options.reportId,
        reportMarkdown: payload.reportMarkdown,
        modelUsed: payload.modelUsed ?? null,
        autoVerify: payload.autoVerify === true,
        autoRepair: payload.autoRepair === true,
      });
    } else if (options.action === 'verify') {
      result = await verifyDraftResearchReport(client, {
        reportId: options.reportId,
        repair: options.repair,
      });
    } else if (options.action === 'suggest-fix') {
      result = await suggestDraftResearchReportRepair(client, {
        reportId: options.reportId,
      });
    } else if (options.action === 'publish') {
      result = await publishDraftResearchReport(client, {
        reportId: options.reportId,
      });
    } else {
      throw new Error(`Unsupported action: ${options.action}`);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});