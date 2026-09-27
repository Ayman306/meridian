-- =============================================================================
-- 0037_partner_is_never_a_friend — make "who is my partner" a real answer.
--
-- `partner_id()` has been, since 0001:
--
--     select cm2.user_id from couple_members cm1
--       join couple_members cm2 on cm1.couple_id = cm2.couple_id
--      where cm1.user_id = auth.uid() and cm2.user_id <> auth.uid()
--      limit 1;
--
-- "The other member", unordered. That was sound while a couple held exactly
-- two people — D1's one-couple-per-user index guaranteed it, and the comment
-- above that index said so. 0013 then let a couple invite a *friend* or a
-- *guest*, and from that moment the answer was whichever member the planner
-- reached first: the partner, or the friend, varying with uuid order and
-- scan choice.
--
-- ## What that broke
--
-- The client builds `partnerRef` from this function, and nearly everything
-- two-person reads it. The worst consequence is on the health Sharing screen,
-- which grants consent to `partnerRef.id` — with a friend in the couple it
-- could offer to share somebody's cycle, or their intimacy log, with the
-- friend. `profiles read partner` is keyed on it too, so the same coin-flip
-- decided whether you could read your own partner's profile or the friend's.
-- Profiles carry a home location, which is not something a friend on one trip
-- should be handed by accident.
--
-- ## The rule now
--
-- A partner is the other **owner or partner** in a space of kind `couple`.
-- Friends and guests are members, never partners, whoever asks. Ties — which
-- a couple should never have, but a bad row should not make random — break on
-- `joined_at`, then `user_id`, so the answer is the same on every call.
--
-- A friend asking gets the couple's earliest owner/partner rather than null.
-- The client reads a null partner as "your partner deleted their account",
-- and a friend is not orphaned; a stable name is the least surprising answer
-- and matches what they saw before, minus the randomness.
--
-- `my_couple_id()` carried the same unordered `limit 1`. Unreachable today —
-- nobody can belong to two spaces while group UI does not exist, and spec
-- 16.9 says it should not — but it prefers the couple and orders
-- deterministically now, so it cannot become a coin-flip later.
-- =============================================================================

create or replace function public.partner_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select other.user_id
    from public.couple_members me
    join public.couples c       on c.id = me.couple_id and c.kind = 'couple'
    join public.couple_members other
      on other.couple_id = me.couple_id
     and other.user_id <> me.user_id
     and other.role in ('owner', 'partner')
   where me.user_id = auth.uid()
   order by other.joined_at, other.user_id
   limit 1;
$$;

create or replace function public.my_couple_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select me.couple_id
    from public.couple_members me
    join public.couples c on c.id = me.couple_id
   where me.user_id = auth.uid()
   order by (c.kind = 'couple') desc, me.joined_at, me.couple_id
   limit 1;
$$;

revoke all on function public.partner_id()   from public, anon;
revoke all on function public.my_couple_id() from public, anon;
grant execute on function public.partner_id()   to authenticated;
grant execute on function public.my_couple_id() to authenticated;
