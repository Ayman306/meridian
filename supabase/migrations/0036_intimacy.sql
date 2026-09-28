-- =============================================================================
-- 0036_intimacy — an intimacy log, and wellness guidance worth reading.
-- Extends Module 12.
--
-- The cycle calendar only applies to one of them. This is the half of the
-- health module that applies to both: what you felt like, what you did about
-- it, and — when the two of you are finally in the same country — how to
-- arrive feeling like a person rather than a jet-lagged one.
--
-- ## It inherits 0014's rules rather than reinventing them
--
-- Owner-private by default, and the database refuses the read: no policy here
-- is keyed on `is_couple_member`, being in the couple grants nothing, and a
-- partner sees these rows only while an unrevoked `intimacy` consent exists.
-- Spec 12.1's line holds — *a hidden tab is not privacy.*
--
-- This is the most personal table in the application, so two things that are
-- conventions elsewhere are hard rules here:
--
-- 1. **Its own consent scope.** `intimacy` is separate from `cycle` and from
--    `notes`. Sharing when your period started is not sharing this, and the
--    sharing screen must never let one imply the other.
-- 2. **The assistant cannot reach it.** No MCP tool reads or writes this
--    table, deliberately, and that is a property of the tool surface rather
--    than of the prompt. Cycle logs are opt-in over MCP because "when is she
--    due" is a question worth answering out loud. This is not.
--
-- Hard delete applies, as in 0014: `delete_all_health_data()` is extended
-- below rather than left to miss a table, which is the failure mode that makes
-- somebody believe they erased something they did not.
--
-- ## One row per day
--
-- Not a timestamped ledger. A daily row is what the cycle log already is, it
-- is the grain the summaries want, and it is markedly less of an intrusion to
-- keep: "that Tuesday" rather than a time of night.
-- =============================================================================

alter table public.health_consents drop constraint if exists valid_scope;
alter table public.health_consents add constraint valid_scope check (
  scope in (
    'cycle', 'cycle_predictions', 'symptoms',
    'medications', 'vaccinations', 'notes',
    'intimacy'
  )
);

create table if not exists public.intimacy_logs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  logged_on  date not null,

  -- How much wanting, 0–5. Nullable because "I did not think about it" is a
  -- real answer and zero is a different one.
  desire     smallint,

  solo       boolean not null default false,
  partnered  boolean not null default false,
  orgasms    smallint not null default 0,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_id, logged_on),
  constraint valid_desire  check (desire is null or (desire >= 0 and desire <= 5)),
  -- An upper bound only so a typo cannot poison an average. It is deliberately
  -- far above anything plausible; this is not the app's business.
  constraint valid_orgasms check (orgasms >= 0 and orgasms <= 50)
);

create index if not exists intimacy_logs_owner_idx
  on public.intimacy_logs (owner_id, logged_on desc);

drop trigger if exists intimacy_logs_updated_at on public.intimacy_logs;
create trigger intimacy_logs_updated_at before update on public.intimacy_logs
  for each row execute function public.set_updated_at();

alter table public.intimacy_logs enable row level security;

drop policy if exists "owner full access" on public.intimacy_logs;
create policy "owner full access" on public.intimacy_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Read-only, and only with consent. As in 0014 there is no viewer write policy
-- at all: a partner's view is read-only by construction, not by convention.
drop policy if exists "viewer with active consent" on public.intimacy_logs;
create policy "viewer with active consent" on public.intimacy_logs
  for select using (public.has_health_consent(owner_id, 'intimacy'));

