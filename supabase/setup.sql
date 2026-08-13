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

