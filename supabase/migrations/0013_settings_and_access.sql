-- =============================================================================
-- 0013_settings_and_access — Settings (spec Module 14), plus two things the
-- spec does not cover and the app needs before anyone else is let in.
--
-- **An invite code was a bearer token.** Anyone holding the eight characters
-- could join, whoever they were. A code read aloud on a call, pasted into a
-- chat, or left in a screenshot was a way into somebody's passport numbers.
-- Invites are now issued *to an email address* and refuse anyone else, so the
-- code alone is not enough — you also have to be the person it was meant for.
--
-- **Not everyone let in should see everything.** A partner sees the whole
-- app; a friend along for one trip has no business in the document vault. So
-- membership carries a role and a set of module grants, and the grants are
-- enforced in RLS rather than by hiding nav items. A screen you cannot reach
-- is not the same as data you cannot read, and only the second one is a
-- guarantee.
--
-- The shape is deliberately more general than a couple. `couples.kind`
-- distinguishes a two-person couple from a larger trip group, the size cap
-- applies only to the former, and the one-couple-per-user rule becomes
-- one-*couple*-per-user rather than one-space-per-user. Nothing in this
-- migration builds group UI; it makes the group case expressible without a
-- second migration that rewrites every policy again.
-- =============================================================================

-- =============================================================================
-- Spaces: couples, and eventually groups.
-- =============================================================================
alter table public.couples
  add column if not exists kind text not null default 'couple';

alter table public.couples drop constraint if exists valid_couple_kind;
alter table public.couples add constraint valid_couple_kind
  check (kind in ('couple', 'group'));

-- D1's guarantee — one couple per user — is what makes `partner_id()`
-- single-valued and every policy unambiguous. It still holds, but only for
-- couples: a user may later belong to any number of trip groups without
-- either fact contradicting the other.
drop index if exists public.couple_members_one_couple_per_user;

-- =============================================================================
-- Roles and grants.
--
-- `module_grants` null means "everything", which is the only sane default for
-- the two people whose app this is. A non-null array is a whitelist, and an
-- empty array is a member who can see the space exists and nothing in it.
-- =============================================================================
alter table public.couple_members
  add column if not exists role          text not null default 'partner',
  add column if not exists module_grants text[],
  add column if not exists invited_by    uuid references public.profiles(id) on delete set null;

alter table public.couple_members drop constraint if exists valid_member_role;
alter table public.couple_members add constraint valid_member_role
  check (role in ('owner', 'partner', 'friend', 'guest'));

-- Full access belongs to the two people the space is for. A friend or a guest
-- always carries an explicit whitelist, because "null means everything" would
-- otherwise be one forgotten column away from handing over the vault.
alter table public.couple_members drop constraint if exists limited_roles_need_grants;
alter table public.couple_members add constraint limited_roles_need_grants
  check (role in ('owner', 'partner') or module_grants is not null);

-- =============================================================================
-- Which modules exist, and which are never shared.
--
-- Functions rather than a table: this list changes when code changes, not when
-- data changes, and a migration is the honest place to record that.
-- =============================================================================
create or replace function public.all_modules()
returns text[] language sql immutable
set search_path = public as $$
  select array[
    'trips', 'wishlist', 'destinations', 'money', 'documents',
    'photos', 'flights', 'allowance', 'health'
  ];
$$;

-- Documents hold passport and visa numbers. Allowance is somebody's
-- immigration history. Health is health. None of the three is something to
-- hand to a friend joining one trip, so the database refuses to grant them
-- rather than trusting every future screen to remember.
create or replace function public.sensitive_modules()
returns text[] language sql immutable
set search_path = public as $$
  select array['documents', 'allowance', 'health'];
$$;

-- One rule, two callers: the invite refuses at issue time so the mistake is
-- caught while somebody is looking at it, and the membership trigger refuses
-- at redeem time so a hand-written row cannot get past the first check.
create or replace function public.assert_grants_allowed(member_role text, grants text[])
returns void language plpgsql immutable
set search_path = public as $$
begin
  if grants is null then return; end if;

  if exists (select 1 from unnest(grants) g where g <> all(public.all_modules())) then
    raise exception 'UNKNOWN_MODULE';
  end if;

  if member_role in ('friend', 'guest')
     and exists (select 1 from unnest(grants) g where g = any(public.sensitive_modules())) then
    raise exception 'SENSITIVE_MODULE_NOT_SHAREABLE';
  end if;
end $$;

create or replace function public.enforce_grant_limits()
returns trigger language plpgsql
set search_path = public as $$
begin
  perform public.assert_grants_allowed(new.role, new.module_grants);
  return new;
