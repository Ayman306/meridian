-- =============================================================================
-- Meridian — complete setup.
--
-- GENERATED FILE. Do not edit: change the migrations and run
--   node scripts/build-setup.mjs
--
-- Paste the whole thing into the Supabase SQL editor and run it once, on a
-- fresh project. It is the concatenation of:
--   supabase/migrations/0001_foundation.sql
--   supabase/migrations/0002_trips.sql
--   supabase/migrations/0003_itinerary.sql
--   supabase/migrations/0004_harden_function_grants.sql
--   supabase/migrations/0005_documents.sql
--   supabase/migrations/0006_dashboard.sql
--   supabase/migrations/0007_wishlist.sql
--   supabase/migrations/0008_destinations.sql
--   supabase/migrations/0009_allowance.sql
--   supabase/migrations/0010_flights.sql
--   supabase/migrations/0011_gallery.sql
--   supabase/migrations/0012_budget.sql
--   supabase/migrations/0013_settings_and_access.sql
--   supabase/migrations/0014_health.sql
--   supabase/migrations/0015_scheduling.sql
--   supabase/migrations/0016_airports.sql
--
-- Safe to re-run: every statement is idempotent or uses "or replace".
-- =============================================================================

-- ===========================================================================
-- 0001_foundation.sql
-- ===========================================================================

-- =============================================================================
-- 0001_foundation — profiles, couples, couple_members, and the RLS primitives
-- every later migration depends on. Spec: Part 0.3, 0.4 and Module 1.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- updated_at trigger, applied to every table that has the column
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- couples
-- -----------------------------------------------------------------------------
create table if not exists public.couples (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  anniversary_date  date,
  invite_code       text unique,
  invite_expires_at timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists couples_updated_at on public.couples;
create trigger couples_updated_at
  before update on public.couples
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user, created by trigger on signup
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text,
  avatar_url         text,
  home_city          text,
  home_country       text,
  home_lat           numeric,
  home_lng           numeric,
  timezone           text not null default 'UTC',   -- IANA, never an offset
  nationality        text,                          -- ISO 3166-1 alpha-2
  second_nationality text,
  accent_color       text not null default 'amber',
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- couple_members — exactly two, enforced by trigger
-- -----------------------------------------------------------------------------
create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- A user belongs to at most one couple. This is what makes partner_id()
-- single-valued and every couple-scoped policy unambiguous.
create unique index if not exists couple_members_one_couple_per_user
  on public.couple_members (user_id);

create or replace function public.enforce_couple_size()
returns trigger language plpgsql
set search_path = public as $$
begin
  if (select count(*) from public.couple_members where couple_id = new.couple_id) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;
  return new;
end $$;

drop trigger if exists couple_size_check on public.couple_members;
create trigger couple_size_check
  before insert on public.couple_members
  for each row execute function public.enforce_couple_size();

-- -----------------------------------------------------------------------------
-- The two functions every policy in the app is built on.
-- SECURITY DEFINER so they can read couple_members without recursing through
-- that table's own RLS policies.
-- -----------------------------------------------------------------------------
create or replace function public.is_couple_member(target uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.partner_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select cm2.user_id
  from public.couple_members cm1
  join public.couple_members cm2 on cm1.couple_id = cm2.couple_id
  where cm1.user_id = auth.uid() and cm2.user_id <> auth.uid()
  limit 1;
$$;

-- The caller's couple, or null in solo mode. Saves a round trip everywhere.
create or replace function public.my_couple_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid() limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Profile auto-creation on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.profiles       enable row level security;
alter table public.couples        enable row level security;
alter table public.couple_members enable row level security;

-- profiles: yourself, and your partner. Nobody else, ever.
drop policy if exists "profiles read self" on public.profiles;
create policy "profiles read self" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles read partner" on public.profiles;
create policy "profiles read partner" on public.profiles
  for select using (id = public.partner_id());

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- couples: members read and update. Creation goes through create_couple().
drop policy if exists "couples read" on public.couples;
create policy "couples read" on public.couples
  for select using (public.is_couple_member(id));

drop policy if exists "couples update" on public.couples;
create policy "couples update" on public.couples
  for update using (public.is_couple_member(id))
          with check (public.is_couple_member(id));

drop policy if exists "couples insert" on public.couples;
create policy "couples insert" on public.couples
  for insert with check (created_by = auth.uid());

-- couple_members: you may read rows of your own couple, and delete your own
-- membership ("leave couple"). Joining goes through join_couple().
drop policy if exists "couple_members read" on public.couple_members;
create policy "couple_members read" on public.couple_members
  for select using (public.is_couple_member(couple_id));

drop policy if exists "couple_members leave" on public.couple_members;
create policy "couple_members leave" on public.couple_members
  for delete using (user_id = auth.uid());

-- =============================================================================
-- Invite codes
-- =============================================================================

-- 8 chars from an alphabet with no I, L, O, 0 or 1 — these get misread when
-- one partner reads the code aloud over a call.
create or replace function public.generate_invite_code()
returns text language plpgsql
set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = candidate);
  end loop;
  return candidate;
end $$;

-- Create a couple and become its first member, atomically.
create or replace function public.create_couple(couple_name text default null)
returns public.couples language plpgsql security definer
set search_path = public as $$
declare
  row public.couples;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'ALREADY_PAIRED';
  end if;

  insert into public.couples (name, invite_code, invite_expires_at, created_by)
  values (couple_name, public.generate_invite_code(), now() + interval '7 days', auth.uid())
  returning * into row;

  insert into public.couple_members (couple_id, user_id) values (row.id, auth.uid());
  return row;
end $$;

-- Join by code. Single transactional RPC — never validate this client-side.
create or replace function public.join_couple(code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  expires timestamptz;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'ALREADY_PAIRED';
  end if;

  select id, invite_expires_at into target, expires
  from public.couples
  where invite_code = upper(trim(code))
  for update;

  if target is null then raise exception 'INVALID_CODE'; end if;
  if expires is null or expires <= now() then raise exception 'EXPIRED_CODE'; end if;

  if (select count(*) from public.couple_members where couple_id = target) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  insert into public.couple_members (couple_id, user_id) values (target, auth.uid());

  -- The code is single-use; a third account must not be able to reuse it.
  update public.couples set invite_code = null, invite_expires_at = null where id = target;

  return target;
end $$;

-- Only a member may mint a new code, and only while the couple is not full.
create or replace function public.regenerate_invite_code()
returns text language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  fresh  text;
begin
  select couple_id into target from public.couple_members where user_id = auth.uid();
  if target is null then raise exception 'NOT_A_MEMBER'; end if;

  if (select count(*) from public.couple_members where couple_id = target) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  fresh := public.generate_invite_code();
  update public.couples
     set invite_code = fresh, invite_expires_at = now() + interval '7 days'
   where id = target;
  return fresh;
end $$;

-- Leaving is destructive and confirmed twice in the UI. Shared rows stay with
-- the couple; the departing user simply loses access via RLS.
create or replace function public.leave_couple()
returns void language plpgsql security definer
set search_path = public as $$
begin
  delete from public.couple_members where user_id = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- Health endpoint for the keep-alive cron (free-tier projects pause at ~7 days
-- idle). Callable by anon so a GitHub Action can hit it with the anon key.
-- -----------------------------------------------------------------------------
create or replace function public.health()
returns jsonb language sql stable
set search_path = public as $$
  select jsonb_build_object('ok', true, 'at', now());
$$;

grant execute on function public.health() to anon, authenticated;
grant execute on function public.create_couple(text)      to authenticated;
grant execute on function public.join_couple(text)        to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;
grant execute on function public.leave_couple()           to authenticated;
grant execute on function public.is_couple_member(uuid)   to authenticated;
grant execute on function public.partner_id()             to authenticated;
grant execute on function public.my_couple_id()           to authenticated;


-- ===========================================================================
-- 0002_trips.sql
-- ===========================================================================

-- =============================================================================
-- 0002_trips — the container everything else attaches to. Spec: Module 3.
-- Deliberately permissive: a trip needs only a title.
-- =============================================================================

create table if not exists public.trip_statuses (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  name        text not null,
  color       text,
  sort_order  int not null default 0,
  is_terminal boolean not null default false,   -- Completed, Cancelled
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (couple_id, name)
);

create table if not exists public.trips (
  id              uuid primary key default gen_random_uuid(),
  couple_id       uuid not null references public.couples(id) on delete cascade,
  title           text not null,
  start_date      date,
  end_date        date,
  date_precision  text not null default 'unknown',
  is_open_ended   boolean not null default false,
  timezone        text,                          -- destination tz, set on choose
  status_id       uuid references public.trip_statuses(id) on delete set null,
  cover_media_id  uuid,                          -- FK added with Gallery
  notes           text,
  custom          jsonb not null default '{}',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint valid_range check (
    start_date is null or end_date is null or end_date >= start_date
  ),
  constraint valid_precision check (
    date_precision in ('exact', 'month', 'season', 'year', 'unknown')
  )
);

create table if not exists public.trip_travelers (
  trip_id        uuid not null references public.trips(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  origin_airport text,
  arrival_date   date,
  departure_date date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.trip_days (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  date       date not null,
  day_type   text not null default 'open',
  title      text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, date),
  constraint valid_day_type check (
    day_type in ('travel', 'planned', 'open', 'rest', 'work')
  )
);

create index if not exists trips_couple_start_idx on public.trips (couple_id, start_date);
create index if not exists trips_live_idx on public.trips (couple_id) where deleted_at is null;
create index if not exists trip_days_trip_date_idx on public.trip_days (trip_id, date);

drop trigger if exists trip_statuses_updated_at on public.trip_statuses;
create trigger trip_statuses_updated_at before update on public.trip_statuses
  for each row execute function public.set_updated_at();
drop trigger if exists trips_updated_at on public.trips;
create trigger trips_updated_at before update on public.trips
  for each row execute function public.set_updated_at();
drop trigger if exists trip_travelers_updated_at on public.trip_travelers;
create trigger trip_travelers_updated_at before update on public.trip_travelers
  for each row execute function public.set_updated_at();
drop trigger if exists trip_days_updated_at on public.trip_days;
create trigger trip_days_updated_at before update on public.trip_days
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — written before any screen exists
-- =============================================================================
alter table public.trip_statuses  enable row level security;
alter table public.trips          enable row level security;
alter table public.trip_travelers enable row level security;
alter table public.trip_days      enable row level security;

drop policy if exists "couple read" on public.trip_statuses;
create policy "couple read" on public.trip_statuses
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.trip_statuses;
create policy "couple write" on public.trip_statuses
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.trips;
create policy "couple read" on public.trips
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.trips;
create policy "couple write" on public.trips
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- trip_travelers and trip_days have no couple_id of their own; they inherit
-- access from their trip.
drop policy if exists "couple read" on public.trip_travelers;
create policy "couple read" on public.trip_travelers
  for select using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));
drop policy if exists "couple write" on public.trip_travelers;
create policy "couple write" on public.trip_travelers
  for all using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  )) with check (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));

drop policy if exists "couple read" on public.trip_days;
create policy "couple read" on public.trip_days
  for select using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));
drop policy if exists "couple write" on public.trip_days;
create policy "couple write" on public.trip_days
  for all using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  )) with check (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));

-- =============================================================================
-- Seeding
-- =============================================================================

-- Statuses are per-couple so they can be renamed later without touching anyone
-- else's. Seeded on demand rather than by trigger, so a couple created before
-- this migration also gets them.
create or replace function public.seed_trip_statuses(target uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_couple_member(target) then raise exception 'NOT_A_MEMBER'; end if;

  insert into public.trip_statuses (couple_id, name, color, sort_order, is_terminal)
  values
    (target, 'Idea',      'slate',  0, false),
    (target, 'Planning',  'amber',  1, false),
    (target, 'Booked',    'sky',    2, false),
    (target, 'Active',    'teal',   3, false),
    (target, 'Completed', 'green',  4, true),
    (target, 'Cancelled', 'rose',   5, true)
  on conflict (couple_id, name) do nothing;
end $$;

-- =============================================================================
-- Day scaffolding
--
-- Generating days is set logic, and doing it client-side means N round trips
-- and a race when both partners edit dates at once. One RPC, one transaction.
--
-- Shortening never silently destroys planned days: the caller asks what would
-- be removed first (trip_days_at_risk), prompts, and only then confirms.
-- =============================================================================
create or replace function public.sync_trip_days(target uuid)
returns int language plpgsql security definer
set search_path = public as $$
declare
  t public.trips;
  horizon date;
  removed int;
begin
  select * into t from public.trips where id = target;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  -- No start date means no day grid at all; the itinerary is a pure idea pool.
  if t.start_date is null then
    delete from public.trip_days where trip_id = target;
    return 0;
  end if;

  -- Open-ended trips render a rolling 30 days forward (spec 3.6).
  horizon := coalesce(t.end_date, t.start_date + 30);

  insert into public.trip_days (trip_id, date)
  select target, d::date
  from generate_series(t.start_date, horizon, interval '1 day') d
  on conflict (trip_id, date) do nothing;

  delete from public.trip_days
   where trip_id = target and (date < t.start_date or date > horizon);
  get diagnostics removed = row_count;

  return removed;
end $$;

grant execute on function public.seed_trip_statuses(uuid) to authenticated;
grant execute on function public.sync_trip_days(uuid)     to authenticated;


-- ===========================================================================
-- 0003_itinerary.sql
-- ===========================================================================

-- =============================================================================
-- 0003_itinerary — the planning surface. Spec: Module 5.
--
-- Scheduling is optional. An unscheduled pile of ideas is a first-class state,
-- which is why every scheduling column is nullable.
-- =============================================================================

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  name       text not null,
  icon       text,
  color      text,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, name)
);

create table if not exists public.itinerary_items (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples(id) on delete cascade,
  trip_id        uuid not null references public.trips(id) on delete cascade,
  title          text not null,

  -- All nullable: null scheduled_date means the item lives in the idea pool.
  scheduled_date date,
  start_time     time,
  end_time       time,
  duration_minutes int,

  destination_id uuid,           -- FK added with Destinations (Module 4)
  place_name     text,
  lat            numeric,
  lng            numeric,
  address        text,
  maps_url       text,

  category_id    uuid references public.categories(id) on delete set null,
  notes          text,
  url            text,
  cost_estimate  numeric,
  currency       text,

  proposed_by    uuid references public.profiles(id),   -- whose pick
  source         text not null default 'manual',        -- manual|wishlist|blend|ai
  state          text not null default 'idea',          -- idea|accepted|booked|done|skipped

  sort_key       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint valid_source check (source in ('manual', 'wishlist', 'blend', 'ai')),
  constraint valid_state  check (state in ('idea', 'accepted', 'booked', 'done', 'skipped')),
  -- A time with no date is meaningless: "8pm" on no particular day.
  constraint time_needs_date check (start_time is null or scheduled_date is not null)
);

create table if not exists public.suggestion_tray (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  trip_id      uuid references public.trips(id) on delete cascade,
  payload      jsonb not null,
  source       text,                          -- 'blend' | 'ai'
  generated_at timestamptz not null default now(),
  accepted_at  timestamptz,
  dismissed_at timestamptz
);

create index if not exists itinerary_day_idx
  on public.itinerary_items (trip_id, scheduled_date, sort_key)
  where deleted_at is null;

create index if not exists itinerary_pool_idx
  on public.itinerary_items (trip_id, sort_key)
  where scheduled_date is null and deleted_at is null;

create index if not exists suggestion_tray_open_idx
  on public.suggestion_tray (trip_id)
  where accepted_at is null and dismissed_at is null;

drop trigger if exists categories_updated_at on public.categories;
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
drop trigger if exists itinerary_items_updated_at on public.itinerary_items;
create trigger itinerary_items_updated_at before update on public.itinerary_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.categories      enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.suggestion_tray enable row level security;

