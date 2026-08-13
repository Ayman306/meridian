-- =============================================================================
-- 0003_itinerary — the planning surface. Spec: Module 5.
--
-- Scheduling is optional. An unscheduled pile of ideas is a first-class state,
-- which is why every scheduling column is nullable.
-- =============================================================================

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  name       text not null,
  icon       text,
  color      text,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, name)
);

create table if not exists public.itinerary_items (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples(id) on delete cascade,
  trip_id        uuid not null references public.trips(id) on delete cascade,
  title          text not null,

  -- All nullable: null scheduled_date means the item lives in the idea pool.
  scheduled_date date,
  start_time     time,
  end_time       time,
  duration_minutes int,

  destination_id uuid,           -- FK added with Destinations (Module 4)
  place_name     text,
  lat            numeric,
  lng            numeric,
  address        text,
  maps_url       text,

  category_id    uuid references public.categories(id) on delete set null,
  notes          text,
  url            text,
  cost_estimate  numeric,
  currency       text,

  proposed_by    uuid references public.profiles(id),   -- whose pick
  source         text not null default 'manual',        -- manual|wishlist|blend|ai
  state          text not null default 'idea',          -- idea|accepted|booked|done|skipped

  sort_key       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint valid_source check (source in ('manual', 'wishlist', 'blend', 'ai')),
  constraint valid_state  check (state in ('idea', 'accepted', 'booked', 'done', 'skipped')),
  -- A time with no date is meaningless: "8pm" on no particular day.
  constraint time_needs_date check (start_time is null or scheduled_date is not null)
);

create table if not exists public.suggestion_tray (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  trip_id      uuid references public.trips(id) on delete cascade,
  payload      jsonb not null,
  source       text,                          -- 'blend' | 'ai'
  generated_at timestamptz not null default now(),
  accepted_at  timestamptz,
  dismissed_at timestamptz
);

create index if not exists itinerary_day_idx
  on public.itinerary_items (trip_id, scheduled_date, sort_key)
  where deleted_at is null;

create index if not exists itinerary_pool_idx
  on public.itinerary_items (trip_id, sort_key)
  where scheduled_date is null and deleted_at is null;

create index if not exists suggestion_tray_open_idx
  on public.suggestion_tray (trip_id)
  where accepted_at is null and dismissed_at is null;

create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger itinerary_items_updated_at before update on public.itinerary_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.categories      enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.suggestion_tray enable row level security;

create policy "couple read" on public.categories
  for select using (public.is_couple_member(couple_id));
create policy "couple write" on public.categories
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

create policy "couple read" on public.itinerary_items
  for select using (public.is_couple_member(couple_id));
create policy "couple write" on public.itinerary_items
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

create policy "couple read" on public.suggestion_tray
  for select using (public.is_couple_member(couple_id));
create policy "couple write" on public.suggestion_tray
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Seeding
-- =============================================================================
create or replace function public.seed_categories(target uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_couple_member(target) then raise exception 'NOT_A_MEMBER'; end if;

  insert into public.categories (couple_id, name, icon, color, is_default, sort_order)
  values
    (target, 'Food',      'utensils',   'amber',  true, 0),
    (target, 'Sight',     'landmark',   'sky',    true, 1),
    (target, 'Activity',  'compass',    'teal',   true, 2),
    (target, 'Transport', 'train',      'slate',  true, 3),
    (target, 'Stay',      'bed',        'violet', true, 4),
    (target, 'Admin',     'file-text',  'zinc',   true, 5),
    (target, 'Rest',      'moon',       'stone',  true, 6)
  on conflict (couple_id, name) do nothing;
end $$;

-- =============================================================================
-- Day type auto-assignment
--
-- A day gains its first item and becomes "planned" — but only if it is
-- currently "open". A manually set rest or work day is never demoted. Running
-- this in a trigger rather than the client means it holds however the item got
-- there: drag, bulk move, or an accepted suggestion.
-- =============================================================================
create or replace function public.promote_day_on_item()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.scheduled_date is null or new.deleted_at is not null then
    return new;
  end if;

  insert into public.trip_days (trip_id, date, day_type)
  values (new.trip_id, new.scheduled_date, 'planned')
  on conflict (trip_id, date) do update
    set day_type = case when public.trip_days.day_type = 'open'
                        then 'planned'
                        else public.trip_days.day_type end;
  return new;
end $$;

create trigger itinerary_promotes_day
  after insert or update of scheduled_date on public.itinerary_items
  for each row execute function public.promote_day_on_item();

-- =============================================================================
-- Which days carry items — asked before shortening a trip, so the prompt can
-- name what would be lost (spec 3.3).
-- =============================================================================
create or replace function public.trip_item_counts_by_day(target uuid)
returns table (date date, item_count bigint)
language sql security definer stable
set search_path = public as $$
  select i.scheduled_date, count(*)
  from public.itinerary_items i
  join public.trips t on t.id = i.trip_id
  where i.trip_id = target
    and i.scheduled_date is not null
    and i.deleted_at is null
    and public.is_couple_member(t.couple_id)
  group by i.scheduled_date;
$$;

-- =============================================================================
-- Shortening a trip must not destroy work.
--
-- 0002's sync_trip_days() deletes days that fall outside the new range. Now
-- that items can be attached to those days, the items are unscheduled back to
-- the idea pool first — they lose their slot, never their content. Replacing
-- the function here keeps the whole operation in one transaction.
-- =============================================================================
create or replace function public.sync_trip_days(target uuid)
returns int language plpgsql security definer
set search_path = public as $$
declare
  t public.trips;
  horizon date;
  removed int;
begin
  select * into t from public.trips where id = target;
  if t is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(t.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  if t.start_date is null then
    -- No dates at all: the itinerary becomes a pure idea pool.
    update public.itinerary_items
       set scheduled_date = null, start_time = null, end_time = null
     where trip_id = target and scheduled_date is not null;
    delete from public.trip_days where trip_id = target;
    return 0;
  end if;

  horizon := coalesce(t.end_date, t.start_date + 30);

  insert into public.trip_days (trip_id, date)
  select target, d::date
  from generate_series(t.start_date, horizon, interval '1 day') d
  on conflict (trip_id, date) do nothing;

  update public.itinerary_items
     set scheduled_date = null, start_time = null, end_time = null
   where trip_id = target
     and scheduled_date is not null
     and (scheduled_date < t.start_date or scheduled_date > horizon);

  delete from public.trip_days
   where trip_id = target and (date < t.start_date or date > horizon);
  get diagnostics removed = row_count;

  return removed;
end $$;

grant execute on function public.seed_categories(uuid)          to authenticated;
grant execute on function public.trip_item_counts_by_day(uuid)  to authenticated;
grant execute on function public.sync_trip_days(uuid)           to authenticated;
