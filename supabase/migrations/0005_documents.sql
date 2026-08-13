-- =============================================================================
-- 0005_documents — the vault and the expiry engine. Spec: Module 8.
--
-- The RLS here is the most nuanced in the app so far. Every other table is
-- couple-scoped: if you are a member, you see it. Documents are not. A
-- document is readable by its owner always, and by the partner only while
-- `is_shared` is true — so revoking sharing has to make it vanish from the
-- other person's view immediately, which means the policy has to encode it
-- rather than the UI filtering it out.
-- =============================================================================

create table if not exists public.document_types (
  id               uuid primary key default gen_random_uuid(),
  couple_id        uuid not null references public.couples(id) on delete cascade,
  name             text not null,
  has_expiry       boolean not null default true,
  requires_country boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (couple_id, name)
);

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  type_id       uuid references public.document_types(id) on delete set null,
  label         text not null,
  country_code  text,

  -- NEVER the full number. Enough to identify which passport, and useless to
  -- anyone who sees it.
  number_last4  text,

  issued_on     date,
  expires_on    date,

  -- Private bucket only. Signed URLs, 300s, generated on demand.
  storage_path  text,
  file_name     text,
  file_size     int,
  mime_type     text,

  is_shared     boolean not null default true,
  notes         text,

  -- Which expiry threshold the owner has already been told about, so the
  -- daily sweep alerts once per threshold instead of every morning.
  last_alerted_threshold text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint number_last4_is_short check (number_last4 is null or length(number_last4) <= 4),
  constraint valid_dates check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

create table if not exists public.trip_document_requirements (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type_id     uuid not null references public.document_types(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  is_manual   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, user_id, type_id)
);

create index if not exists documents_expiry_idx
  on public.documents (couple_id, expires_on)
  where deleted_at is null;

create index if not exists documents_owner_idx
  on public.documents (owner_id)
  where deleted_at is null;

drop trigger if exists document_types_updated_at on public.document_types;
create trigger document_types_updated_at before update on public.document_types
  for each row execute function public.set_updated_at();
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
drop trigger if exists trip_document_requirements_updated_at on public.trip_document_requirements;
create trigger trip_document_requirements_updated_at before update on public.trip_document_requirements
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.document_types             enable row level security;
alter table public.documents                  enable row level security;
alter table public.trip_document_requirements enable row level security;

-- Types are shared vocabulary, couple-scoped like everything else.
drop policy if exists "couple read" on public.document_types;
create policy "couple read" on public.document_types
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.document_types;
create policy "couple write" on public.document_types
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Documents: yours always, your partner's only while they share it.
drop policy if exists "read own or shared" on public.documents;
create policy "read own or shared" on public.documents
  for select using (
    owner_id = auth.uid()
    or (public.is_couple_member(couple_id) and is_shared = true)
  );

-- Writes are owner-only, in both directions: you cannot edit your partner's
-- documents, and you cannot create one in their name.
drop policy if exists "write own" on public.documents;
create policy "write own" on public.documents
  for all using (owner_id = auth.uid())
      with check (owner_id = auth.uid() and public.is_couple_member(couple_id));

-- Requirements are about the trip, not the document, so they follow the trip.
drop policy if exists "couple read" on public.trip_document_requirements;
create policy "couple read" on public.trip_document_requirements
  for select using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));
drop policy if exists "couple write" on public.trip_document_requirements;
create policy "couple write" on public.trip_document_requirements
  for all using (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  )) with check (exists (
    select 1 from public.trips t
    where t.id = trip_id and public.is_couple_member(t.couple_id)
  ));

