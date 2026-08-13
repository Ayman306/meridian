# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | 3 complete, then migrated to Next.js |
| Next | Phase 4 — Documents (spec Module 8) |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Stack | Next.js 16 App Router, React 19. Migrated from Vite after phase 3 — see D19. |
| Supabase project | **not yet provisioned** — see Open questions |
| Deployed | no |

### What runs today

Sign in with Google → create or join a couple by code → fill in a profile →
create trips, set their dates at whatever precision you actually know, set each
partner's own arrival and departure, and see how many nights you overlap — then
plan the trip itself: collect ideas in a pool, drag them onto days, reorder
them, and read the day list or the month grid depending on how long the stay is.
Typecheck, lint, 110 unit tests and a production build pass.

Sign-in is now settled on the server: `src/app/(app)/layout.tsx` redirects an
unauthenticated request before any app JavaScript ships. Pairing and profile
setup stay client-side gates, because they depend on the couple query.

### What is stubbed

- `src/types/database.ts` is hand-maintained against the migrations. Once a
  project exists, replace it with `supabase gen types typescript` output.
- Every route under `AppShell` renders `Placeholder` until its phase lands.
- `coarseTimezoneFromLongitude` in `lib/geocode.ts` is a placeholder for the
  `tz-lookup` package, which arrives with Destinations (Module 4) — that is the
  first module that genuinely needs coordinate→zone precision.

---

## Decisions

Decisions that are not simply "what the spec said". Each records the reasoning,
because the reasoning is what a future change needs to argue with.

### D1 — One couple per user, enforced by a unique index

The spec caps a couple at two members. It does not explicitly forbid a user from
belonging to two couples, but `partner_id()` returns `limit 1` and every policy
assumes a single couple. A `unique index on couple_members (user_id)` makes that
assumption true rather than hoped-for. Consequence: joining requires leaving
first, which the spec's "both users created a couple" edge case already expects.

### D2 — Invite codes are minted in Postgres, not the browser

Spec 1.3 shows the alphabet client-side. Uniqueness can only be enforced where
the uniqueness constraint lives, so `generate_invite_code()` loops until it finds
a free code inside the database. The client-side generator survives in `logic.ts`
for previews and tests only.

### D3 — `join_couple` distinguishes expired from invalid

The spec's RPC folds both into `INVALID_CODE`. Spec 1.7 separately requires
"expired code → clear message, offer regenerate", which needs the two cases
distinguished. The RPC raises `EXPIRED_CODE` and `INVALID_CODE` separately, and
`lib/errors.ts` maps each to its own copy.

### D4 — `onboarded_at` on profiles

Not in the spec's schema. Without it, "has this person finished setup?" has to be
inferred from whether fields are filled — which re-prompts anyone who genuinely
lives on UTC, or who deliberately left a field blank. An explicit stamp makes the
gate honest and is one column.

### D5 — `my_couple_id()` helper

The spec defines `is_couple_member()` and `partner_id()`. Nearly every insert also
needs "which couple am I in?", and doing that as a client round trip on every
mutation is wasteful. Added as a third SECURITY DEFINER helper.

### D6 — Vitest 3, not 2

Vitest 2 bundles its own Vite 5, which type-conflicts with the Vite 6 the app
builds on. Vitest 3 shares the installed Vite.

### D7 — `RestfulEmpty` takes no action prop

Spec 5.3 calls the distinction between the two empty states "the single most
important behavioural rule" in the itinerary module. Making it impossible to pass
a call to action to `RestfulEmpty` turns a rule that must be remembered into one
the compiler enforces.

### D8 — Invite expiry is described in hours under a day

"Expires today" is wrong for a code that dies at 08:00 tomorrow. Under 24 hours
the copy counts hours.

### D9 — Day scaffolding is one RPC, not N client inserts

`sync_trip_days()` does the whole set difference in a single transaction.
Generating days client-side means one round trip per day (a 31-day trip is 31
inserts) and races when both partners edit dates at the same moment. The client
still computes the diff locally via `diffTripDays` — but only to decide whether
to *prompt*, never to perform the write.

### D10 — Purity: date logic takes `today`, not a timezone

`groupTrips`, `countdownDays` and `isStalePlanning` take the viewer's calendar
date rather than their IANA zone. Passing a zone made them read the clock, which
is untestable and hides whose midnight is being used. Callers do
`todayIn(tzSelf)` — which also makes the "in whose timezone?" question (spec 2.6)
visible at each call site.

### D11 — `unwrap*` infers the envelope, not the row

A Supabase response is a union of a success and a failure shape. A plain `<T>`
inferred against it picks up `null` from the failure branch and collapses every
row type to `never` — silently, because property access on `never` is legal. The
helpers now infer the whole envelope and extract the payload with a distributive
conditional type. This bug would otherwise have quietly disabled type checking
on every query in the app.

