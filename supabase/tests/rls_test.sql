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
\echo '== documents: private by owner, shared by choice =='
set request.jwt.claim.sub = :'ada_ada';
select public.seed_document_types(:'ada_couple');
select assert(
  (select count(*) from public.document_types where couple_id = :'ada_couple') = 9,
  'nine document types seeded'
);

select id as passport_type from public.document_types
 where couple_id = :'ada_couple' and name = 'Passport' \gset ada_

insert into public.documents (couple_id, owner_id, type_id, label, expires_on, is_shared)
values (:'ada_couple', :'ada_ada', :'ada_passport_type', 'Ada passport', '2031-01-01', true)
returning id as shared_doc \gset ada_

insert into public.documents (couple_id, owner_id, type_id, label, expires_on, is_shared)
values (:'ada_couple', :'ada_ada', :'ada_passport_type', 'Ada private note', '2031-01-01', false)
returning id as private_doc \gset ada_

select assert(
  (select count(*) from public.documents) = 2,
  'the owner sees both of their own documents'
);

set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.documents) = 1,
  'the partner sees only the shared one'
);
select assert(
  (select count(*) from public.documents where id = :'ada_private_doc') = 0,
  'a private document is invisible to the partner, even by id'
);

-- Un-sharing has to take effect immediately, which is only true if the policy
-- enforces it rather than the UI filtering.
set request.jwt.claim.sub = :'ada_ada';
update public.documents set is_shared = false where id = :'ada_shared_doc';
set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.documents) = 0,
  'un-sharing hides it from the partner straight away'
);

-- The partner cannot edit or create documents in someone else's name.
do $$
declare
  affected int;
begin
  update public.documents set label = 'tampered';
  get diagnostics affected = row_count;
  perform assert(affected = 0, 'the partner cannot edit the owner''s documents');
end $$;

