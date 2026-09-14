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
-- =============================================================================

alter table public.suggestion_tray
  add column if not exists created_by uuid references public.profiles(id);

comment on column public.suggestion_tray.created_by is
  'Who asked for this draft. Copied onto the items when the tray entry is accepted, so an MCP-generated plan is attributed to the person who asked for it.';

-- -----------------------------------------------------------------------------
-- Backfill: the rows that are already orphaned.
--
-- Accepting is the act of adding, so these belong to whoever pressed Keep. The
-- app knows that from now on; for rows written before it did, the id below is
-- the answer the owner gave when asked directly: they generated the drafts and
-- they accepted them.
--
-- An explicit id rather than a guess. The first draft of this migration took
-- `trips.created_by` as a stand-in, which happens to be the same person here,
-- but "happens to be" is not a reason to write somebody's name against 46 rows
-- of someone else's holiday.
--
-- Narrow and idempotent. Only items with no author at all are touched, and
-- only those that came through a tray accept — a hand-typed item with a null
-- author predates `proposed_by` being written at all, and filling that in
-- would be inventing history rather than recovering it. The `exists` guard
-- keeps this inert on any database where that profile is not present, which
-- is every database except the one it was written for.
-- -----------------------------------------------------------------------------
update public.itinerary_items i
   set proposed_by = 'b8ea3e2d-bc16-4337-8879-36a973ceb97c'::uuid
 where i.proposed_by is null
   and i.source in ('blend', 'ai')
   and exists (
     select 1 from public.profiles p
      where p.id = 'b8ea3e2d-bc16-4337-8879-36a973ceb97c'::uuid
   );
