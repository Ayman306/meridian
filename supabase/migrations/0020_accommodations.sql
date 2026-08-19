-- =============================================================================
-- 0020_accommodations — where they sleep.
--
-- The app could say which city a trip is in on a given day and not which bed.
-- That is the largest hole in the journey view: "where are we staying" is the
-- question a couple asks most often on a trip, and until now the answer lived
-- in an email.
--
-- ## Why the dates are check-in and check-out, not arrive and depart
--
-- `trip_destinations` already has `arrive_on` / `depart_on`, and reusing those
-- names here would invite the assumption that the two ranges mean the same
-- thing. They do not. A destination's range covers *days in a city*, inclusive
-- at both ends. A stay covers *nights*, and the check-out day is one you are
-- there for the morning of and not the night of. Three nights from the 4th is
-- check_in 04, check_out 07 — four calendar days, three nights.
--
-- The consequence worth stating: `check_out` is exclusive. Every query that
-- asks "which stay covers this date" uses `date >= check_in and date <
-- check_out`, and the one that asks "is this the morning we leave" compares
-- equality with `check_out`. Getting this backwards would show somebody a hotel
-- on a night they had already left it.
--
-- ## Why the booking reference is here at all
--
-- It is the one thing you need at a front desk at 1am and cannot find. It is
-- couple-shared like everything else on a trip — but it never leaves the app:
-- the MCP tools select an explicit column list that omits it, asserted in
-- `registry.test.ts`, for the same reason document numbers are omitted. A
-- reference sitting in a model's context is a reference that has left the
-- couple's control.
-- =============================================================================

create table if not exists public.accommodations (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  -- Null is legal: a stay can be saved before anybody decides which trip it
  -- belongs to, the same way a wishlist item can.
  trip_id      uuid references public.trips(id) on delete set null,

  name         text not null,
  kind         text not null default 'hotel',

  -- Nights, not days. See the note above.
  check_in     date,
  check_out    date,

  -- Resolved, never typed. Every path that writes these goes through the
  -- geocoder or a parsed maps link (D91–D95).
  address      text,
  city         text,
  country_code text,
  lat          numeric,
  lng          numeric,
  maps_url     text,

  -- The 1am column. Never exposed to a model — see the note above.
  booking_ref  text,
  -- Where it was booked, so a change can be made without hunting for the site.
  url          text,
  phone        text,
  notes        text,

  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Somebody would regret losing a booking reference, so this is a soft delete.
  deleted_at   timestamptz,

  constraint valid_kind check (kind in ('hotel', 'apartment', 'guesthouse', 'family', 'other')),
  -- A one-night stay is check_out = check_in + 1. Equal dates would be a zero
  -- night stay, which is not a stay.
  constraint valid_nights check (
    check_in is null or check_out is null or check_out > check_in
  )
);

create index if not exists accommodations_trip_idx
  on public.accommodations (trip_id, check_in) where deleted_at is null;
create index if not exists accommodations_couple_idx
  on public.accommodations (couple_id, check_in) where deleted_at is null;

drop trigger if exists accommodations_updated_at on public.accommodations;
create trigger accommodations_updated_at before update on public.accommodations
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — the standard couple pair. A stay is shared: either partner books one,
-- either partner needs to read it at a front desk.
-- =============================================================================
alter table public.accommodations enable row level security;

drop policy if exists "couple read" on public.accommodations;
create policy "couple read" on public.accommodations
  for select using (public.is_couple_member(couple_id));

drop policy if exists "couple write" on public.accommodations;
create policy "couple write" on public.accommodations
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));