-- =============================================================================
-- Storage — private bucket, signed URLs only (non-negotiable #3)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'docs',
  'docs',
  false,
  10485760,  -- 10 MB, matching the client-side cap
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path is {couple_id}/{owner_id}/{document_id}/{filename}, so folder[1] is the
-- couple and folder[2] is the owner.
drop policy if exists "docs read own or shared" on storage.objects;
create policy "docs read own or shared" on storage.objects
  for select using (
    bucket_id = 'docs'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and (
      ((storage.foldername(name))[2])::uuid = auth.uid()
      or exists (
        select 1 from public.documents d
        where d.storage_path = storage.objects.name
          and d.is_shared = true
          and d.deleted_at is null
      )
    )
  );

-- You may only write into your own folder, inside your own couple.
drop policy if exists "docs write own" on storage.objects;
create policy "docs write own" on storage.objects
  for insert with check (
    bucket_id = 'docs'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

drop policy if exists "docs update own" on storage.objects;
create policy "docs update own" on storage.objects
  for update using (
    bucket_id = 'docs' and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

drop policy if exists "docs delete own" on storage.objects;
create policy "docs delete own" on storage.objects
  for delete using (
    bucket_id = 'docs' and ((storage.foldername(name))[2])::uuid = auth.uid()
  );

-- =============================================================================
-- Seeding
--
-- requires_country marks the types that are meaningless without one: a visa is
-- always a visa *for* somewhere. The form makes the field required for these.
-- =============================================================================
create or replace function public.seed_document_types(target uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_couple_member(target) then raise exception 'NOT_A_MEMBER'; end if;

  insert into public.document_types (couple_id, name, has_expiry, requires_country, sort_order)
  values
    (target, 'Passport',         true,  true,  0),
    (target, 'Visa',             true,  true,  1),
    (target, 'eTA/ESTA',         true,  true,  2),
    (target, 'PR Card',          true,  true,  3),
    (target, 'Travel Insurance', true,  false, 4),
    (target, 'Vaccination',      false, false, 5),
    (target, 'Driving Licence',  true,  false, 6),
    (target, 'Booking',          false, false, 7),
    (target, 'Other',            false, false, 8)
  on conflict (couple_id, name) do nothing;
end $$;

-- =============================================================================
-- Trip readiness
--
-- The rule that makes this worth doing in SQL rather than the client: a
-- document that expires *before the trip ends* does not satisfy the
-- requirement. Checking against today instead of trip.end_date is the obvious
-- mistake and it fails silently — you would be told you are ready for a trip
-- your passport does not cover.
--
-- Requirements are the union of what has been recorded for the trip and a
-- passport for each traveller, which is always needed and never worth making
-- someone add by hand.
-- =============================================================================
create or replace function public.trip_readiness(target uuid)
returns table (
  user_id       uuid,
  type_id       uuid,
  type_name     text,
  is_manual     boolean,
  document_id   uuid,
  expires_on    date,
  satisfied     boolean
)
language plpgsql security definer stable
set search_path = public as $$
declare
  t public.trips;
begin
  select * into t from public.trips where id = target;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  return query
  with travellers as (
    select tt.user_id from public.trip_travelers tt where tt.trip_id = target
    union
    select cm.user_id from public.couple_members cm where cm.couple_id = t.couple_id
  ),
  passport_type as (
    select dt.id from public.document_types dt
    where dt.couple_id = t.couple_id and dt.name = 'Passport'
    limit 1
  ),
  required as (
    -- A passport, for everyone, always.
    select tr.user_id, pt.id as type_id, false as is_manual
    from travellers tr cross join passport_type pt
    union
    -- Plus anything recorded against this trip.
    select r.user_id, r.type_id, r.is_manual
    from public.trip_document_requirements r
    where r.trip_id = target
  )
  select
    req.user_id,
    req.type_id,
    dt.name,
    bool_or(req.is_manual),
    (array_agg(d.id order by d.expires_on desc nulls first))[1],
    max(d.expires_on),
    bool_or(d.id is not null)
  from required req
  join public.document_types dt on dt.id = req.type_id
  left join public.documents d
    on d.owner_id = req.user_id
   and d.type_id  = req.type_id
   and d.deleted_at is null
   -- The whole point: valid *through the end of the trip*, not merely today.
   and (d.expires_on is null or d.expires_on >= coalesce(t.end_date, t.start_date, current_date))
  group by req.user_id, req.type_id, dt.name;
end $$;

grant execute on function public.seed_document_types(uuid) to authenticated;
grant execute on function public.trip_readiness(uuid)      to authenticated;