end $$;

drop trigger if exists couple_members_grant_limits on public.couple_members;
create trigger couple_members_grant_limits
  before insert or update on public.couple_members
  for each row execute function public.enforce_grant_limits();

-- =============================================================================
-- The two-person cap counts partners, not members.
--
-- 0001's trigger capped `couple_members` at two rows outright, which was the
-- same thing back when every member was a partner. It is not any more: a
-- couple plus one friend along for a trip is three rows and still a couple.
-- The cap that matters — and the one D1's guarantee rests on — is that a
-- couple holds at most two people in an owning role.
-- =============================================================================
create or replace function public.enforce_couple_size()
returns trigger language plpgsql
set search_path = public as $$
begin
  if new.role in ('owner', 'partner')
     and (select kind from public.couples where id = new.couple_id) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = new.couple_id and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;
  return new;
end $$;

-- =============================================================================
-- The predicate every module-scoped policy is rebuilt on.
--
-- SECURITY DEFINER for the same reason `is_couple_member` is: it reads
-- `couple_members`, and a policy that consulted that table through its own RLS
-- would recurse.
-- =============================================================================
create or replace function public.can_see(target uuid, module text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target
      and user_id = auth.uid()
      and (module_grants is null or module = any(module_grants))
  );
$$;

-- What the caller may see in their own space. The nav reads this, so a hidden
-- screen and an unreadable table always agree.
create or replace function public.my_modules()
returns text[] language sql security definer stable
set search_path = public as $$
  select coalesce(
    (select module_grants from public.couple_members where user_id = auth.uid() limit 1),
    public.all_modules()
  );
$$;

create or replace function public.my_role()
returns text language sql security definer stable
set search_path = public as $$
  select role from public.couple_members where user_id = auth.uid() limit 1;
$$;

-- =============================================================================
-- Invites.
--
-- Replaces the bearer code on `couples`. The old columns stay for now so an
-- in-flight invite is not voided by a deploy; nothing writes them any more.
-- =============================================================================
create table if not exists public.invites (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  code          text not null unique,
  -- Stored lower-cased. Compared against the address on the account actually
  -- signing in, which is the whole point of the table.
  invited_email text not null,
  role          text not null default 'partner',
  module_grants text[],
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint valid_invite_role check (role in ('partner', 'friend', 'guest')),
  constraint invite_email_is_lower check (invited_email = lower(invited_email)),
  constraint limited_invites_need_grants check (role = 'partner' or module_grants is not null)
);

-- One live invite per address per space. Re-inviting somebody replaces rather
-- than accumulates, so revoking one code cannot leave another one working.
create unique index if not exists invites_live_idx
  on public.invites (couple_id, invited_email)
  where accepted_at is null and revoked_at is null;

drop trigger if exists invites_updated_at on public.invites;
create trigger invites_updated_at before update on public.invites
  for each row execute function public.set_updated_at();

alter table public.invites enable row level security;

-- Members see their space's invites. Nobody selects an invite by code through
-- the API — that happens inside `join_couple`, under definer rights, so a code
-- cannot be confirmed to exist by anyone it was not sent to.
drop policy if exists "couple read" on public.invites;
create policy "couple read" on public.invites
  for select using (public.is_couple_member(couple_id));

drop policy if exists "couple write" on public.invites;
create policy "couple write" on public.invites
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- The caller's own email, from the auth schema rather than from anything the
-- client can set.
create or replace function public.my_email()
returns text language sql security definer stable
set search_path = public, auth as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