drop policy if exists "couple read" on public.categories;
create policy "couple read" on public.categories
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.categories;
create policy "couple write" on public.categories
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.itinerary_items;
create policy "couple read" on public.itinerary_items
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.itinerary_items;
create policy "couple write" on public.itinerary_items
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.suggestion_tray;
create policy "couple read" on public.suggestion_tray
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.suggestion_tray;
create policy "couple write" on public.suggestion_tray
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Seeding
-- =============================================================================
create or replace function public.seed_categories(target uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_couple_member(target) then raise exception 'NOT_A_MEMBER'; end if;

  insert into public.categories (couple_id, name, icon, color, is_default, sort_order)
  values
    (target, 'Food',      'utensils',   'amber',  true, 0),
    (target, 'Sight',     'landmark',   'sky',    true, 1),
    (target, 'Activity',  'compass',    'teal',   true, 2),
    (target, 'Transport', 'train',      'slate',  true, 3),
    (target, 'Stay',      'bed',        'violet', true, 4),
    (target, 'Admin',     'file-text',  'zinc',   true, 5),
    (target, 'Rest',      'moon',       'stone',  true, 6)
  on conflict (couple_id, name) do nothing;
end $$;

-- =============================================================================
-- Day type auto-assignment
--
-- A day gains its first item and becomes "planned" — but only if it is
-- currently "open". A manually set rest or work day is never demoted. Running
-- this in a trigger rather than the client means it holds however the item got
-- there: drag, bulk move, or an accepted suggestion.
-- =============================================================================
create or replace function public.promote_day_on_item()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.scheduled_date is null or new.deleted_at is not null then
    return new;
  end if;

  insert into public.trip_days (trip_id, date, day_type)
  values (new.trip_id, new.scheduled_date, 'planned')
  on conflict (trip_id, date) do update
    set day_type = case when public.trip_days.day_type = 'open'
                        then 'planned'
                        else public.trip_days.day_type end;
  return new;
end $$;

drop trigger if exists itinerary_promotes_day on public.itinerary_items;
create trigger itinerary_promotes_day
  after insert or update of scheduled_date on public.itinerary_items
  for each row execute function public.promote_day_on_item();

-- =============================================================================
-- Which days carry items — asked before shortening a trip, so the prompt can
-- name what would be lost (spec 3.3).
-- =============================================================================
create or replace function public.trip_item_counts_by_day(target uuid)
returns table (date date, item_count bigint)
language sql security definer stable
set search_path = public as $$
  select i.scheduled_date, count(*)
  from public.itinerary_items i
  join public.trips t on t.id = i.trip_id
  where i.trip_id = target
    and i.scheduled_date is not null
    and i.deleted_at is null
    and public.is_couple_member(t.couple_id)
  group by i.scheduled_date;
$$;

-- =============================================================================
-- Shortening a trip must not destroy work.
--
-- 0002's sync_trip_days() deletes days that fall outside the new range. Now
-- that items can be attached to those days, the items are unscheduled back to
-- the idea pool first — they lose their slot, never their content. Replacing
-- the function here keeps the whole operation in one transaction.
-- =============================================================================
create or replace function public.sync_trip_days(target uuid)
returns int language plpgsql security definer
set search_path = public as $$
declare
  t public.trips;
  horizon date;
  removed int;
begin
  select * into t from public.trips where id = target;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  if t.start_date is null then
    -- No dates at all: the itinerary becomes a pure idea pool.
    update public.itinerary_items
       set scheduled_date = null, start_time = null, end_time = null
     where trip_id = target and scheduled_date is not null;
    delete from public.trip_days where trip_id = target;
    return 0;
  end if;

  horizon := coalesce(t.end_date, t.start_date + 30);

  insert into public.trip_days (trip_id, date)
  select target, d::date
  from generate_series(t.start_date, horizon, interval '1 day') d
  on conflict (trip_id, date) do nothing;

  update public.itinerary_items
     set scheduled_date = null, start_time = null, end_time = null
   where trip_id = target
     and scheduled_date is not null
     and (scheduled_date < t.start_date or scheduled_date > horizon);

  delete from public.trip_days
   where trip_id = target and (date < t.start_date or date > horizon);
  get diagnostics removed = row_count;

  return removed;
end $$;

grant execute on function public.seed_categories(uuid)          to authenticated;
grant execute on function public.trip_item_counts_by_day(uuid)  to authenticated;
grant execute on function public.sync_trip_days(uuid)           to authenticated;


-- ===========================================================================
-- 0004_harden_function_grants.sql
-- ===========================================================================

-- =============================================================================
-- 0004_harden_function_grants — narrow the RPC surface to what is actually used.
--
-- Found by Supabase's database linter after 0001-0003 were applied to a real
-- project. Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- `anon` inherits PUBLIC — so every helper and trigger function was reachable
-- unauthenticated at /rest/v1/rpc/<name>. The earlier migrations granted to
-- `authenticated` but never revoked the default, which does nothing on its own.
--
-- Nothing was exploitable: every one of these either checks `auth.uid()`, goes
-- through is_couple_member(), or is a trigger function that fails without a NEW
-- record. But an unauthenticated caller had no business seeing them at all, and
-- "not exploitable today" is a weak thing to rely on as the app grows.
--
-- Functions are named one by one rather than with ALL FUNCTIONS IN SCHEMA,
-- because that would also strip Supabase's own platform functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pin the search_path on the one function that was missing it.
--
-- set_updated_at runs as invoker so the risk is small, but a mutable
-- search_path in a trigger means the function resolves `now()` against whatever
-- the caller's path happens to be. Pin it and qualify the call.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Trigger functions: never callable directly. A trigger fires as its owner
-- regardless of EXECUTE grants, so revoking costs nothing.
-- -----------------------------------------------------------------------------
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.handle_new_user()       from public, anon, authenticated;
revoke all on function public.enforce_couple_size()   from public, anon, authenticated;
revoke all on function public.promote_day_on_item()   from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal helper: only ever called from inside create_couple(), which is
-- SECURITY DEFINER and so does not need the caller to hold this grant.
-- -----------------------------------------------------------------------------
revoke all on function public.generate_invite_code() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Everything else: revoke the PUBLIC default, then grant back deliberately.
-- -----------------------------------------------------------------------------
revoke all on function public.is_couple_member(uuid)          from public, anon;
revoke all on function public.partner_id()                    from public, anon;
revoke all on function public.my_couple_id()                  from public, anon;
revoke all on function public.create_couple(text)             from public, anon;
revoke all on function public.join_couple(text)               from public, anon;
revoke all on function public.regenerate_invite_code()        from public, anon;
revoke all on function public.leave_couple()                  from public, anon;
revoke all on function public.seed_trip_statuses(uuid)        from public, anon;
revoke all on function public.seed_categories(uuid)           from public, anon;
revoke all on function public.sync_trip_days(uuid)            from public, anon;
revoke all on function public.trip_item_counts_by_day(uuid)   from public, anon;

grant execute on function public.is_couple_member(uuid)        to authenticated;
grant execute on function public.partner_id()                  to authenticated;
grant execute on function public.my_couple_id()                to authenticated;
grant execute on function public.create_couple(text)           to authenticated;
grant execute on function public.join_couple(text)             to authenticated;
grant execute on function public.regenerate_invite_code()      to authenticated;
grant execute on function public.leave_couple()                to authenticated;
grant execute on function public.seed_trip_statuses(uuid)      to authenticated;
grant execute on function public.seed_categories(uuid)         to authenticated;
grant execute on function public.sync_trip_days(uuid)          to authenticated;
grant execute on function public.trip_item_counts_by_day(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- health() is the one function that is meant to be anonymous: the keep-alive
-- cron calls it without a session. It returns a timestamp and nothing else.
-- -----------------------------------------------------------------------------
revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- And stop the default from reappearing on functions added by later migrations.
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;


-- ===========================================================================
-- 0005_documents.sql
-- ===========================================================================

-- =============================================================================
-- 0005_documents — the vault and the expiry engine. Spec: Module 8.
--
-- The RLS here is the most nuanced in the app so far. Every other table is
-- couple-scoped: if you are a member, you see it. Documents are not. A
-- document is readable by its owner always, and by the partner only while
-- `is_shared` is true — so revoking sharing has to make it vanish from the
-- other person's view immediately, which means the policy has to encode it
-- rather than the UI filtering it out.
-- =============================================================================

create table if not exists public.document_types (
  id               uuid primary key default gen_random_uuid(),
  couple_id        uuid not null references public.couples(id) on delete cascade,
  name             text not null,
  has_expiry       boolean not null default true,
  requires_country boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (couple_id, name)
);

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  type_id       uuid references public.document_types(id) on delete set null,
  label         text not null,
  country_code  text,

  -- NEVER the full number. Enough to identify which passport, and useless to
  -- anyone who sees it.
  number_last4  text,

  issued_on     date,
  expires_on    date,

  -- Private bucket only. Signed URLs, 300s, generated on demand.
  storage_path  text,
  file_name     text,
  file_size     int,
  mime_type     text,

  is_shared     boolean not null default true,
  notes         text,

  -- Which expiry threshold the owner has already been told about, so the
  -- daily sweep alerts once per threshold instead of every morning.
  last_alerted_threshold text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint number_last4_is_short check (number_last4 is null or length(number_last4) <= 4),
  constraint valid_dates check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

create table if not exists public.trip_document_requirements (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type_id     uuid not null references public.document_types(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  is_manual   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, user_id, type_id)
);

create index if not exists documents_expiry_idx
  on public.documents (couple_id, expires_on)
  where deleted_at is null;

create index if not exists documents_owner_idx
  on public.documents (owner_id)
  where deleted_at is null;

drop trigger if exists document_types_updated_at on public.document_types;
create trigger document_types_updated_at before update on public.document_types
  for each row execute function public.set_updated_at();
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
drop trigger if exists trip_document_requirements_updated_at on public.trip_document_requirements;
create trigger trip_document_requirements_updated_at before update on public.trip_document_requirements
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.document_types             enable row level security;
alter table public.documents                  enable row level security;
alter table public.trip_document_requirements enable row level security;

-- Types are shared vocabulary, couple-scoped like everything else.
drop policy if exists "couple read" on public.document_types;
create policy "couple read" on public.document_types
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.document_types;
create policy "couple write" on public.document_types
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Documents: yours always, your partner's only while they share it.
drop policy if exists "read own or shared" on public.documents;
create policy "read own or shared" on public.documents
  for select using (
    owner_id = auth.uid()
    or (public.is_couple_member(couple_id) and is_shared = true)
  );

-- Writes are owner-only, in both directions: you cannot edit your partner's
-- documents, and you cannot create one in their name.
drop policy if exists "write own" on public.documents;
create policy "write own" on public.documents
  for all using (owner_id = auth.uid())
      with check (owner_id = auth.uid() and public.is_couple_member(couple_id));

-- Requirements are about the trip, not the document, so they follow the trip.
drop policy if exists "couple read" on public.trip_document_requirements;
create policy "couple read" on public.trip_document_requirements
  for select using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));
drop policy if exists "couple write" on public.trip_document_requirements;
create policy "couple write" on public.trip_document_requirements
  for all using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  )) with check (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));

-- =============================================================================
-- Storage — private bucket, signed URLs only (non-negotiable #3)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'docs',
  'docs',
  false,
  10485760,  -- 10 MB, matching the client-side cap
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path is {couple_id}/{owner_id}/{document_id}/{filename}, so folder[1] is the
-- couple and folder[2] is the owner.
drop policy if exists "docs read own or shared" on storage.objects;
create policy "docs read own or shared" on storage.objects
  for select using (
    bucket_id = 'docs'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and (
      ((storage.foldername(name))[2])::uuid = auth.uid()
      or exists (
        select 1 from public.documents d
        where d.storage_path = storage.objects.name
          and d.is_shared = true
          and d.deleted_at is null
      )
    )
  );

-- You may only write into your own folder, inside your own couple.
drop policy if exists "docs write own" on storage.objects;
create policy "docs write own" on storage.objects
  for insert with check (
    bucket_id = 'docs'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

drop policy if exists "docs update own" on storage.objects;
create policy "docs update own" on storage.objects
  for update using (
    bucket_id = 'docs' and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

drop policy if exists "docs delete own" on storage.objects;
create policy "docs delete own" on storage.objects
  for delete using (
    bucket_id = 'docs' and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

-- =============================================================================
-- Seeding
--
-- requires_country marks the types that are meaningless without one: a visa is
-- always a visa *for* somewhere. The form makes the field required for these.
-- =============================================================================
create or replace function public.seed_document_types(target uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_couple_member(target) then raise exception 'NOT_A_MEMBER'; end if;

  insert into public.document_types (couple_id, name, has_expiry, requires_country, sort_order)
  values
    (target, 'Passport',         true,  true,  0),
    (target, 'Visa',             true,  true,  1),
    (target, 'eTA/ESTA',         true,  true,  2),
    (target, 'PR Card',          true,  true,  3),
    (target, 'Travel Insurance', true,  false, 4),
    (target, 'Vaccination',      false, false, 5),
    (target, 'Driving Licence',  true,  false, 6),
    (target, 'Booking',          false, false, 7),
    (target, 'Other',            false, false, 8)
  on conflict (couple_id, name) do nothing;
end $$;

-- =============================================================================
-- Trip readiness
--
-- The rule that makes this worth doing in SQL rather than the client: a
-- document that expires *before the trip ends* does not satisfy the
-- requirement. Checking against today instead of trip.end_date is the obvious
-- mistake and it fails silently — you would be told you are ready for a trip
-- your passport does not cover.
--
-- Requirements are the union of what has been recorded for the trip and a
-- passport for each traveller, which is always needed and never worth making
-- someone add by hand.
-- =============================================================================
create or replace function public.trip_readiness(target uuid)
returns table (
  user_id       uuid,
  type_id       uuid,
  type_name     text,
  is_manual     boolean,
  document_id   uuid,
  expires_on    date,
  satisfied     boolean
)
language plpgsql security definer stable
set search_path = public as $$
declare
  t public.trips;
begin
  select * into t from public.trips where id = target;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  return query
  with travellers as (
    select tt.user_id from public.trip_travelers tt where tt.trip_id = target
    union
    select cm.user_id from public.couple_members cm where cm.couple_id = t.couple_id
  ),
  passport_type as (
    select dt.id from public.document_types dt
    where dt.couple_id = t.couple_id and dt.name = 'Passport'
    limit 1
  ),
  required as (
    -- A passport, for everyone, always.
    select tr.user_id, pt.id as type_id, false as is_manual
    from travellers tr cross join passport_type pt
    union
    -- Plus anything recorded against this trip.
    select r.user_id, r.type_id, r.is_manual
    from public.trip_document_requirements r
    where r.trip_id = target
  )
  select
    req.user_id,
    req.type_id,
    dt.name,
    bool_or(req.is_manual),
    (array_agg(d.id order by d.expires_on desc nulls first))[1],
    max(d.expires_on),
    bool_or(d.id is not null)
  from required req
  join public.document_types dt on dt.id = req.type_id
  left join public.documents d
    on d.owner_id = req.user_id
   and d.type_id  = req.type_id
   and d.deleted_at is null
   -- The whole point: valid *through the end of the trip*, not merely today.
   and (d.expires_on is null or d.expires_on >= coalesce(t.end_date, t.start_date, current_date))
  group by req.user_id, req.type_id, dt.name;
end $$;

grant execute on function public.seed_document_types(uuid) to authenticated;
grant execute on function public.trip_readiness(uuid)      to authenticated;


-- ===========================================================================
-- 0006_dashboard.sql
-- ===========================================================================

-- =============================================================================
-- 0006_dashboard — one RPC, one round trip. Spec: Module 2.
--
-- The dashboard is the most-visited screen in the app and reads from five
-- tables. Spec 2.4 asks for it as a single Postgres function returning one JSON
-- payload rather than six client queries, and 2.7 makes "loads in one network
-- request" an acceptance criterion.
--
-- What is *not* here, deliberately: anything timezone-dependent. Countdowns,
-- the days-together year boundary and "is it travel day yet" all depend on
-- whose midnight is being asked about, and the database does not know who is
-- looking. It returns dates and counts; `modules/dashboard/logic.ts` resolves
-- them against the viewer's zone. Spec 2.6 is explicit that the year boundary
-- uses the viewer's timezone.
-- =============================================================================

create or replace function public.dashboard()
returns jsonb language plpgsql security definer stable
set search_path = public as $$
declare
  me       uuid := auth.uid();
  my_couple uuid;
  result   jsonb;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select couple_id into my_couple from public.couple_members where user_id = me;
  if my_couple is null then
    -- Solo mode is a real state, not an error. Say so plainly.
    return jsonb_build_object('paired', false);
  end if;

  select jsonb_build_object(
    'paired', true,
    'couple_id', my_couple,

    -- The next trip with a real start date, whatever its precision. The client
    -- decides whether to show a countdown, since only 'exact' earns one.
    'next_trip', (
      select to_jsonb(x) from (
        select t.id, t.title, t.start_date, t.end_date, t.date_precision,
               t.is_open_ended, t.timezone,
               s.name as status_name
        from public.trips t
        left join public.trip_statuses s on s.id = t.status_id
        where t.couple_id = my_couple
          and t.deleted_at is null
          and t.start_date is not null
          and coalesce(t.end_date, t.start_date) >= current_date - 1
        order by t.start_date asc
        limit 1
      ) x
    ),

    -- A trip being planned with no dates at all — what the countdown block
    -- falls back to before it can count anything.
    'planning_trip', (
      select to_jsonb(x) from (
        select t.id, t.title, t.updated_at
        from public.trips t
        where t.couple_id = my_couple
          and t.deleted_at is null
          and t.start_date is null
        order by t.updated_at desc
        limit 1
      ) x
    ),

    -- Per-traveller dates for the next trip, so the client can work out
    -- whether today is a travel day for either of them.
    'travellers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', tt.user_id,
        'arrival_date', tt.arrival_date,
        'departure_date', tt.departure_date,
        'origin_airport', tt.origin_airport
      ))
      from public.trip_travelers tt
      join public.trips t on t.id = tt.trip_id
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is not null
        and coalesce(t.end_date, t.start_date) >= current_date - 1
        and t.id = (
          select t2.id from public.trips t2
          where t2.couple_id = my_couple and t2.deleted_at is null
            and t2.start_date is not null
            and coalesce(t2.end_date, t2.start_date) >= current_date - 1
          order by t2.start_date asc limit 1
        )
    ), '[]'::jsonb),

    -- Every past and present trip that could contribute nights together. The
    -- overlap arithmetic happens client-side because "this year" depends on
    -- the viewer's timezone (spec 2.6).
    'together_windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trip_id', t.id,
        'start_date', t.start_date,
        'end_date', t.end_date,
        'travellers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', tt.user_id,
            'arrival_date', tt.arrival_date,
            'departure_date', tt.departure_date
          )), '[]'::jsonb)
          from public.trip_travelers tt where tt.trip_id = t.id
        )
      ))
      from public.trips t
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is not null
        and t.start_date <= current_date
    ), '[]'::jsonb),

    -- Documents that are close enough to expiry to be worth a word. The
    -- passport threshold is wider (9 months, spec 8.3) because most countries
    -- want six months' validity *beyond entry*, so a passport that looks fine
    -- today can be a problem by the time you travel.
    'expiring_documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'label', d.label,
        'owner_id', d.owner_id,
        'type_name', dt.name,
        'expires_on', d.expires_on,
        'is_passport', (dt.name = 'Passport')
      ) order by d.expires_on asc)
      from public.documents d
      left join public.document_types dt on dt.id = d.type_id
      where d.couple_id = my_couple
        and d.deleted_at is null
        and d.expires_on is not null
        and (d.owner_id = me or d.is_shared = true)
        and d.expires_on <= current_date + case when dt.name = 'Passport' then 275 else 90 end
    ), '[]'::jsonb),

    -- Trips sitting in a planning status long after they were last touched.
    -- A gentle nudge, the lowest-priority alert (spec 2.2).
    'stale_trips', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'updated_at', t.updated_at))
      from public.trips t
      left join public.trip_statuses s on s.id = t.status_id
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is null
        and t.updated_at < now() - interval '60 days'
        and coalesce(s.name, 'Idea') in ('Idea', 'Planning')
    ), '[]'::jsonb),

    'trip_count', (
      select count(*) from public.trips
      where couple_id = my_couple and deleted_at is null
    )
  ) into result;

  return result;
end $$;

grant execute on function public.dashboard() to authenticated;


