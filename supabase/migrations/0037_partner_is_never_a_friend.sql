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
-- ## Authorisation is per couple
--
-- `couple_settings` "partners write" was `is_couple_member(couple_id) and
-- my_role() in ('owner', 'partner')`. `my_role()` is the caller's role in
-- *their own* space, not in the couple being written, so a friend on Eve's trip
-- who is a partner at home passed the check for Eve's couple and could rewrite
-- her settings. It had been a coin-flip; this migration's first draft, by
-- ordering `my_role()` to prefer the partner membership, made it certain. A
-- global role is the wrong tool for a per-couple decision, so there is now a
-- per-couple one: `is_couple_partner(couple_id)`.
--
-- Two older gaps sat beside it and close the same way:
--
-- - `invites` "couple write" required only membership. `create_invite` refuses
--   a friend or guest — "a guest who could invite would route around every
--   grant on their own membership" — but the table let one write an invite
--   directly, and even a partner could skip every rule in `create_invite` by
--   inserting one, or un-revoke an old one with a five-year expiry. The client
--   may now only revoke; see the column privileges at the end of this file.
-- - `couple_members` had no update policy and deleted only your own row. So
--   Settings' "change what they see" and "remove" both affected zero rows and
--   reported success: a friend you removed kept their access, and nothing on
--   the screen said so. Partners may now update and remove **friends and
--   guests** in their own couple — never each other, and a friend can never
--   raise their own role.

-- ## Consent follows the relationship
--
-- `has_health_consent` checked that a consent row existed and nothing else. So
-- a grant that reached a friend through the old coin-flip kept working after
-- this fix — and the Sharing screen, now keyed on the real partner, would not
-- even show it to be revoked. The same hole let a *former* partner keep reading
-- after leaving the couple, if nobody remembered to revoke first.
--
-- Health sharing has only ever been offered to the partner, so each viewer
-- policy now also requires the row's owner to *be* the viewer's partner:
--
--     owner_id = (select public.partner_id())
--
-- The subselect is deliberate. Written bare, `partner_id()` — a three-table
-- join — would run once per row; wrapped, Postgres evaluates it once per query
-- as an initPlan and the comparison prunes every row that is not the
-- partner's before `has_health_consent` ever runs. An earlier draft called
-- `partner_id()` inside `has_health_consent` instead, which ran the join per
-- row of the table. The function keeps a relationship check of its own — see
-- its comment — but a cheap one, reached only for the partner's rows.

-- ## "Which space is mine" had the same flaw, and it was reachable
--
-- `my_couple_id()`, `my_role()` and `my_modules()` each read one membership
-- with an unordered `limit 1`. That looked unreachable — spec 16.9 rules out
-- group spaces — but it is not: `join_couple` only refuses a *partner* invite
-- to someone who is already an owner or partner somewhere. A person who is a
-- friend on another couple's trip can therefore accept a partner invite and
-- hold two memberships, and the unordered read could hand them back the
-- friend's space as their own — every couple-scoped screen pointed at the
-- wrong couple. So all three now prefer, in order: the membership where you
-- are an owner or partner, a couple over a group, then the earliest.
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
   order by (me.role in ('owner', 'partner')) desc, (c.kind = 'couple') desc,
            me.joined_at, me.couple_id
   limit 1;
$$;

-- The relationship is checked here too, not only in the policies. The function
-- is callable as an RPC, and without it a former partner holding a stray
-- consent row would get `true` — learning that the sharing was never revoked —
-- and any future health table whose policy forgot the prefilter would reopen
-- the hole this migration closes. Written as an indexed pair lookup rather
-- than a call to `partner_id()`, and reached only for rows the policy
-- prefilter has already narrowed to the partner's, so it costs a couple of
-- index probes per partner row rather than a join per row of the table.
create or replace function public.has_health_consent(owner uuid, scope_name text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.health_consents c
     where c.owner_id = owner
       and c.viewer_id = auth.uid()
       and c.scope = scope_name
       -- Checked here rather than by a sweep: revocation has to take effect on
       -- the next query, with no cache to expire (spec 12.6).
       and c.revoked_at is null
  )
  and exists (
    select 1
      from public.couple_members viewer
      join public.couple_members holder on holder.couple_id = viewer.couple_id
      join public.couples c on c.id = viewer.couple_id and c.kind = 'couple'
     where viewer.user_id = auth.uid() and viewer.role in ('owner', 'partner')
       and holder.user_id = owner      and holder.role in ('owner', 'partner')
  );
$$;

drop policy if exists "viewer with active consent" on public.cycle_logs;
create policy "viewer with active consent" on public.cycle_logs
  for select using (
    owner_id = (select public.partner_id())
    and public.has_health_consent(owner_id, 'cycle')
  );

drop policy if exists "viewer with active consent" on public.health_records;
create policy "viewer with active consent" on public.health_records
  for select using (
    owner_id = (select public.partner_id())
    and case kind
      when 'medication'   then public.has_health_consent(owner_id, 'medications')
      when 'vaccination'  then public.has_health_consent(owner_id, 'vaccinations')
      else public.has_health_consent(owner_id, 'notes')
    end
  );

drop policy if exists "viewer with active consent" on public.intimacy_logs;
create policy "viewer with active consent" on public.intimacy_logs
  for select using (
    owner_id = (select public.partner_id())
    and public.has_health_consent(owner_id, 'intimacy')
  );

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
   order by (me.role in ('owner', 'partner')) desc, (c.kind = 'couple') desc,
            me.joined_at, me.couple_id
   limit 1;
$$;

