-- =============================================================================
-- 0028_activity — what changed, and letting other things know about it.
--
-- Two people in two time zones is the premise of the whole app, and there has
-- been no way to see what the other one did while you were asleep. You wake up,
-- they have been planning for eight hours, and the only way to find out is to
-- notice a difference on a screen you happen to open.
--
-- ## One event model, three consumers
--
-- The temptation is to build the morning feed as a screen and stop. But "what
-- changed and who did it" is the same question three different things want to
-- ask, so it is answered once:
--
--   1. **The dashboard** — the feed, for a person over coffee.
--   2. **The MCP** — `whats_new`, so an assistant can brief you rather than
--      being asked to trawl six tools.
--   3. **Webhooks** — the same events, pushed to whatever else the couple uses.
--      That is what makes Slack, Discord, Home Assistant, n8n, IFTTT and a
--      hundred other things reachable without this app knowing any of them
--      exist.
--
-- Taken together with the MCP, the app now has both directions: an assistant is
-- how things get *in*, and webhooks are how things get *out*.
--
-- ## Why there is no audit table
--
-- The obvious build is a trigger on twenty tables writing to an `activity_log`.
-- It is also unbounded growth on a free tier, twenty triggers to keep in step,
-- and a second copy of the truth that can disagree with the first.
--
-- The rows already record this. Every couple-scoped table carries who created
-- it and when, so the feed is a query rather than a log. Nothing is written to
-- produce it, nothing grows, and it cannot drift from what actually happened.
--
-- ## The honest limitation, stated rather than hidden
--
-- `created_by` says who made a row. **Nothing says who last changed one** —
-- `updated_at` records that a row moved, not whose hand moved it. So this feed
-- reports *creations only*, and says so in the UI.
--
-- Adding `updated_by` everywhere would mean a trigger on every table and a
-- column on every table, to answer a question that is much less interesting
-- than "what did they add". Reporting an update with no author, or guessing at
-- one, would be worse than not reporting it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Where each person's "new since" line sits.
--
-- On `user_settings`, whose policy is `user_id = auth.uid()`: this is genuinely
-- personal — your unread marker is not your partner's business, and it changes
-- every time you glance at the dashboard.
-- -----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists activity_seen_at timestamptz;

comment on column public.user_settings.activity_seen_at is
  'When this person last marked the activity feed read. Null means never, and the feed falls back to a recent window rather than the beginning of time.';

