-- =============================================================================
-- 0009_allowance — how long each of them may legally stay. Spec: Module 10.
--
-- The module that prevents a real-world mistake with real-world consequences,
-- which shapes two things in this file.
--
-- First, a missing rule is never "unlimited". There is no default row and no
-- fallback; a country with no rule reads "not tracked" and the app says
-- nothing about it.
--
-- Second, every rule carries where it came from and when it was checked, and
-- every screen that shows one repeats the disclaimer. This module must never
-- present itself as authoritative.
-- =============================================================================

-- =============================================================================
-- Rules.
--
-- The spec's schema has no owner columns, but 10.2 requires rules to be per
-- person and manually editable — "the user's actual visa may differ from the
-- generic rule", which is exactly the case that matters. So one table holds
-- both: rows with a null couple_id are the seeded defaults everyone reads, and
-- a row with a couple_id and user_id is that person's override.
--
-- Overrides win. A resident permit or a long-stay visa is a fact about the
-- person, and the generic rule for their passport is simply wrong for them.
-- =============================================================================
create table if not exists public.allowance_rules (
  id                  uuid primary key default gen_random_uuid(),
  -- Null on the seeded defaults. Set on a couple's own override.
  couple_id           uuid references public.couples(id) on delete cascade,
  user_id             uuid references public.profiles(id) on delete cascade,
  passport_country    text not null,
  destination_country text not null,               -- or a zone code, e.g. SCHENGEN
  rule_type           text not null,
  max_days            int not null,
  window_days         int,                         -- required by 'rolling'
  region_members      text[],                      -- zone rules count across these
  label               text,
  notes               text,
  source_url          text,
  verified_on         date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint valid_rule_type check (
    -- 'none' is spec 10.6's resident/PR case: tracked, and deliberately no limit.
    rule_type in ('rolling', 'per_entry', 'per_year', 'per_visa', 'none')
  ),
  constraint rolling_needs_window check (
    rule_type <> 'rolling' or window_days is not null
  ),
  -- An override belongs to somebody. A default belongs to nobody.
  constraint owner_is_all_or_nothing check (
    (couple_id is null and user_id is null) or (couple_id is not null and user_id is not null)
  )
);

-- One default per passport/destination, and one override per person per
-- destination. Partial indexes because the null couple_id is the distinction.
-- The date a 'per_visa' allowance starts counting from — the visa's issue
-- date. The spec's schema has no column for it and its rule type cannot be
-- evaluated without one: "days since the visa was issued" needs the date the
-- visa was issued. Null for every other rule type.
alter table public.allowance_rules add column if not exists window_start date;

create unique index if not exists allowance_rules_default_idx
  on public.allowance_rules (passport_country, destination_country)
  where couple_id is null;
create unique index if not exists allowance_rules_override_idx
  on public.allowance_rules (user_id, destination_country)
  where couple_id is not null;

drop trigger if exists allowance_rules_updated_at on public.allowance_rules;
create trigger allowance_rules_updated_at before update on public.allowance_rules
  for each row execute function public.set_updated_at();

alter table public.allowance_rules enable row level security;

-- The defaults are reference data; a couple's overrides are theirs.
drop policy if exists "read defaults and own" on public.allowance_rules;
create policy "read defaults and own" on public.allowance_rules
  for select using (
    (couple_id is null and auth.uid() is not null)
    or public.is_couple_member(couple_id)
  );

-- You edit your own overrides and nobody else's, and you cannot edit a default
-- through the API at all — those change by migration.
drop policy if exists "write own override" on public.allowance_rules;
create policy "write own override" on public.allowance_rules
  for all using (couple_id is not null and user_id = auth.uid())
      with check (
        couple_id is not null
        and user_id = auth.uid()
        and public.is_couple_member(couple_id)
      );

-- =============================================================================
-- The log.
--
-- Shared, not private: two people planning a trip need to see whether either
-- of them is close to a limit. (Health data is the module where the default
-- flips; this is not that.) Each writes only their own rows.
-- =============================================================================
create table if not exists public.entry_exit_log (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  country_code text not null,
  entered_on   date not null,
  -- Null means still there. Counted through today, and the answer changes daily.
  exited_on    date,
  trip_id      uuid references public.trips(id) on delete set null,
  -- True when derived from trip dates rather than confirmed by a stamp.
  is_estimated boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint valid_stay check (exited_on is null or exited_on >= entered_on)
);

create index if not exists entry_exit_log_lookup_idx
  on public.entry_exit_log (user_id, country_code, entered_on);

drop trigger if exists entry_exit_log_updated_at on public.entry_exit_log;
create trigger entry_exit_log_updated_at before update on public.entry_exit_log
  for each row execute function public.set_updated_at();

alter table public.entry_exit_log enable row level security;

drop policy if exists "couple read" on public.entry_exit_log;
create policy "couple read" on public.entry_exit_log
  for select using (public.is_couple_member(couple_id));

drop policy if exists "write own" on public.entry_exit_log;
create policy "write own" on public.entry_exit_log
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid() and public.is_couple_member(couple_id));

-- =============================================================================
-- Seed: allowance rules.
--
-- Same warning as the visa seed in 0008. These are a starting point with a
-- source and a date attached, not an authority, and the UI never presents them
-- as one. Small on purpose: "not tracked" is a safe answer and a wrong limit
-- is not.
--
-- The Schengen rule is the one worth getting exactly right, because it is the
-- one people get wrong: 90 days in any rolling 180, counted across every
-- member state together, with entry and exit days both counting.
-- =============================================================================
insert into public.allowance_rules (
  passport_country, destination_country, rule_type, max_days, window_days,
  region_members, label, source_url, verified_on
)
values
  ('US', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('GB', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('CA', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   '90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),
  ('IN', 'SCHENGEN', 'rolling', 90, 180,
   array['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT',
         'LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH'],
   'Short-stay visa: 90 days in any 180 across the Schengen area',
   'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa_en', '2026-08-14'),

  -- Per-entry rules: the clock restarts each time you arrive.
  ('US', 'GB', 'per_entry', 180, null, null,
   'Up to 6 months per visit',
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('CA', 'GB', 'per_entry', 180, null, null,
   'Up to 6 months per visit',
   'https://www.gov.uk/standard-visitor', '2026-08-14'),
  ('GB', 'US', 'per_entry', 90, null, null,
   'Visa Waiver Program: up to 90 days per entry',
   'https://esta.cbp.dhs.gov/', '2026-08-14'),
  ('CA', 'US', 'per_entry', 180, null, null,
   'Generally up to 6 months per entry',
   'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', '2026-08-14'),
  ('US', 'JP', 'per_entry', 90, null, null,
   'Visa-free short stay, up to 90 days',
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('GB', 'JP', 'per_entry', 90, null, null,
   'Visa-free short stay, up to 90 days',
   'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html', '2026-08-14'),
  ('IN', 'NP', 'none', 0, null, null,
   'No limit for Indian citizens',
   'https://www.immigration.gov.np/', '2026-08-14')
on conflict do nothing;
