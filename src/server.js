import http from 'node:http';
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

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';
const MAX_BODY_BYTES = 1024 * 1024;
const REPORT_ACTIONS = new Set(['save', 'verify', 'suggest-fix', 'publish']);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function getPort() {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isInteger(parsed) ? parsed : DEFAULT_PORT;
}

function getHost() {
  return process.env.HOST?.trim() || DEFAULT_HOST;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function getBearerToken(request) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice('Bearer '.length).trim() || null;
}

function requireAuthorizedRequest(request) {
  const expectedToken = process.env.WEB_SEARCH_SERVICE_TOKEN?.trim();
  if (!expectedToken) {
    return;
  }

  if (getBearerToken(request) !== expectedToken) {
    throw new HttpError(401, 'Unauthorized');
  }
}

async function readJsonBody(request) {
  let body = '';
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large.');
    }

    body += chunk.toString('utf8');
  }

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function validateModerationRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  if (!REPORT_ACTIONS.has(body.action)) {
    throw new HttpError(400, 'action must be one of save, verify, suggest-fix, or publish.');
  }

  if (!Number.isInteger(body.reportId)) {
    throw new HttpError(400, 'reportId must be an integer.');
  }

  if (body.payload !== undefined && (body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload))) {
    throw new HttpError(400, 'payload must be a JSON object when provided.');
  }

  return {
    action: body.action,
    reportId: body.reportId,
    payload: body.payload,
    repair: body.repair === true,
  };
}

async function runModerationAction({ action, reportId, payload, repair }) {
  const client = createDatabaseClient();
  await client.connect();

  try {
    if (action === 'save') {
      return await saveDraftResearchReport(client, {
        reportId,
        reportMarkdown: typeof payload?.reportMarkdown === 'string' ? payload.reportMarkdown : '',
        modelUsed: typeof payload?.modelUsed === 'string' ? payload.modelUsed : null,
        autoVerify: payload?.autoVerify === true,
        autoRepair: payload?.autoRepair === true,
      });
    }

    if (action === 'verify') {
      return await verifyDraftResearchReport(client, {
        reportId,
        repair,
      });
    }

    if (action === 'suggest-fix') {
      return await suggestDraftResearchReportRepair(client, {
        reportId,
      });
    }

    if (action === 'publish') {
      return await publishDraftResearchReport(client, {
        reportId,
      });
    }

    throw new HttpError(400, `Unsupported action: ${action}`);
  } finally {
    await client.end();
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/internal/healthz')) {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/internal/report-moderation') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    requireAuthorizedRequest(request);
    const body = await readJsonBody(request);
    const moderationRequest = validateModerationRequest(body);
    const result = await runModerationAction(moderationRequest);

    sendJson(response, 200, { result });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (statusCode >= 500) {
      console.error('Web search service request failed:', error);
    }

    sendJson(response, statusCode, { error: message });
  }
});

server.listen(getPort(), getHost(), () => {
  console.log(`boundary-layer-ai-web-search listening on http://${getHost()}:${getPort()}`);
  if (!process.env.WEB_SEARCH_SERVICE_TOKEN?.trim()) {
    console.warn('WEB_SEARCH_SERVICE_TOKEN is not set. Internal moderation endpoint is unsecured.');
  }
});