-- The module grants that go with the same membership, so the nav, the role
-- and the couple can never describe three different spaces.
create or replace function public.my_modules()
returns text[] language sql security definer stable
set search_path = public as $$
  select coalesce(
    (select me.module_grants
       from public.couple_members me
       join public.couples c on c.id = me.couple_id
      where me.user_id = auth.uid()
      order by (me.role in ('owner', 'partner')) desc, (c.kind = 'couple') desc,
               me.joined_at, me.couple_id
      limit 1),
    public.all_modules()
  );
$$;

revoke all on function public.partner_id()   from public, anon;
revoke all on function public.my_couple_id() from public, anon;
revoke all on function public.my_role()      from public, anon;
revoke all on function public.my_modules()   from public, anon;
grant execute on function public.partner_id()   to authenticated;
grant execute on function public.my_couple_id() to authenticated;
grant execute on function public.my_role()      to authenticated;
grant execute on function public.my_modules()   to authenticated;

create or replace function public.is_couple_partner(target uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  -- Security definer for the same reason as `is_couple_member`: it is read
  -- from `couple_members` policies, and reading that table through its own RLS
  -- would recurse.
  select exists (
    select 1 from public.couple_members
     where couple_id = target
       and user_id = auth.uid()
       and role in ('owner', 'partner')
  );
$$;

revoke all on function public.is_couple_partner(uuid) from public, anon;
grant execute on function public.is_couple_partner(uuid) to authenticated;

drop policy if exists "partners write" on public.couple_settings;
create policy "partners write" on public.couple_settings
  for all using (public.is_couple_partner(couple_id))
      with check (public.is_couple_partner(couple_id));


-- Only friends and guests are managed, on both sides of the check: the row
-- being changed must be a friend's or a guest's, and so must the row it
-- becomes. That is what stops a partner demoting the other partner, and a
-- friend promoting themselves — they are not a partner of the couple, so
-- `is_couple_partner` refuses them before the role is even looked at.
drop policy if exists "partners manage friends" on public.couple_members;
create policy "partners manage friends" on public.couple_members
  for update using (public.is_couple_partner(couple_id) and role in ('friend', 'guest'))
         with check (public.is_couple_partner(couple_id) and role in ('friend', 'guest'));

drop policy if exists "partners remove friends" on public.couple_members;
create policy "partners remove friends" on public.couple_members
  for delete using (public.is_couple_partner(couple_id) and role in ('friend', 'guest'));

-- The couple row itself, resolved the same way, so the app can load it in one
-- round trip instead of asking for the id and then the row. `setof` so that
-- "no couple" is an empty result rather than a composite NULL whose meaning
-- depends on the client.
create or replace function public.my_couple()
returns setof public.couples language sql security definer stable
set search_path = public as $$
  select c.* from public.couples c where c.id = public.my_couple_id();
$$;

revoke all on function public.my_couple() from public, anon;
grant execute on function public.my_couple() to authenticated;

-- =============================================================================
-- Column privileges: what the client may write at all.
--
-- `authenticated` held full table-level INSERT, UPDATE and DELETE on every
-- membership table, so RLS policies were the only gate — and a policy says
-- *which rows*, never *which columns*. Every policy fix in this migration's
-- earlier drafts therefore left something adjacent open. The worst: the new
-- "partners manage friends" policy let a partner rewrite a friend's row
-- wholesale, `user_id` included, which would enrol somebody in a couple they
-- never agreed to join. So the client's writes are now narrowed to the columns
-- it actually has a reason to write, and everything else goes through the
-- `SECURITY DEFINER` RPCs that already enforce the rules — `create_couple`,
-- `join_couple`, `create_invite` and `leave_couple`, all of which run as the
-- function owner and are unaffected.
-- =============================================================================

-- Membership: Settings changes what a friend can see, and nothing else.
-- Joining is `join_couple`; leaving is `leave_couple`. Identity, role and join
-- date are not editable from a browser by anybody.
revoke update on public.couple_members from authenticated;
grant update (module_grants) on public.couple_members to authenticated;

-- Invites: issued by `create_invite`, redeemed by `join_couple`. The client
-- only ever revokes one, so that is all it may do — and only one way: a
-- revoked invite cannot be un-revoked, re-dated or re-addressed.
revoke insert, update, delete on public.invites from authenticated;
grant update (revoked_at) on public.invites to authenticated;
-- 0013's "couple write" was FOR ALL to any member. Policies are OR'd, so
-- leaving it in place would re-open every write below to friends and guests —
-- which an earlier draft of this file did, and the privilege matrix in the RLS
-- tests caught.
drop policy if exists "couple write" on public.invites;
drop policy if exists "partners revoke" on public.invites;
create policy "partners revoke" on public.invites
  for update using (public.is_couple_partner(couple_id))
         with check (public.is_couple_partner(couple_id) and revoked_at is not null);

-- The couple itself: the same per-couple rule as its settings. It was any
-- member, so a guest could rename somebody else's couple or change its base
-- currency — and the mirror trigger into `couple_settings`, now partner-only,
-- would then have silently matched no rows and let the two drift apart.
drop policy if exists "couples update" on public.couples;
create policy "couples update" on public.couples
  for update using (public.is_couple_partner(id))
         with check (public.is_couple_partner(id));

-- 0013 dropped the one-couple-per-user unique index so a person could hold a
-- friend membership too, and replaced it with nothing. Every "which space is
-- mine" lookup — `my_couple_id()`, `partner_id()`, `my_role()`, `my_modules()`
-- and the relationship check in `has_health_consent` — starts from `user_id`,
-- and the primary key leads with `couple_id`, so each was a scan.
create index if not exists couple_members_user_idx on public.couple_members (user_id);
