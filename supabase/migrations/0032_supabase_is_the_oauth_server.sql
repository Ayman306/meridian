-- =============================================================================
-- 0032 — delete the authorization server, keep the one thing it cannot answer.
--
-- 0030 built an OAuth 2.1 authorization server by hand: clients, authorization
-- codes, PKCE verification, refresh rotation, replay detection. It worked, it
-- was tested, and it should never have needed to exist. **Supabase Auth ships
-- an OAuth 2.1 server with native MCP support**, and it does all of that —
-- discovery, dynamic client registration, PKCE, token issue, refresh rotation,
-- JWKS — as part of the project this app already runs on.
--
-- What that removes is not just code. It removes `SUPABASE_JWT_SECRET`, which
-- was the single worst thing in this system:
--
--   * It is the key that mints sessions. Anything holding it could act as any
--     user in the project. It sat in an environment variable.
--   * It is the legacy shared secret. A project on asymmetric signing keys does
--     not have one, so the whole MCP path was one dashboard setting away from
--     being unfixable — and 0019's own notes flag that as a live risk.
--   * Rotating it invalidated the anon key and the service-role key at the same
--     time, so the safe move and the routine move were the same move.
--
-- Supabase now issues the access tokens. They are ordinary Supabase JWTs, so
-- **RLS applies to an AI agent exactly as it applies to a browser**, and nothing
-- in this app signs anything any more.
--
-- ## What is dropped
--
--   * `access_tokens` — personal access tokens. They existed because remote
--     OAuth was hard. It is not any more, and two ways in is two ways to get
--     wrong. The stdio server goes with them.
--   * `oauth_clients`, `oauth_codes` — Supabase keeps these now, correctly,
--     and with a team maintaining them.
--
-- Dropped rather than deprecated. A credential table nobody reads is a
-- credential table nobody notices leaking, and every row in these three was
-- issued by a system that no longer exists.
-- =============================================================================

-- Order matters, and no CASCADE. The three reference each other in a ring:
-- `access_tokens` points at `oauth_clients`, and `oauth_codes` points at both.
-- So codes go first, then tokens, then clients. A CASCADE would sort that out
-- by itself and would also silently take anything else that had come to depend
-- on them — which is precisely the report you want to read, not suppress.
drop table if exists public.oauth_codes;
drop table if exists public.access_tokens;
drop table if exists public.oauth_clients;

drop function if exists public.prune_oauth_codes();

-- -----------------------------------------------------------------------------
-- The one thing Supabase's OAuth server cannot answer for us.
--
-- Its scopes are `openid`, `email`, `profile`, `phone` — identity scopes. They
-- have nothing to say about whether this couple's assistant may read a cycle
-- log, and inventing `meridian.health.read` as an OAuth scope would mean a
-- second permission vocabulary to keep in step with the module list the app
-- already has everywhere else.
--
-- So the consent screen writes what was ticked, here, keyed by the client
-- Supabase issued a grant to. One row per app per person.
--
-- Note what is *not* in this table: no secret, no token, no hash, no code.
-- Nothing here is a credential, which is why it can be read back by its owner
-- — unlike every table it replaces.
-- -----------------------------------------------------------------------------
create table if not exists public.mcp_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- Supabase's OAuth client id. We do not mint it and cannot forge it; it
  -- arrives in the `client_id` claim of every token that client presents.
  client_id  text not null,
  -- The client's own name for itself, copied at consent so the Settings list
  -- can say "Claude" rather than a UUID. Untrusted text: it is whatever the
  -- client registered, and it is rendered, never executed.
  client_name text,

  -- Which modules this person ticked. Never widened by a refresh, because a
  -- refresh does not come through the consent screen.
  modules    text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,

  -- One grant per client per person. Re-approving updates the modules rather
  -- than stacking a second row that the first one contradicts.
  unique (user_id, client_id)
);

create index if not exists mcp_grants_user_idx on public.mcp_grants (user_id);

drop trigger if exists mcp_grants_updated_at on public.mcp_grants;
create trigger mcp_grants_updated_at before update on public.mcp_grants
  for each row execute function public.set_updated_at();

alter table public.mcp_grants enable row level security;

-- Owner-scoped, like `access_tokens` was and for the same reason: a partner has
-- no business listing which assistants somebody else has connected. This is not
-- shared data even in an app whose premise is sharing.
drop policy if exists "owner only" on public.mcp_grants;
create policy "owner only" on public.mcp_grants
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.mcp_grants is
  'Which modules a person approved for one OAuth client. Supabase Auth owns the tokens; this owns only the module scope, because OAuth scopes describe identity and cannot describe "may read my cycle log". Contains no credentials.';
