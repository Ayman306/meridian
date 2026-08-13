-- =============================================================================
-- 0006_dashboard — one RPC, one round trip. Spec: Module 2.
--
-- The dashboard is the most-visited screen in the app and reads from five
-- tables. Spec 2.4 asks for it as a single Postgres function returning one JSON
-- payload rather than six client queries, and 2.7 makes "loads in one network
-- request" an acceptance criterion.
--
-- What is *not* here, deliberately: anything timezone-dependent. Countdowns,
-- the days-together year boundary and "is it travel day yet" all depend on
-- whose midnight is being asked about, and the database does not know who is
-- looking. It returns dates and counts; `modules/dashboard/logic.ts` resolves
-- them against the viewer's zone. Spec 2.6 is explicit that the year boundary
-- uses the viewer's timezone.
-- =============================================================================

create or replace function public.dashboard()
returns jsonb language plpgsql security definer stable
set search_path = public as $$
declare
  me       uuid := auth.uid();
  my_couple uuid;
  result   jsonb;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select couple_id into my_couple from public.couple_members where user_id = me;
  if my_couple is null then
    -- Solo mode is a real state, not an error. Say so plainly.
    return jsonb_build_object('paired', false);
  end if;

  select jsonb_build_object(
    'paired', true,
    'couple_id', my_couple,

    -- The next trip with a real start date, whatever its precision. The client
    -- decides whether to show a countdown, since only 'exact' earns one.
    'next_trip', (
      select to_jsonb(x) from (
        select t.id, t.title, t.start_date, t.end_date, t.date_precision,
               t.is_open_ended, t.timezone,
               s.name as status_name
        from public.trips t
        left join public.trip_statuses s on s.id = t.status_id
        where t.couple_id = my_couple
          and t.deleted_at is null
          and t.start_date is not null
          and coalesce(t.end_date, t.start_date) >= current_date - 1
        order by t.start_date asc
        limit 1
      ) x
    ),

    -- A trip being planned with no dates at all — what the countdown block
    -- falls back to before it can count anything.
    'planning_trip', (
      select to_jsonb(x) from (
        select t.id, t.title, t.updated_at
        from public.trips t
        where t.couple_id = my_couple
          and t.deleted_at is null
          and t.start_date is null
        order by t.updated_at desc
        limit 1
      ) x
    ),

    -- Per-traveller dates for the next trip, so the client can work out
    -- whether today is a travel day for either of them.
    'travellers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', tt.user_id,
        'arrival_date', tt.arrival_date,
        'departure_date', tt.departure_date,
        'origin_airport', tt.origin_airport
      ))
      from public.trip_travelers tt
      join public.trips t on t.id = tt.trip_id
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is not null
        and coalesce(t.end_date, t.start_date) >= current_date - 1
        and t.id = (
          select t2.id from public.trips t2
          where t2.couple_id = my_couple and t2.deleted_at is null
            and t2.start_date is not null
            and coalesce(t2.end_date, t2.start_date) >= current_date - 1
          order by t2.start_date asc limit 1
        )
    ), '[]'::jsonb),

    -- Every past and present trip that could contribute nights together. The
    -- overlap arithmetic happens client-side because "this year" depends on
    -- the viewer's timezone (spec 2.6).
    'together_windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trip_id', t.id,
        'start_date', t.start_date,
        'end_date', t.end_date,
        'travellers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', tt.user_id,
            'arrival_date', tt.arrival_date,
            'departure_date', tt.departure_date
          )), '[]'::jsonb)
          from public.trip_travelers tt where tt.trip_id = t.id
        )
      ))
      from public.trips t
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is not null
        and t.start_date <= current_date
    ), '[]'::jsonb),

    -- Documents that are close enough to expiry to be worth a word. The
    -- passport threshold is wider (9 months, spec 8.3) because most countries
    -- want six months' validity *beyond entry*, so a passport that looks fine
    -- today can be a problem by the time you travel.
    'expiring_documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'label', d.label,
        'owner_id', d.owner_id,
        'type_name', dt.name,
        'expires_on', d.expires_on,
        'is_passport', (dt.name = 'Passport')
      ) order by d.expires_on asc)
      from public.documents d
      left join public.document_types dt on dt.id = d.type_id
      where d.couple_id = my_couple
        and d.deleted_at is null
        and d.expires_on is not null
        and (d.owner_id = me or d.is_shared = true)
        and d.expires_on <= current_date + case when dt.name = 'Passport' then 275 else 90 end
    ), '[]'::jsonb),

    -- Trips sitting in a planning status long after they were last touched.
    -- A gentle nudge, the lowest-priority alert (spec 2.2).
    'stale_trips', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'updated_at', t.updated_at))
      from public.trips t
      left join public.trip_statuses s on s.id = t.status_id
      where t.couple_id = my_couple
        and t.deleted_at is null
        and t.start_date is null
        and t.updated_at < now() - interval '60 days'
        and coalesce(s.name, 'Idea') in ('Idea', 'Planning')
    ), '[]'::jsonb),

    'trip_count', (
      select count(*) from public.trips
      where couple_id = my_couple and deleted_at is null
    )
  ) into result;

  return result;
end $$;

grant execute on function public.dashboard() to authenticated;
