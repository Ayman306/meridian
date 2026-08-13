-- =============================================================================
-- 0007_wishlist — independent saving, then a shared view of the overlap.
-- Spec: Module 7. Plus the geocode cache the map needs (spec 6.3).
--
-- The design note in the spec is the important part: verdicts live in their own
-- table so each partner can react to the other's saves without mutating them.
-- A "no" from one person is an opinion about someone else's idea, not an edit
-- of it — and the person who saved it should still see it as theirs.
-- =============================================================================

create table if not exists public.wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  city         text,
  country_code text,
  lat          numeric,
  lng          numeric,
  place_name   text,
  address      text,
  maps_url     text,
  category_id  uuid references public.categories(id) on delete set null,
  intensity    int check (intensity is null or intensity between 1 and 5),
  url          text,
  notes        text,
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.wishlist_verdicts (
  wishlist_id uuid not null references public.wishlist_items(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  verdict     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (wishlist_id, user_id),
  constraint valid_verdict check (verdict in ('yes', 'no', 'maybe'))
);

create index if not exists wishlist_city_idx
  on public.wishlist_items (couple_id, city) where deleted_at is null;
create index if not exists wishlist_user_idx
  on public.wishlist_items (couple_id, user_id) where deleted_at is null;

drop trigger if exists wishlist_items_updated_at on public.wishlist_items;
create trigger wishlist_items_updated_at before update on public.wishlist_items
  for each row execute function public.set_updated_at();
drop trigger if exists wishlist_verdicts_updated_at on public.wishlist_verdicts;
create trigger wishlist_verdicts_updated_at before update on public.wishlist_verdicts
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.wishlist_items    enable row level security;
alter table public.wishlist_verdicts enable row level security;

-- Both partners read everything saved. The point of the module is seeing what
-- the other one liked.
drop policy if exists "couple read" on public.wishlist_items;
create policy "couple read" on public.wishlist_items
  for select using (public.is_couple_member(couple_id));

-- But you only edit your own saves. Someone else's idea is theirs to reword.
drop policy if exists "write own" on public.wishlist_items;
create policy "write own" on public.wishlist_items
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.wishlist_verdicts;
create policy "couple read" on public.wishlist_verdicts
  for select using (exists (
    select 1 from public.wishlist_items w
    where w.id = wishlist_id and public.is_couple_member(w.couple_id)
  ));

-- A verdict is yours: you cast it, you change it, nobody casts one for you.
drop policy if exists "write own verdict" on public.wishlist_verdicts;
create policy "write own verdict" on public.wishlist_verdicts
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and exists (
        select 1 from public.wishlist_items w
        where w.id = wishlist_id and public.is_couple_member(w.couple_id)
      ));

-- =============================================================================
-- Geocode cache (spec 6.3)
--
-- Nominatim allows one request a second and asks that results be cached. This
-- is deliberately NOT couple-scoped: "lisbon" resolves to the same coordinates
-- for everyone, and duplicating rows per couple would mean more requests to a
-- free service that asked us not to make them. It holds public place data and
-- nothing about who searched for it.
-- =============================================================================
create table if not exists public.geocode_cache (
  query        text primary key,
  results      jsonb not null,
  cached_at    timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

drop policy if exists "signed in read" on public.geocode_cache;
create policy "signed in read" on public.geocode_cache
  for select using (auth.uid() is not null);

drop policy if exists "signed in write" on public.geocode_cache;
create policy "signed in write" on public.geocode_cache
  for insert with check (auth.uid() is not null);

drop policy if exists "signed in refresh" on public.geocode_cache;
create policy "signed in refresh" on public.geocode_cache
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- =============================================================================
-- Push a wishlist save into the idea pool.
--
-- One transaction so the duplicate check and the insert cannot race, and so
-- `source` and `proposed_by` are set the same way however it is called. Returns
-- null when the item is already in the trip's pool rather than raising: pushing
-- twice is a mistake worth reporting, not an error worth interrupting a bulk
-- push for (spec 7.6).
-- =============================================================================
create or replace function public.push_wishlist_to_itinerary(
  wishlist_item_id uuid,
  target_trip_id   uuid,
  new_sort_key     text
)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  w      public.wishlist_items;
  t      public.trips;
  new_id uuid;
begin
  select * into w from public.wishlist_items where id = wishlist_item_id and deleted_at is null;
  if w is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(w.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  select * into t from public.trips where id = target_trip_id;
  if t is null or t.couple_id <> w.couple_id then raise exception 'NOT_FOUND'; end if;

  -- Already pushed? Say so by returning null rather than making a second copy.
  if exists (
    select 1 from public.itinerary_items i
    where i.trip_id = target_trip_id
      and i.deleted_at is null
      and i.source = 'wishlist'
      and lower(i.title) = lower(w.title)
  ) then
    return null;
  end if;

  insert into public.itinerary_items (
    couple_id, trip_id, title, place_name, lat, lng, address, maps_url,
    category_id, notes, url, proposed_by, source, sort_key
  ) values (
    w.couple_id, target_trip_id, w.title, w.place_name, w.lat, w.lng, w.address, w.maps_url,
    w.category_id, w.notes, w.url,
    -- Whose pick survives the move. That attribution is the whole point.
    w.user_id, 'wishlist',
    -- The caller supplies the key. Fractional indexing lives in one place
    -- (lib/fractional.ts); deriving keys here too would mean two
    -- implementations that have to agree, and a suffix trick would grow the
    -- key by a character on every push.
    new_sort_key
  )
  returning id into new_id;

  return new_id;
end $$;

revoke all on function public.push_wishlist_to_itinerary(uuid, uuid, text) from public, anon;
grant execute on function public.push_wishlist_to_itinerary(uuid, uuid, text) to authenticated;