### D12 — Both partners become travelers on trip creation

Spec 3.2 says per-traveler dates default to the trip's start and end. Rows have
to exist for that to be editable, so `createTrip` seeds a `trip_travelers` row
for each member with null dates, and the UI falls back to the trip's own dates
while they stay null. That keeps "inherited" visually distinct from "chosen".

### D13 — Day-type promotion is a database trigger

Spec 5.3 says a day gains its first item and becomes "planned", but only if it
is currently "open" — a manual rest or work day is never demoted. Putting that
in a trigger rather than the client means it holds however the item arrived:
drag, bulk move, an accepted suggestion, or a future Edge Function. The rule
cannot be forgotten at a new call site because there is only one site.

### D14 — Timed items sort before untimed ones

Spec 5.3 offers both orderings and says only that we must pick one. A day with
a 09:00 flight and a loose "buy stamps" reads as a schedule with slack; the
reverse reads as a pile with a flight buried in it. Timed first.

### D15 — A time cannot exist without a date

Enforced by a check constraint, not just the form. "8pm on no particular day"
is not a plan, and letting it into the pool would mean every consumer of pool
items has to handle a time that means nothing. Unscheduling an item therefore
clears its times too — in `moveItem`, in `bulkMove`, and in `sync_trip_days`.

### D16 — Shortening a trip unschedules items rather than deleting them

The spec's prompt offers "move to Ideas, or cancel". Rather than a second
round trip after the user chooses, `sync_trip_days()` always unschedules
out-of-range items before deleting their days, inside the same transaction.
The prompt is then honest about a thing that has already been made safe, and
the outcome is the same whoever changed the dates — including a future Edge
Function that never sees the dialog.

### D17 — `trips` calls the item-count RPC directly

The shortening prompt needs to know which days carry items. Importing the
itinerary module from the trips module would create a cycle, since the plan
page imports trips. A four-line duplicated RPC call in `trips/api.ts` is the
cheaper of the two.

### D18 — Drag and drop is optimistic

A drag that visibly snaps back while the server thinks about it reads as
broken even when it succeeds. `useMoveItem` writes the new date into the cache
immediately and rolls back on error.

### D19 — Next.js instead of Vite, Route Handlers instead of Edge Functions

**Owner's decision, taken after phase 3**, overriding spec 0.1 and 0.9. The
reason given was wanting frontend and backend in one repo — which was already
true — plus a preference for Next. The trade was recorded at the time and is
worth keeping visible: this app is auth-gated, personalised, realtime and
drag-heavy, so nearly every component is `'use client'` and the RSC/SEO wins
mostly do not apply. The one real gain is that server-side work is now
TypeScript Route Handlers in `src/app/api` rather than Deno Edge Functions —
one language, one deploy, and local development that does not need a second
runtime. Done at phase 3 because it was the cheapest moment it would ever be.

About 80% of the code was untouched: all migrations, every `logic.ts` and its
110 tests, every `api.ts`, all of `lib/`, and the components themselves.

### D20 — Sessions live in cookies, not localStorage

Forced by D19 and correct regardless. `@supabase/ssr` gives a browser client
and a server client that share cookie-based sessions, so a Server Component can
answer "who is this?" without asking the client. `src/proxy.ts` (Next 16's
renamed middleware) refreshes the session on every request, because Server
Components cannot set cookies themselves.

### D21 — Auth is checked on the server, pairing on the client

`src/app/(app)/layout.tsx` is a Server Component that redirects to `/login`
when there is no user — so an unauthenticated request never downloads the app.
Whether someone is *paired* and *set up* depends on the couple query, which is
client state, so `AppGate` decides that. Two gates in two places, each where
its data actually lives.

### D22 — `api.ts` and `hooks.ts` carry `'use client'`

They are browser-only by nature — they hold the browser Supabase client and
React hooks. Marking the modules themselves, rather than every importer, means
a module's `index.ts` barrel can still be imported from a Server Component that
only wants the page component out of it.

### D24 — The migrations are verified against a real Postgres

`supabase/tests/` applies every migration to a throwaway database and asserts
39 things about the result, including the isolation check the spec gates Stage 1
on: a stranger can neither read nor write another couple's rows. CI runs it on
every push against a Postgres service.

This exists because RLS is the only thing protecting the data and it is
invisible in code review — a policy with a subtly wrong `USING` clause looks
exactly like a correct one. `00_shim.sql` fakes the small part of Supabase's
`auth` schema the migrations touch (`auth.users`, `auth.uid()` from a session
GUC), so the real migrations run unmodified.

Writing the suite immediately found two things: an assertion of mine was wrong
(an UPDATE filtered out by RLS returns zero rows rather than raising — correct
behaviour, wrong test), and the migrations were not idempotent, because
`create trigger` and `create policy` were unguarded. A second run of the setup
would have failed halfway through. Both fixed.

