import process from 'node:process';
import dotenv from 'dotenv';

import { main } from './publish-reports.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});