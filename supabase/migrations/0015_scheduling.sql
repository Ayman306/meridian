-- =============================================================================
-- 0015_scheduling — the thing standing between "all phases done" and "usable
-- without supervision".
--
-- **The sweeps had routes and no schedule.** Three Route Handlers existed and
-- nothing ever called them. One of those is not a tidiness problem: without
-- `deactivate_finished_flights`, a flight whose landing was missed polls
-- AeroDataBox until the month's 600 units are gone. The other two quietly
-- accumulate — trashed photos never leave a one-gigabyte bucket, and expenses
-- that missed a rate stay uncounted forever.
--
-- The stay-allowance alert that priority 3 was reserved for lands in the same
-- change, but in the client rather than here: adding one field to the
-- `dashboard()` payload would have meant restating a hundred and forty lines
-- of JSON construction in a second migration, and two places to maintain it.
-- The country comes from one small indexed read instead.
-- =============================================================================

-- =============================================================================
-- Scheduling.
--
-- pg_cron runs inside the database and pg_net makes the HTTP call, so the
-- sweeps happen whether or not anyone has the app open — which is the entire
-- point of the flight one.
--
-- The secret and the base URL live in Vault rather than in this file. A
-- migration is committed to a public repository; a shared secret in one is not
-- a secret. `schedule_sweeps()` reads them at call time, so this migration is
-- safe to apply before either exists.
-- =============================================================================
-- Guarded, because the scratch Postgres the migrations are tested against has
-- neither. The functions below are plpgsql, so they create cleanly without the
-- extensions present and only need them when they actually run.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

/**
 * Call one of our own cron routes.
 *
 * Reads the base URL and the shared secret from Vault every time rather than
 * baking them in, so rotating the secret is one `vault.update_secret` and no
 * re-scheduling. Returns the request id pg_net hands back; the response
 * arrives asynchronously in `net._http_response` and nothing here waits on it.
 */
create or replace function public.invoke_sweep(path text)
returns bigint language plpgsql security definer
set search_path = public, vault, net as $$
declare
  base    text;
  secret  text;
  bypass  text;
  headers jsonb;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret';

  if base is null or secret is null then
    -- Loud in the logs, but not an exception: a failed sweep must not abort
    -- the cron worker or leave the job in a broken state.
    raise warning 'invoke_sweep: app_base_url or cron_secret missing from vault';
    return null;
  end if;

  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-secret', secret
  );

  -- Vercel Deployment Protection answers 401 to anything without a browser
  -- session, which includes every one of these calls. Where it is left on,
  -- "Protection Bypass for Automation" issues a token that gets past it. The
  -- secret is optional: absent, this behaves exactly as before, which is
  -- correct for a deployment that is not protected.
  select decrypted_secret into bypass
    from vault.decrypted_secrets where name = 'vercel_bypass_token';
  if bypass is not null then
    headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass);
  end if;

  return net.http_post(
    url     := base || path,
    headers := headers,
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

/**
 * Put the schedules in place. Idempotent — unschedules first, so running it
 * again after a URL change or a redeploy cannot leave two of anything.
 *
 * The times are deliberate. The flight sweep is frequent because a flight's
 * phase changes on its own and the whole budget discipline depends on the hard
 * stop firing promptly. The other two are daily and nocturnal because nothing
 * about them is urgent and a quiet hour is a cheap hour.
 */
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
      ('meridian-flight-sweep',  '*/30 * * * *', '/api/cron/flight-sweep'),
      -- 03:15 UTC: hard-delete trashed photos, objects before rows.
      ('meridian-media-sweep',   '15 3 * * *',   '/api/cron/media-sweep'),
      -- 03:45 UTC: convert the expenses that saved while FX was unreachable.
      ('meridian-fx-backfill',   '45 3 * * *',   '/api/cron/fx-backfill')
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

-- Nobody calls either of these through the API. They are operational.
revoke all on function public.invoke_sweep(text)  from public, anon, authenticated;
revoke all on function public.schedule_sweeps()   from public, anon, authenticated;

-- =============================================================================
-- pg_net's own grants, and what could not be done about them.
--
-- Enabling pg_net creates a `net` schema whose functions Supabase grants to
-- `anon` and `authenticated` — which means, on paper, that the key shipped in
-- the browser bundle can ask the database to make an HTTP request. That is
-- server-side request forgery with the database's network position, and it is
-- worth being precise about.
--
-- The revoke below is attempted and mostly does not take: those grants were
-- made by `supabase_admin`, and a role can only revoke what it or a role it
-- belongs to granted. Running as `postgres`, it silently no-ops. It is kept
-- because on a self-hosted database, where `postgres` does own them, it works.
--
-- What actually keeps this closed is that PostgREST only routes schemas on the
-- project's exposed list, which defaults to `public, graphql_public`. `net` is
-- not on it, so there is no path from an anon key to `net.http_post`.
--
-- **The check to keep making:** Supabase dashboard → Project Settings → API →
-- Exposed schemas. If `net` ever appears there, this becomes live, and the
-- fix is to remove it rather than to trust the grants.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    begin
      revoke all on schema net from public, anon, authenticated;
      revoke all on all functions in schema net from public, anon, authenticated;
    exception when insufficient_privilege or others then
      raise notice 'net grants are owned elsewhere; see the comment above';
    end;
  end if;
end $$;
