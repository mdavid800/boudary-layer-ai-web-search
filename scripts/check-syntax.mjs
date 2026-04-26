import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootsToCheck = ['src', 'test'];

function collectJavaScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...collectJavaScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

const filesToCheck = rootsToCheck.flatMap((relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  return collectJavaScriptFiles(absolutePath);
});

for (const filePath of filesToCheck) {
  execFileSync(process.execPath, ['--check', filePath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

console.log(`Syntax check passed for ${filesToCheck.length} JavaScript files.`);