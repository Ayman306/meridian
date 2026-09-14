-- =============================================================================
-- 0034_flight_date_follows_departure — one flight, one date.
--
-- `flights` carries the departure day twice: `flight_date`, a bare local date,
-- and `scheduled_departure`, an instant. Nothing kept them agreeing, and in
-- the live database three of seven rows did not:
--
--   6E1467   flight_date 2026-08-11   departs 2026-12-06 IXE   117 days apart
--   6E1468   flight_date 2026-08-11   departs 2026-11-03 DXB    84 days apart
--   LX140    flight_date 2026-11-08   departs 2026-11-07 ZRH     1 day  apart
--
-- ## How they drifted
--
-- The MCP builds the instant *from* `flight_date` and a local time, so it is
-- consistent by construction. The browser form did not: it wrote the date the
-- user typed and, separately, whatever instant a provider lookup returned. Ask
-- AeroDataBox about "6E1467" and it answers about the next occurrence of that
-- flight number, which may be months away. Both values were then saved, each
-- describing a different flight.
--
-- ## Which one is right
--
-- The instant. A departure time comes from a booking or a provider and carries
-- a zone; `flight_date` is a bare date somebody typed, and when the two
-- disagree it is the typed one that drifted. LX140 settles it on its own: it
-- is the second leg of a connection off LX87, which lands 05:15 on the 7th, so
-- a 12:20 departure on the 7th is right and the 8th is not.
--
-- ## Why a trigger rather than a constraint
--
-- `at time zone <column>` is STABLE, not IMMUTABLE, so it cannot appear in a
-- CHECK. A trigger is the stronger tool anyway: a constraint would reject the
-- write and leave the caller to fix it, while this one repairs the row. Every
-- writer obeys — the app, the MCP, a psql session, whatever replaces them.
--
-- The zone matters and UTC will not do. LX141 leaves Bengaluru at 04:50 on the
-- 30th, which is 23:20 on the 29th in UTC; comparing without the origin zone
-- reports a correct flight as a day out.
-- =============================================================================

create or replace function public.sync_flight_date()
returns trigger language plpgsql as $$
begin
  -- Nothing to derive from. An unresolved flight with no time is a supported
  -- state (spec 9.5, degradation level 6) and `flight_date` is all it has.
  if new.scheduled_departure is null or new.origin_tz is null then
    return new;
  end if;

  begin
    new.flight_date := (new.scheduled_departure at time zone new.origin_tz)::date;
  exception when others then
    -- An unrecognised zone is a data problem in `airports`, not a reason to
    -- refuse the write and lose the flight.
    null;
  end;

  return new;
end $$;

comment on function public.sync_flight_date() is
  'Keeps flights.flight_date equal to the local departure date at the origin airport. The instant is authoritative; the bare date follows it.';

drop trigger if exists flights_sync_date on public.flights;
create trigger flights_sync_date
  before insert or update of scheduled_departure, origin_tz, flight_date
  on public.flights
  for each row execute function public.sync_flight_date();

-- -----------------------------------------------------------------------------
-- Repair what already drifted.
--
-- Derived entirely from each row's own columns, so this is correct on any
-- database and a no-op on one that never drifted. Rows with no departure time
-- or no origin zone are left alone: there is nothing to derive from, and
-- guessing would be worse than the disagreement.
-- -----------------------------------------------------------------------------
update public.flights
   set flight_date = (scheduled_departure at time zone origin_tz)::date
 where scheduled_departure is not null
   and origin_tz is not null
   and flight_date is distinct from (scheduled_departure at time zone origin_tz)::date;
