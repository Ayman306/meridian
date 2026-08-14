-- =============================================================================
-- 0011_gallery — the shared photo library. Spec: Module 11.
--
-- The whole module is shaped by one number: roughly 1 GB of free storage, and
-- it has to last between trips rather than being filled by one of them.
--
-- The decision that makes it viable is that **originals are never uploaded**.
-- Two derivatives per photo — a 1600px display at ~300 KB and a 400px thumb at
-- ~40 KB — is about 340 KB, so a gigabyte holds roughly 2,900 photos. With
-- originals it would hold 250. That is the difference between a library and a
-- demo, and the schema encodes it: `path_original` exists and stays null.
--
-- The other budget is egress. The grid loads thumbs and nothing else; the
-- lightbox loads one display. Nothing in the app ever asks for both.
-- =============================================================================

create table if not exists public.media (
  id                uuid primary key default gen_random_uuid(),
  couple_id         uuid not null references public.couples(id) on delete cascade,
  uploader_id       uuid not null references public.profiles(id) on delete cascade,
  trip_id           uuid references public.trips(id) on delete set null,
  itinerary_item_id uuid references public.itinerary_items(id) on delete set null,

  -- Storage paths, {couple_id}/{media_id}/{variant}.jpg. Content-addressed by
  -- media id, so they never change and can be cached immutably.
  path_display  text not null,                -- 1600px
  path_thumb    text not null,                -- 400px
  path_original text,                         -- stays null on the free tier

  -- ~25 bytes that render as a blurred placeholder before any image loads.
  thumbhash  text,
  media_type text not null default 'photo',
  mime_type  text,
  bytes      int,
  width      int,
  height     int,
  duration_s int,

  -- When the camera says it was taken, not when it was uploaded.
  taken_at timestamptz,
  lat      numeric,
  lng      numeric,

  caption     text,
  is_favorite boolean not null default false,
  -- Perceptual hash, for the duplicate prompt. Never used to auto-reject.
  phash       text,
  search_tsv  tsvector,

  uploaded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint valid_media_type check (media_type in ('photo', 'video'))
);

create table if not exists public.albums (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  title         text not null,
  kind          text not null default 'manual',
  trip_id       uuid references public.trips(id) on delete cascade,
  cover_media_id uuid references public.media(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint valid_kind check (kind in ('trip', 'manual', 'exchange'))
);

create table if not exists public.album_media (
  album_id uuid not null references public.albums(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete cascade,
  sort_key text,
  primary key (album_id, media_id)
);

create table if not exists public.media_comments (
  id         uuid primary key default gen_random_uuid(),
  media_id   uuid not null references public.media(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- Share links.
--
-- The only thing in this app that anyone outside the couple can see, so the
-- rules are tight: a token is 32 random bytes, it expires, it can be revoked
-- instantly, and resolving it happens server-side. A share never hands out a
-- storage path — the Route Handler validates the token and mints a short-lived
-- signed URL, so revoking actually revokes.
-- =============================================================================
create table if not exists public.share_links (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples(id) on delete cascade,
  created_by     uuid references public.profiles(id) on delete set null,
  token          text unique not null,
  target_type    text not null,
  target_id      uuid not null,
  allow_download boolean not null default false,
  passcode_hash  text,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  view_count     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint valid_target check (target_type in ('media', 'album'))
);

-- One photo each per day while apart. The unique key is what makes it one.
create table if not exists public.daily_exchange (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  media_id      uuid not null references public.media(id) on delete cascade,
  -- A calendar date, in the poster's own timezone. Never a timestamp.
  exchange_date date not null,
  created_at    timestamptz not null default now(),
  unique (couple_id, user_id, exchange_date)
);

create index if not exists media_timeline_idx
  on public.media (couple_id, taken_at desc) where deleted_at is null;
create index if not exists media_trip_idx
  on public.media (trip_id, taken_at desc) where deleted_at is null;
create index if not exists media_search_idx on public.media using gin (search_tsv);
create index if not exists media_trash_idx
  on public.media (deleted_at) where deleted_at is not null;
create index if not exists album_media_sorted_idx on public.album_media (album_id, sort_key);
create index if not exists share_links_token_idx on public.share_links (token);

drop trigger if exists media_updated_at on public.media;
create trigger media_updated_at before update on public.media
  for each row execute function public.set_updated_at();
drop trigger if exists albums_updated_at on public.albums;
create trigger albums_updated_at before update on public.albums
  for each row execute function public.set_updated_at();
drop trigger if exists media_comments_updated_at on public.media_comments;
create trigger media_comments_updated_at before update on public.media_comments
  for each row execute function public.set_updated_at();
drop trigger if exists share_links_updated_at on public.share_links;
create trigger share_links_updated_at before update on public.share_links
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Search.
--
-- Maintained by trigger rather than by the client, so a caption edited from
-- anywhere — the lightbox, a future bulk tool, a migration — is searchable
-- without anyone remembering to update a second column.
-- =============================================================================
create or replace function public.media_search_tsv()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.caption, '')), 'A');
  return new;
end $$;

revoke all on function public.media_search_tsv() from public, anon, authenticated;

drop trigger if exists media_search on public.media;
create trigger media_search before insert or update of caption on public.media
  for each row execute function public.media_search_tsv();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.media          enable row level security;
alter table public.albums         enable row level security;
alter table public.album_media    enable row level security;
alter table public.media_comments enable row level security;
alter table public.share_links    enable row level security;
alter table public.daily_exchange enable row level security;

-- A shared library is shared: both partners read and edit everything in it.
-- Whose photo it is stays visible through `uploader_id`.
drop policy if exists "couple read" on public.media;
create policy "couple read" on public.media
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.media;
create policy "couple write" on public.media
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.albums;
create policy "couple read" on public.albums
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.albums;
create policy "couple write" on public.albums
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.album_media;
create policy "couple read" on public.album_media
  for select using (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ));
