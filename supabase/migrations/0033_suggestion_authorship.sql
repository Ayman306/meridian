-- =============================================================================
-- 0033_suggestion_authorship — an accepted suggestion has an author.
--
-- The activity feed reads `itinerary_items.proposed_by` to say who did a thing.
-- Every path filled it in except the one that matters most in practice: a draft
-- generated through the MCP, put in the suggestion tray, and accepted in the
-- app. `acceptSuggestion` copied `proposed_by` straight off the draft payload,
-- and an AI draft has no such field — so every item it created carried a null
-- author and the dashboard rendered eight rows of "Someone added to the plan".
--
-- "Someone" is the fallback for a row written before `created_by` existed. It
-- was never meant to describe the normal way this couple plans a trip.
--
-- ## Who the author is
--
-- The person, not the assistant. An item added by asking Claude to plan a day
-- is the user's item: they asked for it, and they pressed Keep on it. The MCP
-- acts as them — it holds their grant and writes under their RLS — so the honest
-- attribution is the human on the other end, and the feed should read exactly
-- as it would had they typed it in themselves.
--
-- `created_by` on the tray is what carries that from the generating session
-- through to the accept, which may happen days later and on the other person's
-- phone.
-- =============================================================================

alter table public.suggestion_tray
  add column if not exists created_by uuid references public.profiles(id);

comment on column public.suggestion_tray.created_by is
  'Who asked for this draft. Copied onto the items when the tray entry is accepted, so an MCP-generated plan is attributed to the person who asked for it.';

-- -----------------------------------------------------------------------------
-- Backfill: the rows that are already orphaned.
--
-- Best effort, and deliberately narrow. Only items that came from a tray accept
-- (`source in ('blend','ai')`) with no author at all are touched, and they take
-- the trip's creator — the one person we can name who definitely planned this
-- trip. A hand-typed item with a null author is left alone: it predates
-- `proposed_by` being written at all, and guessing at it would be inventing
-- history rather than recovering it.
-- -----------------------------------------------------------------------------
update public.itinerary_items i
   set proposed_by = t.created_by
  from public.trips t
 where i.trip_id = t.id
   and i.proposed_by is null
   and t.created_by is not null
   and i.source in ('blend', 'ai');
