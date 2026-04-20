import path from 'node:path';

const ALLOWED_SOURCE_TABLES = new Set(['core_wind_farms']);

export function getWindFarmSourceTableName(value = process.env.WIND_FARM_SOURCE_TABLE) {
  const tableName = value?.trim() || 'core_wind_farms';

  if (!ALLOWED_SOURCE_TABLES.has(tableName)) {
    throw new Error(
      `Unsupported WIND_FARM_SOURCE_TABLE: ${tableName}. Use core_wind_farms.`,
    );
  }

  return tableName;
}

export function getWindFarmReportsDirectory(value = process.env.WIND_FARM_REPORTS_DIR) {
  const configuredPath = value?.trim() || 'reports';
  return path.resolve(process.cwd(), configuredPath);
}

export async function listWindFarmRows(client, sourceTableName, { ids, country } = {}) {
  const validatedTableName = getWindFarmSourceTableName(sourceTableName);

  const conditions = ["name is not null", "record_status = 'active'"];
  const params = [];

  if (ids && ids.length > 0) {
    params.push(ids);
    conditions.push(`id = ANY($${params.length})`);
  }

  if (country) {
    params.push(country);
    conditions.push(`LOWER(country) = LOWER($${params.length})`);
  }

  const whereClause = conditions.join(' AND ');

  const result = await client.query(
    `
    select
      id,
      name,
      type,
      turbine_count as n_turbines,
      power_mw,
      status
    from public.${validatedTableName}
    where ${whereClause}
    order by id
  `,
    params,
  );

  return result.rows;
}

export async function getLinkedTurbineMetadata(client, windfarmId, sourceTableName) {
  getWindFarmSourceTableName(sourceTableName);
  const result = await client.query(
    `
      select
        t.manufacturer as "oemManufacturer",
        t.rated_power_mw as "ratedPower",
        t.rotor_diameter_m as "rotorDiameter",
        t.hub_height_m as "hubHeight",
        t.turbine_type as "turbineType",
        t.commissioning_date as "commissioningDate",
        count(*)::integer as "matchCount"
      from public.core_turbines t
      join public.core_wind_farm_turbine_links l
        on l.turbine_source_key = t.source_key
      join public.core_wind_farms wf
        on wf.source_key = l.wind_farm_source_key
      where wf.id = $1
        and wf.record_status = 'active'
      group by
        t.manufacturer,
        t.rated_power_mw,
        t.rotor_diameter_m,
        t.hub_height_m,
        t.turbine_type,
        t.commissioning_date
      order by
        count(*) desc,
        t.manufacturer nulls last,
        t.turbine_type nulls last
      limit 1
    `,
    [windfarmId],
  );

  return result.rows[0] || null;
}

export async function getTurbineCountValidationContext(client, windfarmId, sourceTableName) {
  getWindFarmSourceTableName(sourceTableName);

  const factsResult = await client.query(
    `
      WITH ranked AS (
        SELECT
          source_type,
          value,
          source_detail,
          ROW_NUMBER() OVER (
            PARTITION BY source_type
            ORDER BY created_at DESC
          ) AS rn
        FROM public.wind_farm_facts
        WHERE wind_farm_id = $1
          AND field_name = 'turbine_count'
          AND status = 'active'
          AND source_type IN ('community', 'eurowindwakes', 'emodnet')
      )
      SELECT source_type, value, source_detail
      FROM ranked
      WHERE rn = 1
    `,
    [windfarmId],
  );

  const bySource = Object.fromEntries(
    factsResult.rows.map((row) => [row.source_type, {
      value: row.value,
      sourceDetail: row.source_detail,
    }]),
  );

  const approvedNotesResult = await client.query(
    `
      SELECT
        proposed_value,
        COUNT(*)::integer AS note_count,
        COALESCE(SUM(upvotes), 0)::integer AS total_upvotes,
        COUNT(*) FILTER (WHERE promoted_to_fact_id IS NOT NULL)::integer AS promoted_note_count
      FROM public.wind_farm_community_notes
      WHERE wind_farm_id = $1
        AND moderation_status = 'approved'
        AND proposed_field = 'turbine_count'
        AND proposed_value IS NOT NULL
      GROUP BY proposed_value
      ORDER BY promoted_note_count DESC, total_upvotes DESC, COUNT(*) DESC, proposed_value ASC
      LIMIT 3
    `,
    [windfarmId],
  );

  const approvedSummaryResult = await client.query(
    `
      SELECT
        COUNT(*)::integer AS approved_note_count,
        COALESCE(SUM(upvotes), 0)::integer AS total_upvotes
      FROM public.wind_farm_community_notes
      WHERE wind_farm_id = $1
        AND moderation_status = 'approved'
        AND proposed_field = 'turbine_count'
    `,
    [windfarmId],
  );

  const summary = approvedSummaryResult.rows[0] ?? { approved_note_count: 0, total_upvotes: 0 };

  return {
    winningFact: bySource.community ?? bySource.eurowindwakes ?? bySource.emodnet ?? null,
    calculatedFact: bySource.eurowindwakes ?? null,
    emodnetFact: bySource.emodnet ?? null,
    communitySummary: Number(summary.approved_note_count) > 0
      ? {
          approvedNoteCount: Number(summary.approved_note_count),
          totalUpvotes: Number(summary.total_upvotes),
          topProposedValues: approvedNotesResult.rows.map((row) => ({
            value: row.proposed_value,
            noteCount: row.note_count,
            totalUpvotes: row.total_upvotes,
            promotedNoteCount: row.promoted_note_count,
          })),
        }
      : null,
  };
}
