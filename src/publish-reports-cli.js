import process from 'node:process';
import dotenv from 'dotenv';

import { main } from './publish-reports.js';
import { formatErrorWithCause } from './lib/error-format.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

main().catch((error) => {
  console.error(formatErrorWithCause(error));
  process.exitCode = 1;
});
