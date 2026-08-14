# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | 12 complete — the budget |
| Next | Phase 13 — Settings (spec Module 14) |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Stack | Next.js 16 App Router, React 19. Migrated from Vite after phase 3 — see D19. |
| Supabase project | `meridian` / `ylrpxrfneonjzctgtnmj`, ap-northeast-1, Postgres 17 |
| Migrations applied | 0001–0012, live |
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

And Phases 8 and 9, which answer the two questions that come before planning
anything: *where* and *for how long*. The destination board puts candidate
cities side by side — flight hours each, who travels further, what the visa
looks like on each passport, the season, the rough cost, how many saved places
are already there, and how much stay allowance each of you has left. Choosing
one sets the trip's timezone. The allowance module counts days properly: the
rolling window is evaluated on every day of a planned stay, not just arrival,
and days in any Schengen member count against the same total.

And Phase 10, the flight engine. Add a flight with a number and a date; watch
it on a map that draws the great circle it actually flies; and — the part worth
building — be told when to leave to meet someone, with the breakdown that makes
the number trustworthy. It works with no API keys at all: manual entry is the
baseline, and "scheduled times only" is a normal state rather than a failure.

And Phase 11, the shared photo library. Drop photos in and they are resized on
the device, land in the grid grouped by the day they were taken, and can be
captioned, favourited, commented on, put in albums, and shared by a link that
expires and can be revoked. Deleting is reversible for thirty days.

And Phase 12, the money. Record what either of you spent, in whatever currency
you spent it, split evenly or exactly or by percentage or not at all; the app
converts it at the rate for that day, fixes it there, and tells you in one
sentence who owes whom. Settle up and the balance resets. A trip summary adds
totals by category and by person, a per-day average over the days the trip
actually ran, budgets where you set them, and — on stays of a fortnight or more
— a per-week view, because a month-long total is hard to reason about. It
exports to CSV. There is no API key involved anywhere in it.

Typecheck, lint, 516 unit tests, 156 database assertions and a production build
pass.

Sign-in is now settled on the server: `src/app/(app)/layout.tsx` redirects an
unauthenticated request before any app JavaScript ships. Pairing and profile
setup stay client-side gates, because they depend on the couple query.

### What is stubbed

- One `Placeholder` route remains: `/settings` (Phase 13).
- Receipt photos on an expense: `receipt_media_id` is on the row and the
  gallery can hold the file, but the expense form has no picker.
- Per-week *budgets*. `period = 'week'` is modelled, constrained and indexed;
  only trip-period budgets can be set from the UI.
- The FX backfill sweep has a route and a secret but no `pg_cron` schedule,
  same as the flight and media sweeps.
- The blend narrows to a city by matching the trip title against the cities in
  the wishlist. It could read the chosen destination now that Module 4 exists;
  it does not yet.
- `airport_routes` is empty, so every flight duration on the board is a
  great-circle estimate. They are marked "est", which is the honest state until
  there is a dataset to seed from.
- `coarseTimezoneFromLongitude` in `lib/geocode.ts` is still a placeholder for
  `tz-lookup`. Choosing a destination sets the trip's timezone only when the
  candidate carries one, and the city search does not return zones.
- The allowance override form is not built. `useUpsertRule` works and the
  policies are proven; the seeded defaults cover the common cases until the
  Settings surface arrives.
- Flight notifications have nowhere to go. `flight_events` records every phase
  change and the sweep that would send them runs, but push needs
  `push_subscriptions` from Module 14.
- No flight API keys are configured, so every flight is manual and the live
  view sits at degradation level 6. That is a supported state, not a broken
  one — `AERODATABOX_API_KEY` and the OpenSky pair in `.env.example` turn it on.
- The gallery grid paginates rather than virtualising. `@tanstack/react-virtual`
  is installed for when a library is big enough to need it.
- Videos are refused by the uploader. The schema, the size cap and a
  poster-frame helper exist; the pipeline does not.
- The daily-exchange strip has its table, logic and hooks but no surface yet.

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

### D41 — Advisory reference data is read-only through the API

`visa_rules` and `airport_routes` have a select policy and no write policy at
all. New rows arrive by migration.

