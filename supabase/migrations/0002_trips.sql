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
