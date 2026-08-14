# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | 7 complete — Wishlist & Blend, then the Map |
| Next | Phase 8 — Destinations (spec Module 4) |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Stack | Next.js 16 App Router, React 19. Migrated from Vite after phase 3 — see D19. |
| Supabase project | `meridian` / `ylrpxrfneonjzctgtnmj`, ap-northeast-1, Postgres 17 |
| Migrations applied | 0001–0007, live |
| Deployed | no |

### What runs today

Sign in with Google → create or join a couple by code → fill in a profile →
create trips, set their dates at whatever precision you actually know, set each
partner's own arrival and departure, and see how many nights you overlap — then
plan the trip itself: collect ideas in a pool, drag them onto days, reorder
them, and read the day list or the month grid depending on how long the stay is.
**The Stage 1 milestone is met: a trip can be planned end to end with no other
tool.** Sign in, pair, create a trip, plan it, store the documents it needs,
and see the whole thing from the dashboard.

On top of that, Phases 6 and 7: save places to a shared wishlist without either
of you having to agree yet, see the overlap on the blend screen, push what you
both wanted into the plan, and have the app lay out a draft — arithmetic, no
model — that waits in the tray until somebody keeps it. And a map: every place
with coordinates, filterable by day, person, category and state, with the
selected day's route drawn between its stops.

Typecheck, lint, 222 unit tests, 72 database assertions and a production build
pass.

Sign-in is now settled on the server: `src/app/(app)/layout.tsx` redirects an
unauthenticated request before any app JavaScript ships. Pairing and profile
setup stay client-side gates, because they depend on the couple query.

### What is stubbed

- The remaining routes under `AppShell` (`where`, `money`, `photos`) render
  `Placeholder` until their phase lands.
- The blend narrows to a city by matching the trip title against the cities in
  the wishlist. Trips get a real destination in Module 4 (Phase 8); until then
  no match simply means no narrowing.
- The map opens over the world when there is nothing to fit to. Spec 6.6 wants
  the destination — also Module 4.
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

### D28 — Readiness is computed in SQL, not the client

The rule is that a document must be valid *through the end of the trip*, not
today. That join — documents against requirements, filtered by
`expires_on >= trip.end_date` — is the whole feature, and doing it client-side
would mean fetching every document to answer a question about one trip. It also
puts the rule somewhere a future caller cannot forget it. `buildReadiness` only
groups and counts the rows the RPC returns.

A passport is required for both travellers implicitly rather than being a row
someone has to add. Nobody travels without one, and a readiness score that
starts at 0/0 until you tell it what you need is not a readiness score.

### D29 — Storage paths are load-bearing

`{couple_id}/{owner_id}/{document_id}/{filename}` is not a convention, it is
the input to the storage policies: they read `foldername[1]` and
`foldername[2]` to decide access. `storagePath()` is the only place that shape
is built, and its tests say so, because changing it silently means changing who
can read what.

### D30 — The document row is rolled back if its upload fails

Spec 8.7 wants no orphan rows and no orphan objects. The path contains the
document id, so the row must exist first — which means a failed upload leaves a
document claiming a file it does not have. `uploadDocument` deletes the row it
just created rather than leaving that behind.

### D31 — Vague trips never enter the live countdown states

Caught by a test while writing Phase 5. A trip pinned to "2026" is stored as
`2026-01-01`; once that date passed, the state machine saw `start <= today` and
declared the couple **Together** for a trip nobody had booked. Anything less
precise than `exact` now stays in COUNTDOWN with its label and never reaches
travel-day / together / departing.

### D32 — The dashboard RPC returns no derived dates

It returns rows and dates; the client resolves them. "Which year is this night
in?" and "is today travel day?" have different answers for the two people
looking, and spec 2.6 settles it in favour of the viewer's timezone — which the
database does not know. Nights-together arithmetic, the countdown and the year
boundary are therefore all client-side, over data the server merely gathered.

### D33 — Nights together counts only nights already lived

A trip you are on right now contributes the nights up to today, not to its end.
Counting the whole booked window would make the lifetime total *decrease* if a
trip were cut short, which is a strange property for a counter of shared nights.

### D34 — Verdicts live in their own table, and "both of us" is computed

Two decisions that are really one. A verdict is an opinion about someone else's
save, so it cannot be a column on the save — writing it would mean the partner
holding UPDATE on a row that is not theirs, and the RLS policy is the cleaner
statement of the rule: you read everything, you write only your own, verdicts
included.

"Both of us" is then not a state anyone sets. It is derived, every render, from
two people independently saving the same place — 150 m apart, or the same
normalised name in the same city. That coincidence is the most interesting thing
on the screen precisely because nobody arranged it.

### D35 — The draft generator is arithmetic, and its output is inert