The alternative — letting users edit them — sounds friendly and is not. A
user-editable visa table is a user-editable source of immigration advice, and
the two partners would be reading each other's guesses with a "verified on"
date attached. Personal exceptions have a home already: an `allowance_rules`
override, which is scoped to one person and says so.

### D42 — A missing rule is expensive, never free

Three places make the same choice. `combinedFriction` charges an unknown visa
rule the same as an embassy appointment. The board renders it as "Unknown —
check officially" in warning colour. `checkPlannedStay` returns `untracked`
rather than `ok`, and the UI prints "not tracked", never "no limit".

The failure mode this avoids is specific: someone glances at a green row, books
a flight, and finds out at a border that we had no data. Silence has to look
like silence.

### D43 — `allowance_rules` carries both defaults and overrides

The spec's schema has no owner columns, but 10.2 requires rules to be per
person and editable, because "the user's actual visa may differ from the
generic rule" — which is the case that matters most. So one table holds both:
`couple_id is null` marks a seeded default that everyone reads, and a row with
`couple_id` and `user_id` is that person's override. Two partial unique indexes
keep each side honest, and one select policy covers both.

An override wins over a default. A residence permit is a fact about the person,
and the generic rule for their passport is simply wrong for them.

### D44 — The rolling window is evaluated on every day of a stay

The spec calls this "the part people get wrong", and the wrong version is the
natural one to write: check the total on arrival and call it legal.

A trip can be legal on the day you land and illegal on the day you leave,
because the window slides with you. `checkPlannedStay` walks every day of the
planned stay and returns the first that fails. There is a test for exactly
this — 85 days used, a 10-day trip that is fine on arrival and breaches five
days in — and it is the test that would catch a "simplification" of this
function.

Three conventions decide most of the arithmetic and each is easy to get
backwards: entry and exit days both count, a same-day in-and-out is one day,
and the window includes the day being evaluated.

### D45 — Overlapping log rows are merged before counting

Two rows covering one day is usually a typo, but not always: a same-day hop
between two Schengen countries produces two honest entries. Counting that day
twice would overstate the total against the traveller, so `usedOnFor` merges
first. The overlap is still surfaced on the page as something worth fixing.

Merging also closes a loophole in `per_entry` rules: adjacent stays count as
continuous, so stepping across a border and back does not reset the clock.

### D46 — `window_start` on `allowance_rules`

Added to the spec's schema. The `per_visa` rule type means "days since the visa
was issued", and the spec gives no column for the issue date — the rule cannot
be evaluated without one. Null for every other type, and a `per_visa` rule
without it counts zero rather than inventing a start date.

### D47 — Zone membership lives in `lib/zones.ts` and in the database

`allowance_rules.region_members` is what the seeded Schengen rule counts
against; `SCHENGEN_MEMBERS` in `lib/zones.ts` is what the client uses to pick a
rule before it has fetched one, and what the visa lookup falls back to when
there is no country-specific row.

Two copies of the same list is a smell, and the alternative was worse: fetching
the zone table before rendering a board that mostly needs it to decide which
row to read. Both copies are literal, sorted, and named the same thing, so a
change to one is an obvious change to the other.

### D48 — Scoring normalises across the candidates on screen

A score of 0.72 says "compared to these five", not "out of ten in the world".
That is the only honest reading available without a global dataset, and it
means a single candidate scores the same on every axis — correct, because there
is nothing to compare it with.

Two consequences worth knowing. An unknown value scores 0.5, the middle, so it
neither rewards nor punishes a candidate. And the total is divided by the
weights in play, so the number reads 0..1 whether one slider is up or all six.

Spec 4.3 forbids a bare number and it is right: the breakdown ships with the
total and the UI makes it one tap away.

### D49 — A static climate table, and a cost band that is not a price

Spec 4.3 asks for a season band from a static table, which is free, offline and
never stale. `climate.ts` holds twelve bands per country for the countries
someone might plausibly compare, and returns null for the rest — an unlisted
country shows nothing rather than a temperate guess.

`cost.ts` does the same for daily cost. Spec 4.1 says no pricing and 4.2 wants
a cost row; a band reconciles them. "Portugal is cheaper than Switzerland" is
stable and useful. "€95 a day" would be wrong the moment it was written.

