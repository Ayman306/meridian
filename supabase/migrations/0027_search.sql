-- =============================================================================
-- 0027_search — one box that finds anything the couple saved.
--
-- Eleven navigation destinations and no way to search across them. After three
-- years this app holds hundreds of saved places, dozens of documents and
-- thousands of expenses, and the only way to find "that restaurant in Lisbon"
-- is to remember which tab it is under. That is the one gap that gets *worse*
-- with time; everything else on the deferred list was flat-cost.
--
-- ## SECURITY INVOKER, and why that is the whole design
--
-- This function is deliberately **not** `security definer`. It runs as the
-- caller, so every `select` inside it is judged by the same policies the app
-- already relies on: a document the partner has not shared is not found,
-- because the partner cannot read the row, not because this function
-- remembered to exclude it.
--
-- A definer function here would have been the single most dangerous object in
-- the schema — a search endpoint that reads every couple's rows and trusts
-- itself to filter. It is written this way so that getting the filter wrong is
-- not a possible outcome.
--
-- ## Trigram matching, not full-text
--
-- `media` already carries a `search_tsv`, and full-text is the better tool when
-- you know the words. This is the other case: people misremember names, so
-- "alfama" should find "Pensão Alfama" and "borogh market" should find
-- "Borough Market". `pg_trgm` handles both, `ilike '%…%'` is index-accelerated
-- by a GIN trigram index, and one matching strategy across eight tables beats
-- two that rank differently from each other.
--
-- ## What is deliberately not searchable
--
-- Health records and cycle logs. They are owner-private, and a box that
-- surfaces a medication name while somebody is looking for a restaurant is not
-- a feature. Document *numbers* and storage paths are likewise never returned —
-- only the label, exactly as the MCP is restricted (D102).
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Trigram indexes.
--
-- Without these, `ilike '%q%'` is a sequential scan on every table in the union
-- — fine on a laptop with test data, and the reason the feature would feel
-- broken on a real library three years in.
-- -----------------------------------------------------------------------------
create index if not exists trips_title_trgm on public.trips using gin (title gin_trgm_ops);
create index if not exists itinerary_title_trgm
  on public.itinerary_items using gin (title gin_trgm_ops);
create index if not exists itinerary_place_trgm
  on public.itinerary_items using gin (place_name gin_trgm_ops);
create index if not exists wishlist_title_trgm
  on public.wishlist_items using gin (title gin_trgm_ops);
create index if not exists wishlist_place_trgm
  on public.wishlist_items using gin (place_name gin_trgm_ops);
create index if not exists accommodations_name_trgm
  on public.accommodations using gin (name gin_trgm_ops);
create index if not exists documents_label_trgm
  on public.documents using gin (label gin_trgm_ops);
create index if not exists expenses_description_trgm
  on public.expenses using gin (description gin_trgm_ops);
