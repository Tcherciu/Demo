-- Runs imported from watches and other apps (Apple Health — Apple Watch, Garmin, etc. —
-- Strava, GPX files) count as course attempts once the server has verified them.
alter table public.attempts add column source text not null default 'app'
  check (source in ('app', 'apple_health', 'strava', 'gpx'));
-- When the same run arrives twice (phone + watch), the server keeps one attempt and
-- upgrades it to the watch's more accurate track.
create index attempts_user_route_time_idx on public.attempts (user_id, route_id, finished_at);
-- Strava webhook events identify the athlete, not our user.
create unique index strava_connections_athlete_idx on public.strava_connections (athlete_id);
