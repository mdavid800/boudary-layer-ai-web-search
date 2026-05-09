import { createDatabaseClient } from './lib/database.js';
import { verifyDraftResearchReports } from './lib/report-moderation.js';

export function parseVerifyReportsArgs(argv = []) {
  const options = {
    help: false,
    ids: [],
    json: false,
    repair: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '--repair') {
      options.repair = true;
      continue;
    }

    if (argument.startsWith('--ids')) {
      const inlineValue = argument.startsWith('--ids=') ? argument.slice('--ids='.length) : null;
      const rawValue = inlineValue ?? readNextValue(argv, index, '--ids');

      if (inlineValue == null) {
        index += 1;
      }

      options.ids = parseIds(rawValue);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

export function formatVerifyReportsHelp() {
  return [
    'Usage:',
    '  npm run verify-reports -- [options]',
    '',
    'Options:',
    '  --ids <report-id[,report-id...]>  Verify only the selected draft report ids',
    '  --json                           Print the verification summary as JSON',
    '  --repair                         Repair blocked draft rows and re-verify without publishing',
    '  --help, -h                       Show this help text',
  ].join('\n');
}

export async function verifyDraftReports({
  client,
  reportIds = [],
  repair = false,
  ...options
} = {}) {
  return verifyDraftResearchReports(client, {
    reportIds,
    repair,
    ...options,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseVerifyReportsArgs(argv);

  if (options.help) {
    console.log(formatVerifyReportsHelp());
    return;
  }

  const client = createDatabaseClient();
  await client.connect();

  try {
    const summary = await verifyDraftReports({
      client,
      reportIds: options.ids,
      repair: options.repair,
    });

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    }

    if (summary.blockedReports.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

function readNextValue(argv, index, flag) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseIds(rawValue) {
  const ids = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = Number.parseInt(value, 10);

      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--ids must be a comma-separated list of positive integers. Invalid value: ${value}`);
      }

      return parsed;
    });

  if (ids.length === 0) {
    throw new Error('--ids must include at least one report id.');
  }

  return [...new Set(ids)];
}