### D50 — The budget lives in the database, not the client

Every decision about whether an API call may happen is made server-side in
`lib/flights/orchestrator.ts`, and the spend it checks against comes from the
`api_usage` table.

Two failure modes make this the only workable place for it. A counter in the
process resets on every cold start, so a serverless function cannot be trusted
to know what the month has cost. And both partners watch the same flight: if
the client decided, two browsers would double every call. Putting the rule
behind one shared row means whoever refreshes first pays and the other one
reads the result.

The manual refresh button goes through exactly the same max-age check as the
automatic tick. Spec 9.14 asks that spamming it twenty times produce at most
one call, and a client-side cooldown alone cannot promise that.

### D51 — Isolation is the robustness property, not retries

`refreshFlight` settles the two providers separately and neither can reject.
OpenSky being down degrades the position and leaves the gate alone; AeroDataBox
being down leaves the aircraft on the map. A shared try/catch would have made
either failure blank both.

This is also why the status route answers 200 with empty arrays when everything
fails: the live view has no error state by design (spec 9.5), and the client
keeps rendering what it already has.

### D52 — Positions are insertable only by the service role

`flight_positions` has a read policy and no write policy at all. Everything
else in this app lets the couple write their own rows; an aircraft location is
different, because a fabricated one is indistinguishable from a real one on the
map and someone is about to drive to an airport on it.

### D53 — An estimated position never looks like a real one

Solid and rotated for a live fix, half-opacity for a stale one, and **hollow
with a dashed outline** for an estimate. Spec 9.7 calls this the single most
important rule in the map layer and it is right: the difference between
informing someone and lying to them while they drive to an airport.

Dead reckoning between fixes is honest for the minute between polls, so the
marker walks its own heading at its own speed rather than teleporting. It stops
after ninety seconds. Extrapolating for an hour would produce a confident
marker in the middle of an ocean, which is what the hollow style exists to
prevent.

### D54 — Great circles by hand, no turf

Spec 9.7 names `@turf/great-circle`. `lib/geo.ts` is forty lines of
trigonometry instead: turf pulls two more packages to produce a GeoJSON feature
we would immediately unwrap, and the antimeridian split — the part that
actually matters — reads better written out than configured.

The split is not cosmetic. Leaflet joins consecutive coordinates by longitude,
so a Tokyo → Los Angeles route drawn naively goes back across Asia and Europe,
the long way round the world. There is a test for that exact route.

### D55 — The hard stop is a cron function, not app logic

`deactivate_finished_flights()` switches tracking off for anything landed,
cancelled, or six hours past its scheduled arrival. The orchestrator applies
the same rule the moment it becomes true, but the database function exists
because the dangerous case is precisely the one the app never sees: a landing
nobody noticed, on a flight nobody opened, polling every sweep until the
month's allowance is gone.

### D56 — The confirmation parser refuses ambiguity

`11/12/2026` is 11 December to half the world and 12 November to the other
half, so `findDate` does not parse bare numeric dates at all. ISO and named
months only. Guessing the convention would put someone at an airport on the
wrong day, and the cost of not guessing is that they type the date.

The flight-number regex has the opposite problem: "at 21:40" matches it
perfectly. A stop-list of two-letter English words handles it, at the cost of
missing Alaska (AS) and Aeroméxico (AM). Worth it — the parse pre-fills a form
the user confirms, so a missed flight costs one line of typing and a phantom
one costs a puzzled correction.

### D57 — `window_start`, `has_checked_bags`, and other columns the spec omitted

Two small additions of the same kind as D46. `has_checked_bags` exists because
the handoff needs it and spec 9.9 reads it without the schema declaring it.
`flights.trip_id` exists because `/trips/:id/flights` is a route in 9.12 and
the journey table alone cannot answer it for a single-leg flight.

### D58 — No original ever reaches storage

The single decision this whole module is built on. Two derivatives per photo —
1600px display at q75 and a 400px thumb at q70 — is about 340 KB, so a
gigabyte holds roughly 2,900 photos. With originals it holds 250.

