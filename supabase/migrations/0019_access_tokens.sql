-- =============================================================================
-- 0019_access_tokens — personal access tokens, so an AI assistant can hold a
-- credential of its own instead of borrowing a browser session.
--
-- The shape of the problem: an MCP server runs outside the browser and needs to
-- act as one person, against their data, with RLS still doing the enforcing.
-- Three ways that could have gone, and why this is the one:
--
--   1. Hand it the service-role key. Bypasses RLS entirely, which would make
--      application code the only thing standing between a prompt-injected
--      instruction and every couple's rows. Refused — non-negotiable #1.
--   2. Copy a browser refresh token out of devtools. Works, but it is the full
--      session: everything the person can do, no scope, no expiry anyone can
--      see, and revoking it means signing out everywhere.
--   3. This. A token minted on purpose, named, scoped to a subset of modules,
--      revocable on its own, and exchanged for a *short-lived user JWT* that
--      PostgREST evaluates under the ordinary policies.
--
-- The exchange is the important part. This table never grants data access. It
-- answers one question — "which user is this token, and what may it see" — and
-- the answer becomes a ten-minute JWT with that user's `sub`. Every subsequent
-- read is the same query the browser would make, judged by the same policy. A
-- token cannot reach another couple's trips because `is_couple_member` says so,
-- not because a Route Handler remembered to filter.
--
-- Only the SHA-256 of a token is stored, so a leak of this table is not a leak
-- of anybody's credentials — the same reason password tables hold hashes. The
-- raw token is shown once, at creation, and is unrecoverable afterwards.
-- =============================================================================
create table if not exists public.access_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- What it is for, in the owner's words: "Claude on my laptop".
  name         text not null,
  -- SHA-256 hex of the raw token. Never the token.
  token_hash   text not null unique,
  -- The first few characters, so a list of tokens is distinguishable without
  -- being usable. Displayed as `mrd_3f8a…`.
  prefix       text not null,
  -- Which modules this token may reach. A subset of `all_modules()`; the
  -- server refuses to build tools outside it. Narrower than the person's own
  -- access, never wider — a token cannot grant what its owner does not have,
  -- because RLS still answers to the owner's id.
  modules      text[] not null default '{}',
  created_at   timestamptz not null default now(),
  -- Set on every successful exchange, so an unused token is visibly unused and
  -- a stolen one shows activity its owner did not cause.
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  constraint name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists access_tokens_user_idx
  on public.access_tokens (user_id)
  where revoked_at is null;

alter table public.access_tokens enable row level security;

-- Owner-scoped, like health. A partner has no business listing the credentials
-- on somebody else's account, and there is no consent path that would change
-- that: this is not shared data, it is somebody's keys.
drop policy if exists "owner only" on public.access_tokens;
create policy "owner only" on public.access_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Column-level enforcement, not a convention the next screen has to remember.
-- The owner may list their tokens; the owner may not read the hashes back.
-- Brute-forcing a 256-bit random token from its SHA-256 is not a practical
-- attack, but a hash nobody needs to read is a hash nobody should be handed.
--
-- The table-level grant has to go first. `revoke select (token_hash)` on its
-- own is silently useless here: default privileges (and Supabase's own grants)
-- hand `authenticated` a table-wide SELECT, and a table-level privilege covers
-- every column regardless of what was revoked column-by-column. So the whole
-- grant is withdrawn and the readable columns are given back by name.
--
-- INSERT stays table-wide on purpose — the browser has to write `token_hash`,
-- it just may never read one back.
revoke select on public.access_tokens from authenticated;
grant select (
  id, user_id, name, prefix, modules, created_at, last_used_at, expires_at, revoked_at
) on public.access_tokens to authenticated;

-- The exchange endpoint verifies a presented token with the service role, which
-- is the one sanctioned use of it: establishing who is calling, before any data
-- is touched. Everything after that runs as the user.
