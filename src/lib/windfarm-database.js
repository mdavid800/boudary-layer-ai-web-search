import path from 'node:path';

const ALLOWED_SOURCE_TABLES = new Set(['core_wind_farms', 'windfarm_database']);

export function getWindFarmSourceTableName(value = process.env.WIND_FARM_SOURCE_TABLE) {
  const tableName = value?.trim() || 'core_wind_farms';

  if (!ALLOWED_SOURCE_TABLES.has(tableName)) {
    throw new Error(
      `Unsupported WIND_FARM_SOURCE_TABLE: ${tableName}. Use core_wind_farms or windfarm_database.`,
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

  // core_wind_farms uses different column names than windfarm_database
  const isCore = validatedTableName === 'core_wind_farms';
  const turbineCol = isCore ? 'turbine_count' : 'n_turbines';
  const powerCol = 'power_mw';

  const conditions = ['name is not null'];
  const params = [];

  if (ids && ids.length > 0) {
    params.push(ids);
    conditions.push(`id = ANY($${params.length})`);
  }

  if (country && isCore) {
    params.push(country);
    conditions.push(`LOWER(country) = LOWER($${params.length})`);
  }

  const whereClause = conditions.join(' AND ');

  const result = await client.query(
    `
    select
      id,
      name,
      ${turbineCol} as n_turbines,
      ${powerCol} as power_mw,
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
  const isCore = getWindFarmSourceTableName(sourceTableName) === 'core_wind_farms';

  if (isCore) {
    // Use core tables: join through source_key-based links
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

  // Legacy: use windfarm_database + turbine_windfarm_boundary_links
  const result = await client.query(
    `
      select
        t.oem_manufacturer as "oemManufacturer",
        t.rated_power as "ratedPower",
        t.rotor_diameter as "rotorDiameter",
        t.hub_height as "hubHeight",
        t.turbine_type as "turbineType",
        t.commissioning_date as "commissioningDate",
        count(*)::integer as "matchCount"
      from public.turbine_database t
      join public.turbine_windfarm_boundary_links l
        on l.turbine_id = t.id
      where l.windfarm_id = $1
      group by
        t.oem_manufacturer,
        t.rated_power,
        t.rotor_diameter,
        t.hub_height,
        t.turbine_type,
        t.commissioning_date
      order by
        count(*) desc,
        t.oem_manufacturer nulls last,
        t.turbine_type nulls last
      limit 1
    `,
    [windfarmId],
  );

  return result.rows[0] || null;
}

/**
 * Resolve the core_wind_farms.id for a wind farm by name.
 * When the source table is not core_wind_farms, reports/facts must still
 * reference core_wind_farms.id (FK constraint). Returns null if no match.
 */
export async function resolveCoreWindFarmId(client, name) {
  const result = await client.query(
    `SELECT id FROM public.core_wind_farms WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
    [name],
  );
  return result.rows[0]?.id ?? null;
}
