-- =============================================================================
-- 0035_open_ended_trips_roll_forward — the rolling horizon actually rolls.
--
-- Spec 3.6 says an open-ended trip renders a rolling thirty days forward, and
-- the comment in 0002 says so too. The code did something else:
--
--     horizon := coalesce(t.end_date, t.start_date + 30);
--
-- That is thirty days from the *start*, which is a fixed window, not a rolling
-- one. It is correct on the day a trip is created and wrong from day
-- thirty-one onward: someone six weeks into an open-ended stay opens the plan
-- and the grid simply stops, with no way to put anything on tomorrow.
--
-- The fix is to measure from today once the trip has begun:
--
--     coalesce(t.end_date, greatest(t.start_date, current_date) + 30)
--
-- `greatest` keeps a future trip anchored to its start — a stay beginning in
-- March still scaffolds March, not the thirty days after today — while a trip
-- already under way extends from now.
--
-- ## Growing only
--
-- The horizon moves forward, never back, so the delete at the end of this
-- function cannot reach a day that already holds an itinerary item. That
-- matters: `trip_days` rows are scaffolding, but what people hang on them is
-- not, and a shrinking window would take both.
--
-- ## Built on 0003's version, not 0002's
--
-- `sync_trip_days` is defined twice already: 0002 scaffolds the days, and 0003
-- replaces it to unschedule items back to the idea pool before their day is
-- deleted, so shortening a trip costs a slot and never the content. Writing
-- this from the 0002 body silently reverted that, and the database assertions
-- caught it — "it went back to the idea pool" failed within a minute of the
-- change. The unscheduling is carried forward here verbatim.
--
-- ## The date is UTC, and that is fine here
--
-- `current_date` is the database's, not the traveller's. For a thirty-day
-- horizon a few hours of skew is immaterial — the worst case is that the
-- thirtieth day appears a little early or a little late, and nothing reads
-- these rows as instants.
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

  -- Open-ended trips render a rolling thirty days forward (spec 3.6). Measured
  -- from today once the trip has started, so the grid keeps up with it, and
  -- from the start date while it is still ahead of us.
  horizon := coalesce(t.end_date, greatest(t.start_date, current_date) + 30);

  insert into public.trip_days (trip_id, date)
  select target, d::date
  from generate_series(t.start_date, horizon, interval '1 day') d
  on conflict (trip_id, date) do nothing;

  -- Carried forward from 0003: an item outside the window loses its slot, not
  -- its content.
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

comment on function public.sync_trip_days(uuid) is
  'Scaffolds trip_days between the start date and the horizon, unscheduling any item that falls outside it. An open-ended trip rolls thirty days forward from today once it has begun; a dated one ends at its end date.';

grant execute on function public.sync_trip_days(uuid) to authenticated;
