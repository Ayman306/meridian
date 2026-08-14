-- =============================================================================
-- 0012_budget — shared trip spending and who owes whom. Spec: Module 13.
--
-- Two properties drive every choice in this file.
--
-- First, **a past expense's converted value is fixed**. The rate that applied
-- on the day the money was spent is the rate that applies forever; rates move
-- and a balance that moves with them is not a balance. So `amount_base`,
-- `fx_rate` and `fx_date` are stored on the row at save time and never
-- recomputed. Nothing in the app converts at read time.
--
-- Second, **money must not silently disappear into rounding**. An exact split
-- that does not sum to the total, or a percent split that does not sum to 100,
-- is rejected by a constraint rather than accepted and quietly absorbed. The
-- odd cent on an equal split goes to the payer, consistently, in one function
-- in `logic.ts` that is unit-tested.
-- =============================================================================

-- =============================================================================
-- The couple's base currency.
--
-- Every balance is computed in one currency, so there has to be one. The
-- column lives here rather than waiting for Settings (Module 14, phase 13)
-- because an expense cannot be saved without knowing what to convert it to.
-- Settings will expose it; this gives it a home and a sane starting value.
--
-- Changing it later does not rewrite history: existing rows keep the
-- `amount_base` they were saved with. That is a deliberate consequence of the
-- rule above, and the UI says so rather than pretending otherwise.
-- =============================================================================
alter table public.couples
  add column if not exists base_currency text not null default 'USD';

-- =============================================================================
-- Categories.
--
-- Per couple rather than global, because the seed is a starting point people
-- rename. Seeded by trigger on couple creation so a new couple never opens the
-- module to an empty dropdown, and backfilled below for couples that already
-- exist.
-- =============================================================================
create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  name       text not null,
  icon       text,
  color      text,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists expense_categories_name_idx
  on public.expense_categories (couple_id, lower(name));

drop trigger if exists expense_categories_updated_at on public.expense_categories;
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create or replace function public.seed_expense_categories()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.expense_categories (couple_id, name, icon, color, sort_order)
  values
    (new.id, 'Flights',    'plane',        '#60a5fa', 1),
    (new.id, 'Stay',       'bed',          '#a78bfa', 2),
    (new.id, 'Food',       'utensils',     '#fb923c', 3),
    (new.id, 'Transport',  'train-front',  '#34d399', 4),
    (new.id, 'Activities', 'ticket',       '#f472b6', 5),
    (new.id, 'Shopping',   'shopping-bag', '#facc15', 6),
    (new.id, 'Other',      'circle-dashed','#94a3b8', 7)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists couples_seed_categories on public.couples;
create trigger couples_seed_categories after insert on public.couples
  for each row execute function public.seed_expense_categories();

-- =============================================================================
-- Expenses.
--
-- `trip_id` is nullable on purpose (spec 13.6): money spent before a trip
-- exists still counts toward the lifetime balance.
--
-- `amount_base` is nullable and its nullness *is* the retry flag. When the FX
-- provider is unavailable the expense still saves — refusing to record what
-- somebody actually spent because a rate lookup failed would be the wrong
-- trade — and the row is picked up by the backfill sweep later. Every surface
-- that totals money has to cope with a row that is not yet converted, and says
-- so rather than treating it as zero.
-- =============================================================================
create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  couple_id         uuid not null references public.couples(id) on delete cascade,
  trip_id           uuid references public.trips(id) on delete cascade,
  itinerary_item_id uuid references public.itinerary_items(id) on delete set null,

  description text not null,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null,

  -- Fixed at save time. See the header.
  amount_base numeric(12,2),
  fx_rate     numeric(16,8),
  fx_date     date,

  paid_by      uuid not null references public.profiles(id) on delete restrict,
  split_type   text not null default 'equal',
  -- { userId: amount } for 'exact', { userId: percent } for 'percent'.
  split_detail jsonb,

  category_id      uuid references public.expense_categories(id) on delete set null,
  spent_on         date not null default current_date,
  receipt_media_id uuid references public.media(id) on delete set null,
  notes            text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint valid_split_type check (split_type in ('equal', 'exact', 'percent', 'full')),
  -- The two split types that carry numbers must carry them. Which numbers, and
  -- whether they sum correctly, is checked in `logic.ts` where the error can
  -- name the shortfall; this only stops a structurally impossible row.
  constraint split_detail_present check (
    split_type in ('equal', 'full') or split_detail is not null
  ),
  -- A currency code, not free text. Uppercase ISO 4217.
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$'),
  -- Either fully converted or not converted at all. A row with an amount but
  -- no rate would be a number nobody could explain.
  constraint fx_all_or_nothing check (
    (amount_base is null and fx_rate is null and fx_date is null)
    or (amount_base is not null and fx_rate is not null and fx_date is not null)
  )
);

create index if not exists expenses_trip_idx
  on public.expenses (trip_id, spent_on) where deleted_at is null;
create index if not exists expenses_couple_idx
  on public.expenses (couple_id, spent_on) where deleted_at is null;
