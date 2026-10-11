-- PacePath schema. Thresholds mirror src/core/rules.ts — keep them in sync.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  -- Personal pace model (from Strava or in-app history); null = use tier defaults.
  flat_5k_pace_s numeric,
  fatigue_exponent numeric,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  distance_m numeric not null check (distance_m >= 4828.032), -- 3 miles
  elevation_gain_m numeric not null default 0,
  equivalent_flat_m numeric not null,
  difficulty numeric not null check (difficulty between 1 and 10),
  start_lat double precision not null,
  start_lng double precision not null,
  -- Simplified polyline: [[lat, lng, ele|null], ...]
  path jsonb not null,
  completions integer not null default 0,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create index routes_public_idx on public.routes (is_public);
create index routes_creator_idx on public.routes (creator_id);

-- Only valid, finished attempts are stored. Paused/abandoned attempts never leave the device.
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  elapsed_s numeric not null check (elapsed_s > 0),
  pause_count integer not null default 0,
  finished_at timestamptz not null default now(),
  -- Client-generated id so retries after a dropped connection don't double-count.
  client_run_id text not null,
  unique (user_id, client_run_id)
);
create index attempts_route_time_idx on public.attempts (route_id, elapsed_s);

create table public.ratings (
  route_id uuid not null references public.routes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  -- How it felt vs. the estimate: -1 easier, 0 as expected, 1 harder.
  feel smallint check (feel between -1 and 1),
  updated_at timestamptz not null default now(),
  primary key (route_id, user_id)
);

create table public.saved_routes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  route_id uuid not null references public.routes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

-- Strava tokens are only ever touched by the `strava` edge function (service role).
create table public.strava_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Visibility & integrity

create function public.attempts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.routes;
begin
  select * into r from public.routes where id = new.route_id;
  if not found or not (r.is_public or r.creator_id = new.user_id) then
    raise exception 'route not available';
  end if;
  -- Sanity bound: nothing faster than 3:30/mi over the whole course.
  if new.elapsed_s < r.distance_m / 1609.344 * 210 then
    raise exception 'implausible time';
  end if;
  return new;
end $$;

create trigger attempts_before_insert before insert on public.attempts
for each row execute function public.attempts_before_insert();

-- Every valid completion counts; the route goes public at 10 miles or 5 completions.
create function public.attempts_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.routes
     set completions = completions + 1,
         is_public = is_public or distance_m >= 16093.44 or completions + 1 >= 5
   where id = new.route_id;
  return null;
end $$;

create trigger attempts_after_insert after insert on public.attempts
for each row execute function public.attempts_after_insert();

create function public.routes_before_insert() returns trigger
language plpgsql as $$
begin
  new.completions := 0;
  new.is_public := new.distance_m >= 16093.44;
  return new;
end $$;

create trigger routes_before_insert before insert on public.routes
for each row execute function public.routes_before_insert();

-- A finished free run becomes a route, and the run itself is its first completion.
create function public.create_route_from_run(
  p_name text,
  p_distance_m numeric,
  p_elevation_gain_m numeric,
  p_equivalent_flat_m numeric,
  p_difficulty numeric,
  p_path jsonb,
  p_elapsed_s numeric,
  p_client_run_id text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_start jsonb := p_path -> 0;
begin
  insert into public.routes (creator_id, name, distance_m, elevation_gain_m, equivalent_flat_m,
                             difficulty, start_lat, start_lng, path)
  values (auth.uid(), p_name, p_distance_m, p_elevation_gain_m, p_equivalent_flat_m,
          p_difficulty, (v_start ->> 0)::double precision, (v_start ->> 1)::double precision, p_path)
  returning id into v_id;

  insert into public.attempts (route_id, user_id, elapsed_s, client_run_id)
  values (v_id, auth.uid(), p_elapsed_s, p_client_run_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Read models

create view public.route_summaries with (security_invoker = true) as
select
  r.id, r.name, r.creator_id, r.distance_m, r.elevation_gain_m, r.equivalent_flat_m,
  r.difficulty, r.start_lat, r.start_lng, r.is_public, r.completions, r.created_at,
  rt.avg_rating, coalesce(rt.rating_count, 0) as rating_count,
  st.average_s,
  rec.elapsed_s as record_s,
  rec.user_id as record_user_id,
  p.display_name as record_holder
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

-- Each runner's best time per route (the leaderboard).
create view public.route_leaderboard with (security_invoker = true) as
select distinct on (a.route_id, a.user_id)
  a.route_id, a.user_id, p.display_name, a.elapsed_s, a.finished_at
from public.attempts a
join public.profiles p on p.id = a.user_id
order by a.route_id, a.user_id, a.elapsed_s, a.finished_at;

-- ---------------------------------------------------------------------------
-- Row level security

alter table public.profiles enable row level security;
alter table public.routes enable row level security;
alter table public.attempts enable row level security;
alter table public.ratings enable row level security;
alter table public.saved_routes enable row level security;
alter table public.strava_connections enable row level security;

create policy "profiles are readable" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create policy "visible routes" on public.routes for select to authenticated
  using (is_public or creator_id = auth.uid());
create policy "create own routes" on public.routes for insert to authenticated
  with check (creator_id = auth.uid());
create policy "rename own routes" on public.routes for update to authenticated
  using (creator_id = auth.uid());
create policy "delete own private routes" on public.routes for delete to authenticated
  using (creator_id = auth.uid() and not is_public);
-- Clients may only rename; counters and visibility are trigger-managed.
revoke update on public.routes from authenticated;
grant update (name) on public.routes to authenticated;

create policy "attempts on visible routes" on public.attempts for select to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and (r.is_public or r.creator_id = auth.uid())));
create policy "log own attempts" on public.attempts for insert to authenticated
  with check (user_id = auth.uid());

create policy "ratings on visible routes" on public.ratings for select to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and (r.is_public or r.creator_id = auth.uid())));
create policy "rate as self" on public.ratings for insert to authenticated with check (user_id = auth.uid());
create policy "re-rate as self" on public.ratings for update to authenticated using (user_id = auth.uid());

create policy "own saved routes" on public.saved_routes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- strava_connections: no policies → no client access.
