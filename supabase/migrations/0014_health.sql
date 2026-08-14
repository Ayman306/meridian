-- =============================================================================
-- 0014_health — private health data with granular, revocable sharing.
-- Spec: Module 12.
--
-- **This is the only owner-scoped module in the app.** Every other table is
-- couple-scoped: if you are in the couple, you can read it. Here, being in the
-- couple grants nothing. The owner sees their own rows, and a partner sees a
-- scope only while an unrevoked consent row exists saying so.
--
-- Spec 12.1 puts it in one sentence worth repeating: *a hidden tab is not
-- privacy — the database must refuse the read.* So there is no policy anywhere
-- in this file keyed on `is_couple_member`, and none keyed on `can_see` either
-- — the module grant from 0013 gates whether the *screen* exists, and consent
-- gates the data. Both have to be true, and they are independent on purpose:
-- granting somebody the health module does not grant them any health data.
--
-- Two further consequences of the spec's design rules:
--
-- **Revocation is instant.** `revoked_at` is checked in the policy itself, so
-- the next query after a revoke returns nothing. There is no cache to expire
-- and no job to run.
--
-- **Deletion is hard.** Spec 12.2: "Hard delete of all health data, immediate,
-- no soft-delete grace period." So no `deleted_at` column exists on any table
-- here — the one place in this codebase where the house rule about
-- soft-deleting anything a user would regret losing is deliberately reversed.
-- Somebody deleting their health data means it.
-- =============================================================================

-- =============================================================================
-- Consent.
--
-- One row per owner, viewer and scope. Revoking sets `revoked_at` rather than
-- deleting, so "you shared this and then stopped" is answerable — but only to
-- the owner, who is the only one who can read the table at all.
-- =============================================================================
create table if not exists public.health_consents (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade,
  scope      text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, viewer_id, scope),
  constraint valid_scope check (
    scope in ('cycle', 'cycle_predictions', 'symptoms', 'medications', 'vaccinations', 'notes')
  ),
  constraint no_self_consent check (owner_id <> viewer_id)
);

drop trigger if exists health_consents_updated_at on public.health_consents;
create trigger health_consents_updated_at before update on public.health_consents
  for each row execute function public.set_updated_at();

-- =============================================================================
-- The data.
-- =============================================================================
create table if not exists public.cycle_logs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  started_on date not null,
  ended_on   date,
  flow       text,
  symptoms   text[],
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_flow check (flow is null or flow in ('light', 'medium', 'heavy')),
  constraint valid_span check (ended_on is null or ended_on >= started_on)
);

create index if not exists cycle_logs_owner_idx on public.cycle_logs (owner_id, started_on desc);

create table if not exists public.health_records (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  label       text not null,
  detail      jsonb not null default '{}',
  dosage      text,
  frequency   text,
  -- Doses per day and how many are left, for the supply calculator in 12.3.
  -- The spec's `dosage`/`frequency` are free text a person writes; these two
  -- are the numbers the arithmetic needs, and neither can be parsed out of the
  -- other reliably.
  doses_per_day numeric(6,2),
  quantity_remaining numeric(8,2),
  started_on  date,
  valid_until date,
  document_id uuid references public.documents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint valid_kind check (kind in ('medication', 'vaccination', 'condition', 'allergy'))
);

create index if not exists health_records_owner_idx on public.health_records (owner_id, kind);

drop trigger if exists cycle_logs_updated_at on public.cycle_logs;
create trigger cycle_logs_updated_at before update on public.cycle_logs
  for each row execute function public.set_updated_at();

drop trigger if exists health_records_updated_at on public.health_records;
create trigger health_records_updated_at before update on public.health_records
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Border restrictions.
--
-- Reference data, and the most carefully worded table in the app. Spec 12.2:
-- "Only ever links to the official source. Never asserts the rule." So
-- `restriction` is a brief factual label, `source_url` is NOT NULL, and every
-- surface that renders one repeats that the source is the authority.
--
-- A substance with no row means "not checked", never "safe". There is no
-- default row and no fallback, exactly as with allowance rules in 0009.
-- =============================================================================
create table if not exists public.medication_restrictions (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null,
  substance    text not null,
  restriction  text,
  source_url   text not null,
  verified_on  date,
  created_at   timestamptz not null default now()
);

-- A table constraint cannot hold an expression, so the case-insensitive
-- uniqueness that stops "Codeine" and "codeine" being two rows is an index.
create unique index if not exists medication_restrictions_key
  on public.medication_restrictions (country_code, lower(substance));

