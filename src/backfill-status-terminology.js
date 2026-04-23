import process from 'node:process';
import dotenv from 'dotenv';
import { createDatabaseClient } from './lib/database.js';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const STATUS_COLUMN_TABLES = [
  'stg_wind_farms',
  'core_wind_farms',
  'stg_met_masts',
  'core_met_masts',
  'stg_oftos',
  'core_oftos',
  'stg_tidal_sites',
  'core_tidal_sites',
  'stg_wave_sites',
  'core_wave_sites',
];

const STATUS_REPLACEMENTS = [
  {
    canonical: 'Consented',
    aliases: ['Consent Authorised', 'Consent Authorized', 'Approved', 'Consented'],
  },
  {
    canonical: 'Decommissioned',
    aliases: ['Dismantled', 'Decommissioned'],
  },
  {
    canonical: 'In Planning / Consent Application Submitted',
    aliases: [
      'Consent Application Submitted',
      'In Planning',
      'In Planning / Consent Application Submitted',
      'Consent / Planning Application Submitted',
      'Planning Application Submitted',
    ],
  },
  {
    canonical: 'Lease Awarded, Pre-Planning',
    aliases: [
      'Lease Awarded, Pre-Planning',
      'Lease Awarded , Pre-Planning',
      'Lease Awarded, Pre Planning',
      'Lease Awarded, Pre-Planning Submission',
      'Lease Awarded, Pre-Planning Submittion',
    ],
  },
  {
    canonical: 'Concept',
    aliases: ['Test site', 'Test-site', 'Testsite'],
  },
];

const SAFE_CANONICAL_STATUSES = new Set([
  'Operational',
  'Decommissioned',
  'Under Construction',
  'FID Taken, Pre-Construction',
  'Consented',
  'In Planning / Consent Application Submitted',
  'Lease Awarded, Pre-Planning',
  'Development Zone / lease area',
  'Concept',
]);