That is the difference between a library that lasts between trips and one that
fills up on the first one, so `path_original` exists in the schema, stays null,
and the uploader says so in plain words. People assume a photo app keeps the
full-resolution file, and here that assumption is wrong in a way worth stating
rather than hiding.

Processing runs in the browser because it has to: a serverless function has
neither the memory nor the time to decode a 48-megapixel HEIC, and the phone
already has the file open.

### D59 — Egress is a budget too, and the grid is where it is spent

The grid loads thumbs. The lightbox loads one display and preloads at most one
neighbour each way. Nothing in the app asks for both variants of the same
photo. Sixty thumbs at ~40 KB is the spec's three-megabyte page, and the
thumbhash — twenty-five bytes, rendered before any request finishes — is what
makes that page feel instant rather than empty.

Variant paths are content-addressed by media id and therefore never change, so
they are uploaded with a one-year immutable cache header.

### D60 — The upload queue is a pure reducer plus IndexedDB

The acceptance test is fifty photos with a page refresh halfway through, which
rules out holding progress in component state and rules out a promise chain
with retries inside it. So the state machine is a reducer, tested on its own,
and every transition writes to IndexedDB.

What is *not* persisted is the `File` objects — they cannot be serialised, and
a half-uploaded byte stream cannot be resumed after a reload anyway. Anything
in flight comes back as pending and the UI asks for those files again, which is
the honest version of "your queue survived".

One upload at a time. Concurrency would finish a batch marginally sooner and
would also run a phone out of memory decoding two large photos at once.

### D61 — Duplicates prompt, never reject

An 8×8 average hash, and a Hamming distance under 6 means "probably the same
photo". Crude next to a DCT hash and entirely adequate for the only question it
is asked: *did you already upload this one?*

It never decides. Two photos of the same view seconds apart are not the same
photo, and the person who took them is the only one who knows that — so the
queue parks the item and offers "upload anyway" alongside "skip".

### D62 — A share is resolved server-side, so revoking actually revokes

`/api/share/[token]` is the only endpoint in the app that answers without a
session. It checks four things in order — exists, not revoked, not expired,
passcode matches — and only then mints signed URLs valid for fifteen minutes.

It never returns a storage path. That is the whole point: a leaked path keeps
working until someone moves the file, whereas a revoked token stops working on
the next request. The token itself is 32 bytes from `crypto.getRandomValues`,
and every failure returns the same message so guessing gets no feedback.

The database tests found a stronger property than expected here: an anonymous
caller does not read zero rows from `media`, it cannot evaluate the policy at
all, because `is_couple_member` had EXECUTE revoked from `anon` back in 0004.

### D63 — Objects before rows, always

`/api/cron/media-sweep` deletes storage objects first and only then purges the
rows. The spec says so and the reason is worth restating: the row is the only
record of which files exist. Delete it first and the files sit in a bucket with
a one-gigabyte quota, invisible to the app forever.

`expired_media()` therefore returns paths rather than deleting anything, and a
row whose objects could not be removed is deliberately left alone for the next
sweep. Both functions have EXECUTE revoked from `authenticated` — they belong
to cron.

### D64 — A caption's search index is a trigger, not the client's job

`search_tsv` is maintained by a `before insert or update of caption` trigger.
A caption edited from the lightbox, a future bulk tool, or a migration is
searchable without anyone remembering to update a second column — which is the
kind of thing that is remembered for a year and then is not.

### D65 — `redirectTo` is the callback handler, and it is not optional

Sign-in completed at Google and then landed the user back on `/login`, which
looked like a Supabase misconfiguration and was not. `signInWithGoogle`
defaulted `redirectTo` to `${origin}/`. That is a page inside `(app)`, whose
server layout calls `requireUser()`. The PKCE code arrived as a query
parameter, nothing exchanged it, the gate saw no cookie, and it redirected —
correctly — to `/login`. `/auth/callback` was written in Phase 1 and never
actually reached.

The shape of the bug is worth keeping: **only a Route Handler can complete an
OAuth exchange**, because only it can write the session cookie before anything
reads it. A Server Component cannot (`setAll` is a no-op there, which is why
`createServerSupabase` swallows the error), and a Client Component runs after
the gate has already decided. Any future provider goes through
`callbackUrl()` for the same reason.

