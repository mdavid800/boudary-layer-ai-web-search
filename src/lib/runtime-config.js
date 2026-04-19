import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';

dotenv.config();

export const DEFAULT_PROMPT_PATH = path.resolve(process.cwd(), 'prompt.md');
export const DEFAULT_MODEL = readEnvValue('OPENROUTER_MODEL') || 'openai/gpt-5.4';
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
