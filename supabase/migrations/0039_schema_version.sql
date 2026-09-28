-- =============================================================================
-- 0039_schema_version — the database says which migration it is on.
--
-- D139: 0033 and 0035 were merged and never applied, and nothing noticed. CI
-- builds its database from the repo, so it is always in sync with itself, and
-- the deployed app degraded quietly: the assistant's suggest_itinerary failed
-- against a column that did not exist.
--
-- So the schema now carries its own version, and the app carries the version
-- it was built for (`src/lib/schemaVersion.ts`). `/api/health` compares the
-- two on every call — the daily Vercel cron included — and reports `drift`
-- when they differ. After a merge that carries a migration, that is the page to
-- open; before the migration is applied it says so, and afterwards it stops.
--
-- ## The rule for every migration from here on
--
-- Redefine `schema_version()` to return the migration's own number, at the end
-- of the file. `src/lib/schemaVersion.test.ts` fails if the newest migration
-- does not, or if the app's constant disagrees with it — so forgetting is a
-- red test, not another silent gap.
-- =============================================================================

create or replace function public.schema_version()
returns int language sql immutable
set search_path = '' as $$
  select 39;
$$;

comment on function public.schema_version() is
  'The number of the newest migration applied. Every migration redefines it; /api/health compares it with the version the app was built for.';

-- `health()` is what the keep-alive cron calls, so the version rides along on
-- the call that already happens every day. A new key in the same jsonb: every
-- existing reader of `ok` and `at` is unaffected.
create or replace function public.health()
returns jsonb language sql stable
set search_path = public as $$
  select jsonb_build_object('ok', true, 'at', now(), 'schema', public.schema_version());
$$;

revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
grant execute on function public.health() to anon, authenticated;
