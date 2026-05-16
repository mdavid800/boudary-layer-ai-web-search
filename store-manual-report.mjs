/**
 * store-manual-report.mjs
 *
 * Stores a manually-researched wind farm report into the Boundary Layer database.
 * Usage:
 *   node store-manual-report.mjs <windFarmId> < <report-markdown-file>
 *
 * Reads report markdown from stdin, creates a draft in the pipeline DB,
 * runs evidence verification, and outputs the result as JSON.
 */

import dotenv from 'dotenv';
import process from 'node:process';
import { stdin as input } from 'node:process';
import { createDatabaseClient } from './src/lib/database.js';
import { storeResearchReport } from './src/lib/report-storage.js';
import { verifyReportEvidence } from './src/lib/evidence-verifier.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function readStdin() {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const windFarmId = Number.parseInt(process.argv[2], 10);

  if (!Number.isInteger(windFarmId) || windFarmId <= 0) {
    console.error('Usage: node store-manual-report.mjs <windFarmId> < <report-markdown>');
    process.exitCode = 1;
    return;
  }

  const reportMarkdown = await readStdin();

  if (!reportMarkdown || reportMarkdown.trim().length < 100) {
    console.error('Error: Report markdown is empty or too short (received ' + (reportMarkdown?.length ?? 0) + ' chars).');
    process.exitCode = 1;
    return;
  }

  const client = createDatabaseClient();
  await client.connect();

  try {
    // Use a distinctive sentinel as prompt_hash so manual reports don't collide
    // with pipeline-generated reports for the same wind farm.
    const finalPrompt = 'manual-hermes-research-v1';

    // Model identifier — distinct from pipeline models for traceability
    const modelUsed = 'Bert, Boundary-layer-Bot (deepseek/deepseek-v4-flash)';

    const { reportId, factsInserted } = await storeResearchReport(client, {
      windFarmId,
      reportMarkdown: reportMarkdown.trim(),
      modelUsed,
      finalPrompt,
      reviewStatus: 'draft',
    });

    console.error(`Stored report #${reportId} with ${factsInserted} facts for wind farm ID ${windFarmId}.`);

    // Run evidence verification to set initial verification status on all evidence rows
    let verificationResult;
    try {
      verificationResult = await verifyReportEvidence(client, reportId);
    } catch (verificationError) {
      console.error(`Verification did not complete: ${verificationError.message}`);
      verificationResult = {
        passed: false,
        blockedRows: [],
        error: verificationError.message,
      };
    }

    const output = {
      reportId,
      windFarmId,
      factsInserted,
      verificationPassed: verificationResult.passed,
      blockerCount: verificationResult.blockedRows?.length ?? 0,
      blockedRows: (verificationResult.blockedRows ?? []).map((b) => ({
        field: b.report_field_name ?? b.report_item_label ?? 'unknown',
        value: b.reported_value,
        error: b.error,
        sourceUrl: b.source_url,
        httpStatus: b.http_status,
      })),
    };

    console.log(JSON.stringify(output, null, 2));

    if (!verificationResult.passed && (verificationResult.blockedRows?.length ?? 0) > 0) {
      console.error(`${verificationResult.blockedRows.length} blocker(s) found for report #${reportId}.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Failed to store report: ${error.message}`);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
