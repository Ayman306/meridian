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
-- A friend asking gets null: a friend is nobody's partner. An earlier draft
-- answered the couple's owner instead, so the client would not show a friend
-- as orphaned — and in doing so gave every friend the owner's profile, home
-- location included, through `profiles read partner`. The worry was unfounded:
-- nothing in the client reads `isOrphaned`, and every screen that uses
-- `partnerRef` already guards for null, because solo mode has always produced
-- one. A friend takes the same paths as somebody unpaired. So the database
-- gives the true answer.
--
-- ## Consent follows the relationship
--
-- `has_health_consent` checked that a consent row existed and nothing else. So
-- a grant that reached a friend through the old coin-flip kept working after
-- this fix — and the Sharing screen, now keyed on the real partner, would not
-- even show it to be revoked. The same hole let a *former* partner keep reading
-- after leaving the couple, if nobody remembered to revoke first.
--
-- Health sharing has only ever been offered to the partner, so it now requires
-- one: the viewer must currently be the owner's partner, as `partner_id()`
-- sees it. A stray row pointing anywhere else grants nothing, and leaving a
-- couple ends access without anybody having to think about it.
--
-- `my_couple_id()` and `my_role()` carried the same unordered `limit 1`. Unreachable today —
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
     and me.role in ('owner', 'partner')
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

create or replace function public.has_health_consent(owner uuid, scope_name text)
returns boolean language sql security definer stable
set search_path = public as $$
  select public.partner_id() = owner
     and exists (
       select 1 from public.health_consents c
        where c.owner_id = owner
          and c.viewer_id = auth.uid()
          and c.scope = scope_name
          -- Checked here rather than by a sweep: revocation has to take effect
          -- on the next query, with no cache to expire (spec 12.6).
          and c.revoked_at is null
     );
$$;

revoke all on function public.has_health_consent(uuid, text) from public, anon;
grant execute on function public.has_health_consent(uuid, text) to authenticated;

-- The role that goes with `my_couple_id()`, so the two can never describe
-- different spaces.
create or replace function public.my_role()
returns text language sql security definer stable
set search_path = public as $$
  select me.role
    from public.couple_members me
    join public.couples c on c.id = me.couple_id
   where me.user_id = auth.uid()
   order by (c.kind = 'couple') desc, me.joined_at, me.couple_id
   limit 1;
$$;

revoke all on function public.partner_id()   from public, anon;
revoke all on function public.my_couple_id() from public, anon;
revoke all on function public.my_role()      from public, anon;
grant execute on function public.partner_id()   to authenticated;
grant execute on function public.my_couple_id() to authenticated;
grant execute on function public.my_role()      to authenticated;