Three things changed alongside it, all of which existed to make the next
failure legible rather than silent:

- The handler now forwards Google's own `error`/`error_description` instead of
  reporting `missing_code` — a declined consent screen and an origin that is
  not on the allowlist arrive that way, and both used to read identically.
- `/login` renders `?error=`. A bounce with no message now means one specific
  thing (the handler never ran, so the redirect URL is wrong at Supabase); a
  bounce with a message means the handler ran and the message is the reason.
  `docs/SETUP.md`'s troubleshooting table splits the row on exactly that.
- `safeRedirectPath` moved into `logic.ts` with tests. The old inline check was
  `next.startsWith('/')`, which accepts `//evil.example` — a protocol-relative
  URL. An open redirect on a handler that has just minted a session is the
  worst place to have one.

Behind a proxy the redirect origin comes from `x-forwarded-host`, since
`request.url` carries the internal host. The header is only ever used to
rebuild our own origin — the path is always one we chose — so spoofing it
cannot redirect off-site.

### D66 — Three charts by hand, no Recharts

Spec 13.2 names Recharts. This does not use it, for the reason D54 did not use
turf: the library is ~100 KB gzipped and pulls several d3 packages behind it,
and what is needed is a donut, a line and a stacked bar over at most a few
dozen points. `components/charts.tsx` is about two hundred lines of SVG, costs
nothing in the bundle, reads the theme's colours directly rather than being
handed a palette, and scales with the viewport because it is markup.

The donut is drawn as one stroked `circle` per slice with a `stroke-dasharray`
and a cumulative offset, not as arc paths — less arithmetic, and no rounding
seam where two slices meet. All three carry `role="img"` and a written summary,
because a chart that exists only visually is not information, and every number
in them is already on the page as text.

The offsets are computed up front rather than accumulated inside the `map`. A
running total mutated in a render closure is precisely what the React Compiler
refuses, and this is the fifth time in this project that the compiler's
objection pointed at code that was better rewritten than suppressed.

### D67 — The rate is fixed at save time, and the cache is absolute

Two rules, and everything else in Module 13 follows from them.

**A past expense's converted value never changes.** `amount_base`, `fx_rate`
and `fx_date` are written once, at save time, and no read path recomputes
them. Rates move; a balance that moves with them is not a balance. A
`fx_all_or_nothing` constraint keeps the three columns together, so there can
never be a converted amount whose rate nobody can point at.

**A past date's rate cannot change either**, so `fx_rates` is a permanent
cache rather than a TTL one, and a miss is the only reason to call anybody.
The provider is Frankfurter — European Central Bank reference rates, free, no
key, historical dates served directly. Keylessness is worth something on its
own here: it is one fewer secret to leak and one fewer thing to expire.

The ECB publishes on working days, so a weekend has no rate of its own.
Frankfurter answers with the previous working day and says which; the handler
writes the row under *both* that date and the date asked for, otherwise every
future lookup for that Saturday calls out again.

Three consequences worth stating:

- **The browser cannot write `fx_rates`.** `geocode_cache` lets signed-in users
  write; this does not. A poisoned geocode is a pin in the wrong place, a
  poisoned rate is a wrong number in someone's balance. Select policy, no
  insert policy, service role only, asserted in the RLS test.
- **A failed lookup does not fail the save.** The expense is recorded with all
  three FX columns null, and `amount_base is null` is both the retry flag and
  the entire working set of `/api/cron/fx-backfill`. No second flag column to
  drift out of sync with the first.
- **Every screen that totals money reports what it could not convert**, rather
  than treating an unconverted row as zero. A total that is quietly missing an
  expense is worse than one that says it is incomplete.

### D68 — Money is integer cents, and splits sum exactly

`numeric(12,2)` arrives in JavaScript as a number, and 0.1 + 0.2 is not 0.3.
Thirty expenses summed in floating point drift, and the drift lands in the one
number a person reads and acts on. So every operation in `logic.ts` converts to
cents, works in integers, and converts back once at the edge.

