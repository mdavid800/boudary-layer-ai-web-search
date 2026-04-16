import path from 'node:path';
import process from 'node:process';

export const DEFAULT_PROMPT_PATH = path.resolve(process.cwd(), 'prompt.md');
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1';
export const DEFAULT_SEARCH_ENGINE = process.env.OPENROUTER_SEARCH_ENGINE || 'firecrawl';
export const DEFAULT_SEARCH_MODE = process.env.OPENROUTER_SEARCH_MODE || 'plugin';
export const DEFAULT_MAX_RESULTS = getPositiveInteger(
  process.env.OPENROUTER_MAX_RESULTS,
  6,
  'OPENROUTER_MAX_RESULTS',
);
export const DEFAULT_MAX_TOTAL_RESULTS = getPositiveInteger(
  process.env.OPENROUTER_MAX_TOTAL_RESULTS,
  18,
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
