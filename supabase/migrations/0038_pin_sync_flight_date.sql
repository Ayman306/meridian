-- =============================================================================
-- 0038_pin_sync_flight_date — the one function 0034 left with a mutable path.
--
-- Supabase's security advisor flagged `sync_flight_date` as the only function
-- in the schema without a pinned `search_path`. The risk is small, exactly as
-- it was for `set_updated_at` in 0004: it runs as invoker and touches only
-- `new`. But a trigger that resolves names against whatever path the writer
-- happens to have is the pattern 0004 already closed once, so it is closed the
-- same way here — pinned empty, which is safe because everything it uses
-- (`at time zone`, the `date` cast) lives in `pg_catalog`, which is always
-- searched first.
--
-- `alter function` rather than a restatement of the body, so this cannot drift
-- from 0034's logic. And like every trigger function since 0004, nobody calls
-- it directly: a trigger fires as its owner regardless of EXECUTE.
-- =============================================================================

alter function public.sync_flight_date() set search_path = '';

revoke all on function public.sync_flight_date() from public, anon, authenticated;
