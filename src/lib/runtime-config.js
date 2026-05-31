import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { resolveCodexAccess } from './codex-auth.js';

dotenv.config();

export const DEFAULT_PROMPT_PATH = path.resolve(process.cwd(), 'prompt.md');
export const DEFAULT_MODEL = readEnvValue('OPENROUTER_MODEL') || 'openai/gpt-5.4';
export const DEFAULT_CODEX_MODEL = readEnvValue('CODEX_MODEL') || readEnvValue('OPENAI_MODEL') || 'gpt-5.5';
export const DEFAULT_SEARCH_ENGINE = readEnvValue('OPENROUTER_SEARCH_ENGINE') || 'auto';
export const DEFAULT_MAX_RESULTS = getPositiveInteger(
  readEnvValue('OPENROUTER_MAX_RESULTS'),
  8,
  'OPENROUTER_MAX_RESULTS',
);
export const DEFAULT_MAX_TOTAL_RESULTS = getPositiveInteger(
  readEnvValue('OPENROUTER_MAX_TOTAL_RESULTS'),
  24,
  'OPENROUTER_MAX_TOTAL_RESULTS',
);
export const DEFAULT_RESEARCH_PROVIDER = getResearchProvider(
  readEnvValue('RESEARCH_PROVIDER') || 'openrouter',
  'RESEARCH_PROVIDER',
);

export function requireValue(value, name, message) {
  if (value?.trim()) {
    return value.trim();
  }

  throw new Error(message || `Missing ${name}. Copy .env.example to .env and set ${name} first.`);
}

export function getPositiveInteger(value, fallbackValue, variableName) {
  if (value == null || value === '') {
    return fallbackValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsed;
}

function readEnvValue(name) {
  return process.env[name]?.trim();
}

export function getResearchProvider(value, variableName = 'provider') {
  const normalized = (value || '').trim().toLowerCase();
  const allowed = new Set(['openrouter', 'codex']);

  if (!allowed.has(normalized)) {
    throw new Error(`${variableName} must be one of: openrouter, codex.`);
  }

  return normalized;
}

export function getDefaultModelForProvider(provider) {
  return provider === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_MODEL;
}

export function getProviderRuntime(provider) {
  if (provider === 'codex') {
    return resolveCodexAccess();
  }

  return {
    apiKey: requireValue(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY'),
    authMode: 'api_key',
    authSource: 'OPENROUTER_API_KEY',
    baseUrl: null,
  };
}

export function getApiKeyForProvider(provider) {
  return getProviderRuntime(provider).apiKey;
}

export function getBaseUrlForProvider(provider) {
  return getProviderRuntime(provider).baseUrl;
}