Non-negotiable #8 says the app works with AI disabled, and the draft generator
is the feature that would otherwise need a model. It is 200 lines of pure
TypeScript in `wishlist/logic.ts`: select by agreement and intensity, k-means on
coordinates for the day's area, nearest-neighbour plus 2-opt within the day,
then capacity and category rules, then alternate whose pick opens each day.

Two properties matter more than the quality of the output. It is deterministic —
centroids are seeded by position in a longitude-sorted list, never at random, so
the same saves produce the same draft and a regenerate that changes nothing
looks like it changed nothing. And it writes to `suggestion_tray` and nowhere
else (non-negotiable #5): the only path into `itinerary_items` is
`acceptSuggestion`, which runs because somebody pressed Keep.

On a stay over five nights it plans 40% of the days at most and says so in the
note. Filling a month is the single worst thing this feature could do.

### D36 — Unvoted saves count as their picks

Caught by a test. `buildBlend` sorts the partner's unvoted saves into
`undecided`, and the generator originally selected from `mine` and `theirs`
only — so with verdicts optional, which spec 7.2 insists they are, a normal
list left the generator with almost nothing to work with. Undecided is now part
of their side for selection. Only clashes are excluded, because one of them has
actually said no.

### D37 — Fractional keys are minted in the client, never in SQL

`push_wishlist_to_itinerary` takes `new_sort_key` as an argument rather than
deriving one. The first draft appended a character per push — the kind of thing
that works for ten items and produces 200-character keys after a year — and the
deeper problem was two implementations of fractional indexing that would have to
agree. `lib/fractional.ts` is the only one.

The RPC still exists because the duplicate check and the insert have to be one
transaction, and because `source` and `proposed_by` must be set the same way
however it is called. It returns null on a duplicate rather than raising: a bulk
push should report what it skipped, not stop at the first repeat.

### D38 — The geocode cache is not couple-scoped

Every other table in the schema hangs off `couple_id`. This one does not:
"lisbon" resolves to the same coordinates for everyone, and a row per couple
would mean more requests to a free service that explicitly asked for fewer. It
holds public place data and nothing about who searched. RLS still applies —
signed-in callers only — so it is not an open endpoint, just a shared one.

### D39 — Leaflet is driven imperatively, and loaded in an effect

No React wrapper. Clustering, custom pins and the route line all want imperative
calls, and wrapping them means two trees arguing about who owns the DOM. The
library is imported inside `useEffect` rather than at module scope because it
reads `window` on load, which is fatal during server rendering — and the canvas
is additionally behind `next/dynamic` with `ssr: false`.

The popup HTML is built by hand, so every interpolated value goes through
`escapeHtml` first. Leaflet sets it with `innerHTML`, and a place title is user
data.

### D40 — `/api/extract` treats the URL it is given as hostile

Reading OpenGraph tags means fetching a URL a user typed, from the server. That
is an open proxy unless it is fenced: http(s) only, private and link-local
address ranges refused, cloud metadata hosts refused by name, redirects followed
by hand — `redirect: 'follow'` would validate the first URL and then go wherever
the chain pointed — a 6-second timeout, and the body read to a 512 KB cap rather
than trusting `content-length`.

A hostname that resolves to a private address still gets through, which is why
the handler returns four parsed tags and never the status or body. Failure is
answered with empties, not an error: the user can type the title.

### D26 — Function EXECUTE was revoked from PUBLIC (migration 0004)

Supabase's linter, run against the live project, showed every helper and
trigger function reachable unauthenticated at `/rest/v1/rpc/<name>`. The cause
is a Postgres default nobody thinks about: a new function grants EXECUTE to
PUBLIC, and `anon` inherits PUBLIC. 0001–0003 granted to `authenticated` and
never revoked the default, which on its own does nothing.

Nothing was exploitable — each one either checks `auth.uid()`, goes through
`is_couple_member()`, or is a trigger function that fails without a NEW record.
But that is a property of today's code, not a guarantee, and the linter was
right to flag it. 0004 revokes from PUBLIC and grants back deliberately, sets a
default privilege so it cannot creep back on future migrations, and pins the
one mutable `search_path`. `health()` stays anon-callable because the
keep-alive cron has no session.

Verified after applying: `has_function_privilege('anon', …)` is false for all
seventeen functions except `health()`.

### D27 — Generated types replaced the hand-written ones

`src/types/database.ts` now comes from `supabase gen types typescript`. Doing
so immediately caught a real mismatch: `create_couple`'s argument has a SQL
default, making it *optional* rather than *nullable*, and the client was
passing an explicit `null`. Passing null to a `text` parameter with a default
is not the same as omitting it.

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
| 8.1 `documents` | Adds `last_alerted_threshold` | Spec 8.4 requires alert dedupe but names no column for it |
| 8.1 `trip_document_requirements` | Adds `is_manual`, drops `is_satisfied` | Satisfaction is derived by `trip_readiness()`, so storing it would be a cache that goes stale the moment a document is edited. `is_manual` distinguishes the implicit passport from what someone added. |
| 8.3 client-side image compression | Not built | The 10 MB cap is enforced in the form and the bucket; compression is an optimisation on top and needs a real photo to tune against |
| 8.3 vault re-auth gate | Not built | Needs the Settings surface for the WebAuthn fallback (Phase 13) |
| 2.2 active flight card | Not built | Flights are Phase 10 |
| 2.1 `dashboard_cache` | Not built | The spec calls it optional and says it will not be needed at this scale. One RPC is currently a single query. |
| 0.1 React 18 + Vite, browser SPA | Next.js 16 App Router, React 19 | D19 — owner's decision |
| 0.9 Edge Functions | Route Handlers in `src/app/api` | D19 |
| 0.2 project structure | Adds `src/app/`, `src/proxy.ts`; drops `main.tsx`, `App.tsx`, `routes.tsx`, `supabase/functions/` | Follows from D19 |
| 1.2 session persisted in localStorage | Cookies via `@supabase/ssr` | D20 |
| 7.1 `wishlist_items` / `wishlist_verdicts` | Add `updated_at` and the `set_updated_at` trigger; `verdict` gets a check constraint | Part 0.3 requires the column on every table; the spec's schema block relies on an application-level enum that the database was not enforcing |
| 7.2 link extraction via an Edge Function | `POST /api/extract` | D19, and D40 for what the handler refuses to fetch |
| 7.3 `getBlend(city)` as a service | `buildBlend()` over the cached list | The whole wishlist is already in memory; a second round trip per city would be a query to compute what a filter computes |
| 7.3 "keep clusters near accommodation on arrival/departure days" | Arrival and departure days are skipped where there is room; no accommodation term | `accommodations` arrives with Module 11. The pacing intent — nothing booked for the afternoon you land — is kept |
| 7.3 "insert a gap after any anchor" | Not modelled | Duration is optional and mostly unset, so nothing distinguishes an anchor yet. The item cap per pace does the same job coarsely |
| 6.2 accommodation and photo layers | Not built | Those modules do not exist yet |
| 6.2 numbered pins "in itinerary order" | Numbered in the order the day's items are returned, which is `sort_key` order | Same thing today; worth revisiting if the map ever sorts by time instead |
| 6.4 `reverseGeocode(lat, lng)` | Not built | Nothing asks for it. Long-press stores raw coordinates and lets the user name the place |

Nothing else diverges. Where the spec gave SQL verbatim, the migration uses it
verbatim.

---

## Open questions

Ordered by how much they block.

1. **Nobody has signed in yet.** The project is live, all four migrations are
   applied, RLS is on across all ten tables and the signup trigger is installed
   on `auth.users` — but `auth.users` is empty, so the end-to-end path (Google →
   profile row → pair → shared data) has never actually run. That is the one
   remaining piece of the spec's Stage 0 gate; the database half is proven by
   `supabase/tests/`.
   Worth double-checking when you first sign in: Supabase's **URL Configuration
   → Redirect URLs** must include `/auth/callback` on whichever origin you use.
   That path is this app's own route, not the Supabase default, and a sign-in
   that completes at Google and then bounces back to `/login` means it is
   missing.
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
8. **The expiry sweep has no scheduler yet.** `crossedThreshold` and
   `shouldAlert` are written and tested, but nothing calls them on a timer.
   They need a cron Route Handler plus a notification channel — which is the
   same infrastructure the flight sweep needs, so both land together in Phase 10.
9. **Deleted storage objects are not swept.** Deleting a document soft-deletes
   the row and deliberately leaves the file, so a mistake is fully recoverable.
   The 30-day hard delete needs the same cron as above.
10. **Health module scope.** The spec says design it together, last. Left alone.
11. **One advisor warning belongs to Supabase, not to us.** The security linter
    flags `public.rls_auto_enable()` as callable by `anon`. It is a
    platform-created event-trigger function that auto-enables RLS on new tables;
    its return type is `event_trigger`, so it cannot be invoked as an RPC at
    all. Left alone deliberately — revoking on an object the platform owns and
    recreates is a fight we would keep losing. Everything else in the report is
    lint 0029, which fires on every SECURITY DEFINER RPC granted to
    `authenticated`, which is what they are for.
12. **Nominatim is the only geocoder, and it is rate-limited to one call a
    second.** The cache and the 600 ms debounce keep us inside the policy for
    two people. It would not survive real traffic, which is Part 16's problem.
13. **`isSamePlace` has never met a false positive.** 150 m is the spec's
    number and it is untuned against real data — a food hall or a large park
    could merge two genuinely different saves. The blend shows how each pair
    was matched so the mistake is at least legible.
