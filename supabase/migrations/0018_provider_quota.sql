-- =============================================================================
-- 0018_provider_quota — the provider's own count, not just ours.
--
-- `api_usage` records every call this app makes, and the budget has been
-- enforced from it since 0010. That is a good counter and it is not the same
-- as the truth: it misses a call that reached AeroDataBox and then failed on
-- our side before it was recorded, it misses anything the key is used for
-- outside this app, and it starts at zero if the table is ever cleared.
--
-- AeroDataBox publishes what is actually left at `/subscriptions/balance`.
-- This table caches that answer so the guard can use the authoritative number
-- while calling for it rarely.
--
-- Rarely matters. The balance endpoint may itself count against the
-- subscription — the documentation does not promise otherwise — so it is
-- checked only when our own counter says we are near the ceiling, and the
-- answer is cached for six hours. In normal operation that is zero extra calls
-- a month; at worst it is about four a day, and only in the days where the
-- allowance is nearly gone anyway.
-- =============================================================================
create table if not exists public.provider_quota (
  provider     text primary key,
  -- What the provider says is left. Null when never successfully read.
  remaining    int,
  -- What the provider says the total is, in case the plan changes under us.
  total        int,
  checked_at   timestamptz not null default now(),
  -- The last error, so a silently failing balance check is visible rather than
  -- looking like an absent one.
  last_error   text,
  constraint valid_provider check (provider in ('aerodatabox', 'opensky'))
);

alter table public.provider_quota enable row level security;

-- Read-only to signed-in users so the settings screen can show what is left.
-- Written only by the service role, from the Route Handlers.
drop policy if exists "signed in read" on public.provider_quota;
create policy "signed in read" on public.provider_quota
  for select using (auth.uid() is not null);

insert into public.provider_quota (provider, remaining, total)
values ('aerodatabox', null, null), ('opensky', null, null)
on conflict (provider) do nothing;
