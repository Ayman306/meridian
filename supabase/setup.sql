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

