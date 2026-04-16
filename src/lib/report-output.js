import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function saveReport(outputPath, report) {
  return saveTextFile(outputPath, report);
}

export async function saveTextFile(outputPath, content) {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, 'utf8');
  return resolvedPath;
}

export function slugifyFileSegment(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function isPromptTraceEnabled(value = process.env.PROMPT_TRACE_ENABLED) {
  if (!value) {
    return false;
  }

  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function getPromptTraceDirectory(value = process.env.PROMPT_TRACE_DIR) {
  const configuredPath = value?.trim() || 'prompt-traces';
  return path.resolve(process.cwd(), configuredPath);
}
