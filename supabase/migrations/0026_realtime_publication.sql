-- =============================================================================
-- 0026_realtime — the subscriptions have never received anything.
--
-- Six modules have had a realtime hook since their own phase: trips, itinerary,
-- wishlist, flights, gallery, budget. Each opens a channel, subscribes to
-- `postgres_changes`, and tears it down on unmount. All of it correct, and all
-- of it inert — because `supabase_realtime` is an empty publication, and
-- Postgres only sends change events for tables that are *in* one.
--
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime';   -- returned zero rows
--
-- So "two people editing one trip at the same time is normal, not an edge case"
-- was true as a design statement and false as a behaviour: the second person's
-- change appeared when the first navigated, which is what would have happened
-- with no realtime at all. Nothing errored, nothing logged, and the code looked
-- finished.
--
-- This is the same shape as D111 — a stored setting nobody read — and it is the
-- most expensive instance of it in the project, because six modules were built
-- on the assumption that it worked.
--
-- ## Why membership rather than `for all tables`
--
-- A publication over every table would broadcast `access_tokens`, and
-- `cycle_logs`, and every reference table. RLS still decides who may *receive*
-- a row, so that is not a leak — but it is a great deal of write-ahead log
-- traffic on a free tier for tables nothing subscribes to, and a publication is
-- a poor place to be relying on a second system to save you.
--
-- Health tables are deliberately absent for a different reason. They are
-- owner-private, only their owner can change them, and a second device is not a
-- collaboration scenario worth opening a broadcast surface for.
--
-- ## Replica identity
--
-- Left at the default. Every hook in this app reacts to a change by
-- invalidating a query and refetching, so it needs to know only *that*
-- something changed. `replica identity full` would put the entire old row into
-- the WAL on every update and delete, which is real cost for a payload nothing
-- reads.
-- =============================================================================

do $$
declare
  wanted text[] := array[
    -- Trips and the plan. The original "two people, one trip" case.
    'trips', 'trip_days', 'trip_travelers', 'trip_destinations',
    'itinerary_items', 'suggestion_tray',
    -- Where they sleep. Added with the accommodation module; the reason this
    -- migration got written at all.
    'accommodations',
    -- Saving and deciding together.
    'wishlist_items', 'wishlist_verdicts',
    -- Money. Two people entering expenses on the same evening is exactly when
    -- a stale balance misleads.
    'expenses', 'settlements', 'budgets',
    -- Flights. The one on the ground is the one watching.
    'flights', 'journeys', 'flight_events',
    -- Photos and the daily exchange.
    'media', 'media_comments', 'albums', 'daily_exchange',
    -- Documents: `is_shared` can be revoked, and a row the partner may no
    -- longer read should stop being on their screen.
    'documents',
    -- Immigration day counts, and any override either of them writes.
    'entry_exit_log', 'allowance_rules'
  ];
  name text;
begin
  -- The publication is created by Supabase, not by these migrations. A plain
  -- Postgres — the scratch database the RLS suite runs against, or somebody
  -- standing the schema up elsewhere — has no such object, and this migration
  -- has nothing to say there.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not present; skipping realtime membership.';
    return;
  end if;

  foreach name in array wanted loop
    -- Guarded on both sides: the table has to exist, and adding one twice is
    -- an error rather than a no-op, so this migration stays re-runnable.
    if to_regclass('public.' || name) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = name
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', name);
    end if;
  end loop;
end $$;
