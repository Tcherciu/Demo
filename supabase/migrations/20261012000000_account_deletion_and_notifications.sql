-- 1. Account deletion (required by the App Store for apps with sign-up).
--    Deleting the auth user cascades to the profile and everything personal: attempts,
--    ratings, saved routes, Strava tokens, push tokens, notifications. Private routes go too.
--    Public routes stay for everyone else, no longer attributed to anyone.
-- 2. "Your record was beaten" notifications: device push tokens and an in-app list.

alter table public.routes drop constraint routes_creator_id_fkey;
alter table public.routes add constraint routes_creator_id_fkey
  foreign key (creator_id) references public.profiles (id) on delete set null;
alter table public.routes drop constraint routes_creator_or_curated;
alter table public.routes add constraint routes_creator_or_curated
  check (creator_id is not null or is_curated or is_public);

create function public.profiles_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.routes where creator_id = old.id and not is_public;
  return old;
end $$;

create trigger profiles_before_delete before delete on public.profiles
for each row execute function public.profiles_before_delete();

-- Keep the completions counter honest when attempts disappear with an account.
-- (A route that already went public stays public.)
create function public.attempts_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.routes set completions = greatest(completions - 1, 0) where id = old.route_id;
  return null;
end $$;

create trigger attempts_after_delete after delete on public.attempts
for each row execute function public.attempts_after_delete();

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('record_beaten')),
  route_id uuid references public.routes (id) on delete cascade,
  -- e.g. { "routeName": "...", "byName": "...", "newS": 1270, "oldS": 1308 }
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;

-- A device token belongs to whoever is signed in on that device now.
create policy "own push tokens" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid());
revoke insert, delete on public.notifications from authenticated, anon;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
