-- =============================================================================
-- 0023_document_sweep_schedule — the fourth sweep.
--
-- `crossedThreshold` and `shouldAlert` were written and tested in Phase 4 and
-- called by nothing, because the notification channel did not exist yet. It
-- does now, so `/api/cron/document-sweep` is real and this puts it on a timer.
--
-- 04:15 UTC, after the media sweep and the FX backfill, so the three nightly
-- jobs do not contend. A document expiry is not urgent to the minute — what
-- matters is that it arrives once per threshold rather than every morning,
-- which is `shouldAlert`'s job and not the schedule's.
--
-- `schedule_sweeps()` is replaced wholesale rather than amended: it already
-- unschedules and reschedules every job it names, so redefining it with the
-- fourth row is the whole change, and there is one list rather than two places
-- to keep in agreement.
-- =============================================================================

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
      ('meridian-flight-sweep',   '*/30 * * * *', '/api/cron/flight-sweep'),
      -- 03:15 UTC: hard-delete trashed photos, objects before rows.
      ('meridian-media-sweep',    '15 3 * * *',   '/api/cron/media-sweep'),
      -- 03:45 UTC: convert the expenses that saved while FX was unreachable.
      ('meridian-fx-backfill',    '45 3 * * *',   '/api/cron/fx-backfill'),
      -- 04:15 UTC: tell people a passport is running out, once per threshold.
      ('meridian-document-sweep', '15 4 * * *',   '/api/cron/document-sweep')
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

revoke all on function public.schedule_sweeps() from public, anon, authenticated;
