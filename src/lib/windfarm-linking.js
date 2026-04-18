export const LINKAGE_SQL = `
begin;

create or replace function public.normalize_windfarm_name(raw_name text)
returns text
language sql
immutable
returns null on null input
as $$
  select regexp_replace(
    lower(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(trim(raw_name), 'æ', 'ae'),
                        'œ', 'oe'
                      ),
                      'ø', 'o'
                    ),
                    'å', 'a'
                  ),
                  'ä', 'a'
                ),
                'ö', 'o'
              ),
              'é', 'e'
            ),
            'è', 'e'
          ),
          'ê', 'e'
        ),
        'ç', 'c'
      )
    ),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create table if not exists public.turbine_windfarm_boundary_matches (
  turbine_wind_farm text not null,
  windfarm_id bigint not null references public.windfarm_database(id),
  windfarm_name text,
  windfarm_status text not null,
  total_turbines integer not null,
  turbines_covered integer not null,
  coverage_ratio numeric(8, 4) not null,
  turbine_country text,
  windfarm_country text,
  country_match boolean not null,
  name_match_type text not null,
  name_match_rank integer not null,
  auto_rank integer not null,
  auto_selected boolean not null,
  manual_selection text,
  manual_notes text,
  generated_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (turbine_wind_farm, windfarm_id),
  constraint turbine_windfarm_boundary_matches_manual_selection_check
    check (manual_selection in ('selected', 'rejected') or manual_selection is null)
);

create index if not exists turbine_windfarm_boundary_matches_windfarm_id_idx
  on public.turbine_windfarm_boundary_matches (windfarm_id);

create index if not exists turbine_windfarm_boundary_matches_manual_selection_idx
  on public.turbine_windfarm_boundary_matches (manual_selection);

with turbine_farms as (
  select
    t.wind_farm,
    public.normalize_windfarm_name(t.wind_farm) as normalized_wind_farm,
    min(t.country) as turbine_country,
    count(*)::integer as total_turbines
  from public.turbine_database t
  group by t.wind_farm
),
eligible_boundaries as (
  select
    wf.id,
    wf.name,
    wf.country,
    wf.status,
    wf.area_sqkm,
    wf.geometry,
    public.normalize_windfarm_name(wf.name) as normalized_name
  from public.windfarm_database wf
  where wf.status in ('Production', 'Construction', 'Operational', 'Under Construction')
),
spatial_candidates as (
  select
    t.wind_farm,
    pb.id as windfarm_id,
    count(*)::integer as turbines_covered
  from public.turbine_database t
  join eligible_boundaries pb
    on ST_Covers(pb.geometry, t.geometry)
  group by t.wind_farm, pb.id
),
name_candidates as (
  select
    tf.wind_farm,
    pb.id as windfarm_id
  from turbine_farms tf
  join eligible_boundaries pb
    on tf.normalized_wind_farm is not null
   and pb.normalized_name is not null
   and (
     tf.normalized_wind_farm = pb.normalized_name
     or pb.normalized_name like '%' || tf.normalized_wind_farm || '%'
     or tf.normalized_wind_farm like '%' || pb.normalized_name || '%'
   )
),
candidate_ids as (
  select wind_farm, windfarm_id from spatial_candidates
  union
  select wind_farm, windfarm_id from name_candidates
),
scored_candidates as (
  select
    tf.wind_farm as turbine_wind_farm,
    pb.id as windfarm_id,
    pb.name as windfarm_name,
    pb.status as windfarm_status,
    tf.total_turbines,
    coalesce(sc.turbines_covered, 0) as turbines_covered,
    round(coalesce(sc.turbines_covered, 0)::numeric / nullif(tf.total_turbines, 0), 4) as coverage_ratio,
    tf.turbine_country,
    pb.country as windfarm_country,
    coalesce(tf.turbine_country = pb.country, false) as country_match,
    case
      when tf.normalized_wind_farm = pb.normalized_name then 'exact'
      when pb.normalized_name like '%' || tf.normalized_wind_farm || '%' then 'boundary-contains-farm'
      when tf.normalized_wind_farm like '%' || pb.normalized_name || '%' then 'farm-contains-boundary'
      else 'spatial-only'
    end as name_match_type,
    case
      when tf.normalized_wind_farm = pb.normalized_name then 1
      when pb.normalized_name like '%' || tf.normalized_wind_farm || '%' then 2
      when tf.normalized_wind_farm like '%' || pb.normalized_name || '%' then 3
      else 4
    end as name_match_rank,
    pb.area_sqkm
  from candidate_ids ci
  join turbine_farms tf
    on tf.wind_farm = ci.wind_farm
  join eligible_boundaries pb
    on pb.id = ci.windfarm_id
  left join spatial_candidates sc
    on sc.wind_farm = ci.wind_farm
   and sc.windfarm_id = ci.windfarm_id
),
ranked_candidates as (
  select
    sc.*,
    row_number() over (
      partition by sc.turbine_wind_farm
      order by
        sc.name_match_rank,
        case when sc.coverage_ratio > 0 then 0 else 1 end,
        sc.coverage_ratio desc,
        coalesce(sc.area_sqkm, 1000000000) asc,
        sc.windfarm_id
    ) as auto_rank,
    case
      when sc.name_match_type = 'exact' then true
      when sc.coverage_ratio >= 0.5000 then true
      when sc.coverage_ratio > 0 and sc.name_match_type <> 'spatial-only' then true
      else false
    end as auto_selected
  from scored_candidates sc
),
upserted as (
  insert into public.turbine_windfarm_boundary_matches (
    turbine_wind_farm,
    windfarm_id,
    windfarm_name,
    windfarm_status,
    total_turbines,
    turbines_covered,
    coverage_ratio,
    turbine_country,
    windfarm_country,
    country_match,
    name_match_type,
    name_match_rank,
    auto_rank,
    auto_selected,
    generated_at,
    updated_at
  )
  select
    turbine_wind_farm,
    windfarm_id,
    windfarm_name,
    windfarm_status,
    total_turbines,
    turbines_covered,
    coverage_ratio,
    turbine_country,
    windfarm_country,
    country_match,
    name_match_type,
    name_match_rank,
    auto_rank,
    auto_selected,
    now(),
    now()
  from ranked_candidates
  on conflict (turbine_wind_farm, windfarm_id) do update
    set windfarm_name = excluded.windfarm_name,
        windfarm_status = excluded.windfarm_status,
        total_turbines = excluded.total_turbines,
        turbines_covered = excluded.turbines_covered,
        coverage_ratio = excluded.coverage_ratio,
        turbine_country = excluded.turbine_country,
        windfarm_country = excluded.windfarm_country,
        country_match = excluded.country_match,
        name_match_type = excluded.name_match_type,
        name_match_rank = excluded.name_match_rank,
        auto_rank = excluded.auto_rank,
        auto_selected = excluded.auto_selected,
        generated_at = excluded.generated_at,
        updated_at = now()
  returning turbine_wind_farm, windfarm_id
)
delete from public.turbine_windfarm_boundary_matches existing
where existing.manual_selection is null
  and not exists (
    select 1
    from upserted u
    where u.turbine_wind_farm = existing.turbine_wind_farm
      and u.windfarm_id = existing.windfarm_id
  );

create or replace view public.turbine_windfarm_boundary_links as
with selected_matches as (
  select
    m.*,
    case
      when m.manual_selection = 'selected' then 'manual'
      else 'automatic'
    end as selection_source
  from public.turbine_windfarm_boundary_matches m
  where m.manual_selection = 'selected'
     or (m.manual_selection is null and m.auto_selected)
),
ranked_links as (
  select
    t.id as turbine_id,
    t.wind_farm as turbine_wind_farm,
    t.country as turbine_country,
    wf.id as windfarm_id,
    wf.name as windfarm_name,
    wf.status as windfarm_status,
    sm.selection_source,
    sm.name_match_type,
    sm.coverage_ratio,
    sm.turbines_covered,
    sm.total_turbines,
    case
      when ST_Covers(wf.geometry, t.geometry) then 'covered-by-selected-boundary'
      else 'nearest-selected-boundary'
    end as link_method,
    row_number() over (
      partition by t.id
      order by
        case when ST_Covers(wf.geometry, t.geometry) then 0 else 1 end,
        sm.name_match_rank,
        sm.auto_rank,
        coalesce(wf.area_sqkm, 1000000000) asc,
        ST_Distance(t.geometry::geography, ST_PointOnSurface(wf.geometry)::geography),
        wf.id
    ) as link_rank
  from public.turbine_database t
  join selected_matches sm
    on sm.turbine_wind_farm = t.wind_farm
  join public.windfarm_database wf
    on wf.id = sm.windfarm_id
)
select
  turbine_id,
  turbine_wind_farm,
  turbine_country,
  windfarm_id,
  windfarm_name,
  windfarm_status,
  selection_source,
  name_match_type,
  coverage_ratio,
  turbines_covered,
  total_turbines,
  link_method
from ranked_links
where link_rank = 1;

commit;
`;