select assert_raises(
  format(
    'insert into public.documents (couple_id, owner_id, label) values (%L, %L, %L)',
    :'ada_couple', :'ada_ada', 'forged'
  ),
  'violates row-level security',
  'nobody can create a document in their partner''s name'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.documents) = 0,
  'a stranger sees no documents at all'
);
select assert(
  (select count(*) from public.document_types) = 0,
  'a stranger sees no document types'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== readiness checks the trip end date, not today =='
set request.jwt.claim.sub = :'ada_ada';
update public.documents set is_shared = true where id = :'ada_shared_doc';

-- A trip that ends after the passport expires.
insert into public.trips (couple_id, title, start_date, end_date, date_precision, created_by)
values (:'ada_couple', 'Far future', '2031-06-01', '2031-06-10', 'exact', :'ada_ada')
returning id as future_trip \gset ada_

select assert(
  (select satisfied from public.trip_readiness(:'ada_future_trip')
    where user_id = :'ada_ada' and type_name = 'Passport') = false,
  'a passport expiring before the trip ends does NOT satisfy the requirement'
);

-- The same passport against a trip that ends before it expires.
insert into public.trips (couple_id, title, start_date, end_date, date_precision, created_by)
values (:'ada_couple', 'Soon', '2030-06-01', '2030-06-10', 'exact', :'ada_ada')
returning id as near_trip \gset ada_

select assert(
  (select satisfied from public.trip_readiness(:'ada_near_trip')
    where user_id = :'ada_ada' and type_name = 'Passport') = true,
  'the same passport DOES satisfy a trip that ends before it expires'
);

select assert(
  (select count(*) from public.trip_readiness(:'ada_near_trip')) = 2,
  'a passport is required for both travellers without anyone adding it'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert_raises(
  format('select * from public.trip_readiness(%L)', :'ada_near_trip'),
  'NOT_A_MEMBER',
  'a stranger cannot ask about someone else''s readiness'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the dashboard RPC is scoped to the caller =='
set request.jwt.claim.sub = :'ada_ada';
select assert(
  (public.dashboard() ->> 'paired')::boolean,
  'a paired user gets a real payload'
);
select assert(
  jsonb_array_length(public.dashboard() -> 'expiring_documents') >= 0,
  'the payload carries the expiring-documents array'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (public.dashboard() ->> 'paired')::boolean = false,
  'an unpaired user gets paired:false rather than an error'
);
select assert(
  public.dashboard() -> 'next_trip' is null,
  'and no trip data leaks into it'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== wishlist: both read, each writes only their own =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.wishlist_items (couple_id, user_id, title, city, lat, lng)
values (:'ada_couple', :'ada_ada', 'Cervejaria Ramiro', 'Lisbon', 38.7205, -9.1385)
returning id as save \gset ada_

set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.wishlist_items where id = :'ada_save') = 1,
  'the partner can read a save they did not make'
);

-- The point of the module: reacting to a save without editing it.
update public.wishlist_items set title = 'renamed by the partner' where id = :'ada_save';
select assert(
  (select title from public.wishlist_items where id = :'ada_save') = 'Cervejaria Ramiro',
  'the partner cannot edit it — the USING clause filters the row out'
);

insert into public.wishlist_verdicts (wishlist_id, user_id, verdict)
values (:'ada_save', :'bo_bo', 'yes');
select assert(
  (select verdict from public.wishlist_verdicts
    where wishlist_id = :'ada_save' and user_id = :'bo_bo') = 'yes',
  'but they can cast a verdict on it'
);

-- Changing your mind is one click, so the upsert path has to work.
insert into public.wishlist_verdicts (wishlist_id, user_id, verdict)
values (:'ada_save', :'bo_bo', 'maybe')
on conflict (wishlist_id, user_id) do update set verdict = excluded.verdict;
select assert(
  (select verdict from public.wishlist_verdicts
    where wishlist_id = :'ada_save' and user_id = :'bo_bo') = 'maybe',
  'and change it'
);

select assert_raises(
  format(
    'insert into public.wishlist_verdicts (wishlist_id, user_id, verdict) values (%L, %L, %L)',
    :'ada_save', :'ada_ada', 'no'
  ),
  'row-level security',
  'nobody can cast a verdict in the other person''s name'
);

select assert_raises(
  format(
    'insert into public.wishlist_verdicts (wishlist_id, user_id, verdict) values (%L, %L, %L)',
    :'ada_save', :'bo_bo', 'perhaps'
  ),
  'valid_verdict',
  'only yes/no/maybe are verdicts'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.wishlist_items) = 0,
  'a stranger sees no saves'
);
select assert(
  (select count(*) from public.wishlist_verdicts) = 0,
  'and no verdicts'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== push to the idea pool: once, and attribution survives =='
set request.jwt.claim.sub = :'bo_bo';
select public.push_wishlist_to_itinerary(:'ada_save', :'ada_trip', 'z0') as pushed \gset bo_
select assert(:'bo_pushed' is not null, 'either partner can push a save into the plan');

select assert(
  (select proposed_by from public.itinerary_items where id = :'bo_pushed') = :'ada_ada',
  'whose pick it was survives the move, even when the other one pushed it'
);
select assert(
  (select source from public.itinerary_items where id = :'bo_pushed') = 'wishlist',
  'and it is marked as coming from the wishlist'
);
select assert(
  (select scheduled_date from public.itinerary_items where id = :'bo_pushed') is null,
  'it lands in the idea pool, not on a day'
);

-- Spec 7.6: pushing twice is a warning, not a second copy.
select assert(
  public.push_wishlist_to_itinerary(:'ada_save', :'ada_trip', 'z1') is null,
  'pushing the same save again returns null instead of duplicating it'
);
select assert(
  (select count(*) from public.itinerary_items
    where trip_id = :'ada_trip' and source = 'wishlist') = 1,
  'and there is still only one copy'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert_raises(
  format('select public.push_wishlist_to_itinerary(%L, %L, %L)', :'ada_save', :'ada_trip', 'z2'),
  -- SECURITY DEFINER means the function can see the row; the membership check
  -- inside it is what stops the caller, so this is the error that surfaces.
  'NOT_A_MEMBER',
  'a stranger cannot push a save they cannot see'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the geocode cache is shared, and only for signed-in callers =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.geocode_cache (query, results) values ('lisbon', '[]'::jsonb);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.geocode_cache where query = 'lisbon') = 1,
  'another signed-in user reads the same cache — it holds public place data'
);

-- An anonymous caller has no JWT at all, so clear the claim as well as the
-- role — the role alone would still see whoever was signed in last.
set request.jwt.claim.sub = '';
set role anon;
select assert(
  (select count(*) from public.geocode_cache) = 0,
  'but an unauthenticated caller sees nothing'
);
set role authenticated;

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the suggestion tray never writes to the plan by itself =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.suggestion_tray (couple_id, trip_id, payload, source)
values (:'ada_couple', :'ada_trip', '{"kind":"draft","days":[]}'::jsonb, 'blend')
returning id as suggestion \gset ada_

select assert(
  (select count(*) from public.itinerary_items
    where trip_id = :'ada_trip' and source = 'blend') = 0,
  'a suggestion in the tray puts nothing in the itinerary'
);
select assert(
  (select accepted_at from public.suggestion_tray where id = :'ada_suggestion') is null,
  'and it stays unaccepted until someone says so'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== destinations: choosing is one transaction =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.trip_destinations (couple_id, trip_id, city, country_code, timezone, sort_key)
values (:'ada_couple', :'ada_trip', 'Lisbon', 'PT', 'Europe/Lisbon', 'a0')
returning id as lisbon \gset ada_
insert into public.trip_destinations (couple_id, trip_id, city, country_code, timezone, sort_key)
values (:'ada_couple', :'ada_trip', 'Porto', 'PT', 'Europe/Lisbon', 'a1')
returning id as porto \gset ada_

select public.choose_destination(:'ada_lisbon');

select assert(
  (select state from public.trip_destinations where id = :'ada_lisbon') = 'chosen',
  'the chosen candidate is marked chosen'
);
select assert(
  (select state from public.trip_destinations where id = :'ada_porto') = 'rejected',
  'and its rivals are rejected rather than deleted — the reasoning is kept'
);
select assert(
  (select timezone from public.trips where id = :'ada_trip') = 'Europe/Lisbon',
  'choosing sets the trip timezone, which itinerary times depend on'
);

-- Spec 4.2: reversible.
select public.unchoose_destination(:'ada_lisbon');
select assert(
  (select count(*) from public.trip_destinations
    where trip_id = :'ada_trip' and state = 'candidate') = 2,
  'unchoosing puts every candidate back in play, not just the chosen one'
);

select public.choose_destination(:'ada_porto');
select assert(
  (select count(*) from public.trip_destinations
    where trip_id = :'ada_trip' and state = 'chosen') = 1,
  'a trip can only have one chosen destination'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.trip_destinations) = 0,
  'a stranger sees no candidates'
);
select assert_raises(
  format('select public.choose_destination(%L)', :'ada_lisbon'),
  'NOT_A_MEMBER',
  'and cannot choose one'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== reference data is readable, and read-only =='
set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.visa_rules) > 0,
  'visa rules are shared reference data, readable by any signed-in user'
);
select assert_raises(
  'insert into public.visa_rules (passport_country, destination_country, tier)
     values (''ZZ'', ''YY'', 0)',
  'row-level security',
  'but nobody can write advisory immigration data through the API'
);
-- An UPDATE with no policy to permit it is filtered out rather than refused:
-- the rows simply are not visible to write, so nothing raises and nothing
-- changes. Assert the outcome, not an exception.
update public.visa_rules set tier = 0 where tier > 0;
select assert(
  (select count(*) from public.visa_rules where tier > 0) > 0,
  'or edit it — the update matches no writable rows and changes nothing'
);

set request.jwt.claim.sub = '';
set role anon;
select assert(
  (select count(*) from public.visa_rules) = 0,
  'and an unauthenticated caller sees none of it'
);
set role authenticated;

-- ---------------------------------------------------------------------------
\echo ''
\echo '== allowance: defaults are shared, overrides are personal =='
set request.jwt.claim.sub = :'ada_ada';
select assert(
  (select count(*) from public.allowance_rules where couple_id is null) > 0,
  'the seeded defaults are visible'
);
select assert(
  (select max_days from public.allowance_rules
    where couple_id is null and passport_country = 'US' and destination_country = 'SCHENGEN')
  = 90,
  'and the Schengen rule is 90 days'
);
select assert(
  (select window_days from public.allowance_rules
    where couple_id is null and passport_country = 'US' and destination_country = 'SCHENGEN')
  = 180,
  'in any 180'
);
select assert(
  (select cardinality(region_members) from public.allowance_rules
    where couple_id is null and passport_country = 'US' and destination_country = 'SCHENGEN')
  = 29,
  'counted across all 29 member states'
);

-- Same shape as the visa table: the write policy's USING clause excludes every
-- default row, so the statement matches nothing instead of raising.
update public.allowance_rules set max_days = 999 where couple_id is null;
select assert(
  (select count(*) from public.allowance_rules where couple_id is null and max_days = 999) = 0,
  'a user cannot edit the shared defaults'
);

-- An override for their own actual visa.
insert into public.allowance_rules (
  couple_id, user_id, passport_country, destination_country, rule_type, max_days, window_days
) values (:'ada_couple', :'ada_ada', 'US', 'PT', 'per_visa', 365, null)
returning id as override \gset ada_
select assert(:'ada_override' is not null, 'but can add their own override');

select assert_raises(
  format(
    'insert into public.allowance_rules (couple_id, user_id, passport_country,
       destination_country, rule_type, max_days) values (%L, %L, ''US'', ''ES'', ''per_entry'', 90)',
    :'ada_couple', :'bo_bo'
  ),
  'row-level security',
  'and cannot write a rule in their partner''s name'
);

