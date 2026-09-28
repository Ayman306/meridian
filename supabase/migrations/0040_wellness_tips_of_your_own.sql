-- =============================================================================
-- 0040_wellness_tips_of_your_own — a couple adds guidance; an assistant only
-- proposes it.
--
-- 0036 seeded seventeen tips and gave the table no write path at all. This
-- lets the two partners add their own — typed in the app, or proposed by an
-- assistant over the MCP — without loosening either rule the wellness tab was
-- built on.
--
-- ## Advisory data stays advisory
--
-- A tip a couple adds is still a pointer to guidance somebody else maintains,
-- so `source_url` stays required and must now be an http(s) link, and the
-- screen shows it with the same "written down" date and disclaimer as the
-- seeded ones (non-negotiable #4).
--
-- ## Nothing auto-inserts — and the database is what says so
--
-- An assistant's tip lands as a `draft`, shown under "Waiting for you" and
-- nowhere else, until one of the partners keeps it (non-negotiable #5). The
-- itinerary tray holds that line at the tool surface: there is simply no accept
-- tool. Here it is held by the database as well, because it can be. Every call
-- through `/api/mcp/rpc` carries a Supabase OAuth access token, and those carry
-- a `client_id` claim that a person's own session never has. So
-- `wellness_tips_guard` knows who is writing:
--
-- - **An assistant** may insert only a draft (whatever it sent is overwritten),
--   and may touch only drafts afterwards — never publish one, never edit or
--   remove a tip a person has kept.
-- - **A person** publishes directly when they type a tip in, and keeping a
--   draft records who kept it and when.
--
-- A test in `rls_test.sql` sets that claim and proves each refusal.
--
-- ## Whose tips these are
--
-- The seeded rows have no couple and stay readable by anyone signed in, and
-- writable by nobody. A couple's rows are read and written by **the two
-- partners only** — `is_couple_partner`, not membership. A friend on one trip
-- has no business reading a couple's sexual-wellness notes, and 0037's rule
-- applies: per-couple access is decided per couple.
--
-- Soft-deleted, as anything a person would regret losing is. The client may
-- write only the columns it has a reason to write; who wrote a row, which
-- couple it belongs to and how it arrived are set here and never editable.
-- =============================================================================

alter table public.wellness_tips
  add column if not exists couple_id   uuid references public.couples(id) on delete cascade,
  add column if not exists created_by  uuid references public.profiles(id) on delete set null,
  add column if not exists origin      text not null default 'seed',
  add column if not exists status      text not null default 'published',
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

alter table public.wellness_tips drop constraint if exists valid_origin;
alter table public.wellness_tips add constraint valid_origin
  check (origin in ('seed', 'manual', 'assistant'));

alter table public.wellness_tips drop constraint if exists valid_status;
alter table public.wellness_tips add constraint valid_status
  check (status in ('draft', 'published'));

-- The seeded set is shared and fixed; everything else belongs to a couple.
alter table public.wellness_tips drop constraint if exists seed_is_shared;
alter table public.wellness_tips add constraint seed_is_shared
  check ((couple_id is null) = (origin = 'seed'));

alter table public.wellness_tips drop constraint if exists seed_is_published;
alter table public.wellness_tips add constraint seed_is_published
  check (origin <> 'seed' or status = 'published');

-- A kept assistant tip always says who kept it.
alter table public.wellness_tips drop constraint if exists kept_by_a_person;
alter table public.wellness_tips add constraint kept_by_a_person
  check (origin <> 'assistant' or status = 'draft' or reviewed_by is not null);

-- A pointer is only a pointer if it points somewhere a browser can open.
alter table public.wellness_tips drop constraint if exists source_is_a_link;
alter table public.wellness_tips add constraint source_is_a_link
  check (source_url ~* '^https?://[^[:space:]]+$');

alter table public.wellness_tips drop constraint if exists sensible_length;
alter table public.wellness_tips add constraint sensible_length
  check (
    char_length(btrim(title)) between 1 and 120
    and char_length(btrim(body)) between 1 and 1200
  );

-- 0036's title key was global, which would stop a couple naming a tip the way
-- a seeded one is named. Titles are unique within the seeded set, and within
-- each couple's live tips.
drop index if exists public.wellness_tips_key;
create unique index if not exists wellness_tips_seed_key
  on public.wellness_tips (lower(title)) where couple_id is null;
create unique index if not exists wellness_tips_couple_key
  on public.wellness_tips (couple_id, lower(title))
  where couple_id is not null and deleted_at is null;

create index if not exists wellness_tips_couple_idx
  on public.wellness_tips (couple_id) where couple_id is not null;

drop trigger if exists wellness_tips_updated_at on public.wellness_tips;
create trigger wellness_tips_updated_at before update on public.wellness_tips
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Who is writing, and what they may do.
-- =============================================================================
create or replace function public.wellness_tips_guard()
returns trigger language plpgsql
set search_path = '' as $$
declare
  -- Present on every Supabase OAuth access token, which is what the MCP route
  -- is called with; absent from a person's own session. `current_setting`
  -- rather than `auth.jwt()` so the tests can set it the way PostgREST does.
  claims    jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  assistant boolean := coalesce(claims ->> 'client_id', '') <> '';
begin
  -- No signed-in user: a migration seeding the shared set, or the service
  -- role. Neither is a person or an assistant, and the constraints above
  -- still hold them to the table's shape.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by  := auth.uid();
    if assistant then
      new.origin      := 'assistant';
      new.status      := 'draft';
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.origin      := 'manual';
      new.status      := 'published';
      new.reviewed_by := auth.uid();
      new.reviewed_at := pg_catalog.now();
    end if;
    return new;
  end if;

  -- UPDATE. Column privileges already stop the client naming the identity
  -- columns; these are the rules about state.
  if assistant then
    if old.status <> 'draft' then
      raise exception 'ASSISTANT_DRAFTS_ONLY'
        using hint = 'A tip one of you has kept can only be changed in the app.';
    end if;
    if new.status <> 'draft' then
      raise exception 'ASSISTANT_CANNOT_PUBLISH'
        using hint = 'Keeping a suggested tip is a person''s decision, made in the app.';
    end if;
    return new;
  end if;

  if old.status = 'published' and new.status = 'draft' then
    raise exception 'ALREADY_PUBLISHED';
  end if;
  if old.status = 'draft' and new.status = 'published' then
    new.reviewed_by := auth.uid();
    new.reviewed_at := pg_catalog.now();
  end if;
  return new;
end $$;

comment on function public.wellness_tips_guard() is
  'An assistant (a token with a client_id claim) may only create and touch drafts; a person publishes. See 0040.';

revoke all on function public.wellness_tips_guard() from public, anon, authenticated;

drop trigger if exists wellness_tips_guard on public.wellness_tips;
create trigger wellness_tips_guard before insert or update on public.wellness_tips
  for each row execute function public.wellness_tips_guard();

-- =============================================================================
-- Policies: the seeded set to anyone signed in, a couple's own to its partners.
-- =============================================================================
drop policy if exists "signed in read" on public.wellness_tips;
drop policy if exists "shared or partners read" on public.wellness_tips;
create policy "shared or partners read" on public.wellness_tips
  for select using (
    (couple_id is null and auth.uid() is not null)
    or (couple_id is not null and public.is_couple_partner(couple_id))
  );

drop policy if exists "partners add" on public.wellness_tips;
create policy "partners add" on public.wellness_tips
  for insert with check (
    couple_id is not null
    and public.is_couple_partner(couple_id)
    and created_by = auth.uid()
  );

drop policy if exists "partners edit" on public.wellness_tips;
create policy "partners edit" on public.wellness_tips
  for update
  using (couple_id is not null and public.is_couple_partner(couple_id))
  with check (couple_id is not null and public.is_couple_partner(couple_id));

-- No delete policy: removing a tip sets `deleted_at`.

-- Column privileges, as 0037 set them for the membership tables: a policy says
-- which rows, never which columns.
revoke insert, update, delete on public.wellness_tips from authenticated;
grant insert (couple_id, category, audience, title, body, source_url, verified_on)
  on public.wellness_tips to authenticated;
grant update (category, audience, title, body, source_url, verified_on, status, deleted_at)
  on public.wellness_tips to authenticated;

create or replace function public.schema_version()
returns int language sql immutable
set search_path = '' as $$
  select 40;
$$;