const KEY_AUDIT_QUERIES = [
  {
    label: 'core_wind_farms',
    sql: `
      SELECT COALESCE(status, '<null>') AS status, COUNT(*)::int AS count
      FROM public.core_wind_farms
      WHERE record_status = 'active'
      GROUP BY status
      ORDER BY count DESC, status ASC
    `,
  },
  {
    label: 'wind_farm_facts.status',
    sql: `
      SELECT COALESCE(value, '<null>') AS status, source_type, COUNT(*)::int AS count
      FROM public.wind_farm_facts
      WHERE field_name = 'status'
        AND status = 'active'
      GROUP BY value, source_type
      ORDER BY count DESC, value ASC, source_type ASC
    `,
  },
  {
    label: 'community_notes.status',
    sql: `
      SELECT COALESCE(proposed_value, '<null>') AS status, moderation_status, COUNT(*)::int AS count
      FROM public.wind_farm_community_notes
      WHERE proposed_field = 'status'
      GROUP BY proposed_value, moderation_status
      ORDER BY count DESC, proposed_value ASC NULLS LAST
    `,
  },
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeStatusKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function buildStatusReplacementMap() {
  const replacementMap = new Map();
  for (const replacement of STATUS_REPLACEMENTS) {
    for (const alias of replacement.aliases) {
      replacementMap.set(alias.trim().toLowerCase(), replacement.canonical);
    }
  }
  return replacementMap;
}

function replaceMarkdownStatusCell(reportMarkdown, replacementMap) {
  if (typeof reportMarkdown !== 'string' || !reportMarkdown.includes('| Status |')) {
    return { changed: false, nextMarkdown: reportMarkdown, fromStatus: null, toStatus: null };
  }

  let fromStatus = null;
  let toStatus = null;

  const nextMarkdown = reportMarkdown.replace(
    /^(\|\s*Status\s*\|\s*)([^|\r\n]+?)(\s*\|.*)$/m,
    (fullMatch, prefix, rawStatus, suffix) => {
      const normalized = normalizeStatusKey(rawStatus);
      const replacement = normalized ? replacementMap.get(normalized) ?? null : null;

      if (!replacement || replacement === rawStatus.trim()) {
        return fullMatch;
      }

      fromStatus = rawStatus.trim();
      toStatus = replacement;
      return `${prefix}${replacement}${suffix}`;
    },
  );

  return {
    changed: nextMarkdown !== reportMarkdown,
    nextMarkdown,
    fromStatus,
    toStatus,
  };
}

async function printAudit(client, label) {
  console.log(`\n=== ${label} ===`);
  for (const query of KEY_AUDIT_QUERIES) {
    const { rows } = await client.query(query.sql);
    console.log(`\n[${query.label}]`);
    for (const row of rows) {
      console.log(JSON.stringify(row));
    }
  }
}

async function updateStatusColumnTable(client, tableName, replacementMap) {
  let updatedRows = 0;

  for (const replacement of STATUS_REPLACEMENTS) {
    const aliasKeys = replacement.aliases
      .map((alias) => normalizeStatusKey(alias))
      .filter((alias) => alias !== replacement.canonical.toLowerCase());

    if (aliasKeys.length === 0) {
      continue;
    }

    const result = await client.query(
      `
        UPDATE public.${tableName}
        SET status = $1
        WHERE LOWER(TRIM(status)) = ANY($2::text[])
          AND status IS NOT NULL
      `,
      [replacement.canonical, aliasKeys],
    );
    updatedRows += result.rowCount ?? 0;
  }

  return updatedRows;
}

async function updateFactStatuses(client) {
  let updatedRows = 0;

  for (const replacement of STATUS_REPLACEMENTS) {
    const aliasKeys = replacement.aliases
      .map((alias) => normalizeStatusKey(alias))
      .filter((alias) => alias !== replacement.canonical.toLowerCase());

    if (aliasKeys.length === 0) {
      continue;
    }

    const result = await client.query(
      `
        UPDATE public.wind_farm_facts
        SET value = $1
        WHERE field_name = 'status'
          AND status IN ('active', 'draft')
          AND LOWER(TRIM(value)) = ANY($2::text[])
      `,
      [replacement.canonical, aliasKeys],
    );
    updatedRows += result.rowCount ?? 0;
  }

  return updatedRows;
}

async function updateCommunityNoteStatuses(client) {
  let updatedRows = 0;

  for (const replacement of STATUS_REPLACEMENTS) {
    const aliasKeys = replacement.aliases
      .map((alias) => normalizeStatusKey(alias))
      .filter((alias) => alias !== replacement.canonical.toLowerCase());

    if (aliasKeys.length === 0) {
      continue;
    }

    const result = await client.query(
      `
        UPDATE public.wind_farm_community_notes
        SET proposed_value = $1
        WHERE proposed_field = 'status'
          AND proposed_value IS NOT NULL
          AND LOWER(TRIM(proposed_value)) = ANY($2::text[])
      `,
      [replacement.canonical, aliasKeys],
    );
    updatedRows += result.rowCount ?? 0;
  }

  return updatedRows;
}

async function updateReportMarkdownStatuses(client, replacementMap) {
  const result = await client.query(
    `
      SELECT id, report_markdown
      FROM public.research_wind_farm_reports
      WHERE report_markdown LIKE '%| Status |%'
      ORDER BY id ASC
    `,
  );

  let updatedRows = 0;
  for (const row of result.rows) {
    const updated = replaceMarkdownStatusCell(row.report_markdown, replacementMap);
    if (!updated.changed) {
      continue;
    }

    await client.query(
      `
        UPDATE public.research_wind_farm_reports
        SET report_markdown = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [row.id, updated.nextMarkdown],
    );
    updatedRows += 1;
  }

  return updatedRows;
}

async function printResiduals(client) {
  const { rows } = await client.query(
    `
      WITH statuses AS (
        SELECT DISTINCT TRIM(status) AS status
        FROM public.core_wind_farms
        WHERE record_status = 'active'
          AND status IS NOT NULL
        UNION
        SELECT DISTINCT TRIM(value) AS status
        FROM public.wind_farm_facts
        WHERE field_name = 'status'
          AND status = 'active'
          AND value IS NOT NULL
      )
      SELECT status
      FROM statuses
      WHERE status IS NOT NULL
      ORDER BY status ASC
    `,
  );

  const residuals = rows
    .map((row) => row.status)
    .filter((status) => !SAFE_CANONICAL_STATUSES.has(status));

  console.log('\n[residual-noncanonical-statuses]');
  if (residuals.length === 0) {
    console.log('All active runtime statuses are now canonical.');
    return;
  }

  for (const status of residuals) {
    console.log(status);
  }
}

async function main() {
  const apply = hasFlag('--apply');
  const replacementMap = buildStatusReplacementMap();
  const client = createDatabaseClient();

  await client.connect();

  try {
    await printAudit(client, 'before');

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to update the live database.');
      await printResiduals(client);
      return;
    }

    await client.query('BEGIN');

    const baseTableUpdates = [];
    for (const tableName of STATUS_COLUMN_TABLES) {
      const updatedRows = await updateStatusColumnTable(client, tableName, replacementMap);
      baseTableUpdates.push({ tableName, updatedRows });
    }

    const factUpdates = await updateFactStatuses(client);
    const noteUpdates = await updateCommunityNoteStatuses(client);
    const reportUpdates = await updateReportMarkdownStatuses(client, replacementMap);

    await client.query('COMMIT');

    console.log('\nApplied updates:');
    for (const update of baseTableUpdates) {
      console.log(`${update.tableName}: ${update.updatedRows}`);
    }
    console.log(`wind_farm_facts: ${factUpdates}`);
    console.log(`wind_farm_community_notes: ${noteUpdates}`);
    console.log(`research_wind_farm_reports: ${reportUpdates}`);

    await printAudit(client, 'after');
    await printResiduals(client);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});