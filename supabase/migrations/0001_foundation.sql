-- =============================================================================
-- 0001_foundation — profiles, couples, couple_members, and the RLS primitives
-- every later migration depends on. Spec: Part 0.3, 0.4 and Module 1.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- updated_at trigger, applied to every table that has the column
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- couples
-- -----------------------------------------------------------------------------
create table if not exists public.couples (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  anniversary_date  date,
  invite_code       text unique,
  invite_expires_at timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger couples_updated_at
  before update on public.couples
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user, created by trigger on signup
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text,
  avatar_url         text,
  home_city          text,
  home_country       text,
  home_lat           numeric,
  home_lng           numeric,
  timezone           text not null default 'UTC',   -- IANA, never an offset
  nationality        text,                          -- ISO 3166-1 alpha-2
  second_nationality text,
  accent_color       text not null default 'amber',
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- couple_members — exactly two, enforced by trigger
-- -----------------------------------------------------------------------------
create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- A user belongs to at most one couple. This is what makes partner_id()
-- single-valued and every couple-scoped policy unambiguous.
create unique index if not exists couple_members_one_couple_per_user
  on public.couple_members (user_id);

create or replace function public.enforce_couple_size()
returns trigger language plpgsql
set search_path = public as $$
begin
  if (select count(*) from public.couple_members where couple_id = new.couple_id) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;
  return new;
end $$;

create trigger couple_size_check
  before insert on public.couple_members
  for each row execute function public.enforce_couple_size();

-- -----------------------------------------------------------------------------
-- The two functions every policy in the app is built on.
-- SECURITY DEFINER so they can read couple_members without recursing through
-- that table's own RLS policies.
-- -----------------------------------------------------------------------------
create or replace function public.is_couple_member(target uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.partner_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select cm2.user_id
  from public.couple_members cm1
  join public.couple_members cm2 on cm1.couple_id = cm2.couple_id
  where cm1.user_id = auth.uid() and cm2.user_id <> auth.uid()
  limit 1;
$$;

-- The caller's couple, or null in solo mode. Saves a round trip everywhere.
create or replace function public.my_couple_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid() limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Profile auto-creation on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.profiles       enable row level security;
alter table public.couples        enable row level security;
alter table public.couple_members enable row level security;

-- profiles: yourself, and your partner. Nobody else, ever.
drop policy if exists "profiles read self"    on public.profiles;
drop policy if exists "profiles read partner" on public.profiles;
drop policy if exists "profiles update self"  on public.profiles;

create policy "profiles read self" on public.profiles
  for select using (id = auth.uid());

create policy "profiles read partner" on public.profiles
  for select using (id = public.partner_id());

create policy "profiles update self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- couples: members read and update. Creation goes through create_couple().
drop policy if exists "couples read"   on public.couples;
drop policy if exists "couples update" on public.couples;
drop policy if exists "couples insert" on public.couples;

create policy "couples read" on public.couples
  for select using (public.is_couple_member(id));

create policy "couples update" on public.couples
  for update using (public.is_couple_member(id))
          with check (public.is_couple_member(id));

create policy "couples insert" on public.couples
  for insert with check (created_by = auth.uid());

-- couple_members: you may read rows of your own couple, and delete your own
-- membership ("leave couple"). Joining goes through join_couple().
drop policy if exists "couple_members read"  on public.couple_members;
drop policy if exists "couple_members leave" on public.couple_members;

create policy "couple_members read" on public.couple_members
  for select using (public.is_couple_member(couple_id));

create policy "couple_members leave" on public.couple_members
  for delete using (user_id = auth.uid());

-- =============================================================================
-- Invite codes
-- =============================================================================

-- 8 chars from an alphabet with no I, L, O, 0 or 1 — these get misread when
-- one partner reads the code aloud over a call.
create or replace function public.generate_invite_code()
returns text language plpgsql
set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = candidate);
  end loop;
  return candidate;
end $$;

-- Create a couple and become its first member, atomically.
create or replace function public.create_couple(couple_name text default null)
returns public.couples language plpgsql security definer
set search_path = public as $$
declare
  row public.couples;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'ALREADY_PAIRED';
  end if;

  insert into public.couples (name, invite_code, invite_expires_at, created_by)
  values (couple_name, public.generate_invite_code(), now() + interval '7 days', auth.uid())
  returning * into row;

  insert into public.couple_members (couple_id, user_id) values (row.id, auth.uid());
  return row;
end $$;

-- Join by code. Single transactional RPC — never validate this client-side.
create or replace function public.join_couple(code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  expires timestamptz;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'ALREADY_PAIRED';
  end if;

  select id, invite_expires_at into target, expires
  from public.couples
  where invite_code = upper(trim(code))
  for update;

  if target is null then raise exception 'INVALID_CODE'; end if;
  if expires is null or expires <= now() then raise exception 'EXPIRED_CODE'; end if;

  if (select count(*) from public.couple_members where couple_id = target) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  insert into public.couple_members (couple_id, user_id) values (target, auth.uid());

  -- The code is single-use; a third account must not be able to reuse it.
  update public.couples set invite_code = null, invite_expires_at = null where id = target;

  return target;
end $$;

-- Only a member may mint a new code, and only while the couple is not full.
create or replace function public.regenerate_invite_code()
returns text language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  fresh  text;
begin
  select couple_id into target from public.couple_members where user_id = auth.uid();
  if target is null then raise exception 'NOT_A_MEMBER'; end if;

  if (select count(*) from public.couple_members where couple_id = target) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  fresh := public.generate_invite_code();
  update public.couples
     set invite_code = fresh, invite_expires_at = now() + interval '7 days'
   where id = target;
  return fresh;
end $$;

-- Leaving is destructive and confirmed twice in the UI. Shared rows stay with
-- the couple; the departing user simply loses access via RLS.
create or replace function public.leave_couple()
returns void language plpgsql security definer
set search_path = public as $$
begin
  delete from public.couple_members where user_id = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- Health endpoint for the keep-alive cron (free-tier projects pause at ~7 days
-- idle). Callable by anon so a GitHub Action can hit it with the anon key.
-- -----------------------------------------------------------------------------
create or replace function public.health()
returns jsonb language sql stable
set search_path = public as $$
  select jsonb_build_object('ok', true, 'at', now());
$$;

grant execute on function public.health() to anon, authenticated;
grant execute on function public.create_couple(text)      to authenticated;
grant execute on function public.join_couple(text)        to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;
grant execute on function public.leave_couple()           to authenticated;
grant execute on function public.is_couple_member(uuid)   to authenticated;
grant execute on function public.partner_id()             to authenticated;
grant execute on function public.my_couple_id()           to authenticated;
