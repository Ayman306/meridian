-- =============================================================================
-- 0029_webhook_sweep_schedule — the fifth sweep.
--
-- Every fifteen minutes, which is a deliberate middle. A webhook that tells a
-- shared channel "Ayman saved a place" is not urgent to the second, and a
-- tighter loop would mean five times the outbound requests for an endpoint that
-- may be down anyway.
--
-- It is also the only sweep that talks to somebody else's server, so the cost
-- of a mistake here is paid by them: a one-minute schedule pointed at a flaky
-- endpoint is indistinguishable from hammering it.
--
-- Replaced wholesale rather than amended, for the same reason 0023 was: the
-- function already unschedules and reschedules everything it names, so one list
-- beats two places to keep in agreement.
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
      -- Every 15: push what changed to whatever else they have connected.
      ('meridian-webhook-sweep',  '*/15 * * * *', '/api/cron/webhook-sweep'),
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
