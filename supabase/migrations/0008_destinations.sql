-- =============================================================================
-- 0008_destinations — deciding *where*. Spec: Module 4.
--
-- A comparison workspace, not a recommender. The board holds candidates side by
-- side and shows what differs; choosing is a human act, and the app never
-- ranks unless someone moves a weight off zero.
--
-- Two of the three tables here are shared reference data rather than couple
-- data. That is deliberate: a visa rule for an Indian passport entering the
-- Schengen area is the same fact for every couple in the app, and duplicating
-- it per couple would mean N copies of a thing that has one correct value.
-- =============================================================================

create table if not exists public.trip_destinations (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  city         text not null,
  country_code text,                              -- ISO 3166-1 alpha-2
  lat          numeric,
  lng          numeric,
  timezone     text,
  state        text not null default 'candidate',
  arrive_on    date,
  depart_on    date,
  sort_key     text not null,
  notes        text,
  -- Everything the board computed when the candidate was added. Nothing in it
  -- goes stale on its own: flight durations are constant, visa rules change
  -- about yearly, and seasons never change at all.
  board        jsonb not null default '{}',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint valid_state check (state in ('candidate', 'chosen', 'rejected')),
  constraint valid_window check (
    arrive_on is null or depart_on is null or depart_on >= arrive_on
  )
);

create index if not exists trip_destinations_trip_idx
  on public.trip_destinations (trip_id, sort_key) where deleted_at is null;

-- At most one chosen destination per trip. The RPC below enforces the
-- transition; this makes the invariant true even if someone writes directly.
create unique index if not exists trip_destinations_one_chosen_idx
  on public.trip_destinations (trip_id)
  where state = 'chosen' and deleted_at is null;

drop trigger if exists trip_destinations_updated_at on public.trip_destinations;
create trigger trip_destinations_updated_at before update on public.trip_destinations
  for each row execute function public.set_updated_at();

alter table public.trip_destinations enable row level security;

drop policy if exists "couple read" on public.trip_destinations;
create policy "couple read" on public.trip_destinations
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.trip_destinations;
create policy "couple write" on public.trip_destinations
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Shared reference data.
--
-- Readable by anyone signed in, writable by nobody through the API. New rows
-- arrive by migration, which is the only way advisory data should change: a
-- user-editable visa table is a user-editable source of immigration advice.
-- Per-person exceptions live in `allowance_rules` (0009), where they belong.
-- =============================================================================

create table if not exists public.visa_rules (
  id                  uuid primary key default gen_random_uuid(),
  passport_country    text not null,
  destination_country text not null,              -- or a zone code, e.g. SCHENGEN
  tier                int not null,
  label               text,
  max_days            int,
  source_url          text,
  verified_on         date,
  unique (passport_country, destination_country),
  constraint valid_tier check (tier between 0 and 5)
);

alter table public.visa_rules enable row level security;

drop policy if exists "signed in read" on public.visa_rules;
create policy "signed in read" on public.visa_rules
  for select using (auth.uid() is not null);

create table if not exists public.airport_routes (
  origin_iata      text not null,
  dest_iata        text not null,
  duration_minutes int not null,
  is_direct        boolean not null default true,
  primary key (origin_iata, dest_iata)
);

alter table public.airport_routes enable row level security;

drop policy if exists "signed in read" on public.airport_routes;
create policy "signed in read" on public.airport_routes
  for select using (auth.uid() is not null);

