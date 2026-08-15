-- =============================================================================
-- 0017_cycle_tracking — who sees the cycle section, and what it can predict.
--
-- Two changes, and the second one needs stating carefully.
--
-- **Who sees it.** The cycle section was shown to everybody, which is noise
-- for anyone who does not menstruate. `profiles.gender` decides the default.
-- But gender is not the same question as "do you want to track this" — a woman
-- past menopause, on continuous contraception, or simply uninterested should be
-- able to turn it off, and somebody the default would hide it from should be
-- able to turn it on. So `tracks_cycle` is a nullable override: null means
-- "follow the default", and an explicit true or false always wins.
--
-- **What it predicts.** Spec 12.2 rules out fertility guidance, and this does
-- not add any. What it adds is the *estimated* fertile window and ovulation
-- day that every mainstream cycle app shows, computed as calendar arithmetic
-- from logged cycles and labelled as an estimate everywhere it appears.
--
-- The distinction the code holds to:
--   - It never says a day is safe, and never mentions contraception.
--   - It never says a day is good for conceiving.
--   - It reports what the arithmetic says, with its variance, and stops.
--
-- Calendar arithmetic is not a measurement of ovulation. Ovulation is observed
-- with basal temperature or an LH test, which is why `ovulation_on` exists on
-- the log: when she knows, what she knows replaces what the app guessed, for
-- that cycle and as evidence for the next prediction.
-- =============================================================================

alter table public.profiles
  add column if not exists gender       text,
  add column if not exists tracks_cycle boolean;

alter table public.profiles drop constraint if exists valid_gender;
alter table public.profiles add constraint valid_gender
  check (gender is null or gender in ('female', 'male', 'other', 'prefer_not_to_say'));

comment on column public.profiles.tracks_cycle is
  'Null follows the gender default. True or false is an explicit choice and always wins.';

-- =============================================================================
-- Observations on a cycle.
--
-- `ovulation_on` is the day ovulation was actually observed — a temperature
-- shift, a positive test — as opposed to the day the arithmetic guessed. When
-- present it replaces the estimate for that cycle, and it is what the next
-- estimate learns its luteal length from.
--
-- `luteal_days` is per-cycle rather than per-person because it varies, and
-- because a person who has measured it once should not have that number
-- silently applied to a cycle it did not come from.
-- =============================================================================
alter table public.cycle_logs
  add column if not exists ovulation_on date,
  add column if not exists luteal_days  int,
  -- Free text she writes, kept separate from `notes` so the notes field stays
  -- what it was and this can be shown beside the fertile window.
  add column if not exists fertility_note text;

alter table public.cycle_logs drop constraint if exists valid_luteal;
alter table public.cycle_logs add constraint valid_luteal
  check (luteal_days is null or luteal_days between 7 and 20);

-- Ovulation belongs to the cycle that started on `started_on`, so it cannot
-- precede it. The upper bound is generous on purpose: long and irregular
-- cycles are exactly the ones this has to keep working for.
alter table public.cycle_logs drop constraint if exists valid_ovulation;
alter table public.cycle_logs add constraint valid_ovulation
  check (
    ovulation_on is null
    or (ovulation_on >= started_on and ovulation_on <= started_on + 90)
  );