-- The backfill sweep's working set: saved, but never converted.
create index if not exists expenses_unconverted_idx
  on public.expenses (couple_id) where amount_base is null and deleted_at is null;

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Settlements.
--
-- The spec's schema has no `deleted_at`. This adds one: a settlement is a
-- record that money changed hands, and deleting one silently moves the balance
-- for both people. Soft-delete is the house rule for anything a user would
-- regret losing, and this qualifies more than most.
-- =============================================================================
create table if not exists public.settlements (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  trip_id    uuid references public.trips(id) on delete set null,
  from_user  uuid not null references public.profiles(id) on delete restrict,
  to_user    uuid not null references public.profiles(id) on delete restrict,
  amount     numeric(12,2) not null check (amount > 0),
  currency   text not null,
  settled_on date not null default current_date,
  method     text,
  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$'),
  constraint settlement_has_two_sides check (from_user <> to_user)
);

create index if not exists settlements_couple_idx
  on public.settlements (couple_id, settled_on) where deleted_at is null;

drop trigger if exists settlements_updated_at on public.settlements;
create trigger settlements_updated_at before update on public.settlements
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Budgets. Optional throughout: budget-vs-actual appears only where one is set.
-- =============================================================================
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  category_id uuid references public.expense_categories(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null,
  period      text not null default 'trip',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint valid_period check (period in ('trip', 'week')),
  constraint currency_is_code check (currency ~ '^[A-Z]{3}$')
);

-- The spec's `unique (trip_id, category_id, period)` does not hold in Postgres
-- when category_id is null — every null is distinct, so a trip could collect
-- any number of overall budgets. Two partial indexes say what was meant.
create unique index if not exists budgets_category_idx
  on public.budgets (trip_id, category_id, period) where category_id is not null;
create unique index if not exists budgets_overall_idx
  on public.budgets (trip_id, period) where category_id is null;

drop trigger if exists budgets_updated_at on public.budgets;
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- =============================================================================
-- FX rates.
--
-- Reference data, shared by every couple, keyed by day. One row per pair per
-- date, fetched once and never re-fetched — a past date's rate cannot change,
-- so a cache miss is the only reason to call the provider at all.
--
-- Unlike `geocode_cache`, signed-in users cannot write here. A poisoned
-- geocode result is a wrong pin on a map; a poisoned rate is a wrong number in
-- somebody's balance. Only the service role inserts, from the Route Handler
-- that talks to the provider.
-- =============================================================================
create table if not exists public.fx_rates (
  base      text not null,
  quote     text not null,
  rate      numeric(16,8) not null check (rate > 0),
  rate_date date not null,
  fetched_at timestamptz not null default now(),
  source    text,
  primary key (base, quote, rate_date),
  constraint fx_base_is_code check (base ~ '^[A-Z]{3}$'),
  constraint fx_quote_is_code check (quote ~ '^[A-Z]{3}$')
);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.settlements        enable row level security;
alter table public.budgets            enable row level security;
alter table public.fx_rates           enable row level security;

drop policy if exists "couple read" on public.expense_categories;
create policy "couple read" on public.expense_categories
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.expense_categories;
create policy "couple write" on public.expense_categories
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Shared money is shared: both partners see and edit every expense, whoever
-- entered it. Who paid stays visible through `paid_by`.
drop policy if exists "couple read" on public.expenses;
create policy "couple read" on public.expenses
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.expenses;
create policy "couple write" on public.expenses
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.settlements;
create policy "couple read" on public.settlements
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.settlements;
create policy "couple write" on public.settlements
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

drop policy if exists "couple read" on public.budgets;
create policy "couple read" on public.budgets
  for select using (public.is_couple_member(couple_id));
drop policy if exists "couple write" on public.budgets;
create policy "couple write" on public.budgets
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- Read by anyone signed in, written by nobody through the API. See above.
drop policy if exists "signed in read" on public.fx_rates;
create policy "signed in read" on public.fx_rates
  for select using (auth.uid() is not null);

-- =============================================================================
-- Backfill: categories for couples that predate this migration.
-- =============================================================================
insert into public.expense_categories (couple_id, name, icon, color, sort_order)
select c.id, v.name, v.icon, v.color, v.sort_order
from public.couples c
cross join (values
  ('Flights',    'plane',         '#60a5fa', 1),
  ('Stay',       'bed',           '#a78bfa', 2),
  ('Food',       'utensils',      '#fb923c', 3),
  ('Transport',  'train-front',   '#34d399', 4),
  ('Activities', 'ticket',        '#f472b6', 5),
  ('Shopping',   'shopping-bag',  '#facc15', 6),
  ('Other',      'circle-dashed', '#94a3b8', 7)
) as v(name, icon, color, sort_order)
on conflict do nothing;

-- =============================================================================
-- Grants.
--
-- Revoking from PUBLIC alone is not enough, which is the lesson of 0004 (see
-- D26). Supabase sets ALTER DEFAULT PRIVILEGES granting EXECUTE on new
-- functions to `anon` and `authenticated` directly, so a fresh function is
-- reachable at /rest/v1/rpc/<name> by both regardless of the PUBLIC default.
-- Trigger functions are named explicitly in all three.
--
-- `rls_auto_enable` is Supabase's own event trigger — it is what has been
-- enabling RLS on every table the moment it is created, which is a useful
-- backstop but not a substitute for the policies. It is not ours and does not
-- exist in the scratch harness, so the revoke is guarded. The linter flags it
-- reachable at /rest/v1/rpc; it is an event-trigger helper and nobody should
-- be able to call it.
-- =============================================================================
revoke all on function public.seed_expense_categories() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