`shares()` sums to the expense total **exactly**, not to within a cent. Where a
division leaves a remainder the payer absorbs it: they are the one out of
pocket, so rounding in their favour never leaves the other person owing a cent
they did not agree to. €10.01 splits 5.01 / 5.00, which is spec 13.7's
acceptance criterion stated as arithmetic.

Two subtleties that are easy to get wrong and are therefore tested:

- **Shares are computed on the original amount and then scaled to base**, not
  by splitting `amount_base` directly. Splitting after conversion puts the odd
  cent somewhere the receipt does not agree with.
- **The per-day average is over elapsed days, not days with spending.** A
  zero-spend day is still a day of the trip; averaging it away flatters the
  number. When the trip's dates are known the route hands them down, so the
  span comes from the trip rather than from whichever days happen to have rows.

Validation rejects rather than rounds, as spec 13.3 requires, and the message
names the shortfall — "that leaves 10.00 unaccounted for", not "invalid split".

### D26 — Function EXECUTE was revoked from PUBLIC (migration 0004)

Supabase's linter, run against the live project, showed every helper and
trigger function reachable unauthenticated at `/rest/v1/rpc/<name>`. The cause
is a Postgres default nobody thinks about: a new function grants EXECUTE to
PUBLIC, and `anon` inherits PUBLIC. 0001–0003 granted to `authenticated` and
never revoked the default, which on its own does nothing.

**Revisited in 0012.** Revoking from PUBLIC was not the whole fix. Supabase
sets `ALTER DEFAULT PRIVILEGES` granting EXECUTE on new functions to `anon` and
`authenticated` *directly*, so a function added after 0004 is reachable at
`/rest/v1/rpc/<name>` regardless of the PUBLIC default. The advisor caught
`seed_expense_categories()` immediately; the fix is to name all three roles in
the revoke, which 0012 does. It also revokes `rls_auto_enable()` — Supabase's
own event trigger, which is what has been enabling RLS on every table at
creation, and which nobody should be able to call.

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
| 4.1 `trip_destinations` | Adds `updated_at`, `created_by`, `deleted_at`, and a unique index enforcing one chosen destination per trip | Part 0.3 requires the columns; the index makes the RPC's invariant true even for a direct write |
| 4.1 `visa_rules` / `airport_routes` "public read, no RLS write" | Select policy for signed-in users only, no write policy | D41. Anonymous read would expose the whole advisory table to the internet for nothing |
| 4.2 scoring weights "persisted per couple" | Own table, `destination_weights` | `couple_settings` belongs to Module 14; inventing half of it here would make that migration a merge |
| 4.2 timezone from `tz-lookup` | Not built | The city search returns a country, not a zone. Choosing a destination sets the trip's timezone only when the candidate carries one |
| 4.2 rough daily cost band | Static table, four bands, no currency | Spec 4.1 forbids pricing and 4.2 wants the row. See D49 |
| 4.3 `airport_routes` cache | Table exists, empty | Nothing to seed it from yet, so every duration is an estimate and marked as one |
| 10.1 `allowance_rules` | Adds `couple_id`, `user_id`, `label`, `notes`, `window_start`; adds a `'none'` rule type | D43 and D46. Spec 10.2 requires per-person editable rules and 10.6 requires a resident/PR case, neither of which the schema block supports |
| 10.1 `entry_exit_log` | Adds `updated_at` | Part 0.3 |
| 10.2 rule setup UI | Not built | The policies and mutation exist and are tested; the form waits for Settings (Phase 13) |
| 10.4 `getAllowanceStatus` as a service | `statusFor()` over data already fetched | The check has to render inline on the board, once per candidate. A round trip each would make that screen crawl |
| 9.3 `flights` | Adds `trip_id`, `created_by`, `deleted_at` | D57. `/trips/:id/flights` needs a direct link for single-leg flights |
| 9.7 `@turf/great-circle` | Hand-written in `lib/geo.ts` | D54 |
| 9.4 one Edge Function | Route Handler plus a shared orchestrator in `lib/flights/` | D19, and so the on-demand path and the cron sweep cannot drift apart on the budget rules |
| 9.8 notifications | Events recorded, nothing sent | No push channel until `push_subscriptions` (Module 14) |
| 9.8 screenshot/PDF parsing | Not built | Needs the AI module; the spec marks it optional |
| 9.9 `estimateDrive` | Great circle × 1.4 ÷ 45 km/h, labelled an estimate | Exactly what the spec prescribes without a routing key; one function to swap if one appears |
| 11.1 `media` | Adds `updated_at` | Part 0.3 |
| 11.1 `albums`, `media_comments`, `share_links` | Add `updated_at` | Same |
| 11.3 virtualised grid | Paginated instead | 60 a page already keeps the payload inside the spec's own budget; `@tanstack/react-virtual` is installed for when a library outgrows it |
| 11.3 video support | Refused by the uploader | Schema, cap and a poster-frame helper exist; the pipeline does not, and a broken video is worse than an unsupported one |
| 11.3 daily-exchange strip | Table, logic and hooks only | The surface is a small piece of UI and was left for the same pass as the recap screen |
| 11.4 phash | 8×8 average hash, not DCT | D61 — enough for a prompt, and it never rejects anything on its own |
| 11.5 `uploadMedia` returns an observable queue | A reducer plus a hook | D60 |
| 13.1 `expenses`, `expense_categories`, `budgets` | Add `updated_at`, `created_by`, `couple_id` where the block omitted them | Part 0.3 requires them on every couple-scoped table |
| 13.1 `settlements` | Adds `deleted_at` | A settlement is a record that money changed hands; deleting one silently moves both people's balance |
| 13.1 `unique (trip_id, category_id, period)` | Two partial unique indexes | In Postgres every null is distinct, so the spec's constraint would have let a trip collect any number of overall budgets. The RLS test asserts both halves |
| 13.2 Recharts | Hand-written SVG | D66 |
| 13.3 `fx_rates[base][currency][date]` via exchangerate.host | Frankfurter (ECB), same cache shape | No key, free, serves historical dates. D67 |
| 13.4 `getBalance` / `getTripSummary` as services | Derived in hooks from rows already fetched | The list beside them holds the same rows; a second source of truth for a number this consequential is how the two end up disagreeing on screen |

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
14. **The seeded visa and allowance rules need a human to verify them.** They
    are a small, deliberately conservative starting set, each with a source
    link and a checked-on date, and every surface that renders one carries the
    advisory line. That is the right structure — but structure is not accuracy.
    Before either of you relies on a row, open its source. Rules change with no
    notice, and the app has no way to learn that they have.