-- -----------------------------------------------------------------------------
-- The feed.
--
-- SECURITY INVOKER, for the same reason `search_everything` is (D117): every
-- select inside runs as the caller, so RLS decides what appears. A document the
-- partner has not shared does not show up because the partner cannot read the
-- row — not because this function remembered to exclude it.
--
-- `actor_id` is returned rather than a name: names live on `profiles`, the
-- client already has both of them loaded, and joining here would be a second
-- way to render a person that could disagree with the first.
-- -----------------------------------------------------------------------------
create or replace function public.activity_feed(
  since timestamptz default null,
  max_results int default 50
)
returns table (
  event      text,
  id         uuid,
  title      text,
  subtitle   text,
  actor_id   uuid,
  trip_id    uuid,
  at         timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with bound as (
    -- Null means "never looked", and the beginning of time would dump the
    -- entire history of the couple into a morning summary. A fortnight is the
    -- longest that still reads as "recently".
    select coalesce(since, now() - interval '14 days') as floor
  ),
  events as (
    select 'trip_created'::text as event, t.id, t.title,
           coalesce(to_char(t.start_date, 'FMDD Mon YYYY'), 'no dates yet') as subtitle,
           t.created_by as actor_id, t.id as trip_id, t.created_at as at
      from public.trips t, bound b
     where t.deleted_at is null and t.created_at > b.floor

    union all
    select 'plan_added', i.id, i.title,
           coalesce(i.place_name, to_char(i.scheduled_date, 'FMDD Mon'), 'in the idea pool'),
           i.proposed_by, i.trip_id, i.created_at
      from public.itinerary_items i, bound b
     where i.deleted_at is null and i.created_at > b.floor

    union all
    select 'place_saved', w.id, w.title,
           coalesce(w.place_name, w.city, ''),
           w.user_id, null::uuid, w.created_at
      from public.wishlist_items w, bound b
     where w.deleted_at is null and w.created_at > b.floor

    union all
    -- A verdict is somebody reacting to the other's idea, which is the most
    -- conversational thing in the app and the easiest to miss.
    select 'verdict_cast', v.wishlist_id, w.title,
           v.verdict, v.user_id, null::uuid, v.created_at
      from public.wishlist_verdicts v
      join public.wishlist_items w on w.id = v.wishlist_id
         , bound b
     where w.deleted_at is null and v.created_at > b.floor

    union all
    select 'stay_booked', a.id, a.name,
           coalesce(a.city, to_char(a.check_in, 'FMDD Mon'), ''),
           a.created_by, a.trip_id, a.created_at
      from public.accommodations a, bound b
     where a.deleted_at is null and a.created_at > b.floor

    union all
    select 'destination_added', d.id, d.city,
           coalesce(d.country_code, ''), d.created_by, d.trip_id, d.created_at
      from public.trip_destinations d, bound b
     where d.deleted_at is null and d.created_at > b.floor

    union all
    select 'flight_added', f.id, f.flight_number,
           coalesce(f.origin_iata, '???') || ' to ' || coalesce(f.dest_iata, '???'),
           f.created_by, f.trip_id, f.created_at
      from public.flights f, bound b
     where f.deleted_at is null and f.created_at > b.floor

    union all
    select 'expense_logged', e.id, e.description,
           e.currency || ' ' || e.amount::text, e.created_by, e.trip_id, e.created_at
      from public.expenses e, bound b
     where e.deleted_at is null and e.created_at > b.floor

    union all
    select 'photo_added', m.id, coalesce(m.caption, 'A photo'),
           '', m.uploader_id, m.trip_id, m.uploaded_at
      from public.media m, bound b
     where m.deleted_at is null and m.uploaded_at > b.floor

    union all
    -- Only ever the label, never a number or a path — the same restriction the
    -- MCP and search carry (D102, D117).
    select 'document_added', d.id, d.label,
           coalesce(d.country_code, ''), d.owner_id, null::uuid, d.created_at
      from public.documents d, bound b
     where d.deleted_at is null and d.created_at > b.floor
  )
  select e.event, e.id, e.title, nullif(e.subtitle, '') as subtitle,
         e.actor_id, e.trip_id, e.at
    from events e
   order by e.at desc
   limit greatest(1, least(max_results, 200));
$$;

revoke all on function public.activity_feed(timestamptz, int) from public, anon;
grant execute on function public.activity_feed(timestamptz, int) to authenticated;

comment on function public.activity_feed(timestamptz, int) is
  'Creations across everything the caller can read, newest first. SECURITY INVOKER: RLS is the filter. Creations only — nothing records who last *updated* a row.';

-- =============================================================================
-- Integrations: the same events, pushed somewhere else.
--
-- Deliberately generic. This app does not know what Slack is, and should not:
-- it posts a signed JSON body to a URL somebody pasted, and whatever is at the
-- other end decides what that means. That is what makes Discord, Home
-- Assistant, n8n, Zapier and IFTTT all work without a line of code each.
-- =============================================================================
create table if not exists public.integrations (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,

  name        text not null,
  url         text not null,

  -- Which events to send. Empty means all of them, which is what most people
  -- want and saves a wall of checkboxes on the way in.
  events      text[] not null default '{}',

  -- Signs the body so the receiver can prove it came from here. Generated
  -- server-side; shown once, exactly like an access token.
  secret      text not null,

  enabled     boolean not null default true,

  -- The last attempt, for the panel to show. A row rather than a log table:
  -- "did this work" is the question people ask, and a delivery history is
  -- unbounded growth for a question nobody asks twice.
  last_status      int,
  last_error       text,
  last_delivered_at timestamptz,
  -- How far the sender has got, so a delivery is sent once rather than on
  -- every sweep.
  delivered_through timestamptz,

  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint integration_url_is_https check (url ~* '^https://')
);

create index if not exists integrations_couple_idx
  on public.integrations (couple_id) where enabled;

drop trigger if exists integrations_updated_at on public.integrations;
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

alter table public.integrations enable row level security;

-- The couple reads and writes their own. The *secret* is the exception below.
drop policy if exists "couple read" on public.integrations;
create policy "couple read" on public.integrations
  for select using (public.is_couple_member(couple_id));

drop policy if exists "couple write" on public.integrations;
create policy "couple write" on public.integrations
  for all using (public.is_couple_member(couple_id))
      with check (public.is_couple_member(couple_id));

-- -----------------------------------------------------------------------------
-- The secret is not readable, by anyone, ever — including its owner.
--
-- Same reasoning as `access_tokens.token_hash` (0019): anything that can select
-- it can forge a signature, and no screen has ever needed to. It is shown once
-- at creation, from the value the client generated, and never read back.
--
-- A table-level revoke followed by named column grants, because a column-level
-- revoke underneath a table-level grant does nothing at all — the mistake 0019
-- was written to avoid making twice.
-- -----------------------------------------------------------------------------
revoke select on public.integrations from authenticated;
grant select (
  id, couple_id, name, url, events, enabled,
  last_status, last_error, last_delivered_at, delivered_through,
  created_by, created_at, updated_at
) on public.integrations to authenticated;
