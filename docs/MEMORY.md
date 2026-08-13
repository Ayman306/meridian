# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | 3 complete (Foundations, Auth & Couple, Trips, Itinerary) |
| Next | Phase 4 — Documents (spec Module 8) |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Supabase project | **not yet provisioned** — see Open questions |
| Deployed | no |

### What runs today

Sign in with Google → create or join a couple by code → fill in a profile →
create trips, set their dates at whatever precision you actually know, set each
partner's own arrival and departure, and see how many nights you overlap — then
plan the trip itself: collect ideas in a pool, drag them onto days, reorder
them, and read the day list or the month grid depending on how long the stay is.
Typecheck, lint, 110 unit tests and a production build pass.

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

Nothing else diverges. Where the spec gave SQL verbatim, the migration uses it
verbatim.

---

## Open questions

Ordered by how much they block.

1. **Supabase project.** None exists yet — the org has only an unrelated
   `ascent-track`. Someone needs to create one (region chosen deliberately: put
   it near whichever partner reads more, latency-wise), then:
   - apply `supabase/migrations/0001_foundation.sql`
   - enable the Google provider and set the OAuth redirect to the deployed origin
   - set the `SUPABASE_URL` / `SUPABASE_ANON_KEY` repository secrets for the
     keep-alive workflow
   - regenerate `src/types/database.ts`
   Until then the RLS verification in Phase 0 cannot run, and it is the one thing
   the spec says to confirm before proceeding.
2. **Hosting.** Vercel or Cloudflare Pages, both free. Needs an SPA rewrite rule
   so deep links like `/trips/:id/plan` resolve.
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