### D25 — `supabase/setup.sql` is generated and CI-checked

Someone standing up a project should paste one thing, not three in the right
order. `scripts/build-setup.mjs` concatenates the migrations; the output is
committed and CI fails if it has drifted, so the convenience copy cannot become
a stale second source of truth.

### D23 — Preferences read through `useSyncExternalStore`

`ThemeProvider` used to seed `useState` from localStorage, which crashes during
SSR, and the obvious fix — read it in an effect — sets state synchronously and
cascades a render. `useStoredPreference` treats localStorage as what it is, an
external store: the server render sees the fallback, and a change in another
tab is picked up for free.

---

## Deviations from the spec

| Spec | Code | Why |
| --- | --- | --- |
| 1.3 `join_couple` raises `INVALID_CODE` for expiry | Raises `EXPIRED_CODE` | D3 — spec 1.7 needs the cases distinguished |
| 1.1 `profiles` columns | Adds `onboarded_at` | D4 |
| 0.4 `couple_members` | Adds a unique index on `user_id` | D1 |
| 0.2 module layout | `providers/` holds Auth/Couple/Theme as specified; `components/common/` also holds `ErrorBoundary` | A render crash on a phone in an airport must not be a blank page |
| 3.1 `trip_days` | Adds `created_at` / `updated_at` | Part 0.3 requires them on every table; the module's own schema block omitted them |
| 3.1 `trip_travelers` | Same | Same |
| 3.3 day regeneration | Set difference runs in `sync_trip_days()` | D9 |
| 3.2 shortening prompt | Prompts on days carrying items, a note, or a manual day type | Extended in Phase 3 to count items |
| 5.1 `itinerary_items` | Adds a `time_needs_date` check constraint | D15 |
| 5.3 day-type promotion | Runs as a trigger, not in the client | D13 |
| 5.2 week view | Not built | The spec calls it optional and worth building only if the month grid feels too coarse. It has not been used in anger yet. |
| 5.1 `destination_id` | Column exists, FK deferred | `trip_destinations` arrives in Phase 8; adding the constraint then is one line |
| 0.1 React 18 + Vite, browser SPA | Next.js 16 App Router, React 19 | D19 — owner's decision |
| 0.9 Edge Functions | Route Handlers in `src/app/api` | D19 |
| 0.2 project structure | Adds `src/app/`, `src/proxy.ts`; drops `main.tsx`, `App.tsx`, `routes.tsx`, `supabase/functions/` | Follows from D19 |
| 1.2 session persisted in localStorage | Cookies via `@supabase/ssr` | D20 |

Nothing else diverges. Where the spec gave SQL verbatim, the migration uses it
verbatim.

---

## Open questions

Ordered by how much they block.

1. **Supabase project.** Still none — the Supabase connector dropped out of the
   session it was going to be created in, so this is the one setup step nobody
   has done yet. `docs/SETUP.md` walks through it and the SQL is already proven
   by `npm run db:test`, so it should be a paste and two OAuth forms. Create it
   (region chosen deliberately: near whichever partner reads more), then:
   - apply `supabase/migrations/0001_foundation.sql`
   - enable the Google provider and set the OAuth redirect to the deployed origin
   - set the `APP_URL` repository secret (the deployed origin) for the
     keep-alive workflow, which now pings `/api/health`
   - add `/auth/callback` on both origins to the Google redirect allowlist
   - regenerate `src/types/database.ts`
   The spec's Stage 0 gate is already verified at the database level by
   `supabase/tests/` — what a live project adds is confirmation that the *app*
   is wired to those same policies.
2. **Hosting.** Vercel's free tier is the obvious fit now that this is a Next
   app — Cloudflare Pages would need the OpenNext adapter. No rewrite rules
   needed; the App Router handles deep links itself.
3. **`requires_country` on `document_types`** (spec 8.1) is declared but no
   feature reads it. Resolve when Documents lands.
4. **Open-ended trips have a 30-day horizon** (spec 3.6). Nothing rolls it
   forward yet — a trip open-ended for two months will show a stale grid. The
   cheapest fix is to re-run `sync_trip_days()` on trip open; decide when the
   itinerary makes the cost visible.
5. **Overlap warnings** are computed (`overlappingTrips`) but not yet surfaced.
   The natural home is the trip list, once there are enough trips for it to
   matter.
6. **The tight-connection heuristic** assumes 25 km/h door to door and scales
   straight-line distance by 1.4. Both numbers are guesses that suit a dense
   European city and will be wrong for a road trip. Revisit once the map
   module (Phase 7) makes real distances visible.
7. **Bulk actions** have a working mutation (`useBulkMove`) and no UI. Worth
   adding once a real trip has enough items for multi-select to pay off.
8. **Health module scope.** The spec says design it together, last. Left alone.
