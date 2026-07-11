import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_CODEX_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CODEX_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export function resolveCodexAccess({
  env = process.env,
  homeDir = os.homedir(),
  readFileSync = fs.readFileSync,
} = {}) {
  const codexApiKey = readEnvValue(env, 'CODEX_API_KEY');
  if (codexApiKey && !looksLikeOpenRouterKey(codexApiKey)) {
    return {
      apiKey: codexApiKey,
      authMode: 'api_key',
      authSource: 'CODEX_API_KEY',
      baseUrl: DEFAULT_CODEX_API_BASE_URL,
    };
  }

  const openAiApiKey = readEnvValue(env, 'OPENAI_API_KEY');
  if (openAiApiKey && !looksLikeOpenRouterKey(openAiApiKey)) {
    return {
      apiKey: openAiApiKey,
      authMode: 'api_key',
      authSource: 'OPENAI_API_KEY',
      baseUrl: DEFAULT_CODEX_API_BASE_URL,
    };
  }

  const hermesHome = readEnvValue(env, 'HERMES_HOME') || path.join(homeDir, '.hermes');
  const authCandidates = [
    {
      authPath: path.join(hermesHome, 'auth.json'),
      authSource: 'hermes-openai-codex-oauth',
      extractToken: extractHermesCodexAccessToken,
    },
    {
      authPath: path.join(homeDir, '.codex', 'auth.json'),
      authSource: 'codex-cli-oauth',
      extractToken: (payload) => readNestedString(payload, ['tokens', 'access_token']),
    },
  ];

  for (const candidate of authCandidates) {
    const token = readAccessToken(candidate.authPath, candidate.extractToken, readFileSync);
    if (token && !isExpiredJwt(token)) {
      return {
        apiKey: token,
        authMode: 'oauth',
        authSource: candidate.authSource,
        authPath: candidate.authPath,
        baseUrl: DEFAULT_CODEX_OAUTH_BASE_URL,
      };
    }
  }

  throw new Error(
    'Missing CODEX_API_KEY / OPENAI_API_KEY and no valid Codex OAuth token was found. Run `hermes login --provider openai-codex` or `codex login` first.',
  );
}

function looksLikeOpenRouterKey(value) {
  return typeof value === 'string' && value.trim().startsWith('sk-or-');
}

function readEnvValue(env, name) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readNestedString(value, pathSegments) {
  const nestedValue = pathSegments.reduce((currentValue, key) => currentValue?.[key], value);
  return typeof nestedValue === 'string' && nestedValue.trim() ? nestedValue.trim() : '';
}

function extractHermesCodexAccessToken(payload) {
  const legacyToken = readNestedString(payload, ['providers', 'openai-codex', 'tokens', 'access_token']);
  if (legacyToken && !isExpiredJwt(legacyToken)) {
    return legacyToken;
  }

  const credentialPool = payload?.credential_pool?.['openai-codex'];
  if (!Array.isArray(credentialPool)) {
    return '';
  }

  for (const credential of credentialPool) {
    if (credential?.auth_type !== 'oauth') {
      continue;
    }

    const token = readNestedString(credential, ['access_token']);
    if (token) {
      return token;
    }
  }

  return '';
}

function readAccessToken(authPath, extractToken, readFileSync) {
  try {
    const payload = JSON.parse(readFileSync(authPath, 'utf8'));
    return extractToken(payload);
  } catch {
    return '';
  }
}

function isExpiredJwt(token) {
  const expirationSeconds = getJwtExpiration(token);
  if (!expirationSeconds) {
    return false;
  }

  return Date.now() >= ((expirationSeconds - 60) * 1000);
}

function getJwtExpiration(token) {
  if (typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const expirationSeconds = Number.parseInt(decodedPayload?.exp, 10);
    return Number.isInteger(expirationSeconds) && expirationSeconds > 0 ? expirationSeconds : null;
  } catch {
    return null;
  }
}
