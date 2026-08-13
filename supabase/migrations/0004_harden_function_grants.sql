-- =============================================================================
-- 0004_harden_function_grants — narrow the RPC surface to what is actually used.
--
-- Found by Supabase's database linter after 0001-0003 were applied to a real
-- project. Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- `anon` inherits PUBLIC — so every helper and trigger function was reachable
-- unauthenticated at /rest/v1/rpc/<name>. The earlier migrations granted to
-- `authenticated` but never revoked the default, which does nothing on its own.
--
-- Nothing was exploitable: every one of these either checks `auth.uid()`, goes
-- through is_couple_member(), or is a trigger function that fails without a NEW
-- record. But an unauthenticated caller had no business seeing them at all, and
-- "not exploitable today" is a weak thing to rely on as the app grows.
--
-- Functions are named one by one rather than with ALL FUNCTIONS IN SCHEMA,
-- because that would also strip Supabase's own platform functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pin the search_path on the one function that was missing it.
--
-- set_updated_at runs as invoker so the risk is small, but a mutable
-- search_path in a trigger means the function resolves `now()` against whatever
-- the caller's path happens to be. Pin it and qualify the call.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Trigger functions: never callable directly. A trigger fires as its owner
-- regardless of EXECUTE grants, so revoking costs nothing.
-- -----------------------------------------------------------------------------
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.handle_new_user()       from public, anon, authenticated;
revoke all on function public.enforce_couple_size()   from public, anon, authenticated;
revoke all on function public.promote_day_on_item()   from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal helper: only ever called from inside create_couple(), which is
-- SECURITY DEFINER and so does not need the caller to hold this grant.
-- -----------------------------------------------------------------------------
revoke all on function public.generate_invite_code() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Everything else: revoke the PUBLIC default, then grant back deliberately.
-- -----------------------------------------------------------------------------
revoke all on function public.is_couple_member(uuid)          from public, anon;
revoke all on function public.partner_id()                    from public, anon;
revoke all on function public.my_couple_id()                  from public, anon;
revoke all on function public.create_couple(text)             from public, anon;
revoke all on function public.join_couple(text)               from public, anon;
revoke all on function public.regenerate_invite_code()        from public, anon;
revoke all on function public.leave_couple()                  from public, anon;
revoke all on function public.seed_trip_statuses(uuid)        from public, anon;
revoke all on function public.seed_categories(uuid)           from public, anon;
revoke all on function public.sync_trip_days(uuid)            from public, anon;
revoke all on function public.trip_item_counts_by_day(uuid)   from public, anon;

grant execute on function public.is_couple_member(uuid)        to authenticated;
grant execute on function public.partner_id()                  to authenticated;
grant execute on function public.my_couple_id()                to authenticated;
grant execute on function public.create_couple(text)           to authenticated;
grant execute on function public.join_couple(text)             to authenticated;
grant execute on function public.regenerate_invite_code()      to authenticated;
grant execute on function public.leave_couple()                to authenticated;
grant execute on function public.seed_trip_statuses(uuid)      to authenticated;
grant execute on function public.seed_categories(uuid)         to authenticated;
grant execute on function public.sync_trip_days(uuid)          to authenticated;
grant execute on function public.trip_item_counts_by_day(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- health() is the one function that is meant to be anonymous: the keep-alive
-- cron calls it without a session. It returns a timestamp and nothing else.
-- -----------------------------------------------------------------------------
revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- And stop the default from reappearing on functions added by later migrations.
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;