-- =============================================================================
-- Issuing an invite.
-- =============================================================================
create or replace function public.create_invite(
  email         text,
  member_role   text default 'partner',
  grants        text[] default null,
  valid_days    int default 7
)
returns public.invites language plpgsql security definer
set search_path = public as $$
declare
  target uuid;
  row    public.invites;
  normalised text := lower(trim(email));
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if normalised !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  target := public.my_couple_id();
  if target is null then raise exception 'NOT_PAIRED'; end if;

  perform public.assert_grants_allowed(member_role, grants);

  -- Only the two people the space belongs to may let anyone else in. A guest
  -- who could invite would route around every grant on their own membership.
  if public.my_role() not in ('owner', 'partner') then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Order matters: "they are already in this" is a more useful answer than
  -- "it is full", and inviting an existing member is the likelier mistake.
  if exists (
    select 1 from public.couple_members m
    join auth.users u on u.id = m.user_id
    where m.couple_id = target and lower(u.email) = normalised
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- Inviting a second partner into a full couple is the old COUPLE_FULL case,
  -- checked before a code is minted rather than after it is redeemed.
  if member_role = 'partner'
     and (select kind from public.couples where id = target) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = target and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  -- Supersede any live invite to the same address, so the unique index holds
  -- and an older code stops working the moment a new one is issued.
  update public.invites
     set revoked_at = now()
   where couple_id = target and invited_email = normalised
     and accepted_at is null and revoked_at is null;

  insert into public.invites (
    couple_id, code, invited_email, role, module_grants, expires_at, created_by
  )
  values (
    target,
    public.generate_invite_code(),
    normalised,
    member_role,
    case when member_role = 'partner' then grants
         -- A friend or guest always carries an explicit list; the default is
         -- the four modules that hold nothing sensitive.
         else coalesce(grants, array['trips', 'wishlist', 'destinations', 'photos'])
    end,
    now() + make_interval(days => greatest(1, least(valid_days, 30))),
    auth.uid()
  )
  returning * into row;

  return row;
end $$;

-- =============================================================================
-- Redeeming one.
--
-- Replaces `join_couple(code)`. Same name and signature so nothing else
-- changes, but the code is no longer sufficient on its own.
-- =============================================================================
create or replace function public.join_couple(code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  inv        public.invites;
  normalised text := upper(trim(code));
  caller     text := public.my_email();
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into inv from public.invites i where i.code = normalised;

  if inv.id is null then raise exception 'INVALID_CODE'; end if;
  if inv.revoked_at is not null then raise exception 'INVALID_CODE'; end if;
  if inv.accepted_at is not null then raise exception 'INVALID_CODE'; end if;
  if inv.expires_at < now() then raise exception 'EXPIRED_CODE'; end if;

  -- The check this whole migration exists for. A valid, live code presented by
  -- the wrong account is refused, and says so — "wrong code" would send
  -- somebody hunting for a typo that is not there.
  if caller is null or caller <> inv.invited_email then
    raise exception 'EMAIL_MISMATCH';
  end if;

  -- A couple still holds two *partners*. Friends and guests do not count
  -- against it, and a group has no cap at all.
  if inv.role = 'partner'
     and (select kind from public.couples where id = inv.couple_id) = 'couple'
     and (
       select count(*) from public.couple_members
       where couple_id = inv.couple_id and role in ('owner', 'partner')
     ) >= 2 then
    raise exception 'COUPLE_FULL';
  end if;

  -- One couple per person still holds, but only for the partner role: being
  -- a friend in somebody else's space says nothing about your own.
  if inv.role = 'partner' and exists (
    select 1 from public.couple_members m
    join public.couples c on c.id = m.couple_id
    where m.user_id = auth.uid() and c.kind = 'couple' and m.role in ('owner', 'partner')
  ) then
    raise exception 'ALREADY_PAIRED';
  end if;

  if exists (select 1 from public.couple_members
              where couple_id = inv.couple_id and user_id = auth.uid()) then
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into public.couple_members (couple_id, user_id, role, module_grants, invited_by)
  values (inv.couple_id, auth.uid(), inv.role, inv.module_grants, inv.created_by);

  update public.invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  -- The legacy bearer code on `couples` is spent the moment anyone joins.
  update public.couples set invite_code = null, invite_expires_at = null
   where id = inv.couple_id;

  return inv.couple_id;
end $$;

-- The old regenerate call now issues an invite, which needs an address.
-- Kept so a stale client gets a clear error rather than a missing function.
create or replace function public.regenerate_invite_code()
returns text language plpgsql
set search_path = public as $$
begin
  raise exception 'INVITE_NEEDS_EMAIL';
end $$;

-- =============================================================================
-- Settings. Spec 14.1, verbatim except for the RLS every table here needs.
-- =============================================================================
create table if not exists public.couple_settings (
  couple_id               uuid primary key references public.couples(id) on delete cascade,
  base_currency           text not null default 'USD',
  distance_unit           text not null default 'km',
  date_format             text not null default 'iso',
  week_starts_on          int  not null default 1,
  ai_enabled              boolean not null default false,
  require_insurance       boolean not null default false,
  long_stay_threshold     int  not null default 5,
  show_departure_countdown boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint valid_distance_unit check (distance_unit in ('km', 'mi')),
  constraint valid_date_format check (date_format in ('iso', 'dmy', 'mdy')),
  constraint valid_week_start check (week_starts_on between 0 and 6),
  constraint valid_threshold check (long_stay_threshold between 1 and 60)
);

create table if not exists public.user_settings (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  theme                   text not null default 'system',
  work_hours_start        time,
  work_hours_end          time,
  work_timezone           text,
  work_days               int[],
  notify_flights          boolean not null default true,
  notify_documents        boolean not null default true,
  notify_allowance        boolean not null default true,
  notify_daily_exchange   boolean not null default false,
  notify_partner_activity boolean not null default false,
  quiet_hours_start       time,
  quiet_hours_end         time,
  -- Spec 8.3's idle re-auth on the document vault, which had nowhere to live.
  vault_lock_minutes      int not null default 15,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint valid_theme check (theme in ('system', 'light', 'dark')),
  constraint valid_lock check (vault_lock_minutes between 0 and 240)
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

drop trigger if exists couple_settings_updated_at on public.couple_settings;
create trigger couple_settings_updated_at before update on public.couple_settings
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.couple_settings   enable row level security;
alter table public.user_settings     enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "couple read" on public.couple_settings;
create policy "couple read" on public.couple_settings
  for select using (public.is_couple_member(couple_id));
-- Shared preferences are changed by the people the space belongs to. A guest
-- does not get to switch everyone's base currency.
drop policy if exists "partners write" on public.couple_settings;
create policy "partners write" on public.couple_settings
  for all using (public.is_couple_member(couple_id) and public.my_role() in ('owner', 'partner'))
      with check (public.is_couple_member(couple_id) and public.my_role() in ('owner', 'partner'));

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Seed a settings row per space, and per user, so the app never has to cope
-- with a missing row.
create or replace function public.seed_couple_settings()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.couple_settings (couple_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists couples_seed_settings on public.couples;
create trigger couples_seed_settings after insert on public.couples
  for each row execute function public.seed_couple_settings();

create or replace function public.seed_user_settings()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists profiles_seed_settings on public.profiles;
create trigger profiles_seed_settings after insert on public.profiles
  for each row execute function public.seed_user_settings();

insert into public.couple_settings (couple_id, base_currency)
select id, base_currency from public.couples on conflict do nothing;
insert into public.user_settings (user_id) select id from public.profiles on conflict do nothing;

-- `couples.base_currency` was 0012's placeholder for exactly this table. Keep
-- the two in step rather than picking a winner mid-flight: the app reads
-- couple_settings, and this trigger means an older client writing the old
-- column does not silently disagree with it.
create or replace function public.mirror_base_currency()
returns trigger language plpgsql
set search_path = public as $$
begin
  update public.couple_settings
     set base_currency = new.base_currency
   where couple_id = new.id and base_currency is distinct from new.base_currency;
  return new;
end $$;

drop trigger if exists couples_mirror_currency on public.couples;
create trigger couples_mirror_currency after update of base_currency on public.couples
  for each row execute function public.mirror_base_currency();

-- =============================================================================
-- Module visibility, enforced.
--
-- Every couple-scoped policy below gains its module's grant check. This is the
-- part that makes a grant a guarantee rather than a preference: a guest with
-- no 'money' grant does not get an empty expenses screen, they get zero rows
-- from the database however they ask.
-- =============================================================================

-- trips
drop policy if exists "couple read" on public.trips;
create policy "couple read" on public.trips
  for select using (public.can_see(couple_id, 'trips'));
drop policy if exists "couple write" on public.trips;
create policy "couple write" on public.trips
  for all using (public.can_see(couple_id, 'trips'))
      with check (public.can_see(couple_id, 'trips'));

drop policy if exists "couple read" on public.itinerary_items;
create policy "couple read" on public.itinerary_items
  for select using (public.can_see(couple_id, 'trips'));
drop policy if exists "couple write" on public.itinerary_items;
create policy "couple write" on public.itinerary_items
  for all using (public.can_see(couple_id, 'trips'))
      with check (public.can_see(couple_id, 'trips'));

-- wishlist
--
-- Note the policy *names*. Postgres ORs every policy that applies, so adding a
-- differently-named one alongside the original loosens rather than tightens —
-- a permissive "couple write" beside 0007's "write own" would have handed
-- every member edit rights over each other's saves. Each policy below reuses
-- its original name so it is replaced, and keeps whatever extra condition it
-- already carried.
drop policy if exists "couple read" on public.wishlist_items;
create policy "couple read" on public.wishlist_items
  for select using (public.can_see(couple_id, 'wishlist'));
drop policy if exists "write own" on public.wishlist_items;
create policy "write own" on public.wishlist_items
  for all using (user_id = auth.uid() and public.can_see(couple_id, 'wishlist'))
      with check (user_id = auth.uid() and public.can_see(couple_id, 'wishlist'));

-- destinations
drop policy if exists "couple read" on public.trip_destinations;
create policy "couple read" on public.trip_destinations
  for select using (public.can_see(couple_id, 'destinations'));
drop policy if exists "couple write" on public.trip_destinations;
create policy "couple write" on public.trip_destinations
  for all using (public.can_see(couple_id, 'destinations'))
      with check (public.can_see(couple_id, 'destinations'));

-- money
drop policy if exists "couple read" on public.expenses;
create policy "couple read" on public.expenses
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.expenses;
create policy "couple write" on public.expenses
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

drop policy if exists "couple read" on public.settlements;
create policy "couple read" on public.settlements
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.settlements;
create policy "couple write" on public.settlements
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

drop policy if exists "couple read" on public.budgets;
create policy "couple read" on public.budgets
  for select using (public.can_see(couple_id, 'money'));
drop policy if exists "couple write" on public.budgets;
create policy "couple write" on public.budgets
  for all using (public.can_see(couple_id, 'money'))
      with check (public.can_see(couple_id, 'money'));

-- documents — sensitive, so a grant can never include it for friend or guest
drop policy if exists "read own or shared" on public.documents;
create policy "read own or shared" on public.documents
  for select using (
    public.can_see(couple_id, 'documents')
    -- Module 8's owner-private rule still applies on top of the grant.
    and (is_shared or owner_id = auth.uid())
  );
drop policy if exists "write own" on public.documents;
create policy "write own" on public.documents
  for all using (owner_id = auth.uid() and public.can_see(couple_id, 'documents'))
      with check (owner_id = auth.uid() and public.can_see(couple_id, 'documents'));

-- photos
drop policy if exists "couple read" on public.media;
create policy "couple read" on public.media
  for select using (public.can_see(couple_id, 'photos'));
drop policy if exists "couple write" on public.media;
create policy "couple write" on public.media
  for all using (public.can_see(couple_id, 'photos'))
      with check (public.can_see(couple_id, 'photos'));

drop policy if exists "couple read" on public.albums;
create policy "couple read" on public.albums
  for select using (public.can_see(couple_id, 'photos'));
drop policy if exists "couple write" on public.albums;
create policy "couple write" on public.albums
  for all using (public.can_see(couple_id, 'photos'))
      with check (public.can_see(couple_id, 'photos'));

-- flights
drop policy if exists "couple read" on public.flights;
create policy "couple read" on public.flights
  for select using (public.can_see(couple_id, 'flights'));
drop policy if exists "couple write" on public.flights;
create policy "couple write" on public.flights
  for all using (public.can_see(couple_id, 'flights'))
      with check (public.can_see(couple_id, 'flights'));

-- allowance — sensitive
drop policy if exists "couple read" on public.entry_exit_log;
create policy "couple read" on public.entry_exit_log
  for select using (public.can_see(couple_id, 'allowance'));
drop policy if exists "write own" on public.entry_exit_log;
create policy "write own" on public.entry_exit_log
  for all using (user_id = auth.uid() and public.can_see(couple_id, 'allowance'))
      with check (user_id = auth.uid() and public.can_see(couple_id, 'allowance'));

-- =============================================================================
-- Grants. Same rule as 0004 and 0012: name all three roles.
-- =============================================================================
grant execute on function public.can_see(uuid, text)   to authenticated;
grant execute on function public.my_modules()          to authenticated;
grant execute on function public.my_role()             to authenticated;
grant execute on function public.create_invite(text, text, text[], int) to authenticated;
grant execute on function public.all_modules()         to authenticated;
grant execute on function public.sensitive_modules()   to authenticated;

revoke all on function public.can_see(uuid, text)      from public, anon;
revoke all on function public.my_modules()             from public, anon;
revoke all on function public.my_role()                from public, anon;
revoke all on function public.my_email()               from public, anon, authenticated;
revoke all on function public.create_invite(text, text, text[], int) from public, anon;
revoke all on function public.all_modules()            from public, anon;
revoke all on function public.sensitive_modules()      from public, anon;
revoke all on function public.enforce_grant_limits()   from public, anon, authenticated;
revoke all on function public.assert_grants_allowed(text, text[]) from public, anon;
grant execute on function public.assert_grants_allowed(text, text[]) to authenticated;
revoke all on function public.seed_couple_settings()   from public, anon, authenticated;
revoke all on function public.seed_user_settings()     from public, anon, authenticated;
revoke all on function public.mirror_base_currency()   from public, anon, authenticated;

-- Existing members predate roles. The one who created the space owns it; the
-- other is a partner. Both keep null grants, which is everything.
update public.couple_members m
   set role = case when c.created_by = m.user_id then 'owner' else 'partner' end
  from public.couples c
 where c.id = m.couple_id and m.role = 'partner' and c.created_by = m.user_id;