15. **Nothing re-checks `verified_on`.** A rule checked two years ago looks
    exactly like one checked yesterday apart from the date. A staleness badge
    past, say, six months would be a few lines and is worth adding once these
    have been in use long enough to go stale.
16. **The blend still guesses a city from the trip title.** Now that a trip can
    have a chosen destination, it should read that instead. One-line change,
    left alone in this pass to keep Phase 8 reviewable on its own.
17. **The `pg_cron` schedule for the flight sweep is not created.** The route,
    its secret and the hard-stop function all exist and are tested; scheduling
    it is one `cron.schedule` statement, and it wants a deployed URL to point
    at. Until then the sweep only runs if something calls it.
18. **Nothing has flown yet.** Every flight path is exercised by unit tests
    against fixtures, and the provider adapters have never spoken to a real
    AeroDataBox or OpenSky response. The field mapping in
    `lib/flights/providers.ts` is written from their documented shapes and
    should be treated as unverified until a real flight goes through it.
19. **No photo has been uploaded.** The pipeline is exercised by unit tests
    over the pure parts — dedupe, grouping, bucketing, the queue — but Canvas,
    EXIF and HEIC conversion have never run against a real file in a real
    browser. Expect the first fifty-photo batch to surface something.
20. **The share route has never been hit by a browser other than this app.**
    The checks are unit-reasoned and the RLS around them is proven, but the
    end-to-end "open the link on a phone with no session" path is untested.
21. **Allowance alerts are not on the dashboard yet.** Priority 3 in the alert
    strip has been reserved for them since Phase 5, and `checkPlannedStay` can
    now fill it. It needs the dashboard RPC to return upcoming trips with their
    destination country, which it does not.