set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.allowance_rules where id = :'ada_override') = 1,
  'the partner can see the override — planning together needs both sides visible'
);
update public.allowance_rules set max_days = 1 where id = :'ada_override';
select assert(
  (select max_days from public.allowance_rules where id = :'ada_override') = 365,
  'but not change it — someone else''s allowance is not theirs to rewrite'
);

-- A rolling rule with no window is not a rule anyone can evaluate.
select assert_raises(
  format(
    'insert into public.allowance_rules (couple_id, user_id, passport_country,
       destination_country, rule_type, max_days) values (%L, %L, ''GB'', ''BR'', ''rolling'', 90)',
    :'ada_couple', :'bo_bo'
  ),
  'rolling_needs_window',
  'a rolling rule without a window is refused'
);

-- ---------------------------------------------------------------------------
\echo ''
\echo '== the entry log is shared to read and personal to write =='
set request.jwt.claim.sub = :'ada_ada';
insert into public.entry_exit_log (couple_id, user_id, country_code, entered_on, exited_on)
values (:'ada_couple', :'ada_ada', 'PT', '2026-01-01', '2026-01-10')
returning id as crossing \gset ada_

-- Currently present: no exit date.
insert into public.entry_exit_log (couple_id, user_id, country_code, entered_on)
values (:'ada_couple', :'ada_ada', 'ES', '2026-03-01');
select assert(
  (select count(*) from public.entry_exit_log where exited_on is null) = 1,
  'an open-ended stay is allowed — it means they are still there'
);

select assert_raises(
  format(
    'insert into public.entry_exit_log (couple_id, user_id, country_code, entered_on, exited_on)
       values (%L, %L, ''FR'', ''2026-05-10'', ''2026-05-01'')',
    :'ada_couple', :'ada_ada'
  ),
  'valid_stay',
  'but leaving before arriving is not'
);

set request.jwt.claim.sub = :'bo_bo';
select assert(
  (select count(*) from public.entry_exit_log where id = :'ada_crossing') = 1,
  'the partner can read the log — a shared limit needs a shared view'
);
select assert_raises(
  format(
    'insert into public.entry_exit_log (couple_id, user_id, country_code, entered_on)
       values (%L, %L, ''IT'', ''2026-06-01'')',
    :'ada_couple', :'ada_ada'
  ),
  'row-level security',
  'but cannot record a border crossing on their behalf'
);

set request.jwt.claim.sub = :'cyd_cyd';
select assert(
  (select count(*) from public.entry_exit_log) = 0,
  'a stranger sees no crossings at all'
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