export const LINKAGE_SUMMARY_SQL = `
with selected_matches as (
  select *
  from public.turbine_windfarm_boundary_matches
  where manual_selection = 'selected'
     or (manual_selection is null and auto_selected)
),
resolved_links as (
  select *
  from public.turbine_windfarm_boundary_links
)
select 'candidate_rows' as metric, count(*)::text as value
from public.turbine_windfarm_boundary_matches
union all
select 'auto_selected_rows', count(*)::text
from public.turbine_windfarm_boundary_matches
where manual_selection is null and auto_selected
union all
select 'manual_selected_rows', count(*)::text
from public.turbine_windfarm_boundary_matches
where manual_selection = 'selected'
union all
select 'selected_candidate_rows', count(*)::text
from selected_matches
union all
select 'linked_turbines', count(*)::text
from resolved_links
union all
select 'unlinked_turbines', (
  select count(*)::text
  from public.turbine_database t
  where not exists (
    select 1 from resolved_links rl where rl.turbine_id = t.id
  )
)
union all
select 'linked_turbine_farms', count(distinct turbine_wind_farm)::text
from resolved_links
union all
select 'unlinked_turbine_farms', (
  select count(distinct t.wind_farm)::text
  from public.turbine_database t
  where not exists (
    select 1 from resolved_links rl where rl.turbine_id = t.id
  )
)
order by metric;
`;
