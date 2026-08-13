-- =============================================================================
-- The verification the spec gates Stage 1 on (Part 15, Stage 0):
--
--   "two accounts pair, and account A cannot read account B's rows"
--
-- Everything here runs as the `authenticated` role with a real auth.uid(), so
-- the policies are exercised exactly as they are in production. Any failure
-- raises, so the script exits non-zero.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function assert(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice '  ok   %', description;
  else
    raise exception 'FAILED: %', description;
  end if;
end $$;

create or replace function assert_raises(stmt text, expected text, description text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if position(expected in sqlerrm) > 0 then
      raise notice '  ok   % (%)', description, expected;
      return;
    end if;
    raise exception 'FAILED: % — expected %, got %', description, expected, sqlerrm;
  end;
  raise exception 'FAILED: % — expected % but nothing was raised', description, expected;
end $$;

-- ---------------------------------------------------------------------------
-- Four accounts: two who pair, one who tries to gatecrash, one unrelated.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== signup =='
select auth.test_signup('ada@example.com',   'Ada Lovelace')   as ada    \gset ada_
select auth.test_signup('bo@example.com',    'Bo Nguyen')      as bo     \gset bo_
select auth.test_signup('cyd@example.com',   'Cyd Stranger')   as cyd    \gset cyd_
select auth.test_signup('dee@example.com',   'Dee Elsewhere')  as dee    \gset dee_

select assert(
  (select count(*) from public.profiles) = 4,
  'the signup trigger created a profile for each account'
);
select assert(
  (select display_name from public.profiles where id = :'ada_ada') = 'Ada Lovelace',
  'the trigger copied the display name out of the auth metadata'
);

-- ---------------------------------------------------------------------------
set role authenticated;
\echo ''
\echo '== ada creates a couple =='
set request.jwt.claim.sub = :'ada_ada';

select id as couple from public.create_couple('Ada & Bo') \gset ada_
select assert(:'ada_couple' is not null, 'create_couple returned a couple');

select invite_code as code from public.couples where id = :'ada_couple' \gset ada_
select assert(length(:'ada_code') = 8, 'the invite code is 8 characters');
select assert(:'ada_code' !~ '[ILO01]', 'the invite code avoids I, L, O, 0 and 1');

select assert_raises(
  format('select public.create_couple(%L)', 'second one'),
  'ALREADY_PAIRED',
  'a second create_couple is refused'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== bo joins =='
set request.jwt.claim.sub = :'bo_bo';

select public.join_couple(lower(:'ada_code')) as joined \gset bo_
select assert(:'bo_joined' = :'ada_couple', 'join_couple is case-insensitive and returned the couple');
select assert(
  (select count(*) from public.couple_members where couple_id = :'ada_couple') = 2,
  'the couple now has exactly two members'
);
select assert(
  (select invite_code from public.couples where id = :'ada_couple') is null,
  'the code was spent on use'
);
select assert(public.partner_id() = :'ada_ada', 'partner_id() resolves to Ada');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== a third account cannot get in =='
set request.jwt.claim.sub = :'cyd_cyd';

select assert_raises(
  format('select public.join_couple(%L)', :'ada_code'),
  'INVALID_CODE',
  'the spent code is refused'
);

-- Give Cyd a live code to attack, by having Ada mint one... except the couple
-- is full, so even that is refused. Prove it.
set request.jwt.claim.sub = :'ada_ada';
select assert_raises(
  'select public.regenerate_invite_code()',
  'COUPLE_FULL',
  'a full couple cannot mint a new code'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the isolation check the spec gates on =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.trips (couple_id, title, created_by)
values (:'ada_couple', 'Lisbon', :'ada_ada')
returning id as trip \gset ada_

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.trips) = 0,
  'a stranger reads zero trips (RLS, not filtering)'
);
select assert(
  (select count(*) from public.trips where id = :'ada_trip') = 0,
  'a stranger cannot read the trip even by its exact id'
);
select assert(
  (select count(*) from public.profiles) = 1,
  'a stranger sees only their own profile'
);
select assert(
  (select count(*) from public.couples) = 0,
  'a stranger cannot see the couple'
);
select assert(
  not public.is_couple_member(:'ada_couple'),
  'is_couple_member() says no'
);

-- Writes are refused too, not merely reads.
--
-- An UPDATE whose rows are filtered out by the USING clause does not raise —
-- it simply matches nothing. That is correct, so the assertion is that the row
-- count is zero and the value is untouched, not that an error was thrown.
do $$
declare
  affected int;
begin
  update public.trips set title = 'hijacked' where title = 'Lisbon';
  get diagnostics affected = row_count;
  perform assert(affected = 0, 'a stranger''s update matches no rows');
end $$;

-- An INSERT is different: WITH CHECK rejects it outright.
select assert_raises(
  format('insert into public.trips (couple_id, title) values (%L, %L)', :'ada_couple', 'planted'),
  'violates row-level security',
  'a stranger cannot insert a trip into someone else''s couple'
);
do $$
declare
  affected int;
begin
  delete from public.couple_members;
  get diagnostics affected = row_count;
  perform assert(affected = 0, 'a stranger cannot delete anyone else''s membership');
end $$;

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the partner sees everything =='
set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.trips where id = :'ada_trip') = 1,
  'the partner reads the trip'
);
select assert(
  (select count(*) from public.profiles) = 2,
  'the partner reads both profiles and no others'
);
select assert(
  (select count(*) from public.profiles where id = :'dee_dee') = 0,
  'an unrelated profile stays invisible'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== day scaffolding =='
set request.jwt.claim.sub = :'ada_ada';

update public.trips
   set start_date = '2026-06-01', end_date = '2026-06-05', date_precision = 'exact'
 where id = :'ada_trip';
select public.sync_trip_days(:'ada_trip');

select assert(
  (select count(*) from public.trip_days where trip_id = :'ada_trip') = 5,
  'a 4-night trip generates 5 days'
);

-- Extend, and only the new days appear.
update public.trips set end_date = '2026-06-08' where id = :'ada_trip';
select public.sync_trip_days(:'ada_trip');
select assert(
  (select count(*) from public.trip_days where trip_id = :'ada_trip') = 8,
  'extending adds only the new days'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== itinerary =='
select public.seed_categories(:'ada_couple');
select assert(
  (select count(*) from public.categories where couple_id = :'ada_couple') = 7,
  'seven categories seeded'
);

insert into public.itinerary_items (couple_id, trip_id, title, sort_key)
values (:'ada_couple', :'ada_trip', 'An idea with no date', 'a0');

select assert(
  (select day_type from public.trip_days
    where trip_id = :'ada_trip' and date = '2026-06-03') = 'open',
  'an unscheduled item does not promote any day'
);

-- A time with no date is rejected by the check constraint.
select assert_raises(
  format(
    'insert into public.itinerary_items (couple_id, trip_id, title, sort_key, start_time)
     values (%L, %L, %L, %L, %L)',
    :'ada_couple', :'ada_trip', 'Dinner at eight, some day', 'a1', '20:00'
  ),
  'time_needs_date',
  'a time without a date is refused'
);

-- Scheduling one promotes its day open -> planned.
insert into public.itinerary_items (couple_id, trip_id, title, sort_key, scheduled_date, start_time)
values (:'ada_couple', :'ada_trip', 'Dinner', 'a2', '2026-06-03', '20:00');

select assert(
  (select day_type from public.trip_days
    where trip_id = :'ada_trip' and date = '2026-06-03') = 'planned',
  'scheduling an item promotes its day to planned'
);

-- A manually set rest day is never demoted.
update public.trip_days set day_type = 'rest'
 where trip_id = :'ada_trip' and date = '2026-06-04';
insert into public.itinerary_items (couple_id, trip_id, title, sort_key, scheduled_date)
values (:'ada_couple', :'ada_trip', 'Something on the rest day', 'a3', '2026-06-04');

select assert(
  (select day_type from public.trip_days
    where trip_id = :'ada_trip' and date = '2026-06-04') = 'rest',
  'a manual rest day survives gaining an item'
);

select assert(
  (select item_count from public.trip_item_counts_by_day(:'ada_trip')
    where date = '2026-06-03') = 1,
  'the per-day item count is right'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== shortening a trip unschedules rather than deletes =='
update public.trips set end_date = '2026-06-02' where id = :'ada_trip';
select public.sync_trip_days(:'ada_trip');

select assert(
  (select count(*) from public.itinerary_items
    where trip_id = :'ada_trip' and title = 'Dinner' and deleted_at is null) = 1,
  'the item on the dropped day still exists'
);
select assert(
  (select scheduled_date from public.itinerary_items
    where trip_id = :'ada_trip' and title = 'Dinner') is null,
  'it went back to the idea pool'
);
select assert(
  (select start_time from public.itinerary_items
    where trip_id = :'ada_trip' and title = 'Dinner') is null,
  'and lost its time with its date'
);
select assert(
  (select count(*) from public.trip_days where trip_id = :'ada_trip') = 2,
  'the out-of-range days are gone'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the itinerary is couple-scoped too =='
set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.itinerary_items) = 0,
  'a stranger reads no itinerary items'
);
select assert(
  (select count(*) from public.categories) = 0,
  'a stranger reads no categories'
);
select assert(
  (select count(*) from public.trip_days) = 0,
  'a stranger reads no trip days'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== leaving =='
set request.jwt.claim.sub = :'bo_bo';
select public.leave_couple();
select assert(
  (select count(*) from public.trips) = 0,
  'after leaving, the shared data is no longer readable'
);

reset role;
\echo ''
\echo 'All RLS and schema assertions passed.'
