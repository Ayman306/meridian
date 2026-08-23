-- =============================================================================
-- 0030_oauth — an authorization server, and the reasoning for reversing a
-- decision this repo made deliberately in the other direction.
--
-- `mcp/README.md` said, and meant: no OAuth server, because hand-rolling one is
-- a large amount of security-critical code whose failure modes are silent. That
-- reasoning has not become wrong. What changed is the cost of the alternative.
--
-- The personal access token path works for any client that can be handed a
-- bearer header — the stdio server, the CLI, curl. It cannot work for a client
-- that only speaks OAuth, and the hosted surfaces (claude.ai, the mobile app)
-- are exactly those clients. The choice was therefore not "OAuth or a simpler
-- design", it was "OAuth or the app is unreachable from a phone". The owner
-- chose reachability, knowing the cost.
--
-- ## What limits the blast radius
--
-- The parts of OAuth that are most often got wrong are the parts not built:
--
--   * **No client secrets.** Public clients with PKCE only. There is no
--     confidential-client path, so there is no secret to leak, compare in
--     variable time, or forget to rotate.
--   * **No implicit grant, no password grant, no device flow.** One grant type
--     in and one refresh, both of which are exercised by tests.
--   * **No new credential store.** An issued access token is a row in
--     `access_tokens` — the same table, the same hash discipline, the same
--     Settings screen, the same revoke. A grant is a token somebody approved
--     through a different door, not a second kind of thing.
--
-- That last one is the reason this is tolerable at all. Every property already
-- proven about a PAT — hashed at rest, unreadable by its owner, scoped to
-- modules, exchanged for a ten-minute JWT, RLS as the actual boundary — holds
-- for an OAuth grant without a line of new enforcement.
--
-- ## What is genuinely new, and therefore genuinely worth reviewing
--
-- Two tables and two decisions: that an authorization code is single-use and
-- short-lived, and that a redirect URI is matched exactly. Those are the whole
-- security surface added here. They are small on purpose.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Registered clients.
--
-- RFC 7591 dynamic registration, which the MCP specification requires: a client
-- the owner has never heard of registers itself and gets an id. That sounds
-- alarming and is not, because registration grants nothing. A client id is a
-- name to show on a consent screen. Every actual grant still requires a person,
-- signed in, reading which modules were asked for, and pressing a button.
--
-- No RLS policy is written on purpose. RLS is enabled, nothing is granted, and
-- so only the service role reaches this table — the same posture the token
-- exchange already takes. There is no screen that lists other people's clients
-- because there is no reason for one to exist.
-- -----------------------------------------------------------------------------
create table if not exists public.oauth_clients (
  id            uuid primary key default gen_random_uuid(),
  -- Opaque, generated server-side. Not a secret; it is public by design.
  client_id     text not null unique,
  -- Shown to a person on the consent screen, so it is the client's claim about
  -- itself and must be rendered as untrusted text, never as markup.
  client_name   text not null,
  -- Exact-match allowlist. A code is only ever handed back to one of these.
  redirect_uris text[] not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,

  constraint client_has_redirects check (cardinality(redirect_uris) > 0),
  constraint client_name_not_blank check (length(btrim(client_name)) > 0)
);

alter table public.oauth_clients enable row level security;

comment on table public.oauth_clients is
  'Dynamically registered public OAuth clients. Registration grants nothing — every grant still needs a person at the consent screen. Service role only; no policies by design.';