-- ===========================================================================
-- 0007_wishlist.sql
-- ===========================================================================

-- =============================================================================
-- 0007_wishlist — independent saving, then a shared view of the overlap.
-- Spec: Module 7. Plus the geocode cache the map needs (spec 6.3).
--
-- The design note in the spec is the important part: verdicts live in their own
-- table so each partner can react to the other's saves without mutating them.
-- A "no" from one person is an opinion about someone else's idea, not an edit
-- of it — and the person who saved it should still see it as theirs.
-- =============================================================================

create table if not exists public.wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  city         text,
  country_code text,
  lat          numeric,
  lng          numeric,
  place_name   text,
  address      text,
  maps_url     text,
  category_id  uuid references public.categories(id) on delete set null,
  intensity    int check (intensity is null or intensity between 1 and 5),
  url          text,
  notes        text,
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.wishlist_verdicts (
  wishlist_id uuid not null references public.wishlist_items(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  verdict     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (wishlist_id, user_id),
  constraint valid_verdict check (verdict in ('yes', 'no', 'maybe'))
);

create index if not exists wishlist_city_idx
  on public.wishlist_items (couple_id, city) where deleted_at is null;
create index if not exists wishlist_user_idx
  on public.wishlist_items (couple_id, user_id) where deleted_at is null;

drop trigger if exists wishlist_items_updated_at on public.wishlist_items;
create trigger wishlist_items_updated_at before update on public.wishlist_items
  for each row execute function public.set_updated_at();
drop trigger if exists wishlist_verdicts_updated_at on public.wishlist_verdicts;
create trigger wishlist_verdicts_updated_at before update on public.wishlist_verdicts
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.wishlist_items    enable row level security;
alter table public.wishlist_verdicts enable row level security;

-- Both partners read everything saved. The point of the module is seeing what
-- the other one liked.
drop policy if exists "couple read" on public.wishlist_items;
create policy "couple read" on public.wishlist_items
  for select using (public.is_couple_member(couple_id));

-- But you only edit your own saves. Someone else's idea is theirs to reword.
drop policy if exists "write own" on public.wishlist_items;
create policy "write own" on public.wishlist_items
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.wishlist_verdicts;
create policy "couple read" on public.wishlist_verdicts
  for select using (exists (
    select 1 from public.wishlist_items w
    where w.id = wishlist_id and public.is_couple_member(w.couple_id)
  ));

-- A verdict is yours: you cast it, you change it, nobody casts one for you.
drop policy if exists "write own verdict" on public.wishlist_verdicts;
create policy "write own verdict" on public.wishlist_verdicts
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and exists (
        select 1 from public.wishlist_items w
        where w.id = wishlist_id and public.is_couple_member(w.couple_id)
      ));