-- =============================================================================
-- RLS.
--
-- The consent predicate, written once. SECURITY DEFINER so it can read
-- `health_consents` without recursing through that table's own policy.
-- =============================================================================
create or replace function public.has_health_consent(owner uuid, scope_name text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.health_consents c
    where c.owner_id = owner
      and c.viewer_id = auth.uid()
      and c.scope = scope_name
      -- Checked here rather than by a sweep: revocation has to take effect on
      -- the next query, with no cache to expire (spec 12.6).
      and c.revoked_at is null
  );
$$;

alter table public.health_consents          enable row level security;
alter table public.cycle_logs               enable row level security;
alter table public.health_records           enable row level security;
alter table public.medication_restrictions  enable row level security;

-- Consent rows belong to the owner alone. A viewer cannot enumerate what they
-- have been granted — they simply find out by whether a read returns rows.
-- Letting them read this table would turn "what does my partner track?" into a
-- question the app answers, which is the thing this module exists to prevent.
drop policy if exists "owner only" on public.health_consents;
create policy "owner only" on public.health_consents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owner full access" on public.cycle_logs;
create policy "owner full access" on public.cycle_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Read-only, and only with consent. There is no write policy for a viewer at
-- all: a partner's view is read-only by construction, not by convention.
drop policy if exists "viewer with active consent" on public.cycle_logs;
create policy "viewer with active consent" on public.cycle_logs
  for select using (public.has_health_consent(owner_id, 'cycle'));

drop policy if exists "owner full access" on public.health_records;
create policy "owner full access" on public.health_records
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Per-kind consent: sharing your vaccination record does not share your
-- medication list. The scopes are separate because the decisions are.
drop policy if exists "viewer with active consent" on public.health_records;
create policy "viewer with active consent" on public.health_records
  for select using (
    case kind
      when 'medication'   then public.has_health_consent(owner_id, 'medications')
      when 'vaccination'  then public.has_health_consent(owner_id, 'vaccinations')
      -- Conditions and allergies ride with 'notes', which is the scope whose
      -- label says "the rest of it" on the sharing screen.
      else public.has_health_consent(owner_id, 'notes')
    end
  );

-- Reference data, readable by anyone signed in, written by migration only.
drop policy if exists "signed in read" on public.medication_restrictions;
create policy "signed in read" on public.medication_restrictions
  for select using (auth.uid() is not null);

-- =============================================================================
-- Hard delete.
--
-- Spec 12.2, and the reason this is an RPC rather than three client deletes:
-- it has to be one transaction. A delete that removed the cycle logs, failed,
-- and left the consents behind would leave somebody believing they had erased
-- something they had not.
-- =============================================================================
create or replace function public.delete_all_health_data()
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.cycle_logs      where owner_id = auth.uid();
  delete from public.health_records  where owner_id = auth.uid();
  delete from public.health_consents where owner_id = auth.uid();
end $$;

-- =============================================================================
-- Seed: medication restrictions.
--
-- Deliberately tiny, and every row carries the official source. These are
-- pointers to guidance, not the guidance — the app links and says "check",
-- and never tells anyone whether they may carry something.
-- =============================================================================
insert into public.medication_restrictions
  (country_code, substance, restriction, source_url, verified_on)
values
  ('JP', 'pseudoephedrine', 'Prohibited — commonly found in cold and sinus remedies',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('JP', 'codeine', 'Restricted — limits apply and prior permission may be needed',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('JP', 'amphetamine', 'Prohibited, including some prescribed ADHD medicines',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-14'),
  ('AE', 'codeine', 'Controlled — prior approval and documentation required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('AE', 'tramadol', 'Controlled — prior approval and documentation required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('AE', 'cannabidiol', 'Prohibited',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-14'),
  ('SG', 'codeine', 'Controlled — approval needed before arrival',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-14'),
  ('SG', 'cannabidiol', 'Prohibited',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-14'),
  ('US', 'pseudoephedrine', 'Sale restricted; quantity limits apply',
   'https://www.fda.gov/drugs/information-drug-class/legal-requirements-sale-and-purchase-drug-products-containing-pseudoephedrine-ephedrine-and', '2026-08-14'),
  ('GB', 'tramadol', 'Controlled — carry a prescription and a letter for longer trips',
   'https://www.gov.uk/travelling-controlled-drugs', '2026-08-14'),
  ('IN', 'tramadol', 'Controlled substance',
   'https://cdsco.gov.in/opencms/opencms/en/Home/', '2026-08-14')
on conflict do nothing;

-- =============================================================================
-- Grants.
-- =============================================================================
grant execute on function public.has_health_consent(uuid, text) to authenticated;
grant execute on function public.delete_all_health_data()       to authenticated;
revoke all on function public.has_health_consent(uuid, text)    from public, anon;
revoke all on function public.delete_all_health_data()          from public, anon;
