-- =============================================================================
-- Local test harness — a minimal stand-in for the parts of Supabase the
-- migrations depend on. NEVER applied to a real project: Supabase provides all
-- of this already, and running it there would clobber the real auth schema.
--
-- Its whole job is to let `supabase/tests/run.sh` execute the real migrations,
-- unmodified, against a plain Postgres so the SQL and the RLS policies can be
-- proven before anyone pastes them into a live project.
-- =============================================================================

create extension if not exists "pgcrypto";

create schema if not exists auth;

-- The subset of auth.users the migrations touch.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

/*
 * Supabase derives auth.uid() from the request JWT. Locally we read it from a
 * session GUC, so a test can say "now act as this user" and every policy
 * behaves exactly as it would in production.
 */
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- The two roles PostgREST connects as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;

-- Supabase grants these by default; without them RLS would never be reached
-- because a plain permission error would come first.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;

/** Sign a user up, the way the auth server would. */
create or replace function auth.test_signup(user_email text, display_name text)
returns uuid language plpgsql as $$
declare
  new_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (user_email, jsonb_build_object('full_name', display_name))
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Storage, enough of it for migration 0005's bucket and object policies.
--
-- Supabase provides all of this. Locally we need the two tables and
-- storage.foldername(), because the docs policies parse the object path with
-- it — and a policy that cannot be executed cannot be tested.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  metadata   jsonb
);

alter table storage.objects enable row level security;

/* Splits an object path into its segments, 1-indexed, exactly as Supabase's
   own implementation does: 'a/b/c.pdf' -> {a,b}. The filename is dropped. */
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