-- =============================================================================
-- Geocode cache (spec 6.3)
--
-- Nominatim allows one request a second and asks that results be cached. This
-- is deliberately NOT couple-scoped: "lisbon" resolves to the same coordinates
-- for everyone, and duplicating rows per couple would mean more requests to a
-- free service that asked us not to make them. It holds public place data and
-- nothing about who searched for it.
-- =============================================================================
create table if not exists public.geocode_cache (
  query        text primary key,
  results      jsonb not null,
  cached_at    timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

drop policy if exists "signed in read" on public.geocode_cache;
create policy "signed in read" on public.geocode_cache
  for select using (auth.uid() is not null);

drop policy if exists "signed in write" on public.geocode_cache;
create policy "signed in write" on public.geocode_cache
  for insert with check (auth.uid() is not null);

drop policy if exists "signed in refresh" on public.geocode_cache;
create policy "signed in refresh" on public.geocode_cache
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- =============================================================================
-- Push a wishlist save into the idea pool.
--
-- One transaction so the duplicate check and the insert cannot race, and so
-- `source` and `proposed_by` are set the same way however it is called. Returns
-- null when the item is already in the trip's pool rather than raising: pushing
-- twice is a mistake worth reporting, not an error worth interrupting a bulk
-- push for (spec 7.6).
-- =============================================================================
create or replace function public.push_wishlist_to_itinerary(
  wishlist_item_id uuid,
  target_trip_id   uuid,
  new_sort_key     text
)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  w      public.wishlist_items;
  t      public.trips;
  new_id uuid;
begin
  select * into w from public.wishlist_items where id = wishlist_item_id and deleted_at is null;
  if w is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(w.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  select * into t from public.trips where id = target_trip_id;
  if t is null or t.couple_id <> w.couple_id then raise exception 'NOT_FOUND'; end if;

  -- Already pushed? Say so by returning null rather than making a second copy.
  if exists (
    select 1 from public.itinerary_items i
    where i.trip_id = target_trip_id
      and i.deleted_at is null
      and i.source = 'wishlist'
      and lower(i.title) = lower(w.title)
  ) then
    return null;
  end if;

  insert into public.itinerary_items (
    couple_id, trip_id, title, place_name, lat, lng, address, maps_url,
    category_id, notes, url, proposed_by, source, sort_key
  ) values (
    w.couple_id, target_trip_id, w.title, w.place_name, w.lat, w.lng, w.address, w.maps_url,
    w.category_id, w.notes, w.url,
    -- Whose pick survives the move. That attribution is the whole point.
    w.user_id, 'wishlist',
    -- The caller supplies the key. Fractional indexing lives in one place
    -- (lib/fractional.ts); deriving keys here too would mean two
    -- implementations that have to agree, and a suffix trick would grow the
    -- key by a character on every push.
    new_sort_key
  )
  returning id into new_id;

  return new_id;
end $$;

revoke all on function public.push_wishlist_to_itinerary(uuid, uuid, text) from public, anon;
grant execute on function public.push_wishlist_to_itinerary(uuid, uuid, text) to authenticated;


-- ===========================================================================
-- 0008_destinations.sql
-- ===========================================================================

-- =============================================================================
-- 0008_destinations — deciding *where*. Spec: Module 4.
--
-- A comparison workspace, not a recommender. The board holds candidates side by
-- side and shows what differs; choosing is a human act, and the app never
-- ranks unless someone moves a weight off zero.
--
-- Two of the three tables here are shared reference data rather than couple
-- data. That is deliberate: a visa rule for an Indian passport entering the
-- Schengen area is the same fact for every couple in the app, and duplicating
-- it per couple would mean N copies of a thing that has one correct value.
-- =============================================================================

create table if not exists public.trip_destinations (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  city         text not null,
  country_code text,                              -- ISO 3166-1 alpha-2
  lat          numeric,
  lng          numeric,
  timezone     text,
  state        text not null default 'candidate',
  arrive_on    date,
  depart_on    date,
  sort_key     text not null,
  notes        text,
  -- Everything the board computed when the candidate was added. Nothing in it
  -- goes stale on its own: flight durations are constant, visa rules change
  -- about yearly, and seasons never change at all.
  board        jsonb not null default '{}',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint valid_state check (state in ('candidate', 'chosen', 'rejected')),
  constraint valid_window check (
    arrive_on is null or depart_on is null or depart_on >= arrive_on
  )
);

create index if not exists trip_destinations_trip_idx
  on public.trip_destinations (trip_id, sort_key) where deleted_at is null;

-- At most one chosen destination per trip. The RPC below enforces the
-- transition; this makes the invariant true even if someone writes directly.
create unique index if not exists trip_destinations_one_chosen_idx
  on public.trip_destinations (trip_id)
  where state = 'chosen' and deleted_at is null;

drop trigger if exists trip_destinations_updated_at on public.trip_destinations;
create trigger trip_destinations_updated_at before update on public.trip_destinations
  for each row execute function public.set_updated_at();

alter table public.trip_destinations enable row level security;

drop policy if exists "couple read" on public.trip_destinations;
create policy "couple read" on public.trip_destinations
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.trip_destinations;
create policy "couple write" on public.trip_destinations
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Shared reference data.
--
-- Readable by anyone signed in, writable by nobody through the API. New rows
-- arrive by migration, which is the only way advisory data should change: a
-- user-editable visa table is a user-editable source of immigration advice.
-- Per-person exceptions live in `allowance_rules` (0009), where they belong.
-- =============================================================================

create table if not exists public.visa_rules (
  id                  uuid primary key default gen_random_uuid(),
  passport_country    text not null,
  destination_country text not null,              -- or a zone code, e.g. SCHENGEN
  tier                int not null,
  label               text,
  max_days            int,
  source_url          text,
  verified_on         date,
  unique (passport_country, destination_country),
  constraint valid_tier check (tier between 0 and 5)
);

alter table public.visa_rules enable row level security;

drop policy if exists "signed in read" on public.visa_rules;
create policy "signed in read" on public.visa_rules
  for select using (auth.uid() is not null);

create table if not exists public.airport_routes (
  origin_iata      text not null,
  dest_iata        text not null,
  duration_minutes int not null,
  is_direct        boolean not null default true,
  primary key (origin_iata, dest_iata)
);

alter table public.airport_routes enable row level security;

drop policy if exists "signed in read" on public.airport_routes;
create policy "signed in read" on public.airport_routes
  for select using (auth.uid() is not null);

-- =============================================================================
-- Scoring weights (spec 4.2: "persisted per couple, not per trip").
--
-- Its own table rather than a column on `couples`, and not folded into
-- `couple_settings` — that table belongs to Module 14 and inventing half of it
-- here would make the later migration a merge instead of a create.
-- =============================================================================
create table if not exists public.destination_weights (
  couple_id  uuid primary key references public.couples(id) on delete cascade,
  -- All zero by default, which is what makes ranking opt-in.
  weights    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists destination_weights_updated_at on public.destination_weights;
create trigger destination_weights_updated_at before update on public.destination_weights
  for each row execute function public.set_updated_at();

alter table public.destination_weights enable row level security;

drop policy if exists "couple read" on public.destination_weights;
create policy "couple read" on public.destination_weights
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.destination_weights;
create policy "couple write" on public.destination_weights
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Choosing a destination.
--
-- Three writes that must not be separable: this one becomes chosen, its rivals
-- become rejected, and the trip takes its timezone. Half of that applied is a
-- trip whose itinerary times mean something different from what its planner
-- intended, so it is one transaction.
--
-- Rejected candidates stay visible. The reasoning for a decision is worth as
-- much as the decision, and a board with one column explains nothing.
-- =============================================================================
create or replace function public.choose_destination(destination_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  d public.trip_destinations;
begin
  select * into d from public.trip_destinations
   where id = destination_id and deleted_at is null;
  if d is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(d.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  update public.trip_destinations
     set state = 'rejected'
   where trip_id = d.trip_id
     and id <> d.id
     and deleted_at is null
     and state <> 'rejected';

  update public.trip_destinations set state = 'chosen' where id = d.id;

  -- A destination with no timezone leaves the trip's alone rather than
  -- clearing it: an unknown zone is not the same as no zone.
  update public.trips
     set timezone = coalesce(d.timezone, timezone)
   where id = d.trip_id;
end $$;

revoke all on function public.choose_destination(uuid) from public, anon;
grant execute on function public.choose_destination(uuid) to authenticated;

-- Undo. Marking one chosen is reversible (spec 4.2), and going back should not
-- resurrect the rejections that the choice caused.
create or replace function public.unchoose_destination(destination_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  d public.trip_destinations;
begin
  select * into d from public.trip_destinations
   where id = destination_id and deleted_at is null;
  if d is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(d.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  update public.trip_destinations
     set state = 'candidate'
   where trip_id = d.trip_id and deleted_at is null;
end $$;

revoke all on function public.unchoose_destination(uuid) from public, anon;
grant execute on function public.unchoose_destination(uuid) to authenticated;

-- =============================================================================
-- Seed: visa rules.
--
-- READ THIS BEFORE TRUSTING A ROW. These are a starting point, not an
-- authority. Every one carries its source and the date it was checked, and
-- every surface that renders one shows both plus "Advisory only — confirm with
-- the embassy" (spec 4.3, non-negotiable #4). Rules change with no notice and
-- individual circumstances differ; the app's job is to say what it knows and
-- when it learned it, never to be believed.
--
-- Deliberately small. A missing rule renders as "Unknown — check officially",
-- which is a safe answer. A wrong rule is not.
--
-- Tiers: 0 visa-free · 1 eVisa/ETA online · 2 visa on arrival ·
--        3 embassy appointment · 4 difficult/long lead · 5 unavailable
-- =============================================================================
insert into public.visa_rules
  (passport_country, destination_country, tier, label, max_days, source_url, verified_on)
values
  -- Indian passport
  ('IN', 'SCHENGEN', 3, 'Schengen visa required — embassy appointment', 90,
   'https://en.wikipedia.org/wiki/Visa_requirements_for_Indian_citizens', '2026-08-14'),
  ('IN', 'US', 3, 'B1/B2 visa required — embassy interview', 180,
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('IN', 'GB', 3, 'Standard Visitor visa required', 180,
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('IN', 'CA', 3, 'Visitor visa (TRV) required', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('IN', 'JP', 3, 'Visa required — embassy or accredited agency', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/index.html', '2026-08-14'),
  ('IN', 'AE', 1, 'eVisa, or visa on arrival with a US/UK/Schengen visa', 60,
   'https://u.ae/en/information-and-services/visa-and-emirates-id', '2026-08-14'),
  ('IN', 'LK', 1, 'ETA online before travel', 30,
   'https://www.eta.gov.lk/', '2026-08-14'),
  ('IN', 'MV', 2, 'Free visa on arrival', 30,
   'https://immigration.gov.mv/tourist-visa/', '2026-08-14'),
  ('IN', 'NP', 0, 'No visa required', null,
   'https://www.immigration.gov.np/', '2026-08-14'),

  -- US passport
  ('US', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('US', 'GB', 1, 'Electronic Travel Authorisation required', 180,
   'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta', '2026-08-14'),
  ('US', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('US', 'CA', 0, 'Visa-free; eTA not required for US citizens', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('US', 'AU', 1, 'ETA (subclass 601) online', 90,
   'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
   '2026-08-14'),
  ('US', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14'),

  -- British passport
  ('GB', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('GB', 'US', 1, 'ESTA under the Visa Waiver Program', 90,
   'https://esta.cbp.dhs.gov/', '2026-08-14'),
  ('GB', 'CA', 1, 'eTA required for air travel', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('GB', 'AU', 1, 'ETA (subclass 601) online', 90,
   'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
   '2026-08-14'),
  ('GB', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('GB', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14'),

  -- Canadian passport
  ('CA', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('CA', 'US', 0, 'Visa-free for short visits', 180,
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('CA', 'GB', 1, 'Electronic Travel Authorisation required', 180,
   'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta', '2026-08-14'),
  ('CA', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('CA', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14')
on conflict (passport_country, destination_country) do nothing;


-- ===========================================================================
-- 0009_allowance.sql
-- ===========================================================================

-- =============================================================================
-- 0009_allowance — how long each of them may legally stay. Spec: Module 10.
--
-- The module that prevents a real-world mistake with real-world consequences,
-- which shapes two things in this file.
--
-- First, a missing rule is never "unlimited". There is no default row and no
-- fallback; a country with no rule reads "not tracked" and the app says
-- nothing about it.
--
-- Second, every rule carries where it came from and when it was checked, and
-- every screen that shows one repeats the disclaimer. This module must never
-- present itself as authoritative.
-- =============================================================================

-- =============================================================================
-- Rules.
--
-- The spec's schema has no owner columns, but 10.2 requires rules to be per
-- person and manually editable — "the user's actual visa may differ from the
-- generic rule", which is exactly the case that matters. So one table holds
-- both: rows with a null couple_id are the seeded defaults everyone reads, and
-- a row with a couple_id and user_id is that person's override.
--
-- Overrides win. A resident permit or a long-stay visa is a fact about the
-- person, and the generic rule for their passport is simply wrong for them.
-- =============================================================================
create table if not exists public.allowance_rules (
  id                  uuid primary key default gen_random_uuid(),
  -- Null on the seeded defaults. Set on a couple's own override.
  couple_id           uuid references public.couples(id) on delete cascade,
  user_id             uuid references public.profiles(id) on delete cascade,
  passport_country    text not null,
  destination_country text not null,               -- or a zone code, e.g. SCHENGEN
  rule_type           text not null,
  max_days            int not null,
  window_days         int,                         -- required by 'rolling'
  region_members      text[],                      -- zone rules count across these
  label               text,
  notes               text,
  source_url          text,
  verified_on         date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint valid_rule_type check (
    -- 'none' is spec 10.6's resident/PR case: tracked, and deliberately no limit.
    rule_type in ('rolling', 'per_entry', 'per_year', 'per_visa', 'none')
  ),
  constraint rolling_needs_window check (
    rule_type <> 'rolling' or window_days is not null
  ),
  -- An override belongs to somebody. A default belongs to nobody.
  constraint owner_is_all_or_nothing check (
    (couple_id is null and user_id is null) or (couple_id is not null and user_id is not null)
  )
);

-- One default per passport/destination, and one override per person per
-- destination. Partial indexes because the null couple_id is the distinction.
-- The date a 'per_visa' allowance starts counting from — the visa's issue
-- date. The spec's schema has no column for it and its rule type cannot be
-- evaluated without one: "days since the visa was issued" needs the date the
-- visa was issued. Null for every other rule type.
alter table public.allowance_rules add column if not exists window_start date;

create unique index if not exists allowance_rules_default_idx
  on public.allowance_rules (passport_country, destination_country)
  where couple_id is null;
create unique index if not exists allowance_rules_override_idx
  on public.allowance_rules (user_id, destination_country)
  where couple_id is not null;

drop trigger if exists allowance_rules_updated_at on public.allowance_rules;
create trigger allowance_rules_updated_at before update on public.allowance_rules
  for each row execute function public.set_updated_at();

alter table public.allowance_rules enable row level security;

-- The defaults are reference data; a couple's overrides are theirs.
drop policy if exists "read defaults and own" on public.allowance_rules;
create policy "read defaults and own" on public.allowance_rules
  for select using (
    (couple_id is null and auth.uid() is not null)
    or public.is_couple_member(couple_id)
  );

-- You edit your own overrides and nobody else's, and you cannot edit a default
-- through the API at all — those change by migration.
drop policy if exists "write own override" on public.allowance_rules;
create policy "write own override" on public.allowance_rules
  for all using (couple_id is not null and user_id = auth.uid())
      with check (
        couple_id is not null
        and user_id = auth.uid()
        and public.is_couple_member(couple_id)
      );

-- =============================================================================
-- The log.
--
-- Shared, not private: two people planning a trip need to see whether either
-- of them is close to a limit. (Health data is the module where the default
-- flips; this is not that.) Each writes only their own rows.
-- =============================================================================
create table if not exists public.entry_exit_log (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  country_code text not null,
  entered_on   date not null,
  -- Null means still there. Counted through today, and the answer changes daily.
  exited_on    date,
  trip_id      uuid references public.trips(id) on delete set null,
  -- True when derived from trip dates rather than confirmed by a stamp.
  is_estimated boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint valid_stay check (exited_on is null or exited_on >= entered_on)
);

create index if not exists entry_exit_log_lookup_idx
  on public.entry_exit_log (user_id, country_code, entered_on);

drop trigger if exists entry_exit_log_updated_at on public.entry_exit_log;
create trigger entry_exit_log_updated_at before update on public.entry_exit_log
  for each row execute function public.set_updated_at();

alter table public.entry_exit_log enable row level security;

drop policy if exists "couple read" on public.entry_exit_log;
create policy "couple read" on public.entry_exit_log
  for select using (public.is_couple_member(couple_id));

drop policy if exists "write own" on public.entry_exit_log;
create policy "write own" on public.entry_exit_log
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

-- =============================================================================
-- Seed: allowance rules.
--
-- Same warning as the visa seed in 0008. These are a starting point with a
-- source and a date attached, not an authority, and the UI never presents them
-- as one. Small on purpose: "not tracked" is a safe answer and a wrong limit
-- is not.
--
-- The Schengen rule is the one worth getting exactly right, because it is the
-- one people get wrong: 90 days in any rolling 180, counted across every
-- member state together, with entry and exit days both counting.
-- =============================================================================
insert into public.allowance_rules (
  passport_country, destination_country, rule_type, max_days, window_days,
  region_members, label, source_url, verified_on
)
values
  ('US', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('GB', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('CA', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('IN', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   'Short-stay visa: 90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),

  -- Per-entry rules: the clock restarts each time you arrive.
  ('US', 'GB', 'per_entry', 180, null, null,
   'Up to 6 months per visit',
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('CA', 'GB', 'per_entry', 180, null, null,
   'Up to 6 months per visit',
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('GB', 'US', 'per_entry', 90, null, null,
   'Visa Waiver Program: up to 90 days per entry',
   'https://esta.cbp.dhs.gov/', '2026-08-14'),
  ('CA', 'US', 'per_entry', 180, null, null,
   'Generally up to 6 months per entry',
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('US', 'JP', 'per_entry', 90, null, null,
   'Visa-free short stay, up to 90 days',
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('GB', 'JP', 'per_entry', 90, null, null,
   'Visa-free short stay, up to 90 days',
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('IN', 'NP', 'none', 0, null, null,
   'No limit for Indian citizens',
   'https://www.immigration.gov.np/', '2026-08-14')
on conflict do nothing;


-- ===========================================================================
-- 0010_flights.sql
-- ===========================================================================

-- =============================================================================
-- 0010_flights — one flight engine, two sources, one reconciled state.
-- Spec: Module 9, the largest in the document.
--
-- The schema carries more bookkeeping than any other module here, and every
-- extra column earns its place by protecting a budget:
--
--   status_polled_at / position_polled_at  — what makes cache-gating possible
--   status_error_count                     — what stops a broken flight looping
--   tracking_active                        — the master switch a cron enforces
--   api_usage                              — the only honest record of spend
--
-- AeroDataBox allows roughly 600 units a month. One flight tracked carelessly
-- would eat that in a day, so the design assumption throughout is that the
-- database, not the client, decides when a call is allowed to happen.
-- =============================================================================

create table if not exists public.journeys (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete cascade,
  traveler_id uuid not null references public.profiles(id) on delete cascade,
  direction   text not null,
  booking_ref text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint valid_direction check (direction in ('outbound', 'return'))
);

create table if not exists public.flights (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  journey_id  uuid references public.journeys(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete set null,
  -- Whose flight it is. Not who may see it — either partner reads and edits
  -- every flight, because the one on the ground is the one refreshing it.
  traveler_id uuid not null references public.profiles(id) on delete cascade,
  leg_index   int not null default 1,

  -- Identity
  flight_number text not null,                 -- normalised, e.g. 'AC42'
  callsign      text,                          -- 'ACA42' — what OpenSky knows
  icao24        text,                          -- aircraft hex, cached after the first fix
  registration  text,
  airline_iata  text,
  airline_name  text,
  flight_date   date not null,

  -- Route
  origin_iata text, origin_name text, origin_tz text,
  origin_lat  numeric, origin_lng numeric,
  dest_iata   text, dest_name text, dest_tz text,
  dest_lat    numeric, dest_lng numeric,

  -- Times, all UTC. A flight is the one thing in this app that is genuinely
  -- an instant rather than a calendar date (spec 0.5).
  scheduled_departure timestamptz,
  scheduled_arrival   timestamptz,
  estimated_departure timestamptz,
  estimated_arrival   timestamptz,
  actual_departure    timestamptz,
  actual_arrival      timestamptz,

  -- Status detail
  gate text, terminal text, baggage_belt text, aircraft_type text,
  phase text not null default 'scheduled',
  has_checked_bags boolean not null default true,

  -- Source bookkeeping. This is the budget's memory.
  tracking_active      boolean not null default true,
  status_polled_at     timestamptz,
  position_polled_at   timestamptz,
  status_error_count   int not null default 0,
  position_error_count int not null default 0,
  -- Whatever the user typed in. Applied last, wins over both providers.
  manual_override      jsonb,
  raw_status           jsonb,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint valid_phase check (phase in (
    'scheduled', 'checkin', 'boarding', 'departed', 'enroute',
    'descending', 'landed', 'cancelled', 'diverted', 'unknown'
  ))
);

create table if not exists public.flight_positions (
  id            uuid primary key default gen_random_uuid(),
  flight_id     uuid not null references public.flights(id) on delete cascade,
  lat           numeric not null,
  lng           numeric not null,
  altitude_m    numeric,
  heading       numeric,
  velocity_ms   numeric,
  vertical_rate numeric,
  on_ground     boolean not null default false,
  source        text not null default 'opensky',
  recorded_at   timestamptz not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.flight_events (
  id               uuid primary key default gen_random_uuid(),
  flight_id        uuid references public.flights(id) on delete cascade,
  event_type       text not null,
  from_value       jsonb,
  to_value         jsonb,
  notified_user_id uuid references public.profiles(id) on delete set null,
  notified_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- =============================================================================
-- Spend, recorded.
--
-- Not couple-scoped: the allowance belongs to the deployment, not to a couple,
-- and the guard has to see every call anyone made. Nobody writes to it through
-- the API — only the Route Handlers, which use the service role.
-- =============================================================================
create table if not exists public.api_usage (
  id        uuid primary key default gen_random_uuid(),
  provider  text not null,
  flight_id uuid references public.flights(id) on delete set null,
  units     int not null default 1,
  success   boolean,
  error     text,
  called_at timestamptz not null default now()
);

-- Shared reference data, same treatment as visa_rules in 0008.
create table if not exists public.airline_codes (
  iata text primary key,
  icao text not null,
  name text
);

create table if not exists public.airport_wait_times (
  iata                text primary key,
  immigration_minutes int,
  baggage_minutes     int,
  notes               text,
  -- Written by whoever was standing at arrivals. See the policy below.
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists flights_tracking_idx
  on public.flights (tracking_active, scheduled_departure)
  where tracking_active = true;
create index if not exists flights_couple_idx
  on public.flights (couple_id, flight_date desc) where deleted_at is null;
create index if not exists flight_positions_recent_idx
  on public.flight_positions (flight_id, recorded_at desc);
create index if not exists api_usage_window_idx
  on public.api_usage (provider, called_at);

drop trigger if exists journeys_updated_at on public.journeys;
create trigger journeys_updated_at before update on public.journeys
  for each row execute function public.set_updated_at();
drop trigger if exists flights_updated_at on public.flights;
create trigger flights_updated_at before update on public.flights
  for each row execute function public.set_updated_at();
drop trigger if exists airport_wait_times_updated_at on public.airport_wait_times;
create trigger airport_wait_times_updated_at before update on public.airport_wait_times
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
--
-- Spec 9.8: "traveler_id determines *whose* flight it is, not who may see it."
-- Both partners read and write every flight in the couple. The person watching
-- from the ground is usually the one refreshing it, and making them read-only
-- on their partner's flight would be exactly backwards.
-- =============================================================================
alter table public.journeys           enable row level security;
alter table public.flights            enable row level security;
alter table public.flight_positions   enable row level security;
alter table public.flight_events      enable row level security;
alter table public.api_usage          enable row level security;
alter table public.airline_codes      enable row level security;
alter table public.airport_wait_times enable row level security;

drop policy if exists "couple read" on public.journeys;
create policy "couple read" on public.journeys
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.journeys;
create policy "couple write" on public.journeys
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.flights;
create policy "couple read" on public.flights
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.flights;
create policy "couple write" on public.flights
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Positions and events belong to their flight; membership is checked through it.
drop policy if exists "couple read" on public.flight_positions;
create policy "couple read" on public.flight_positions
  for select using (exists (
    select 1 from public.flights f
    where f.id = flight_id and public.is_couple_member(f.couple_id)
  ));
-- Writes come from the Route Handler with the service role, which bypasses
-- RLS. No insert policy, so nothing can fabricate a position from the browser:
-- a made-up aircraft location is the worst thing this module could show.
drop policy if exists "couple read" on public.flight_events;
create policy "couple read" on public.flight_events
  for select using (exists (
    select 1 from public.flights f
    where f.id = flight_id and public.is_couple_member(f.couple_id)
  ));

-- Read-only, so Settings can show how much of the month is gone.
drop policy if exists "signed in read" on public.api_usage;
create policy "signed in read" on public.api_usage
  for select using (auth.uid() is not null);

drop policy if exists "signed in read" on public.airline_codes;
create policy "signed in read" on public.airline_codes
  for select using (auth.uid() is not null);

-- Wait times are the one piece of reference data users may write, because
-- they are the ones who measured it: spec 9.9 asks the watcher how long the
-- arrival actually took and writes the answer back. That is a fact about a
-- queue, not advice about a border.
drop policy if exists "signed in read" on public.airport_wait_times;
create policy "signed in read" on public.airport_wait_times
  for select using (auth.uid() is not null);
drop policy if exists "signed in report" on public.airport_wait_times;
create policy "signed in report" on public.airport_wait_times
  for insert with check (auth.uid() is not null and updated_by = auth.uid());
drop policy if exists "signed in update" on public.airport_wait_times;
create policy "signed in update" on public.airport_wait_times
  for update using (auth.uid() is not null) with check (updated_by = auth.uid());

-- =============================================================================
-- The hard stop.
--
-- Spec 9.6: tracking goes off when the flight is done, and a daily cron
-- enforces it "regardless of app usage". This is the guard against one stuck
-- flight consuming the month — the failure mode where a landing is missed, the
-- phase never advances, and a poll every minute runs until the quota is gone.
--
-- Returns how many it switched off so the sweep can report it.
-- =============================================================================
create or replace function public.deactivate_finished_flights()
returns int language plpgsql security definer
set search_path = public as $$
declare
  affected int;
begin
  update public.flights
     set tracking_active = false
   where tracking_active
     and (
       phase in ('landed', 'cancelled')
       or actual_arrival is not null
       -- The safety net: a flight that should have landed six hours ago is
       -- finished whether or not anyone told us.
       or (scheduled_arrival is not null and scheduled_arrival < now() - interval '6 hours')
       or status_error_count > 10
     );
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.deactivate_finished_flights() from public, anon, authenticated;

-- =============================================================================
-- Quota accounting.
--
-- AeroDataBox is metered per calendar month, OpenSky per day. The guard reads
-- this before every call and refuses above 90% (spec 9.4), so the number has
-- to come from the database rather than a counter in a process that restarts.
-- =============================================================================
create or replace function public.api_usage_in_window(target_provider text)
returns int language sql stable
set search_path = public as $$
  select coalesce(sum(units), 0)::int
    from public.api_usage
   where provider = target_provider
     and called_at >= case
       when target_provider = 'opensky' then date_trunc('day', now())
       else date_trunc('month', now())
     end;
$$;

revoke all on function public.api_usage_in_window(text) from public, anon;
grant execute on function public.api_usage_in_window(text) to authenticated;

-- =============================================================================
-- Seed: airline codes.
--
-- IATA to ICAO, which is what turns a boarding pass ('AC42') into a callsign
-- ('ACA42') — and the callsign is the only handle OpenSky has. Without a row
-- here, status still works and position tracking does not (spec 9.13).
--
-- A small set of the carriers someone flying between India, Europe and North
-- America would actually be on. Unknown airlines degrade, they do not break.
-- =============================================================================
insert into public.airline_codes (iata, icao, name) values
  ('AC', 'ACA', 'Air Canada'),
  ('AA', 'AAL', 'American Airlines'),
  ('AF', 'AFR', 'Air France'),
  ('AI', 'AIC', 'Air India'),
  ('AY', 'FIN', 'Finnair'),
  ('BA', 'BAW', 'British Airways'),
  ('DL', 'DAL', 'Delta Air Lines'),
  ('EK', 'UAE', 'Emirates'),
  ('ET', 'ETH', 'Ethiopian Airlines'),
  ('EY', 'ETD', 'Etihad Airways'),
  ('FR', 'RYR', 'Ryanair'),
  ('IB', 'IBE', 'Iberia'),
  ('JL', 'JAL', 'Japan Airlines'),
  ('KL', 'KLM', 'KLM'),
  ('LH', 'DLH', 'Lufthansa'),
  ('LX', 'SWR', 'Swiss'),
  ('NH', 'ANA', 'All Nippon Airways'),
  ('QR', 'QTR', 'Qatar Airways'),
  ('SK', 'SAS', 'SAS'),
  ('SQ', 'SIA', 'Singapore Airlines'),
  ('TK', 'THY', 'Turkish Airlines'),
  ('TP', 'TAP', 'TAP Air Portugal'),
  ('U2', 'EZY', 'easyJet'),
  ('UA', 'UAL', 'United Airlines'),
  ('UK', 'VTI', 'Air India Express'),
  ('VS', 'VIR', 'Virgin Atlantic'),
  ('W6', 'WZZ', 'Wizz Air'),
  ('WS', 'WJA', 'WestJet'),
  ('6E', 'IGO', 'IndiGo')
on conflict (iata) do nothing;


-- ===========================================================================
-- 0011_gallery.sql
-- ===========================================================================

-- =============================================================================
-- 0011_gallery — the shared photo library. Spec: Module 11.
--
-- The whole module is shaped by one number: roughly 1 GB of free storage, and
-- it has to last between trips rather than being filled by one of them.
--
-- The decision that makes it viable is that **originals are never uploaded**.
-- Two derivatives per photo — a 1600px display at ~300 KB and a 400px thumb at
-- ~40 KB — is about 340 KB, so a gigabyte holds roughly 2,900 photos. With
-- originals it would hold 250. That is the difference between a library and a
-- demo, and the schema encodes it: `path_original` exists and stays null.
--
-- The other budget is egress. The grid loads thumbs and nothing else; the
-- lightbox loads one display. Nothing in the app ever asks for both.
-- =============================================================================

create table if not exists public.media (
  id                uuid primary key default gen_random_uuid(),
  couple_id         uuid not null references public.couples(id) on delete cascade,
  uploader_id       uuid not null references public.profiles(id) on delete cascade,
  trip_id           uuid references public.trips(id) on delete set null,
  itinerary_item_id uuid references public.itinerary_items(id) on delete set null,

  -- Storage paths, {couple_id}/{media_id}/{variant}.jpg. Content-addressed by
  -- media id, so they never change and can be cached immutably.
  path_display  text not null,                -- 1600px
  path_thumb    text not null,                -- 400px
  path_original text,                         -- stays null on the free tier

  -- ~25 bytes that render as a blurred placeholder before any image loads.
  thumbhash  text,
  media_type text not null default 'photo',
  mime_type  text,
  bytes      int,
  width      int,
  height     int,
  duration_s int,

  -- When the camera says it was taken, not when it was uploaded.
  taken_at timestamptz,
  lat      numeric,
  lng      numeric,

  caption     text,
  is_favorite boolean not null default false,
  -- Perceptual hash, for the duplicate prompt. Never used to auto-reject.
  phash       text,
  search_tsv  tsvector,

  uploaded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint valid_media_type check (media_type in ('photo', 'video'))
);

create table if not exists public.albums (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  title         text not null,
  kind          text not null default 'manual',
  trip_id       uuid references public.trips(id) on delete cascade,
  cover_media_id uuid references public.media(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint valid_kind check (kind in ('trip', 'manual', 'exchange'))
);

create table if not exists public.album_media (
  album_id uuid not null references public.albums(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete cascade,
  sort_key text,
  primary key (album_id, media_id)
);

create table if not exists public.media_comments (
  id         uuid primary key default gen_random_uuid(),
  media_id   uuid not null references public.media(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- Share links.
--
-- The only thing in this app that anyone outside the couple can see, so the
-- rules are tight: a token is 32 random bytes, it expires, it can be revoked
-- instantly, and resolving it happens server-side. A share never hands out a
-- storage path — the Route Handler validates the token and mints a short-lived
-- signed URL, so revoking actually revokes.
-- =============================================================================
create table if not exists public.share_links (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples(id) on delete cascade,
  created_by     uuid references public.profiles(id) on delete set null,
  token          text unique not null,
  target_type    text not null,
  target_id      uuid not null,
  allow_download boolean not null default false,
  passcode_hash  text,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  view_count     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint valid_target check (target_type in ('media', 'album'))
);

-- One photo each per day while apart. The unique key is what makes it one.
create table if not exists public.daily_exchange (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  media_id      uuid not null references public.media(id) on delete cascade,
  -- A calendar date, in the poster's own timezone. Never a timestamp.
  exchange_date date not null,
  created_at    timestamptz not null default now(),
  unique (couple_id, user_id, exchange_date)
);

create index if not exists media_timeline_idx
  on public.media (couple_id, taken_at desc) where deleted_at is null;
create index if not exists media_trip_idx
  on public.media (trip_id, taken_at desc) where deleted_at is null;
create index if not exists media_search_idx on public.media using gin (search_tsv);
create index if not exists media_trash_idx
  on public.media (deleted_at) where deleted_at is not null;
create index if not exists album_media_sorted_idx on public.album_media (album_id, sort_key);
create index if not exists share_links_token_idx on public.share_links (token);

drop trigger if exists media_updated_at on public.media;
create trigger media_updated_at before update on public.media
  for each row execute function public.set_updated_at();
drop trigger if exists albums_updated_at on public.albums;
create trigger albums_updated_at before update on public.albums
  for each row execute function public.set_updated_at();
drop trigger if exists media_comments_updated_at on public.media_comments;
create trigger media_comments_updated_at before update on public.media_comments
  for each row execute function public.set_updated_at();
drop trigger if exists share_links_updated_at on public.share_links;
create trigger share_links_updated_at before update on public.share_links
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Search.
--
-- Maintained by trigger rather than by the client, so a caption edited from
-- anywhere — the lightbox, a future bulk tool, a migration — is searchable
-- without anyone remembering to update a second column.
-- =============================================================================
create or replace function public.media_search_tsv()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.caption, '')), 'A');
  return new;
end $$;

revoke all on function public.media_search_tsv() from public, anon, authenticated;

drop trigger if exists media_search on public.media;
create trigger media_search before insert or update of caption on public.media
  for each row execute function public.media_search_tsv();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.media          enable row level security;
alter table public.albums         enable row level security;
alter table public.album_media    enable row level security;
alter table public.media_comments enable row level security;
alter table public.share_links    enable row level security;
alter table public.daily_exchange enable row level security;

-- A shared library is shared: both partners read and edit everything in it.
-- Whose photo it is stays visible through `uploader_id`.
drop policy if exists "couple read" on public.media;
create policy "couple read" on public.media
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.media;
create policy "couple write" on public.media
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.albums;
create policy "couple read" on public.albums
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.albums;
create policy "couple write" on public.albums
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.album_media;
create policy "couple read" on public.album_media
  for select using (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ));
drop policy if exists "couple write" on public.album_media;
create policy "couple write" on public.album_media
  for all using (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ))
  with check (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ));

drop policy if exists "couple read" on public.media_comments;
create policy "couple read" on public.media_comments
  for select using (exists (
    select 1 from public.media m where m.id = media_id and public.is_couple_member(m.couple_id)
  ));
-- You write your own comments. Editing what your partner said about a photo is
-- not a feature anyone asked for.
drop policy if exists "write own comment" on public.media_comments;
create policy "write own comment" on public.media_comments
  for all using (author_id = auth.uid())
      with check (author_id = auth.uid() and exists (
        select 1 from public.media m where m.id = media_id and public.is_couple_member(m.couple_id)
      ));

drop policy if exists "couple read" on public.share_links;
create policy "couple read" on public.share_links
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.share_links;
create policy "couple write" on public.share_links
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.daily_exchange;
create policy "couple read" on public.daily_exchange
  for select using (public.is_couple_member(couple_id));
drop policy if exists "post own" on public.daily_exchange;
create policy "post own" on public.daily_exchange
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

-- =============================================================================
-- Storage
--
-- Private bucket, path {couple_id}/{media_id}/{variant}.jpg. Membership is
-- read off the first path segment, which is why that segment is the couple id
-- and not something guessable.
--
-- The size limit is per object and generous for a 1600px JPEG. It exists to
-- stop an accidental original — the thing this whole design avoids — from
-- reaching the bucket at all.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects
  for select using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media write" on storage.objects;
create policy "media write" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media update" on storage.objects;
create policy "media update" on storage.objects
  for update using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects
  for delete using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- Trip albums.
--
-- Auto-created, and idempotent: called on trip create and again whenever the
-- gallery notices a trip without one, so a trip made before this migration
-- still gets its album the first time someone opens its photos.
-- =============================================================================
create or replace function public.ensure_trip_album(target_trip uuid)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  t        public.trips;
  album_id uuid;
begin
  select * into t from public.trips where id = target_trip and deleted_at is null;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  select id into album_id from public.albums
   where trip_id = target_trip and kind = 'trip' limit 1;
  if album_id is not null then return album_id; end if;

  insert into public.albums (couple_id, title, kind, trip_id, created_by)
  values (t.couple_id, t.title, 'trip', t.id, auth.uid())
  returning id into album_id;

  return album_id;
end $$;

revoke all on function public.ensure_trip_album(uuid) from public, anon;
grant execute on function public.ensure_trip_album(uuid) to authenticated;

-- =============================================================================
-- The trash sweep.
--
-- Returns the paths to delete rather than deleting the rows itself, because
-- **order matters**: the storage objects must go first. Deleting the rows first
-- loses the only record of which files existed, and those files then sit in the
-- bucket consuming the quota with nothing left pointing at them.
--
-- The cron handler calls this, removes the objects, then calls the purge below.
-- =============================================================================
create or replace function public.expired_media(grace_days int default 30)
returns table (id uuid, path_display text, path_thumb text, path_original text)
language sql stable security definer
set search_path = public as $$
  select m.id, m.path_display, m.path_thumb, m.path_original
    from public.media m
   where m.deleted_at is not null
     and m.deleted_at < now() - make_interval(days => grace_days);
$$;

revoke all on function public.expired_media(int) from public, anon, authenticated;

create or replace function public.purge_media(ids uuid[])
returns int language plpgsql security definer
set search_path = public as $$
declare
  affected int;
begin
  delete from public.media
   where id = any(ids)
     -- Belt and braces: only ever rows already soft-deleted, whatever the
     -- caller passed in.
     and deleted_at is not null;
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.purge_media(uuid[]) from public, anon, authenticated;

-- =============================================================================
-- Storage usage, so the gallery can say how much of the gigabyte is left.
-- =============================================================================
create or replace function public.media_usage()
returns table (photo_count bigint, total_bytes bigint, trashed_count bigint)
language sql stable security definer
set search_path = public as $$
  select
    count(*) filter (where deleted_at is null),
    coalesce(sum(bytes) filter (where deleted_at is null), 0),
    count(*) filter (where deleted_at is not null)
  from public.media
  where public.is_couple_member(couple_id);
$$;

revoke all on function public.media_usage() from public, anon;
grant execute on function public.media_usage() to authenticated;


-- ===========================================================================
-- 0012_budget.sql
-- ===========================================================================

-- =============================================================================
-- 0012_budget — shared trip spending and who owes whom. Spec: Module 13.
--
-- Two properties drive every choice in this file.
--
-- First, **a past expense's converted value is fixed**. The rate that applied
-- on the day the money was spent is the rate that applies forever; rates move
-- and a balance that moves with them is not a balance. So `amount_base`,
-- `fx_rate` and `fx_date` are stored on the row at save time and never
-- recomputed. Nothing in the app converts at read time.
--
-- Second, **money must not silently disappear into rounding**. An exact split
-- that does not sum to the total, or a percent split that does not sum to 100,
-- is rejected by a constraint rather than accepted and quietly absorbed. The
-- odd cent on an equal split goes to the payer, consistently, in one function
-- in `logic.ts` that is unit-tested.
-- =============================================================================

-- =============================================================================
-- The couple's base currency.
--
-- Every balance is computed in one currency, so there has to be one. The
-- column lives here rather than waiting for Settings (Module 14, phase 13)
-- because an expense cannot be saved without knowing what to convert it to.
-- Settings will expose it; this gives it a home and a sane starting value.
--
-- Changing it later does not rewrite history: existing rows keep the
-- `amount_base` they were saved with. That is a deliberate consequence of the
-- rule above, and the UI says so rather than pretending otherwise.
-- =============================================================================
alter table public.couples
  add column if not exists base_currency text not null default 'USD';

-- =============================================================================
-- Categories.
--
-- Per couple rather than global, because the seed is a starting point people
-- rename. Seeded by trigger on couple creation so a new couple never opens the
-- module to an empty dropdown, and backfilled below for couples that already
-- exist.
-- =============================================================================
create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  name       text not null,
  icon       text,
  color      text,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists expense_categories_name_idx
  on public.expense_categories (couple_id, lower(name));

drop trigger if exists expense_categories_updated_at on public.expense_categories;
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create or replace function public.seed_expense_categories()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.expense_categories (couple_id, name, icon, color, sort_order)
  values
    (new.id, 'Flights',    'plane',        '#60a5fa', 1),
    (new.id, 'Stay',       'bed',          '#a78bfa', 2),
    (new.id, 'Food',       'utensils',     '#fb923c', 3),
    (new.id, 'Transport',  'train-front',  '#34d399', 4),
    (new.id, 'Activities', 'ticket',       '#f472b6', 5),
    (new.id, 'Shopping',   'shopping-bag', '#facc15', 6),
    (new.id, 'Other',      'circle-dashed','#94a3b8', 7)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists couples_seed_categories on public.couples;
create trigger couples_seed_categories after insert on public.couples
  for each row execute function public.seed_expense_categories();

-- =============================================================================
-- Expenses.
--
-- `trip_id` is nullable on purpose (spec 13.6): money spent before a trip
-- exists still counts toward the lifetime balance.
--
-- `amount_base` is nullable and its nullness *is* the retry flag. When the FX
-- provider is unavailable the expense still saves — refusing to record what
-- somebody actually spent because a rate lookup failed would be the wrong
-- trade — and the row is picked up by the backfill sweep later. Every surface
-- that totals money has to cope with a row that is not yet converted, and says
-- so rather than treating it as zero.
-- =============================================================================
create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  couple_id         uuid not null references public.couples(id) on delete cascade,
  trip_id           uuid references public.trips(id) on delete cascade,
  itinerary_item_id uuid references public.itinerary_items(id) on delete set null,

  description text not null,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null,

  -- Fixed at save time. See the header.
  amount_base numeric(12,2),
  fx_rate     numeric(16,8),
  fx_date     date,

  paid_by      uuid not null references public.profiles(id) on delete restrict,
  split_type   text not null default 'equal',
  -- { userId: amount } for 'exact', { userId: percent } for 'percent'.
  split_detail jsonb,

  category_id      uuid references public.expense_categories(id) on delete set null,
  spent_on         date not null default current_date,
  receipt_media_id uuid references public.media(id) on delete set null,
  notes            text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint valid_split_type check (split_type in ('equal', 'exact', 'percent', 'full')),
  -- The two split types that carry numbers must carry them. Which numbers, and
  -- whether they sum correctly, is checked in `logic.ts` where the error can
  -- name the shortfall; this only stops a structurally impossible row.
  constraint split_detail_present check (
    split_type in ('equal', 'full') or split_detail is not null
  ),
  -- A currency code, not free text. Uppercase ISO 4217.
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$'),
  -- Either fully converted or not converted at all. A row with an amount but
  -- no rate would be a number nobody could explain.
  constraint fx_all_or_nothing check (
    (amount_base is null and fx_rate is null and fx_date is null)
    or (amount_base is not null and fx_rate is not null and fx_date is not null)
  )
);

create index if not exists expenses_trip_idx
  on public.expenses (trip_id, spent_on) where deleted_at is null;
create index if not exists expenses_couple_idx
  on public.expenses (couple_id, spent_on) where deleted_at is null;
-- The backfill sweep's working set: saved, but never converted.
create index if not exists expenses_unconverted_idx
  on public.expenses (couple_id) where amount_base is null and deleted_at is null;

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Settlements.
--
-- The spec's schema has no `deleted_at`. This adds one: a settlement is a
-- record that money changed hands, and deleting one silently moves the balance
-- for both people. Soft-delete is the house rule for anything a user would
-- regret losing, and this qualifies more than most.
-- =============================================================================
create table if not exists public.settlements (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  trip_id    uuid references public.trips(id) on delete set null,
  from_user  uuid not null references public.profiles(id) on delete restrict,
  to_user    uuid not null references public.profiles(id) on delete restrict,
  amount     numeric(12,2) not null check (amount > 0),
  currency   text not null,
  settled_on date not null default current_date,
  method     text,
  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$'),
  constraint settlement_has_two_sides check (from_user <> to_user)
);

create index if not exists settlements_couple_idx
  on public.settlements (couple_id, settled_on) where deleted_at is null;

drop trigger if exists settlements_updated_at on public.settlements;
create trigger settlements_updated_at before update on public.settlements
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Budgets. Optional throughout: budget-vs-actual appears only where one is set.
-- =============================================================================
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  category_id uuid references public.expense_categories(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null,
  period      text not null default 'trip',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint valid_period check (period in ('trip', 'week')),
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$')
);

-- The spec's `unique (trip_id, category_id, period)` does not hold in Postgres
-- when category_id is null — every null is distinct, so a trip could collect
-- any number of overall budgets. Two partial indexes say what was meant.
create unique index if not exists budgets_category_idx
  on public.budgets (trip_id, category_id, period) where category_id is not null;
create unique index if not exists budgets_overall_idx
  on public.budgets (trip_id, period) where category_id is null;

drop trigger if exists budgets_updated_at on public.budgets;
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- =============================================================================
-- FX rates.
--
-- Reference data, shared by every couple, keyed by day. One row per pair per
-- date, fetched once and never re-fetched — a past date's rate cannot change,
-- so a cache miss is the only reason to call the provider at all.
--
-- Unlike `geocode_cache`, signed-in users cannot write here. A poisoned
-- geocode result is a wrong pin on a map; a poisoned rate is a wrong number in
-- somebody's balance. Only the service role inserts, from the Route Handler
-- that talks to the provider.
-- =============================================================================
create table if not exists public.fx_rates (
  base      text not null,
  quote     text not null,
  rate      numeric(16,8) not null check (rate > 0),
  rate_date date not null,
  fetched_at timestamptz not null default now(),
  source    text,
  primary key (base, quote, rate_date),
  constraint fx_base_is_code check (base ~ '^[A-Z]{3}$'),
  constraint fx_quote_is_code check (quote ~ '^[A-Z]{3}$')
);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.settlements        enable row level security;
alter table public.budgets            enable row level security;
alter table public.fx_rates           enable row level security;

drop policy if exists "couple read" on public.expense_categories;
create policy "couple read" on public.expense_categories
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.expense_categories;
create policy "couple write" on public.expense_categories
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Shared money is shared: both partners see and edit every expense, whoever
-- entered it. Who paid stays visible through `paid_by`.
drop policy if exists "couple read" on public.expenses;
create policy "couple read" on public.expenses
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.expenses;
create policy "couple write" on public.expenses
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.settlements;
create policy "couple read" on public.settlements
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.settlements;
create policy "couple write" on public.settlements
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.budgets;
create policy "couple read" on public.budgets
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.budgets;
create policy "couple write" on public.budgets
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Read by anyone signed in, written by nobody through the API. See above.
drop policy if exists "signed in read" on public.fx_rates;
create policy "signed in read" on public.fx_rates
  for select using (auth.uid() is not null);

-- =============================================================================
-- Backfill: categories for couples that predate this migration.
-- =============================================================================
insert into public.expense_categories (couple_id, name, icon, color, sort_order)
select c.id, v.name, v.icon, v.color, v.sort_order
from public.couples c
cross join (values
  ('Flights',    'plane',         '#60a5fa', 1),
  ('Stay',       'bed',           '#a78bfa', 2),
  ('Food',       'utensils',      '#fb923c', 3),
  ('Transport',  'train-front',   '#34d399', 4),
  ('Activities', 'ticket',        '#f472b6', 5),
  ('Shopping',   'shopping-bag',  '#facc15', 6),
  ('Other',      'circle-dashed', '#94a3b8', 7)
) as v(name, icon, color, sort_order)
on conflict do nothing;

-- =============================================================================
-- Grants.
--
-- Revoking from PUBLIC alone is not enough, which is the lesson of 0004 (see
-- D26). Supabase sets ALTER DEFAULT PRIVILEGES granting EXECUTE on new
-- functions to `anon` and `authenticated` directly, so a fresh function is
-- reachable at /rest/v1/rpc/<name> by both regardless of the PUBLIC default.
-- Trigger functions are named explicitly in all three.
--
-- `rls_auto_enable` is Supabase's own event trigger — it is what has been
-- enabling RLS on every table the moment it is created, which is a useful
-- backstop but not a substitute for the policies. It is not ours and does not
-- exist in the scratch harness, so the revoke is guarded. The linter flags it
-- reachable at /rest/v1/rpc; it is an event-trigger helper and nobody should
-- be able to call it.
-- =============================================================================
revoke all on function public.seed_expense_categories() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;


-- ===========================================================================
-- 0013_settings_and_access.sql
-- ===========================================================================

-- =============================================================================
-- 0013_settings_and_access — Settings (spec Module 14), plus two things the
-- spec does not cover and the app needs before anyone else is let in.
--
-- **An invite code was a bearer token.** Anyone holding the eight characters
-- could join, whoever they were. A code read aloud on a call, pasted into a
-- chat, or left in a screenshot was a way into somebody's passport numbers.
-- Invites are now issued *to an email address* and refuse anyone else, so the
-- code alone is not enough — you also have to be the person it was meant for.
--
-- **Not everyone let in should see everything.** A partner sees the whole
-- app; a friend along for one trip has no business in the document vault. So
-- membership carries a role and a set of module grants, and the grants are
-- enforced in RLS rather than by hiding nav items. A screen you cannot reach
-- is not the same as data you cannot read, and only the second one is a
-- guarantee.
--
-- The shape is deliberately more general than a couple. `couples.kind`
-- distinguishes a two-person couple from a larger trip group, the size cap
-- applies only to the former, and the one-couple-per-user rule becomes
-- one-*couple*-per-user rather than one-space-per-user. Nothing in this
-- migration builds group UI; it makes the group case expressible without a
-- second migration that rewrites every policy again.
-- =============================================================================

-- =============================================================================
-- Spaces: couples, and eventually groups.
-- =============================================================================
alter table public.couples
  add column if not exists kind text not null default 'couple';

alter table public.couples drop constraint if exists valid_couple_kind;
alter table public.couples add constraint valid_couple_kind
  check (kind in ('couple', 'group'));

-- D1's guarantee — one couple per user — is what makes `partner_id()`
-- single-valued and every policy unambiguous. It still holds, but only for
-- couples: a user may later belong to any number of trip groups without
-- either fact contradicting the other.
drop index if exists public.couple_members_one_couple_per_user;

-- =============================================================================
-- Roles and grants.
--
-- `module_grants` null means "everything", which is the only sane default for
-- the two people whose app this is. A non-null array is a whitelist, and an
-- empty array is a member who can see the space exists and nothing in it.
-- =============================================================================
alter table public.couple_members
  add column if not exists role          text not null default 'partner',
  add column if not exists module_grants text[],
  add column if not exists invited_by    uuid references public.profiles(id) on delete set null;

alter table public.couple_members drop constraint if exists valid_member_role;
alter table public.couple_members add constraint valid_member_role
  check (role in ('owner', 'partner', 'friend', 'guest'));

-- Full access belongs to the two people the space is for. A friend or a guest
-- always carries an explicit whitelist, because "null means everything" would
-- otherwise be one forgotten column away from handing over the vault.
alter table public.couple_members drop constraint if exists limited_roles_need_grants;
alter table public.couple_members add constraint limited_roles_need_grants
  check (role in ('owner', 'partner') or module_grants is not null);

-- =============================================================================
-- Which modules exist, and which are never shared.
--
-- Functions rather than a table: this list changes when code changes, not when
-- data changes, and a migration is the honest place to record that.
-- =============================================================================
create or replace function public.all_modules()
returns text[] language sql immutable
set search_path = public as $$
  select array[
    'trips', 'wishlist', 'destinations', 'money', 'documents',
    'photos', 'flights', 'allowance', 'health'
  ];
$$;

-- Documents hold passport and visa numbers. Allowance is somebody's
-- immigration history. Health is health. None of the three is something to
-- hand to a friend joining one trip, so the database refuses to grant them
-- rather than trusting every future screen to remember.
create or replace function public.sensitive_modules()
returns text[] language sql immutable
set search_path = public as $$
  select array['documents', 'allowance', 'health'];
$$;

-- One rule, two callers: the invite refuses at issue time so the mistake is
-- caught while somebody is looking at it, and the membership trigger refuses
-- at redeem time so a hand-written row cannot get past the first check.
create or replace function public.assert_grants_allowed(member_role text, grants text[])
returns void language plpgsql immutable
set search_path = public as $$
begin
  if grants is null then return; end if;

  if exists (select 1 from unnest(grants) g where g <> all(public.all_modules())) then
    raise exception 'UNKNOWN_MODULE';
  end if;

  if member_role in ('friend', 'guest')
     and exists (select 1 from unnest(grants) g where g = any(public.sensitive_modules())) then
    raise exception 'SENSITIVE_MODULE_NOT_SHAREABLE';
  end if;
end $$;

create or replace function public.enforce_grant_limits()
returns trigger language plpgsql
set search_path = public as $$
begin
  perform public.assert_grants_allowed(new.role, new.module_grants);
  return new;
end $$;

drop trigger if exists couple_members_grant_limits on public.couple_members;
create trigger couple_members_grant_limits
  before insert or update on public.couple_members
  for each row execute function public.enforce_grant_limits();

-- =============================================================================
-- The two-person cap counts partners, not members.
--
-- 0001's trigger capped `couple_members` at two rows outright, which was the
-- same thing back when every member was a partner. It is not any more: a
-- couple plus one friend along for a trip is three rows and still a couple.
-- The cap that matters — and the one D1's guarantee rests on — is that a
-- couple holds at most two people in an owning role.
-- =============================================================================
create or replace function public.enforce_couple_size()
returns trigger language plpgsql
set search_path = public as $$
begin
  if new.role in ('owner', 'partner')
     and (select kind from public.couples where id = new.couple_id) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = new.couple_id and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;
  return new;
end $$;

-- =============================================================================
-- The predicate every module-scoped policy is rebuilt on.
--
-- SECURITY DEFINER for the same reason `is_couple_member` is: it reads
-- `couple_members`, and a policy that consulted that table through its own RLS
-- would recurse.
-- =============================================================================
create or replace function public.can_see(target uuid, module text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target
      and user_id = auth.uid()
      and (module_grants is null or module = any(module_grants))
  );
$$;

-- What the caller may see in their own space. The nav reads this, so a hidden
-- screen and an unreadable table always agree.
create or replace function public.my_modules()
returns text[] language sql security definer stable
set search_path = public as $$
  select coalesce(
    (select module_grants from public.couple_members where user_id = auth.uid() limit 1),
    public.all_modules()
  );
$$;

create or replace function public.my_role()
returns text language sql security definer stable
set search_path = public as $$
  select role from public.couple_members where user_id = auth.uid() limit 1;
$$;

-- =============================================================================
-- Invites.
--
-- Replaces the bearer code on `couples`. The old columns stay for now so an
-- in-flight invite is not voided by a deploy; nothing writes them any more.
-- =============================================================================
create table if not exists public.invites (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  code          text not null unique,
  -- Stored lower-cased. Compared against the address on the account actually
  -- signing in, which is the whole point of the table.
  invited_email text not null,
  role          text not null default 'partner',
  module_grants text[],
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint valid_invite_role check (role in ('partner', 'friend', 'guest')),
  constraint invite_email_is_lower check (invited_email = lower(invited_email)),
  constraint limited_invites_need_grants check (role = 'partner' or module_grants is not null)
);

-- One live invite per address per space. Re-inviting somebody replaces rather
-- than accumulates, so revoking one code cannot leave another one working.
create unique index if not exists invites_live_idx
  on public.invites (couple_id, invited_email)
  where accepted_at is null and revoked_at is null;

drop trigger if exists invites_updated_at on public.invites;
create trigger invites_updated_at before update on public.invites
  for each row execute function public.set_updated_at();

alter table public.invites enable row level security;

-- Members see their space's invites. Nobody selects an invite by code through
-- the API — that happens inside `join_couple`, under definer rights, so a code
-- cannot be confirmed to exist by anyone it was not sent to.
drop policy if exists "couple read" on public.invites;
create policy "couple read" on public.invites
  for select using (public.is_couple_member(couple_id));

drop policy if exists "couple write" on public.invites;
create policy "couple write" on public.invites
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- The caller's own email, from the auth schema rather than from anything the
-- client can set.
create or replace function public.my_email()
returns text language sql security definer stable
set search_path = public, auth as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

-- =============================================================================
-- Issuing an invite.
-- =============================================================================
create or replace function public.create_invite(
  email         text,
  member_role   text default 'partner',
  grants        text[] default null,
  valid_days    int default 7
)
returns public.invites language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  row    public.invites;
  normalised text := lower(trim(email));
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if normalised !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  target := public.my_couple_id();
  if target is null then raise exception 'NOT_PAIRED'; end if;

  perform public.assert_grants_allowed(member_role, grants);

  -- Only the two people the space belongs to may let anyone else in. A guest
  -- who could invite would route around every grant on their own membership.
  if public.my_role() not in ('owner', 'partner') then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Order matters: "they are already in this" is a more useful answer than
  -- "it is full", and inviting an existing member is the likelier mistake.
  if exists (
    select 1 from public.couple_members m
    join auth.users u on u.id = m.user_id
    where m.couple_id = target and lower(u.email) = normalised
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- Inviting a second partner into a full couple is the old COUPLE_FULL case,
  -- checked before a code is minted rather than after it is redeemed.
  if member_role = 'partner'
     and (select kind from public.couples where id = target) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = target and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  -- Supersede any live invite to the same address, so the unique index holds
  -- and an older code stops working the moment a new one is issued.
  update public.invites
     set revoked_at = now()
   where couple_id = target and invited_email = normalised
     and accepted_at is null and revoked_at is null;

  insert into public.invites (
    couple_id, code, invited_email, role, module_grants, expires_at, created_by
  )
  values (
    target,
    public.generate_invite_code(),
    normalised,
    member_role,
    case when member_role = 'partner' then grants
         -- A friend or guest always carries an explicit list; the default is
         -- the four modules that hold nothing sensitive.
         else coalesce(grants, array['trips', 'wishlist', 'destinations', 'photos'])
    end,
    now() + make_interval(days => greatest(1, least(valid_days, 30))),
    auth.uid()
  )
  returning * into row;

  return row;
end $$;

-- =============================================================================
-- Redeeming one.
--
-- Replaces `join_couple(code)`. Same name and signature so nothing else
-- changes, but the code is no longer sufficient on its own.
-- =============================================================================
create or replace function public.join_couple(code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  inv        public.invites;
  normalised text := upper(trim(code));
  caller     text := public.my_email();
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into inv from public.invites i where i.code = normalised;

  if inv.id is null then raise exception 'INVALID_CODE'; end if;
  if inv.revoked_at is not null then raise exception 'INVALID_CODE'; end if;
  if inv.accepted_at is not null then raise exception 'INVALID_CODE'; end if;
  if inv.expires_at < now() then raise exception 'EXPIRED_CODE'; end if;

  -- The check this whole migration exists for. A valid, live code presented by
  -- the wrong account is refused, and says so — "wrong code" would send
  -- somebody hunting for a typo that is not there.
  if caller is null or caller <> inv.invited_email then
    raise exception 'EMAIL_MISMATCH';
  end if;

  -- A couple still holds two *partners*. Friends and guests do not count
  -- against it, and a group has no cap at all.
  if inv.role = 'partner'
     and (select kind from public.couples where id = inv.couple_id) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = inv.couple_id and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  -- One couple per person still holds, but only for the partner role: being
  -- a friend in somebody else's space says nothing about your own.
  if inv.role = 'partner' and exists (
    select 1 from public.couple_members m
    join public.couples c on c.id = m.couple_id
    where m.user_id = auth.uid() and c.kind = 'couple' and m.role in ('owner', 'partner')
  ) then
    raise exception 'ALREADY_PAIRED';
  end if;

  if exists (select 1 from public.couple_members
              where couple_id = inv.couple_id and user_id = auth.uid()) then
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into public.couple_members (couple_id, user_id, role, module_grants, invited_by)
  values (inv.couple_id, auth.uid(), inv.role, inv.module_grants, inv.created_by);

  update public.invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  -- The legacy bearer code on `couples` is spent the moment anyone joins.
  update public.couples set invite_code = null, invite_expires_at = null
   where id = inv.couple_id;

  return inv.couple_id;
end $$;

-- The old regenerate call now issues an invite, which needs an address.
-- Kept so a stale client gets a clear error rather than a missing function.
create or replace function public.regenerate_invite_code()
returns text language plpgsql
set search_path = public as $$
begin
  raise exception 'INVITE_NEEDS_EMAIL';
end $$;

-- =============================================================================
-- Settings. Spec 14.1, verbatim except for the RLS every table here needs.
-- =============================================================================
create table if not exists public.couple_settings (
  couple_id               uuid primary key references public.couples(id) on delete cascade,
  base_currency           text not null default 'USD',
  distance_unit           text not null default 'km',
  date_format             text not null default 'iso',
  week_starts_on          int  not null default 1,
  ai_enabled              boolean not null default false,
  require_insurance       boolean not null default false,
  long_stay_threshold     int  not null default 5,
  show_departure_countdown boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint valid_distance_unit check (distance_unit in ('km', 'mi')),
  constraint valid_date_format check (date_format in ('iso', 'dmy', 'mdy')),
  constraint valid_week_start check (week_starts_on between 0 and 6),
  constraint valid_threshold check (long_stay_threshold between 1 and 60)
);

create table if not exists public.user_settings (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  theme                   text not null default 'system',
  work_hours_start        time,
  work_hours_end          time,
  work_timezone           text,
  work_days               int[],
  notify_flights          boolean not null default true,
  notify_documents        boolean not null default true,
  notify_allowance        boolean not null default true,
  notify_daily_exchange   boolean not null default false,
  notify_partner_activity boolean not null default false,
  quiet_hours_start       time,
  quiet_hours_end         time,
  -- Spec 8.3's idle re-auth on the document vault, which had nowhere to live.
  vault_lock_minutes      int not null default 15,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint valid_theme check (theme in ('system', 'light', 'dark')),
  constraint valid_lock check (vault_lock_minutes between 0 and 240)
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

drop trigger if exists couple_settings_updated_at on public.couple_settings;
create trigger couple_settings_updated_at before update on public.couple_settings
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.couple_settings   enable row level security;
alter table public.user_settings     enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "couple read" on public.couple_settings;
create policy "couple read" on public.couple_settings
  for select using (public.is_couple_member(couple_id));
-- Shared preferences are changed by the people the space belongs to. A guest
-- does not get to switch everyone's base currency.
drop policy if exists "partners write" on public.couple_settings;
create policy "partners write" on public.couple_settings
  for all using (public.is_couple_member(couple_id) and public.my_role() in ('owner', 'partner'))
      with check (public.is_couple_member(couple_id) and public.my_role() in ('owner', 'partner'));

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Seed a settings row per space, and per user, so the app never has to cope
-- with a missing row.
create or replace function public.seed_couple_settings()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.couple_settings (couple_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists couples_seed_settings on public.couples;
create trigger couples_seed_settings after insert on public.couples
  for each row execute function public.seed_couple_settings();

create or replace function public.seed_user_settings()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists profiles_seed_settings on public.profiles;
create trigger profiles_seed_settings after insert on public.profiles
  for each row execute function public.seed_user_settings();

insert into public.couple_settings (couple_id, base_currency)
select id, base_currency from public.couples on conflict do nothing;
insert into public.user_settings (user_id) select id from public.profiles on conflict do nothing;

-- `couples.base_currency` was 0012's placeholder for exactly this table. Keep
-- the two in step rather than picking a winner mid-flight: the app reads
-- couple_settings, and this trigger means an older client writing the old
-- column does not silently disagree with it.
create or replace function public.mirror_base_currency()
returns trigger language plpgsql
set search_path = public as $$
begin
  update public.couple_settings
     set base_currency = new.base_currency
   where couple_id = new.id and base_currency is distinct from new.base_currency;
  return new;
end $$;

drop trigger if exists couples_mirror_currency on public.couples;
create trigger couples_mirror_currency after update of base_currency on public.couples
  for each row execute function public.mirror_base_currency();

-- =============================================================================
-- Module visibility, enforced.
--
-- Every couple-scoped policy below gains its module's grant check. This is the
-- part that makes a grant a guarantee rather than a preference: a guest with
-- no 'money' grant does not get an empty expenses screen, they get zero rows
-- from the database however they ask.
-- =============================================================================

-- trips
drop policy if exists "couple read" on public.trips;
create policy "couple read" on public.trips
  for select using (public.can_see(couple_id, 'trips'));
drop policy if exists "couple write" on public.trips;
create policy "couple write" on public.trips
  for all using (public.can_see(couple_id, 'trips'))
      with check (public.can_see(couple_id, 'trips'));

drop policy if exists "couple read" on public.itinerary_items;
create policy "couple read" on public.itinerary_items
  for select using (public.can_see(couple_id, 'trips'));
drop policy if exists "couple write" on public.itinerary_items;
create policy "couple write" on public.itinerary_items
  for all using (public.can_see(couple_id, 'trips'))
      with check (public.can_see(couple_id, 'trips'));

-- wishlist
--
-- Note the policy *names*. Postgres ORs every policy that applies, so adding a
-- differently-named one alongside the original loosens rather than tightens —
-- a permissive "couple write" beside 0007's "write own" would have handed
-- every member edit rights over each other's saves. Each policy below reuses
-- its original name so it is replaced, and keeps whatever extra condition it
-- already carried.
drop policy if exists "couple read" on public.wishlist_items;
create policy "couple read" on public.wishlist_items
  for select using (public.can_see(couple_id, 'wishlist'));
drop policy if exists "write own" on public.wishlist_items;
create policy "write own" on public.wishlist_items
  for all using (user_id = auth.uid() and public.can_see(couple_id, 'wishlist'))
      with check (user_id = auth.uid() and public.can_see(couple_id, 'wishlist'));

-- destinations
drop policy if exists "couple read" on public.trip_destinations;
create policy "couple read" on public.trip_destinations
  for select using (public.can_see(couple_id, 'destinations'));
drop policy if exists "couple write" on public.trip_destinations;
create policy "couple write" on public.trip_destinations
  for all using (public.can_see(couple_id, 'destinations'))
      with check (public.can_see(couple_id, 'destinations'));

-- money
drop policy if exists "couple read" on public.expenses;
create policy "couple read" on public.expenses
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.expenses;
create policy "couple write" on public.expenses
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

drop policy if exists "couple read" on public.settlements;
create policy "couple read" on public.settlements
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.settlements;
create policy "couple write" on public.settlements
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

drop policy if exists "couple read" on public.budgets;
create policy "couple read" on public.budgets
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.budgets;
create policy "couple write" on public.budgets
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

-- documents — sensitive, so a grant can never include it for friend or guest
drop policy if exists "read own or shared" on public.documents;
create policy "read own or shared" on public.documents
  for select using (
    public.can_see(couple_id, 'documents')
    -- Module 8's owner-private rule still applies on top of the grant.
    and (is_shared or owner_id = auth.uid())
  );
drop policy if exists "write own" on public.documents;
create policy "write own" on public.documents
  for all using (owner_id = auth.uid() and public.can_see(couple_id, 'documents'))
      with check (owner_id = auth.uid() and public.can_see(couple_id, 'documents'));

-- photos
drop policy if exists "couple read" on public.media;
create policy "couple read" on public.media
  for select using (public.can_see(couple_id, 'photos'));
drop policy if exists "couple write" on public.media;
create policy "couple write" on public.media
  for all using (public.can_see(couple_id, 'photos'))
      with check (public.can_see(couple_id, 'photos'));

drop policy if exists "couple read" on public.albums;
create policy "couple read" on public.albums
  for select using (public.can_see(couple_id, 'photos'));
drop policy if exists "couple write" on public.albums;
create policy "couple write" on public.albums
  for all using (public.can_see(couple_id, 'photos'))
      with check (public.can_see(couple_id, 'photos'));

-- flights
drop policy if exists "couple read" on public.flights;
create policy "couple read" on public.flights
  for select using (public.can_see(couple_id, 'flights'));
drop policy if exists "couple write" on public.flights;
create policy "couple write" on public.flights
  for all using (public.can_see(couple_id, 'flights'))
      with check (public.can_see(couple_id, 'flights'));

-- allowance — sensitive
drop policy if exists "couple read" on public.entry_exit_log;
create policy "couple read" on public.entry_exit_log
  for select using (public.can_see(couple_id, 'allowance'));
drop policy if exists "write own" on public.entry_exit_log;
create policy "write own" on public.entry_exit_log
  for all using (user_id = auth.uid() and public.can_see(couple_id, 'allowance'))
      with check (user_id = auth.uid() and public.can_see(couple_id, 'allowance'));

-- =============================================================================
-- Grants. Same rule as 0004 and 0012: name all three roles.
-- =============================================================================
grant execute on function public.can_see(uuid, text)   to authenticated;
grant execute on function public.my_modules()          to authenticated;
grant execute on function public.my_role()             to authenticated;
grant execute on function public.create_invite(text, text, text[], int) to authenticated;
grant execute on function public.all_modules()         to authenticated;
grant execute on function public.sensitive_modules()   to authenticated;

revoke all on function public.can_see(uuid, text)      from public, anon;
revoke all on function public.my_modules()             from public, anon;
revoke all on function public.my_role()                from public, anon;
revoke all on function public.my_email()               from public, anon, authenticated;
revoke all on function public.create_invite(text, text, text[], int) from public, anon;
revoke all on function public.all_modules()            from public, anon;
revoke all on function public.sensitive_modules()      from public, anon;
revoke all on function public.enforce_grant_limits()   from public, anon, authenticated;
revoke all on function public.assert_grants_allowed(text, text[]) from public, anon;
grant execute on function public.assert_grants_allowed(text, text[]) to authenticated;
revoke all on function public.seed_couple_settings()   from public, anon, authenticated;
revoke all on function public.seed_user_settings()     from public, anon, authenticated;
revoke all on function public.mirror_base_currency()   from public, anon, authenticated;

-- Existing members predate roles. The one who created the space owns it; the
-- other is a partner. Both keep null grants, which is everything.
update public.couple_members m
   set role = case when c.created_by = m.user_id then 'owner' else 'partner' end
  from public.couples c
 where c.id = m.couple_id and m.role = 'partner' and c.created_by = m.user_id;


-- ===========================================================================
-- 0014_health.sql
-- ===========================================================================

-- =============================================================================
-- 0014_health — private health data with granular, revocable sharing.
-- Spec: Module 12.
--
-- **This is the only owner-scoped module in the app.** Every other table is
-- couple-scoped: if you are in the couple, you can read it. Here, being in the
-- couple grants nothing. The owner sees their own rows, and a partner sees a
-- scope only while an unrevoked consent row exists saying so.
--
-- Spec 12.1 puts it in one sentence worth repeating: *a hidden tab is not
-- privacy — the database must refuse the read.* So there is no policy anywhere
-- in this file keyed on `is_couple_member`, and none keyed on `can_see` either
-- — the module grant from 0013 gates whether the *screen* exists, and consent
-- gates the data. Both have to be true, and they are independent on purpose:
-- granting somebody the health module does not grant them any health data.
--
-- Two further consequences of the spec's design rules:
--
-- **Revocation is instant.** `revoked_at` is checked in the policy itself, so
-- the next query after a revoke returns nothing. There is no cache to expire
-- and no job to run.
--
-- **Deletion is hard.** Spec 12.2: "Hard delete of all health data, immediate,
-- no soft-delete grace period." So no `deleted_at` column exists on any table
-- here — the one place in this codebase where the house rule about
-- soft-deleting anything a user would regret losing is deliberately reversed.
-- Somebody deleting their health data means it.
-- =============================================================================

-- =============================================================================
-- Consent.
--
-- One row per owner, viewer and scope. Revoking sets `revoked_at` rather than
-- deleting, so "you shared this and then stopped" is answerable — but only to
-- the owner, who is the only one who can read the table at all.
-- =============================================================================
create table if not exists public.health_consents (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade,
  scope      text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, viewer_id, scope),
  constraint valid_scope check (
    scope in ('cycle', 'cycle_predictions', 'symptoms', 'medications', 'vaccinations', 'notes')
  ),
  constraint no_self_consent check (owner_id <> viewer_id)
);

drop trigger if exists health_consents_updated_at on public.health_consents;
create trigger health_consents_updated_at before update on public.health_consents
  for each row execute function public.set_updated_at();

-- =============================================================================
-- The data.
-- =============================================================================
create table if not exists public.cycle_logs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  started_on date not null,
  ended_on   date,
  flow       text,
  symptoms   text[],
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_flow check (flow is null or flow in ('light', 'medium', 'heavy')),
  constraint valid_span check (ended_on is null or ended_on >= started_on)
);

create index if not exists cycle_logs_owner_idx on public.cycle_logs (owner_id, started_on desc);

create table if not exists public.health_records (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  label       text not null,
  detail      jsonb not null default '{}',
  dosage      text,
  frequency   text,
  -- Doses per day and how many are left, for the supply calculator in 12.3.
  -- The spec's `dosage`/`frequency` are free text a person writes; these two
  -- are the numbers the arithmetic needs, and neither can be parsed out of the
  -- other reliably.
  doses_per_day numeric(6,2),
  quantity_remaining numeric(8,2),
  started_on  date,
  valid_until date,
  document_id uuid references public.documents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint valid_kind check (kind in ('medication', 'vaccination', 'condition', 'allergy'))
);

create index if not exists health_records_owner_idx on public.health_records (owner_id, kind);

drop trigger if exists cycle_logs_updated_at on public.cycle_logs;
create trigger cycle_logs_updated_at before update on public.cycle_logs
  for each row execute function public.set_updated_at();

drop trigger if exists health_records_updated_at on public.health_records;
create trigger health_records_updated_at before update on public.health_records
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Border restrictions.
--
-- Reference data, and the most carefully worded table in the app. Spec 12.2:
-- "Only ever links to the official source. Never asserts the rule." So
-- `restriction` is a brief factual label, `source_url` is NOT NULL, and every
-- surface that renders one repeats that the source is the authority.
--
-- A substance with no row means "not checked", never "safe". There is no
-- default row and no fallback, exactly as with allowance rules in 0009.
-- =============================================================================
create table if not exists public.medication_restrictions (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null,
  substance    text not null,
  restriction  text,
  source_url   text not null,
  verified_on  date,
  created_at   timestamptz not null default now()
);

-- A table constraint cannot hold an expression, so the case-insensitive
-- uniqueness that stops "Codeine" and "codeine" being two rows is an index.
create unique index if not exists medication_restrictions_key
  on public.medication_restrictions (country_code, lower(substance));

-- =============================================================================
-- RLS.
--
-- The consent predicate, written once. SECURITY DEFINER so it can read
-- `health_consents` without recursing through that table's own policy.
-- =============================================================================
create or replace function public.has_health_consent(owner uuid, scope_name text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.health_consents c
    where c.owner_id = owner
      and c.viewer_id = auth.uid()
      and c.scope = scope_name
      -- Checked here rather than by a sweep: revocation has to take effect on
      -- the next query, with no cache to expire (spec 12.6).
      and c.revoked_at is null
  );
$$;

alter table public.health_consents          enable row level security;
alter table public.cycle_logs               enable row level security;
alter table public.health_records           enable row level security;
alter table public.medication_restrictions  enable row level security;

-- Consent rows belong to the owner alone. A viewer cannot enumerate what they
-- have been granted — they simply find out by whether a read returns rows.
-- Letting them read this table would turn "what does my partner track?" into a
-- question the app answers, which is the thing this module exists to prevent.
drop policy if exists "owner only" on public.health_consents;
create policy "owner only" on public.health_consents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owner full access" on public.cycle_logs;
create policy "owner full access" on public.cycle_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Read-only, and only with consent. There is no write policy for a viewer at
-- all: a partner's view is read-only by construction, not by convention.
drop policy if exists "viewer with active consent" on public.cycle_logs;
create policy "viewer with active consent" on public.cycle_logs
  for select using (public.has_health_consent(owner_id, 'cycle'));

drop policy if exists "owner full access" on public.health_records;
create policy "owner full access" on public.health_records
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Per-kind consent: sharing your vaccination record does not share your
-- medication list. The scopes are separate because the decisions are.
drop policy if exists "viewer with active consent" on public.health_records;
create policy "viewer with active consent" on public.health_records
  for select using (
    case kind
      when 'medication'   then public.has_health_consent(owner_id, 'medications')
      when 'vaccination'  then public.has_health_consent(owner_id, 'vaccinations')
      -- Conditions and allergies ride with 'notes', which is the scope whose
      -- label says "the rest of it" on the sharing screen.
      else public.has_health_consent(owner_id, 'notes')
    end
  );

-- Reference data, readable by anyone signed in, written by migration only.
drop policy if exists "signed in read" on public.medication_restrictions;
create policy "signed in read" on public.medication_restrictions
  for select using (auth.uid() is not null);

-- =============================================================================
-- Hard delete.
--
-- Spec 12.2, and the reason this is an RPC rather than three client deletes:
-- it has to be one transaction. A delete that removed the cycle logs, failed,
-- and left the consents behind would leave somebody believing they had erased
-- something they had not.
-- =============================================================================
create or replace function public.delete_all_health_data()
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.cycle_logs      where owner_id = auth.uid();
  delete from public.health_records  where owner_id = auth.uid();
  delete from public.health_consents where owner_id = auth.uid();
end $$;

-- =============================================================================
-- Seed: medication restrictions.
--
-- Deliberately tiny, and every row carries the official source. These are
-- pointers to guidance, not the guidance — the app links and says "check",
-- and never tells anyone whether they may carry something.
-- =============================================================================
insert into public.medication_restrictions
  (country_code, substance, restriction, source_url, verified_on)
values
  ('JP', 'pseudoephedrine', 'Prohibited — commonly found in cold and sinus remedies',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('JP', 'codeine', 'Restricted — limits apply and prior permission may be needed',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('JP', 'amphetamine', 'Prohibited, including some prescribed ADHD medicines',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('AE', 'codeine', 'Controlled — prior approval and documentation required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('AE', 'tramadol', 'Controlled — prior approval and documentation required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('AE', 'cannabidiol', 'Prohibited',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('SG', 'codeine', 'Controlled — approval needed before arrival',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-14'),
  ('SG', 'cannabidiol', 'Prohibited',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-14'),
  ('US', 'pseudoephedrine', 'Sale restricted; quantity limits apply',
   'https://www.fda.gov/drugs/information-drug-class/legal-requirements-sale-and-purchase-drug-products-containing-pseudoephedrine-ephedrine-and', '2026-08-14'),
  ('GB', 'tramadol', 'Controlled — carry a prescription and a letter for longer trips',
   'https://www.gov.uk/travelling-controlled-drugs', '2026-08-14'),
  ('IN', 'tramadol', 'Controlled substance',
   'https://cdsco.gov.in/opencms/opencms/en/Home/', '2026-08-14')
on conflict do nothing;

-- =============================================================================
-- Grants.
-- =============================================================================
grant execute on function public.has_health_consent(uuid, text) to authenticated;
grant execute on function public.delete_all_health_data()       to authenticated;
revoke all on function public.has_health_consent(uuid, text)    from public, anon;
revoke all on function public.delete_all_health_data()          from public, anon;


-- ===========================================================================
-- 0015_scheduling.sql
-- ===========================================================================

-- =============================================================================
-- 0015_scheduling — the thing standing between "all phases done" and "usable
-- without supervision".
--
-- **The sweeps had routes and no schedule.** Three Route Handlers existed and
-- nothing ever called them. One of those is not a tidiness problem: without
-- `deactivate_finished_flights`, a flight whose landing was missed polls
-- AeroDataBox until the month's 600 units are gone. The other two quietly
-- accumulate — trashed photos never leave a one-gigabyte bucket, and expenses
-- that missed a rate stay uncounted forever.
--
-- The stay-allowance alert that priority 3 was reserved for lands in the same
-- change, but in the client rather than here: adding one field to the
-- `dashboard()` payload would have meant restating a hundred and forty lines
-- of JSON construction in a second migration, and two places to maintain it.
-- The country comes from one small indexed read instead.
-- =============================================================================

-- =============================================================================
-- Scheduling.
--
-- pg_cron runs inside the database and pg_net makes the HTTP call, so the
-- sweeps happen whether or not anyone has the app open — which is the entire
-- point of the flight one.
--
-- The secret and the base URL live in Vault rather than in this file. A
-- migration is committed to a public repository; a shared secret in one is not
-- a secret. `schedule_sweeps()` reads them at call time, so this migration is
-- safe to apply before either exists.
-- =============================================================================
-- Guarded, because the scratch Postgres the migrations are tested against has
-- neither. The functions below are plpgsql, so they create cleanly without the
-- extensions present and only need them when they actually run.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

/**
 * Call one of our own cron routes.
 *
 * Reads the base URL and the shared secret from Vault every time rather than
 * baking them in, so rotating the secret is one `vault.update_secret` and no
 * re-scheduling. Returns the request id pg_net hands back; the response
 * arrives asynchronously in `net._http_response` and nothing here waits on it.
 */
create or replace function public.invoke_sweep(path text)
returns bigint language plpgsql security definer
set search_path = public, vault, net as $$
declare
  base    text;
  secret  text;
  bypass  text;
  headers jsonb;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret';

  if base is null or secret is null then
    -- Loud in the logs, but not an exception: a failed sweep must not abort
    -- the cron worker or leave the job in a broken state.
    raise warning 'invoke_sweep: app_base_url or cron_secret missing from vault';
    return null;
  end if;

  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-secret', secret
  );

  -- Vercel Deployment Protection answers 401 to anything without a browser
  -- session, which includes every one of these calls. Where it is left on,
  -- "Protection Bypass for Automation" issues a token that gets past it. The
  -- secret is optional: absent, this behaves exactly as before, which is
  -- correct for a deployment that is not protected.
  select decrypted_secret into bypass
    from vault.decrypted_secrets where name = 'vercel_bypass_token';
  if bypass is not null then
    headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass);
  end if;

  return net.http_post(
    url     := base || path,
    headers := headers,
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

/**
 * Put the schedules in place. Idempotent — unschedules first, so running it
 * again after a URL change or a redeploy cannot leave two of anything.
 *
 * The times are deliberate. The flight sweep is frequent because a flight's
 * phase changes on its own and the whole budget discipline depends on the hard
 * stop firing promptly. The other two are daily and nocturnal because nothing
 * about them is urgent and a quiet hour is a cheap hour.
 */
create or replace function public.schedule_sweeps()
returns void language plpgsql security definer
set search_path = public, cron as $$
declare
  job record;
begin
  for job in
    select * from (values
      -- Every 30 minutes: the hard stop on finished flights, then a refresh of
      -- the ones actually in the air. This is the one with money attached.
      ('meridian-flight-sweep',  '*/30 * * * *', '/api/cron/flight-sweep'),
      -- 03:15 UTC: hard-delete trashed photos, objects before rows.
      ('meridian-media-sweep',   '15 3 * * *',   '/api/cron/media-sweep'),
      -- 03:45 UTC: convert the expenses that saved while FX was unreachable.
      ('meridian-fx-backfill',   '45 3 * * *',   '/api/cron/fx-backfill')
    ) as t(name, schedule, path)
  loop
    perform cron.unschedule(job.name)
      where exists (select 1 from cron.job j where j.jobname = job.name);

    perform cron.schedule(
      job.name,
      job.schedule,
      format('select public.invoke_sweep(%L)', job.path)
    );
  end loop;
end $$;

-- Nobody calls either of these through the API. They are operational.
revoke all on function public.invoke_sweep(text)  from public, anon, authenticated;
revoke all on function public.schedule_sweeps()   from public, anon, authenticated;

-- =============================================================================
-- pg_net's own grants, and what could not be done about them.
--
-- Enabling pg_net creates a `net` schema whose functions Supabase grants to
-- `anon` and `authenticated` — which means, on paper, that the key shipped in
-- the browser bundle can ask the database to make an HTTP request. That is
-- server-side request forgery with the database's network position, and it is
-- worth being precise about.
--
-- The revoke below is attempted and mostly does not take: those grants were
-- made by `supabase_admin`, and a role can only revoke what it or a role it
-- belongs to granted. Running as `postgres`, it silently no-ops. It is kept
-- because on a self-hosted database, where `postgres` does own them, it works.
--
-- What actually keeps this closed is that PostgREST only routes schemas on the
-- project's exposed list, which defaults to `public, graphql_public`. `net` is
-- not on it, so there is no path from an anon key to `net.http_post`.
--
-- **The check to keep making:** Supabase dashboard → Project Settings → API →
-- Exposed schemas. If `net` ever appears there, this becomes live, and the
-- fix is to remove it rather than to trust the grants.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    begin
      revoke all on schema net from public, anon, authenticated;
      revoke all on all functions in schema net from public, anon, authenticated;
    exception when insufficient_privilege or others then
      raise notice 'net grants are owned elsewhere; see the comment above';
    end;
  end if;
end $$;


-- ===========================================================================
-- 0016_airports.sql
-- ===========================================================================

-- =============================================================================
-- 0016_airports — the reference data the flight module was missing.
--
-- `flights` has carried `origin_iata`, `origin_lat`, `origin_tz` and their
-- destination twins since 0010, and nothing could fill them. The lookup route
-- resolves a route from AeroDataBox, and with no key configured — which is the
-- documented, supported baseline — every flight saved as `??? → ???`, drew no
-- great circle, and could not compute a meeting time.
--
-- Manual entry is the baseline for this module, so the baseline has to be able
-- to name an airport. That needs a table: an IATA code alone is a label, and
-- the map wants coordinates while the dual-time display wants a zone.
--
-- Reference data, so it is seeded here and written by nobody through the API,
-- exactly like `visa_rules` and `medication_restrictions`. Around 120 airports
-- rather than the full nine thousand: these are the ones this app's users
-- plausibly fly through, the file stays readable, and an unlisted airport is
-- still enterable by code — it just carries no coordinates until somebody adds
-- a row.
-- =============================================================================
create table if not exists public.airports (
  iata         text primary key,
  icao         text,
  name         text not null,
  city         text not null,
  country_code text not null,
  lat          numeric not null,
  lng          numeric not null,
  timezone     text not null,
  created_at   timestamptz not null default now(),
  constraint iata_is_code check (iata ~ '^[A-Z]{3}$')
);

create index if not exists airports_city_idx on public.airports (lower(city));
create index if not exists airports_country_idx on public.airports (country_code);

alter table public.airports enable row level security;

drop policy if exists "signed in read" on public.airports;
create policy "signed in read" on public.airports
  for select using (auth.uid() is not null);

-- =============================================================================
-- Seed.
--
-- Coordinates are the published airport reference points; timezones are IANA
-- names, because a fixed offset is wrong twice a year.
-- =============================================================================
insert into public.airports (iata, icao, name, city, country_code, lat, lng, timezone) values
  -- India
  ('IXE','VOML','Mangaluru International','Mangaluru','IN',12.9613,74.8901,'Asia/Kolkata'),
  ('BOM','VABB','Chhatrapati Shivaji Maharaj International','Mumbai','IN',19.0887,72.8679,'Asia/Kolkata'),
  ('DEL','VIDP','Indira Gandhi International','Delhi','IN',28.5562,77.1000,'Asia/Kolkata'),
  ('BLR','VOBL','Kempegowda International','Bengaluru','IN',13.1986,77.7066,'Asia/Kolkata'),
  ('MAA','VOMM','Chennai International','Chennai','IN',12.9941,80.1709,'Asia/Kolkata'),
  ('HYD','VOHS','Rajiv Gandhi International','Hyderabad','IN',17.2403,78.4294,'Asia/Kolkata'),
  ('COK','VOCI','Cochin International','Kochi','IN',10.1520,76.4019,'Asia/Kolkata'),
  ('CCU','VECC','Netaji Subhas Chandra Bose International','Kolkata','IN',22.6547,88.4467,'Asia/Kolkata'),
  ('GOI','VAGO','Goa International (Dabolim)','Goa','IN',15.3808,73.8314,'Asia/Kolkata'),
  ('AMD','VAAH','Sardar Vallabhbhai Patel International','Ahmedabad','IN',23.0772,72.6347,'Asia/Kolkata'),
  ('PNQ','VAPO','Pune','Pune','IN',18.5793,73.9089,'Asia/Kolkata'),
  ('TRV','VOTV','Trivandrum International','Thiruvananthapuram','IN',8.4821,76.9201,'Asia/Kolkata'),
  ('CCJ','VOCL','Calicut International','Kozhikode','IN',11.1368,75.9553,'Asia/Kolkata'),
  -- Gulf and Middle East
  ('DXB','OMDB','Dubai International','Dubai','AE',25.2532,55.3657,'Asia/Dubai'),
  ('AUH','OMAA','Zayed International','Abu Dhabi','AE',24.4330,54.6511,'Asia/Dubai'),
  ('SHJ','OMSJ','Sharjah International','Sharjah','AE',25.3286,55.5172,'Asia/Dubai'),
  ('DOH','OTHH','Hamad International','Doha','QA',25.2731,51.6081,'Asia/Qatar'),
  ('RUH','OERK','King Khalid International','Riyadh','SA',24.9576,46.6988,'Asia/Riyadh'),
  ('JED','OEJN','King Abdulaziz International','Jeddah','SA',21.6796,39.1565,'Asia/Riyadh'),
  ('KWI','OKKK','Kuwait International','Kuwait City','KW',29.2266,47.9689,'Asia/Kuwait'),
  ('BAH','OBBI','Bahrain International','Manama','BH',26.2708,50.6336,'Asia/Bahrain'),
  ('MCT','OOMS','Muscat International','Muscat','OM',23.5933,58.2844,'Asia/Muscat'),
  ('TLV','LLBG','Ben Gurion','Tel Aviv','IL',32.0114,34.8867,'Asia/Jerusalem'),
  ('AMM','OJAI','Queen Alia International','Amman','JO',31.7226,35.9932,'Asia/Amman'),
  ('IST','LTFM','Istanbul','Istanbul','TR',41.2753,28.7519,'Europe/Istanbul'),
  ('SAW','LTFJ','Sabiha Gokcen','Istanbul','TR',40.8986,29.3092,'Europe/Istanbul'),
  -- United Kingdom and Ireland
  ('LHR','EGLL','Heathrow','London','GB',51.4700,-0.4543,'Europe/London'),
  ('LGW','EGKK','Gatwick','London','GB',51.1537,-0.1821,'Europe/London'),
  ('STN','EGSS','Stansted','London','GB',51.8860,0.2389,'Europe/London'),
  ('LTN','EGGW','Luton','London','GB',51.8747,-0.3683,'Europe/London'),
  ('MAN','EGCC','Manchester','Manchester','GB',53.3654,-2.2728,'Europe/London'),
  ('EDI','EGPH','Edinburgh','Edinburgh','GB',55.9500,-3.3725,'Europe/London'),
  ('BHX','EGBB','Birmingham','Birmingham','GB',52.4539,-1.7480,'Europe/London'),
  ('GLA','EGPF','Glasgow','Glasgow','GB',55.8719,-4.4331,'Europe/London'),
  ('DUB','EIDW','Dublin','Dublin','IE',53.4213,-6.2701,'Europe/Dublin'),
  -- Continental Europe
  ('CDG','LFPG','Charles de Gaulle','Paris','FR',49.0097,2.5479,'Europe/Paris'),
  ('ORY','LFPO','Orly','Paris','FR',48.7233,2.3794,'Europe/Paris'),
  ('AMS','EHAM','Schiphol','Amsterdam','NL',52.3105,4.7683,'Europe/Amsterdam'),
  ('FRA','EDDF','Frankfurt','Frankfurt','DE',50.0379,8.5622,'Europe/Berlin'),
  ('MUC','EDDM','Munich','Munich','DE',48.3538,11.7861,'Europe/Berlin'),
  ('BER','EDDB','Brandenburg','Berlin','DE',52.3667,13.5033,'Europe/Berlin'),
  ('MAD','LEMD','Adolfo Suarez Barajas','Madrid','ES',40.4936,-3.5668,'Europe/Madrid'),
  ('BCN','LEBL','El Prat','Barcelona','ES',41.2974,2.0833,'Europe/Madrid'),
  ('LIS','LPPT','Humberto Delgado','Lisbon','PT',38.7742,-9.1342,'Europe/Lisbon'),
  ('OPO','LPPR','Francisco Sa Carneiro','Porto','PT',41.2481,-8.6814,'Europe/Lisbon'),
  ('FCO','LIRF','Fiumicino','Rome','IT',41.8003,12.2389,'Europe/Rome'),
  ('MXP','LIMC','Malpensa','Milan','IT',45.6306,8.7281,'Europe/Rome'),
  ('VCE','LIPZ','Marco Polo','Venice','IT',45.5053,12.3519,'Europe/Rome'),
  ('NAP','LIRN','Naples','Naples','IT',40.8860,14.2908,'Europe/Rome'),
  ('ATH','LGAV','Eleftherios Venizelos','Athens','GR',37.9364,23.9445,'Europe/Athens'),
  ('ZRH','LSZH','Zurich','Zurich','CH',47.4647,8.5492,'Europe/Zurich'),
  ('GVA','LSGG','Geneva','Geneva','CH',46.2381,6.1089,'Europe/Zurich'),
  ('VIE','LOWW','Vienna','Vienna','AT',48.1103,16.5697,'Europe/Vienna'),
  ('BRU','EBBR','Brussels','Brussels','BE',50.9014,4.4844,'Europe/Brussels'),
  ('CPH','EKCH','Kastrup','Copenhagen','DK',55.6180,12.6508,'Europe/Copenhagen'),
  ('ARN','ESSA','Arlanda','Stockholm','SE',59.6519,17.9186,'Europe/Stockholm'),
  ('OSL','ENGM','Gardermoen','Oslo','NO',60.1976,11.1004,'Europe/Oslo'),
  ('HEL','EFHK','Vantaa','Helsinki','FI',60.3172,24.9633,'Europe/Helsinki'),
  ('KEF','BIKF','Keflavik','Reykjavik','IS',63.9850,-22.6056,'Atlantic/Reykjavik'),
  ('WAW','EPWA','Chopin','Warsaw','PL',52.1657,20.9671,'Europe/Warsaw'),
  ('PRG','LKPR','Vaclav Havel','Prague','CZ',50.1008,14.2600,'Europe/Prague'),
  ('BUD','LHBP','Ferenc Liszt','Budapest','HU',47.4369,19.2556,'Europe/Budapest'),
  ('OTP','LROP','Henri Coanda','Bucharest','RO',44.5711,26.0850,'Europe/Bucharest'),
  ('SOF','LBSF','Sofia','Sofia','BG',42.6952,23.4062,'Europe/Sofia'),
  ('ZAG','LDZA','Franjo Tudman','Zagreb','HR',45.7429,16.0688,'Europe/Zagreb'),
  ('BEG','LYBE','Nikola Tesla','Belgrade','RS',44.8184,20.3091,'Europe/Belgrade'),
  ('KBP','UKBB','Boryspil','Kyiv','UA',50.3450,30.8947,'Europe/Kyiv'),
  -- North America
  ('JFK','KJFK','John F Kennedy International','New York','US',40.6413,-73.7781,'America/New_York'),
  ('EWR','KEWR','Newark Liberty','New York','US',40.6895,-74.1745,'America/New_York'),
  ('LGA','KLGA','LaGuardia','New York','US',40.7769,-73.8740,'America/New_York'),
  ('BOS','KBOS','Logan International','Boston','US',42.3656,-71.0096,'America/New_York'),
  ('IAD','KIAD','Dulles International','Washington','US',38.9531,-77.4565,'America/New_York'),
  ('ATL','KATL','Hartsfield-Jackson','Atlanta','US',33.6407,-84.4277,'America/New_York'),
  ('MIA','KMIA','Miami International','Miami','US',25.7959,-80.2870,'America/New_York'),
  ('ORD','KORD','O''Hare International','Chicago','US',41.9742,-87.9073,'America/Chicago'),
  ('DFW','KDFW','Dallas Fort Worth','Dallas','US',32.8998,-97.0403,'America/Chicago'),
  ('IAH','KIAH','George Bush Intercontinental','Houston','US',29.9902,-95.3368,'America/Chicago'),
  ('DEN','KDEN','Denver International','Denver','US',39.8561,-104.6737,'America/Denver'),
  ('PHX','KPHX','Sky Harbor','Phoenix','US',33.4342,-112.0116,'America/Phoenix'),
  ('LAX','KLAX','Los Angeles International','Los Angeles','US',33.9416,-118.4085,'America/Los_Angeles'),
  ('SFO','KSFO','San Francisco International','San Francisco','US',37.6213,-122.3790,'America/Los_Angeles'),
  ('SEA','KSEA','Seattle-Tacoma','Seattle','US',47.4502,-122.3088,'America/Los_Angeles'),
  ('LAS','KLAS','Harry Reid International','Las Vegas','US',36.0840,-115.1537,'America/Los_Angeles'),
  ('YYZ','CYYZ','Toronto Pearson','Toronto','CA',43.6777,-79.6248,'America/Toronto'),
  ('YUL','CYUL','Montreal-Trudeau','Montreal','CA',45.4706,-73.7408,'America/Toronto'),
  ('YVR','CYVR','Vancouver International','Vancouver','CA',49.1967,-123.1815,'America/Vancouver'),
  ('YYC','CYYC','Calgary International','Calgary','CA',51.1315,-114.0106,'America/Edmonton'),
  ('MEX','MMMX','Benito Juarez','Mexico City','MX',19.4363,-99.0721,'America/Mexico_City'),
  ('CUN','MMUN','Cancun International','Cancun','MX',21.0365,-86.8771,'America/Cancun'),
  -- South America
  ('GRU','SBGR','Guarulhos','Sao Paulo','BR',-23.4356,-46.4731,'America/Sao_Paulo'),
  ('GIG','SBGL','Galeao','Rio de Janeiro','BR',-22.8100,-43.2506,'America/Sao_Paulo'),
  ('EZE','SAEZ','Ezeiza','Buenos Aires','AR',-34.8222,-58.5358,'America/Argentina/Buenos_Aires'),
  ('SCL','SCEL','Arturo Merino Benitez','Santiago','CL',-33.3930,-70.7858,'America/Santiago'),
  ('LIM','SPJC','Jorge Chavez','Lima','PE',-12.0219,-77.1143,'America/Lima'),
  ('BOG','SKBO','El Dorado','Bogota','CO',4.7016,-74.1469,'America/Bogota'),
  -- Africa
  ('CAI','HECA','Cairo International','Cairo','EG',30.1219,31.4056,'Africa/Cairo'),
  ('CMN','GMMN','Mohammed V','Casablanca','MA',33.3675,-7.5899,'Africa/Casablanca'),
  ('RAK','GMMX','Menara','Marrakesh','MA',31.6069,-8.0363,'Africa/Casablanca'),
  ('JNB','FAOR','O R Tambo','Johannesburg','ZA',-26.1392,28.2460,'Africa/Johannesburg'),
  ('CPT','FACT','Cape Town International','Cape Town','ZA',-33.9649,18.6017,'Africa/Johannesburg'),
  ('NBO','HKJK','Jomo Kenyatta','Nairobi','KE',-1.3192,36.9278,'Africa/Nairobi'),
  ('ADD','HAAB','Bole International','Addis Ababa','ET',8.9779,38.7993,'Africa/Addis_Ababa'),
  ('DAR','HTDA','Julius Nyerere','Dar es Salaam','TZ',-6.8781,39.2026,'Africa/Dar_es_Salaam'),
  ('ZNZ','HTZA','Abeid Amani Karume','Zanzibar','TZ',-6.2220,39.2249,'Africa/Dar_es_Salaam'),
  -- South and Southeast Asia
  ('CMB','VCBI','Bandaranaike International','Colombo','LK',7.1808,79.8841,'Asia/Colombo'),
  ('MLE','VRMM','Velana International','Male','MV',4.1918,73.5291,'Indian/Maldives'),
  ('KTM','VNKT','Tribhuvan International','Kathmandu','NP',27.6966,85.3591,'Asia/Kathmandu'),
  ('DAC','VGHS','Hazrat Shahjalal','Dhaka','BD',23.8433,90.3978,'Asia/Dhaka'),
  ('KHI','OPKC','Jinnah International','Karachi','PK',24.9065,67.1608,'Asia/Karachi'),
  ('LHE','OPLA','Allama Iqbal International','Lahore','PK',31.5216,74.4036,'Asia/Karachi'),
  ('ISB','OPIS','Islamabad International','Islamabad','PK',33.5490,72.8256,'Asia/Karachi'),
  ('BKK','VTBS','Suvarnabhumi','Bangkok','TH',13.6900,100.7501,'Asia/Bangkok'),
  ('DMK','VTBD','Don Mueang','Bangkok','TH',13.9126,100.6068,'Asia/Bangkok'),
  ('HKT','VTSP','Phuket International','Phuket','TH',8.1132,98.3169,'Asia/Bangkok'),
  ('SIN','WSSS','Changi','Singapore','SG',1.3644,103.9915,'Asia/Singapore'),
  ('KUL','WMKK','Kuala Lumpur International','Kuala Lumpur','MY',2.7456,101.7099,'Asia/Kuala_Lumpur'),
  ('CGK','WIII','Soekarno-Hatta','Jakarta','ID',-6.1256,106.6559,'Asia/Jakarta'),
  ('DPS','WADD','Ngurah Rai','Bali','ID',-8.7482,115.1672,'Asia/Makassar'),
  ('MNL','RPLL','Ninoy Aquino','Manila','PH',14.5086,121.0198,'Asia/Manila'),
  ('SGN','VVTS','Tan Son Nhat','Ho Chi Minh City','VN',10.8188,106.6520,'Asia/Ho_Chi_Minh'),
  ('HAN','VVNB','Noi Bai','Hanoi','VN',21.2212,105.8072,'Asia/Ho_Chi_Minh'),
  -- East Asia
  ('HKG','VHHH','Hong Kong International','Hong Kong','HK',22.3080,113.9185,'Asia/Hong_Kong'),
  ('PVG','ZSPD','Pudong','Shanghai','CN',31.1443,121.8083,'Asia/Shanghai'),
  ('PEK','ZBAA','Capital','Beijing','CN',40.0799,116.6031,'Asia/Shanghai'),
  ('CAN','ZGGG','Baiyun','Guangzhou','CN',23.3924,113.2988,'Asia/Shanghai'),
  ('TPE','RCTP','Taoyuan','Taipei','TW',25.0777,121.2328,'Asia/Taipei'),
  ('ICN','RKSI','Incheon','Seoul','KR',37.4602,126.4407,'Asia/Seoul'),
  ('NRT','RJAA','Narita','Tokyo','JP',35.7720,140.3929,'Asia/Tokyo'),
  ('HND','RJTT','Haneda','Tokyo','JP',35.5494,139.7798,'Asia/Tokyo'),
  ('KIX','RJBB','Kansai','Osaka','JP',34.4342,135.2328,'Asia/Tokyo'),
  -- Oceania
  ('SYD','YSSY','Kingsford Smith','Sydney','AU',-33.9399,151.1753,'Australia/Sydney'),
  ('MEL','YMML','Tullamarine','Melbourne','AU',-37.6690,144.8410,'Australia/Melbourne'),
  ('BNE','YBBN','Brisbane','Brisbane','AU',-27.3842,153.1175,'Australia/Brisbane'),
  ('PER','YPPH','Perth','Perth','AU',-31.9403,115.9670,'Australia/Perth'),
  ('AKL','NZAA','Auckland','Auckland','NZ',-37.0082,174.7850,'Pacific/Auckland')
on conflict (iata) do nothing;