-- =============================================================================
-- Wellness guidance.
--
-- Couple-independent reference data, same shape and same honesty as
-- `medication_restrictions`: every row carries the official source and the
-- date somebody last checked it. **The app is not the authority. The linked
-- page is.** Nothing here is a diagnosis, a prescription, or a claim about
-- what anybody should want.
--
-- `audience` picks a default, exactly as `profiles.gender` does for the cycle
-- calendar in 0017 — and for the same reason it is only a default. The screen
-- offers everything to anyone who asks, because a list that hides itself based
-- on a profile field is a worse answer than one that starts somewhere sensible.
-- =============================================================================
create table if not exists public.wellness_tips (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  audience    text not null default 'everyone',
  title       text not null,
  body        text not null,
  source_url  text not null,
  verified_on date,
  created_at  timestamptz not null default now(),
  constraint valid_category check (
    category in ('lifestyle', 'diet', 'connection', 'body', 'trip_prep')
  ),
  constraint valid_audience check (audience in ('everyone', 'female', 'male'))
);

create unique index if not exists wellness_tips_key on public.wellness_tips (lower(title));

alter table public.wellness_tips enable row level security;

drop policy if exists "signed in read" on public.wellness_tips;
create policy "signed in read" on public.wellness_tips
  for select using (auth.uid() is not null);

-- =============================================================================
-- Hard delete, extended.
--
-- Spec 12.2. One transaction, and now four tables: a delete that missed this
-- one would leave the most personal rows in the database while telling
-- somebody their health data was gone.
-- =============================================================================
create or replace function public.delete_all_health_data()
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.cycle_logs     where owner_id = auth.uid();
  delete from public.health_records where owner_id = auth.uid();
  delete from public.intimacy_logs  where owner_id = auth.uid();
  delete from public.health_consents where owner_id = auth.uid();
end $$;

revoke all on function public.delete_all_health_data() from public, anon;
grant execute on function public.delete_all_health_data() to authenticated;