-- -----------------------------------------------------------------------------
-- Authorization codes.
--
-- Hashed, exactly like a token: a code is a bearer credential for the sixty
-- seconds it lives, and a leaked database should not hand somebody a live one.
--
-- `consumed_at` rather than a delete, so replaying a code is *detectable* and
-- not merely ineffective. A second presentation of a spent code is one of the
-- few unambiguous signals of an attack this system can observe, and deleting
-- the row would throw it away.
-- -----------------------------------------------------------------------------
create table if not exists public.oauth_codes (
  id             uuid primary key default gen_random_uuid(),
  code_hash      text not null unique,
  client_id      text not null references public.oauth_clients(client_id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Bound at issue and re-checked at exchange. A code issued for one redirect
  -- may not be redeemed while claiming another.
  redirect_uri   text not null,
  -- PKCE. S256 only — `plain` is accepted by the RFC and is worthless against
  -- an attacker who can read the authorization request, which is the attacker
  -- PKCE exists for.
  code_challenge text not null,
  -- Which modules the person actually ticked, which is not necessarily what
  -- the client asked for.
  modules        text[] not null default '{}',
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  -- Which token this code produced, so that a code presented a second time can
  -- revoke what the first presentation issued. Without this, replay detection
  -- can refuse the replay but not undo the grant the attacker may already
  -- hold — which is the half that matters.
  issued_token_id uuid references public.access_tokens(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists oauth_codes_expiry_idx
  on public.oauth_codes (expires_at);

alter table public.oauth_codes enable row level security;

comment on table public.oauth_codes is
  'Single-use PKCE authorization codes, stored hashed and valid for seconds. consumed_at is kept rather than deleted so a replay is detectable, not merely refused. Service role only; no policies by design.';

-- -----------------------------------------------------------------------------
-- An OAuth grant is an access token, in the table that already exists.
--
-- The alternative was an `oauth_tokens` table, and it would have been a second
-- copy of the same idea: a hashed bearer credential, scoped to modules, owned
-- by a user, revocable. Two tables would mean two revoke paths, two expiry
-- checks, and one Settings screen that has to remember to read both — which is
-- precisely the shape of thing that ends with a revoked credential still
-- working somewhere.
-- -----------------------------------------------------------------------------
alter table public.access_tokens
  add column if not exists kind text not null default 'pat',
  -- Which client holds this grant. Null for a token a person made by hand.
  add column if not exists client_id text references public.oauth_clients(client_id) on delete cascade,
  -- Rotated on every refresh. Hashed, and as unreadable as `token_hash`.
  add column if not exists refresh_token_hash text unique,
  -- The hash this one replaced, kept for exactly one generation.
  --
  -- Rotation alone refuses a stale refresh token, because the hash no longer
  -- matches anything. It cannot tell the difference between a client that
  -- retried after a dropped response and an attacker replaying a stolen one.
  -- Keeping the previous hash makes that distinguishable: a presentation of
  -- the *superseded* token is reuse, and the whole grant is revoked on the
  -- spot. This is the detect-and-revoke behaviour OAuth 2.1 asks for, at the
  -- cost of one column.
  add column if not exists previous_refresh_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'access_tokens_kind_known'
  ) then
    alter table public.access_tokens
      add constraint access_tokens_kind_known check (kind in ('pat', 'oauth'));
  end if;

  -- A grant without a client is not a grant. Stated in the schema rather than
  -- left to the handler, because the handler is the thing being reviewed.
  if not exists (
    select 1 from pg_constraint where conname = 'access_tokens_oauth_has_client'
  ) then
    alter table public.access_tokens
      add constraint access_tokens_oauth_has_client
      check (kind = 'pat' or client_id is not null);
  end if;
end $$;

create index if not exists access_tokens_refresh_idx
  on public.access_tokens (refresh_token_hash)
  where refresh_token_hash is not null;

create index if not exists access_tokens_prev_refresh_idx
  on public.access_tokens (previous_refresh_hash)
  where previous_refresh_hash is not null;

-- -----------------------------------------------------------------------------
-- The new columns and the SELECT grant.
--
-- 0019 revoked the table-level SELECT and granted the safe columns back by
-- name, so a column added later is unreadable until it is named here. That is
-- the behaviour we want and it is worth saying out loud: **the default for a
-- new column on this table is "nobody can read it"**, and adding one to the
-- list below is a deliberate act.
--
-- `kind` and `client_id` are named, because Settings has to show a person which
-- of their credentials is an app grant and which they made themselves.
-- `refresh_token_hash` is *not* named, for exactly the reason `token_hash` is
-- not: anything that can read it can mint a fresh access token.
-- -----------------------------------------------------------------------------
grant select (kind, client_id) on public.access_tokens to authenticated;

comment on column public.access_tokens.kind is
  'pat = made by hand in Settings. oauth = approved at the consent screen by this person for a registered client.';
comment on column public.access_tokens.refresh_token_hash is
  'SHA-256 of the current refresh token. Never granted to authenticated — reading it is equivalent to holding it.';
comment on column public.access_tokens.previous_refresh_hash is
  'The refresh hash this row replaced. A presentation of it is reuse of a rotated token, and revokes the grant.';

-- -----------------------------------------------------------------------------
-- Housekeeping.
--
-- Spent and expired codes are worthless after their minute is up, but they are
-- not deleted immediately: a consumed code is the evidence of a replay, and a
-- replay reported an hour later is still worth having refused. A day is long
-- enough to see it and short enough that this never becomes a table.
-- -----------------------------------------------------------------------------
create or replace function public.prune_oauth_codes()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.oauth_codes
     where created_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.prune_oauth_codes() from public, anon, authenticated;

comment on function public.prune_oauth_codes() is
  'Drops codes older than a day. Spent codes are kept for that day on purpose: a consumed code presented again is evidence of a replay.';
