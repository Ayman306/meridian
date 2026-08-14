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