-- =============================================================================
-- Seed: wellness guidance.
--
-- Deliberately small, like 0014's restriction list, and for the same reason:
-- every row is a pointer to guidance somebody else maintains, not the guidance
-- itself. Public-health sources only (NHS, CDC) — no supplement marketing, no
-- folk remedies, and nothing that treats desire as a performance target.
--
-- `verified_on` is the date these were written down, **not** the date a human
-- read the page. Open the source before relying on a row; MEMORY's open
-- question about the seeded visa rules applies here word for word.
-- =============================================================================
insert into public.wellness_tips (category, audience, title, body, source_url, verified_on) values
  ('lifestyle', 'everyone',
   'Sleep first',
   'Short or broken sleep lowers desire and energy for most people, and it is usually the easiest of these to change. Aim for a regular bedtime for a week before you travel rather than trying to catch up in one night.',
   'https://www.nhs.uk/live-well/sleep-and-tiredness/', '2026-09-27'),

  ('lifestyle', 'everyone',
   'Move most days',
   'Regular activity improves circulation, mood and body confidence, all of which matter more than any single "performance" tip. The NHS guideline is 150 minutes of moderate activity a week — a brisk walk counts.',
   'https://www.nhs.uk/live-well/exercise/', '2026-09-27'),

  ('lifestyle', 'everyone',
   'Alcohol does less than it promises',
   'A drink can lower inhibition, but alcohol depresses arousal and makes orgasm harder for everyone. If you are marking an occasion, keep it modest rather than making it the occasion.',
   'https://www.nhs.uk/live-well/alcohol-advice/', '2026-09-27'),

  ('lifestyle', 'everyone',
   'Stress is a desire problem, not only a mood one',
   'Sustained stress reliably suppresses libido. Treating the stress tends to do more than anything aimed directly at sex — and the weeks before a long-awaited trip are often the most stressful ones.',
   'https://www.nhs.uk/mental-health/', '2026-09-27'),

  ('diet', 'everyone',
   'Eat for circulation, not for aphrodisiacs',
   'No food has been shown to reliably increase desire. What does help is the ordinary heart-healthy pattern — vegetables, whole grains, fish, less processed meat and salt — because arousal depends on blood flow in both bodies.',
   'https://www.nhs.uk/live-well/eat-well/', '2026-09-27'),

  ('diet', 'everyone',
   'Heavy meals are a poor prelude',
   'A very large or very late meal leaves most people sleepy rather than interested. If you are planning an evening together, eat earlier and lighter than you would on an ordinary night.',
   'https://www.nhs.uk/live-well/eat-well/', '2026-09-27'),

  ('body', 'everyone',
   'Pelvic floor exercises are for everyone',
   'Pelvic floor muscles support arousal, sensation and control in every body. The NHS has a simple routine that takes a few minutes a day and shows results over weeks, not days — so start well before a trip.',
   'https://www.nhs.uk/conditions/pelvic-floor-exercises/', '2026-09-27'),

  ('body', 'everyone',
   'Desire that shows up afterwards is still desire',
   'Many people rarely feel spontaneous desire and only notice wanting once something has already started. That is a recognised pattern, not a fault, and expecting it can take a great deal of pressure off a first night back together.',
   'https://www.nhs.uk/conditions/loss-of-libido/', '2026-09-27'),

  ('body', 'female',
   'Dryness is common, and easily solved',
   'Vaginal dryness affects people at every age and has many ordinary causes — stress, contraception, cycle stage, not enough time. A lubricant solves most of it; persistent dryness or pain is worth a GP appointment rather than endurance.',
   'https://www.nhs.uk/conditions/vaginal-dryness/', '2026-09-27'),

  ('body', 'female',
   'Desire often moves with the cycle',
   'Many people notice desire rising around ovulation and falling before a period. If you track your cycle in this app, the pattern may be visible in your own log — and it is useful context for planning, not a rule to obey.',
   'https://www.nhs.uk/conditions/loss-of-libido/', '2026-09-27'),

  ('body', 'male',
   'Erection problems are usually circulatory',
   'Occasional difficulty is normal and often caused by tiredness, alcohol or anxiety. Persistent difficulty is a cardiovascular signal worth taking to a GP early — it is frequently the first symptom of something treatable.',
   'https://www.nhs.uk/conditions/erection-problems-erectile-dysfunction/', '2026-09-27'),

  ('body', 'male',
   'Smoking shows up here first',
   'Smoking narrows the small blood vessels erections depend on, and the effect appears earlier than most other damage. Stopping improves it for many people.',
   'https://www.nhs.uk/conditions/erection-problems-erectile-dysfunction/', '2026-09-27'),

  ('connection', 'everyone',
   'Have the conversation outside the bedroom',
   'Mismatched desire is one of the most common things couples deal with, and the worst moment to raise it is during or just after sex. A calm conversation on an ordinary afternoon does far more.',
   'https://www.nhs.uk/conditions/loss-of-libido/', '2026-09-27'),

  ('connection', 'everyone',
   'A reunion carries expectations — say them out loud',
   'Time apart tends to build a picture of the first night back that neither of you has agreed to. Saying what you are actually hoping for, including "mostly I want to sleep next to you", prevents a quiet disappointment neither of you planned.',
   'https://www.nhs.uk/conditions/loss-of-libido/', '2026-09-27'),

  ('trip_prep', 'everyone',
   'Deal with jet lag before anything else',
   'Crossing several time zones affects sleep, mood and appetite for days. Shifting your bedtime an hour a day toward the destination before you fly, and getting daylight on arrival, does more for a first evening together than anything else on this list.',
   'https://www.nhs.uk/conditions/jet-lag/', '2026-09-27'),

  ('trip_prep', 'everyone',
   'Pack what you actually use',
   'Contraception, lubricant and any regular medication are all far harder to buy in an unfamiliar country, and some are restricted in ways you would not expect. The Documents and Medications tabs already track what expires — this is the other half of the same packing list.',
   'https://www.nhs.uk/contraception/', '2026-09-27'),

  ('trip_prep', 'everyone',
   'Testing is a kindness, not an accusation',
   'If either of you has had other partners since you last met, testing beforehand is routine sexual healthcare. Many infections carry no symptoms, so "feeling fine" is not information.',
   'https://www.cdc.gov/sti/', '2026-09-27')
on conflict do nothing;
