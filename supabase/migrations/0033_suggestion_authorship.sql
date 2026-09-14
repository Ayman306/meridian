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
-- The person who accepted it. Pressing Keep is the act of adding something to
-- the plan; asking for a draft is only a proposal, and the thing that produced
-- it may not have been a person at all. So the accepter is the author, and the
-- feed reads exactly as it would had they typed the item in themselves.
--
-- `created_by` on the tray is the last resort behind that, for a draft accepted
-- with no session user to credit. It also records real provenance: who asked,
-- which may have been days earlier and on the other person's phone.
--
-- ## Why there is no backfill here
--
-- Rows written before this have no author, and no rule recovers one: the tray
-- entry that would have named them did not store it, which is the whole bug.
-- Anything this migration could do would be a guess dressed as schema.
--
-- Repairing them is a one-off data fix against one database, by someone who
-- knows the answer — not a statement every future clone and CI run replays.
-- Migrations are shared and permanent; that repair is neither, and writing a
-- person's uuid into version control to perform it would be the wrong trade
-- twice over. See docs/MEMORY.md D133 for what was run and when.
-- =============================================================================

alter table public.suggestion_tray
  add column if not exists created_by uuid references public.profiles(id);

comment on column public.suggestion_tray.created_by is
  'Who asked for this draft. Copied onto the items when the tray entry is accepted, so an MCP-generated plan is attributed to the person who asked for it.';