drop policy if exists "couple write" on public.album_media;
create policy "couple write" on public.album_media
  for all using (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ))
  with check (exists (
    select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)
  ));

drop policy if exists "couple read" on public.media_comments;
create policy "couple read" on public.media_comments
  for select using (exists (
    select 1 from public.media m where m.id = media_id and public.is_couple_member(m.couple_id)
  ));
-- You write your own comments. Editing what your partner said about a photo is
-- not a feature anyone asked for.
drop policy if exists "write own comment" on public.media_comments;
create policy "write own comment" on public.media_comments
  for all using (author_id = auth.uid())
      with check (author_id = auth.uid() and exists (
        select 1 from public.media m where m.id = media_id and public.is_couple_member(m.couple_id)
      ));

drop policy if exists "couple read" on public.share_links;
create policy "couple read" on public.share_links
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.share_links;
create policy "couple write" on public.share_links
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.daily_exchange;
create policy "couple read" on public.daily_exchange
  for select using (public.is_couple_member(couple_id));
drop policy if exists "post own" on public.daily_exchange;
create policy "post own" on public.daily_exchange
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

-- =============================================================================
-- Storage
--
-- Private bucket, path {couple_id}/{media_id}/{variant}.jpg. Membership is
-- read off the first path segment, which is why that segment is the couple id
-- and not something guessable.
--
-- The size limit is per object and generous for a 1600px JPEG. It exists to
-- stop an accidental original — the thing this whole design avoids — from
-- reaching the bucket at all.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects
  for select using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media write" on storage.objects;
create policy "media write" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media update" on storage.objects;
create policy "media update" on storage.objects
  for update using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects
  for delete using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- Trip albums.
--
-- Auto-created, and idempotent: called on trip create and again whenever the
-- gallery notices a trip without one, so a trip made before this migration
-- still gets its album the first time someone opens its photos.
-- =============================================================================
create or replace function public.ensure_trip_album(target_trip uuid)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  t        public.trips;
  album_id uuid;
begin
  select * into t from public.trips where id = target_trip and deleted_at is null;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  select id into album_id from public.albums
   where trip_id = target_trip and kind = 'trip' limit 1;
  if album_id is not null then return album_id; end if;

  insert into public.albums (couple_id, title, kind, trip_id, created_by)
  values (t.couple_id, t.title, 'trip', t.id, auth.uid())
  returning id into album_id;

  return album_id;
end $$;

revoke all on function public.ensure_trip_album(uuid) from public, anon;
grant execute on function public.ensure_trip_album(uuid) to authenticated;

-- =============================================================================
-- The trash sweep.
--
-- Returns the paths to delete rather than deleting the rows itself, because
-- **order matters**: the storage objects must go first. Deleting the rows first
-- loses the only record of which files existed, and those files then sit in the
-- bucket consuming the quota with nothing left pointing at them.
--
-- The cron handler calls this, removes the objects, then calls the purge below.
-- =============================================================================
create or replace function public.expired_media(grace_days int default 30)
returns table (id uuid, path_display text, path_thumb text, path_original text)
language sql stable security definer
set search_path = public as $$
  select m.id, m.path_display, m.path_thumb, m.path_original
    from public.media m
   where m.deleted_at is not null
     and m.deleted_at < now() - make_interval(days => grace_days);
$$;

revoke all on function public.expired_media(int) from public, anon, authenticated;

create or replace function public.purge_media(ids uuid[])
returns int language plpgsql security definer
set search_path = public as $$
declare
  affected int;
begin
  delete from public.media
   where id = any(ids)
     -- Belt and braces: only ever rows already soft-deleted, whatever the
     -- caller passed in.
     and deleted_at is not null;
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.purge_media(uuid[]) from public, anon, authenticated;

-- =============================================================================
-- Storage usage, so the gallery can say how much of the gigabyte is left.
-- =============================================================================
create or replace function public.media_usage()
returns table (photo_count bigint, total_bytes bigint, trashed_count bigint)
language sql stable security definer
set search_path = public as $$
  select
    count(*) filter (where deleted_at is null),
    coalesce(sum(bytes) filter (where deleted_at is null), 0),
    count(*) filter (where deleted_at is not null)
  from public.media
  where public.is_couple_member(couple_id);
$$;

revoke all on function public.media_usage() from public, anon;
grant execute on function public.media_usage() to authenticated;
