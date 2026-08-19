-- =============================================================================
-- 0021_work_hours — move work hours to where the other person can read them.
--
-- The work-day overlay exists so neither of them plans a lunch through the
-- other's stand-up. That requires reading the *partner's* hours, and the
-- columns were on `user_settings`, whose policy is `user_id = auth.uid()` and
-- nothing else. So the feature could only ever have drawn your own hours, which
-- is the one case where you did not need to be told.
--
-- Rather than widen that policy — which would hand a partner the whole settings
-- row, including notification toggles and the vault timeout — the two columns
-- move to `profiles`, which is already couple-readable and is exactly where
-- facts-about-a-person-the-other-one-needs already live: timezone, home city,
-- nationality. Work hours are that class of fact.
--
-- Backfilled and then dropped, so there is one source of truth rather than two
-- that can disagree.
-- =============================================================================

alter table public.profiles
  add column if not exists work_hours_start time,
  add column if not exists work_hours_end   time;

comment on column public.profiles.work_hours_start is
  'Local wall-clock, in this profile''s own timezone. Feeds the itinerary''s work-day overlay, which is why it is here and not on user_settings.';

-- Carry across anything already entered. Guarded because a fresh database has
-- no such column to read from.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_settings'
      and column_name = 'work_hours_start'
  ) then
    execute $migrate$
      update public.profiles p
         set work_hours_start = u.work_hours_start,
             work_hours_end   = u.work_hours_end
        from public.user_settings u
       where u.user_id = p.id
         and (u.work_hours_start is not null or u.work_hours_end is not null)
    $migrate$;

    execute 'alter table public.user_settings drop column work_hours_start';
    execute 'alter table public.user_settings drop column work_hours_end';
  end if;
end $$;
