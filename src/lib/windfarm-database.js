import path from 'node:path';

const ALLOWED_SOURCE_TABLES = new Set(['windfarm_database', 'windfarm_database_test']);

export function getWindFarmSourceTableName(value = process.env.WIND_FARM_SOURCE_TABLE) {
  const tableName = value?.trim() || 'windfarm_database';

  if (!ALLOWED_SOURCE_TABLES.has(tableName)) {
    throw new Error(
      `Unsupported WIND_FARM_SOURCE_TABLE: ${tableName}. Use windfarm_database or windfarm_database_test.`,
    );
  }

  return tableName;
}

export function getWindFarmReportsDirectory(value = process.env.WIND_FARM_REPORTS_DIR) {
  const configuredPath = value?.trim() || 'reports';
  return path.resolve(process.cwd(), configuredPath);
}

export async function listWindFarmRows(client, sourceTableName) {
  const validatedTableName = getWindFarmSourceTableName(sourceTableName);
  const result = await client.query(`
    select
      id,
      name,
      n_turbines,
      power_mw,
      status
    from public.${validatedTableName}
    where name is not null
    order by id
  `);

  return result.rows;
}

export async function getLinkedTurbineMetadata(client, windfarmId) {
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
