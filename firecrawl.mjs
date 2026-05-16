#!/usr/bin/env node

/**
 * firecrawl.mjs — Web search + scrape via Firecrawl API.
 *
 * Usage:
 *   node firecrawl.mjs search "query"           # Search the web (returns URLs + snippets)
 *   node firecrawl.mjs scrape <url>              # Get full page as clean markdown
 *   node firecrawl.mjs scrape <url> json         # Get full JSON response
 *   node firecrawl.mjs scrape <url> --first "txt"  # First 300 chars matching text
 *   node firecrawl.mjs pdf <url>                 # Scrape a PDF (same as scrape)
 *
 * Requires FIRECRAWL_API_KEY in environment or .env file.
 */

import dotenv from 'dotenv';
import process from 'node:process';

dotenv.config();

const API_KEY = process.env.FIRECRAWL_API_KEY;

if (!API_KEY) {
  console.error('Error: FIRECRAWL_API_KEY not set.');
  process.exit(1);
}

const mode = process.argv[2];
const target = process.argv[3];

async function searchWeb(query) {
  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit: 8,
    }),
  });

  const data = await response.json();
  if (!data.success) {
    console.error('Search error:', JSON.stringify(data));
    process.exit(1);
  }

  for (const result of data.data || []) {
    console.log(`## ${result.title}`);
    console.log(`URL: ${result.url}`);
    if (result.description) console.log(result.description.substring(0, 300));
    console.log();
  }
}

async function scrapeUrl(url, subMode) {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  const data = await response.json();
  if (!data.success) {
    console.error('Scrape error:', JSON.stringify(data));
    process.exit(1);
  }

  const markdown = data.data?.markdown || '';

  if (subMode === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (subMode === '--first' && process.argv[4]) {
    const searchText = process.argv[4];
    const idx = markdown.toLowerCase().indexOf(searchText.toLowerCase());
    if (idx >= 0) {
      console.log(markdown.substring(Math.max(0, idx - 50), idx + 350));
    } else {
      console.error(`Text "${searchText}" not found.`);
      process.exit(1);
    }
  } else {
    console.log(markdown);
  }
}

async function main() {
  if (!mode || !target) {
    console.error('Usage:');
    console.error('  node firecrawl.mjs search "query"           # web search');
    console.error('  node firecrawl.mjs scrape <url>              # get page content');
    console.error('  node firecrawl.mjs scrape <url> json         # full response');
    console.error('  node firecrawl.mjs scrape <url> --first "txt" # find text');
    process.exit(1);
  }

  if (mode === 'search') {
    await searchWeb(target);
  } else if (mode === 'scrape' || mode === 'pdf') {
    await scrapeUrl(target, process.argv[4]);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
