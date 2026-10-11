-- 1. Results only arrive through the `runs` edge function, which re-verifies the GPS track.
-- 2. Curated library routes (imported by admins from GPX) are public from day one.
-- 3. Each route records where its elevation data came from.

-- Curated routes have no creator.
alter table public.routes alter column creator_id drop not null;
alter table public.routes add column is_curated boolean not null default false;
alter table public.routes add constraint routes_creator_or_curated check (creator_id is not null or is_curated);
alter table public.routes add column elevation_source text not null default 'gps'
  check (elevation_source in ('gps', 'dem', 'gpx'));

-- Simplified GPS track kept with each verified attempt, for audits and disputes.
alter table public.attempts add column track jsonb;

create or replace function public.routes_before_insert() returns trigger
language plpgsql as $$
begin
  new.completions := 0;
  new.is_public := new.is_curated or new.distance_m >= 16093.44;
  return new;
end $$;

-- Clients can no longer write attempts or routes directly (only the verifier, as service_role).
drop policy "log own attempts" on public.attempts;
revoke insert, update, delete on public.attempts from authenticated, anon;
drop policy "create own routes" on public.routes;
revoke insert on public.routes from authenticated, anon;
-- Curated routes can't be deleted or renamed by anyone but the service role.
drop policy "rename own routes" on public.routes;
create policy "rename own routes" on public.routes for update to authenticated
  using (creator_id = auth.uid() and not is_curated);

drop function public.create_route_from_run(text, numeric, numeric, numeric, numeric, jsonb, numeric, text);

create function public.create_route_from_run(
  p_user_id uuid,
  p_name text,
  p_distance_m numeric,
  p_elevation_gain_m numeric,
  p_equivalent_flat_m numeric,
  p_difficulty numeric,
  p_path jsonb,
  p_elapsed_s numeric,
  p_client_run_id text,
  p_elevation_source text default 'gps'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_start jsonb := p_path -> 0;
begin
  insert into public.routes (creator_id, name, distance_m, elevation_gain_m, equivalent_flat_m,
                             difficulty, start_lat, start_lng, path, elevation_source)
  values (p_user_id, p_name, p_distance_m, p_elevation_gain_m, p_equivalent_flat_m,
          p_difficulty, (v_start ->> 0)::double precision, (v_start ->> 1)::double precision, p_path,
          p_elevation_source)
  returning id into v_id;

  insert into public.attempts (route_id, user_id, elapsed_s, client_run_id)
  values (v_id, p_user_id, p_elapsed_s, p_client_run_id);
  return v_id;
end $$;

revoke execute on function public.create_route_from_run(uuid, text, numeric, numeric, numeric, numeric, jsonb, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.create_route_from_run(uuid, text, numeric, numeric, numeric, numeric, jsonb, numeric, text, text)
  to service_role;

-- Expose the new columns to Browse (columns can only be appended to an existing view).
create or replace view public.route_summaries with (security_invoker = true) as
select
  r.id, r.name, r.creator_id, r.distance_m, r.elevation_gain_m, r.equivalent_flat_m,
  r.difficulty, r.start_lat, r.start_lng, r.is_public, r.completions, r.created_at,
  rt.avg_rating, coalesce(rt.rating_count, 0) as rating_count,
  st.average_s,
  rec.elapsed_s as record_s,
  rec.user_id as record_user_id,
  p.display_name as record_holder,
  r.is_curated,
  r.elevation_source
from public.routes r
left join lateral (
  select avg(stars)::numeric(3,2) as avg_rating, count(*) as rating_count
  from public.ratings where route_id = r.id
) rt on true
left join lateral (
  select avg(elapsed_s) as average_s from public.attempts where route_id = r.id
) st on true
left join lateral (
  select a.elapsed_s, a.user_id from public.attempts a
  where a.route_id = r.id order by a.elapsed_s, a.finished_at limit 1
) rec on true
left join public.profiles p on p.id = rec.user_id;