-- =============================================================================
-- Scoring weights (spec 4.2: "persisted per couple, not per trip").
--
-- Its own table rather than a column on `couples`, and not folded into
-- `couple_settings` — that table belongs to Module 14 and inventing half of it
-- here would make the later migration a merge instead of a create.
-- =============================================================================
create table if not exists public.destination_weights (
  couple_id  uuid primary key references public.couples(id) on delete cascade,
  -- All zero by default, which is what makes ranking opt-in.
  weights    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists destination_weights_updated_at on public.destination_weights;
create trigger destination_weights_updated_at before update on public.destination_weights
  for each row execute function public.set_updated_at();

alter table public.destination_weights enable row level security;

drop policy if exists "couple read" on public.destination_weights;
create policy "couple read" on public.destination_weights
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.destination_weights;
create policy "couple write" on public.destination_weights
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- =============================================================================
-- Choosing a destination.
--
-- Three writes that must not be separable: this one becomes chosen, its rivals
-- become rejected, and the trip takes its timezone. Half of that applied is a
-- trip whose itinerary times mean something different from what its planner
-- intended, so it is one transaction.
--
-- Rejected candidates stay visible. The reasoning for a decision is worth as
-- much as the decision, and a board with one column explains nothing.
-- =============================================================================
create or replace function public.choose_destination(destination_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  d public.trip_destinations;
begin
  select * into d from public.trip_destinations
   where id = destination_id and deleted_at is null;
  if d is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(d.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  update public.trip_destinations
     set state = 'rejected'
   where trip_id = d.trip_id
     and id <> d.id
     and deleted_at is null
     and state <> 'rejected';

  update public.trip_destinations set state = 'chosen' where id = d.id;

  -- A destination with no timezone leaves the trip's alone rather than
  -- clearing it: an unknown zone is not the same as no zone.
  update public.trips
     set timezone = coalesce(d.timezone, timezone)
   where id = d.trip_id;
end $$;

revoke all on function public.choose_destination(uuid) from public, anon;
grant execute on function public.choose_destination(uuid) to authenticated;

-- Undo. Marking one chosen is reversible (spec 4.2), and going back should not
-- resurrect the rejections that the choice caused.
create or replace function public.unchoose_destination(destination_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  d public.trip_destinations;
begin
  select * into d from public.trip_destinations
   where id = destination_id and deleted_at is null;
  if d is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_couple_member(d.couple_id) then raise exception 'NOT_A_MEMBER'; end if;

  update public.trip_destinations
     set state = 'candidate'
   where trip_id = d.trip_id and deleted_at is null;
end $$;

revoke all on function public.unchoose_destination(uuid) from public, anon;
grant execute on function public.unchoose_destination(uuid) to authenticated;

-- =============================================================================
-- Seed: visa rules.
--
-- READ THIS BEFORE TRUSTING A ROW. These are a starting point, not an
-- authority. Every one carries its source and the date it was checked, and
-- every surface that renders one shows both plus "Advisory only — confirm with
-- the embassy" (spec 4.3, non-negotiable #4). Rules change with no notice and
-- individual circumstances differ; the app's job is to say what it knows and
-- when it learned it, never to be believed.
--
-- Deliberately small. A missing rule renders as "Unknown — check officially",
-- which is a safe answer. A wrong rule is not.
--
-- Tiers: 0 visa-free · 1 eVisa/ETA online · 2 visa on arrival ·
--        3 embassy appointment · 4 difficult/long lead · 5 unavailable
-- =============================================================================
insert into public.visa_rules
  (passport_country, destination_country, tier, label, max_days, source_url, verified_on)
values
  -- Indian passport
  ('IN', 'SCHENGEN', 3, 'Schengen visa required — embassy appointment', 90,
   'https://en.wikipedia.org/wiki/Visa_requirements_for_Indian_citizens', '2026-08-14'),
  ('IN', 'US', 3, 'B1/B2 visa required — embassy interview', 180,
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('IN', 'GB', 3, 'Standard Visitor visa required', 180,
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('IN', 'CA', 3, 'Visitor visa (TRV) required', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('IN', 'JP', 3, 'Visa required — embassy or accredited agency', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/index.html', '2026-08-14'),
  ('IN', 'AE', 1, 'eVisa, or visa on arrival with a US/UK/Schengen visa', 60,
   'https://u.ae/en/information-and-services/visa-and-emirates-id', '2026-08-14'),
  ('IN', 'LK', 1, 'ETA online before travel', 30,
   'https://www.eta.gov.lk/', '2026-08-14'),
  ('IN', 'MV', 2, 'Free visa on arrival', 30,
   'https://immigration.gov.mv/tourist-visa/', '2026-08-14'),
  ('IN', 'NP', 0, 'No visa required', null,
   'https://www.immigration.gov.np/', '2026-08-14'),

  -- US passport
  ('US', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('US', 'GB', 1, 'Electronic Travel Authorisation required', 180,
   'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta', '2026-08-14'),
  ('US', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('US', 'CA', 0, 'Visa-free; eTA not required for US citizens', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('US', 'AU', 1, 'ETA (subclass 601) online', 90,
   'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
   '2026-08-14'),
  ('US', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14'),

  -- British passport
  ('GB', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('GB', 'US', 1, 'ESTA under the Visa Waiver Program', 90,
   'https://esta.cbp.dhs.gov/', '2026-08-14'),
  ('GB', 'CA', 1, 'eTA required for air travel', 180,
   'https://www.canada.ca/en/immigration-refugees-citizenship.html', '2026-08-14'),
  ('GB', 'AU', 1, 'ETA (subclass 601) online', 90,
   'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
   '2026-08-14'),
  ('GB', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('GB', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14'),

  -- Canadian passport
  ('CA', 'SCHENGEN', 0, 'Visa-free — 90 days in any 180', 90,
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('CA', 'US', 0, 'Visa-free for short visits', 180,
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('CA', 'GB', 1, 'Electronic Travel Authorisation required', 180,
   'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta', '2026-08-14'),
  ('CA', 'JP', 0, 'Visa-free short stay', 90,
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('CA', 'IN', 1, 'e-Tourist visa online', 90,
   'https://indianvisaonline.gov.in/', '2026-08-14')
on conflict (passport_country, destination_country) do nothing;
