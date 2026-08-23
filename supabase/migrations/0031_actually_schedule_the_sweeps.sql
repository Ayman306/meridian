-- =============================================================================
-- 0031 — call the function.
--
-- `schedule_sweeps()` has been defined three times: 0015 wrote it with three
-- jobs, 0023 added the document sweep, 0029 added the webhook sweep. **No
-- migration has ever called it.** The three jobs that exist on the live
-- database are there because somebody ran the function by hand, once, back
-- when it listed three — and every redefinition since has been dead code.
--
-- So the document-expiry sweep and the webhook sweep have never run anywhere.
-- Not on the live project, not in the test harness. 0023 and 0029 both read as
-- finished work and neither did anything, which is the same shape of mistake as
-- the empty realtime publication in 0026: a feature that is entirely present
-- except for the one line that switches it on.
--
-- The call is safe to repeat. The function unschedules each job by name before
-- rescheduling it, so running this on a database that already has all five
-- leaves five, and running it on one that has three brings it to five.
--
-- The lesson worth keeping: **a migration that only defines a scheduler has not
-- scheduled anything.** Any future change to the sweep list must end with this
-- same call, or it is a comment.
-- =============================================================================
-- Guarded on pg_cron existing, the same way 0026 is guarded on the realtime
-- publication existing: the scratch Postgres the RLS suite runs against has
-- neither, and a migration that cannot run there is a migration the suite
-- silently skips.
do $$
declare
  missing text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron is not installed here; nothing to schedule.';
    return;
  end if;

  perform public.schedule_sweeps();

  -- Proof, in the migration itself, rather than a thing to remember to check.
  -- If the function silently no-ops again, this fails loudly at deploy time
  -- instead of going quiet for another two months.
  select string_agg(expected.name, ', ')
    into missing
    from (values
      ('meridian-flight-sweep'),
      ('meridian-webhook-sweep'),
      ('meridian-media-sweep'),
      ('meridian-fx-backfill'),
      ('meridian-document-sweep')
    ) as expected(name)
   where not exists (
     select 1 from cron.job j where j.jobname = expected.name
   );

  if missing is not null then
    raise exception 'schedule_sweeps() did not schedule: %', missing;
  end if;
end $$;