create index if not exists media_caption_trgm on public.media using gin (caption gin_trgm_ops);
create index if not exists destinations_city_trgm
  on public.trip_destinations using gin (city gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- The search itself.
--
-- One round trip returning a heterogeneous list. `kind` is what the client
-- switches on to build a link; `subtitle` is whatever context makes the row
-- identifiable without opening it — a city, a date, an address.
--
-- `rank` combines two things a single measure gets wrong on its own: trigram
-- similarity, which is forgiving of spelling, and a prefix bonus, because
-- somebody typing "bor" almost certainly means the thing that *starts* with it
-- rather than the one that merely contains those letters somewhere.
-- -----------------------------------------------------------------------------
create or replace function public.search_everything(q text, max_results int default 30)
returns table (
  kind      text,
  id        uuid,
  title     text,
  subtitle  text,
  trip_id   uuid,
  occurred  date,
  rank      real
)
language sql
stable
-- Not `security definer`. See the note at the top: RLS is the filter.
security invoker
set search_path = public
as $$
  with needle as (
    select
      trim(q) as raw,
      '%' || trim(q) || '%' as like_pattern,
      trim(q) || '%' as prefix_pattern
  ),
  hits as (
    select 'trip'::text as kind, t.id, t.title,
           coalesce(t.notes, '') as subtitle,
           t.id as trip_id, t.start_date as occurred,
           similarity(t.title, n.raw) + case when t.title ilike n.prefix_pattern then 0.5 else 0 end as rank
      from public.trips t, needle n
     where t.deleted_at is null and t.title ilike n.like_pattern

    union all
    select 'plan', i.id, i.title,
           coalesce(i.place_name, i.address, ''),
           i.trip_id, i.scheduled_date,
           greatest(similarity(i.title, n.raw), similarity(coalesce(i.place_name, ''), n.raw))
             + case when i.title ilike n.prefix_pattern then 0.5 else 0 end
      from public.itinerary_items i, needle n
     where i.deleted_at is null
       and (i.title ilike n.like_pattern or i.place_name ilike n.like_pattern
            or i.address ilike n.like_pattern)

    union all
    select 'saved', w.id, w.title,
           coalesce(w.place_name, w.city, ''),
           null::uuid, null::date,
           greatest(similarity(w.title, n.raw), similarity(coalesce(w.place_name, ''), n.raw))
             + case when w.title ilike n.prefix_pattern then 0.5 else 0 end
      from public.wishlist_items w, needle n
     where w.deleted_at is null
       and (w.title ilike n.like_pattern or w.place_name ilike n.like_pattern
            or w.city ilike n.like_pattern)

    union all
    select 'stay', a.id, a.name,
           coalesce(a.city, a.address, ''),
           a.trip_id, a.check_in,
           similarity(a.name, n.raw) + case when a.name ilike n.prefix_pattern then 0.5 else 0 end
      from public.accommodations a, needle n
     where a.deleted_at is null
       and (a.name ilike n.like_pattern or a.address ilike n.like_pattern
            or a.city ilike n.like_pattern)

    union all
    -- Label only. Never the number, never the storage path — the same
    -- restriction the MCP tools carry, for the same reason.
    select 'document', d.id, d.label,
           coalesce(d.country_code, ''),
           null::uuid, d.expires_on,
           similarity(d.label, n.raw) + case when d.label ilike n.prefix_pattern then 0.5 else 0 end
      from public.documents d, needle n
     where d.deleted_at is null and d.label ilike n.like_pattern

    union all
    select 'expense', e.id, e.description,
           e.currency || ' ' || e.amount::text,
           e.trip_id, e.spent_on,
           similarity(e.description, n.raw)
             + case when e.description ilike n.prefix_pattern then 0.5 else 0 end
      from public.expenses e, needle n
     where e.deleted_at is null and e.description ilike n.like_pattern

    union all
    select 'photo', m.id, coalesce(m.caption, 'Photo'),
           '', m.trip_id, m.taken_at::date,
           similarity(coalesce(m.caption, ''), n.raw)
             + case when m.caption ilike n.prefix_pattern then 0.5 else 0 end
      from public.media m, needle n
     where m.deleted_at is null and m.caption ilike n.like_pattern

    union all
    select 'destination', td.id, td.city,
           coalesce(td.country_code, ''),
           td.trip_id, td.arrive_on,
           similarity(td.city, n.raw) + case when td.city ilike n.prefix_pattern then 0.5 else 0 end
      from public.trip_destinations td, needle n
     where td.deleted_at is null and td.city ilike n.like_pattern
  )
  select h.kind, h.id, h.title, nullif(h.subtitle, '') as subtitle, h.trip_id, h.occurred,
         h.rank::real
    from hits h, needle n
   -- Two characters matches half the library and is not a search. The client
   -- also refuses to call below this length; the guard is here as well because
   -- the client is not the only caller — the MCP could be next.
   where length(n.raw) >= 2
   order by h.rank desc, h.occurred desc nulls last, h.title
   limit greatest(1, least(max_results, 100));
$$;

revoke all on function public.search_everything(text, int) from public, anon;
grant execute on function public.search_everything(text, int) to authenticated;

comment on function public.search_everything(text, int) is
  'Trigram search across everything the caller can read. SECURITY INVOKER on purpose: RLS is the filter, not this function.';
