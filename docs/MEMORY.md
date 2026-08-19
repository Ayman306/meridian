# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | **All 14 done. Sweeps scheduled.** |
| Next | Two operator steps below, then use it. The rest is the deferred list in `PHASES.md`. |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Stack | Next.js 16 App Router, React 19. Migrated from Vite after phase 3 — see D19. |
| Supabase project | `meridian` / `ylrpxrfneonjzctgtnmj`, ap-northeast-1, Postgres 17 |
| Migrations applied | 0001–0020, live |
| Deployed | Vercel, `meridian-ay-za.vercel.app` |

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

Opening a trip now shows the trip rather than a form: a map with the route it
traces, a strip of every day with its flights, its density, where they sleep
and — for whoever is looking — their own cycle marks, and one day's detail in a
panel that does not push the page down. Saved places near *that night's hotel*
are offered on the day already in view, one tap to add. See D96–D103.

Accommodation is modelled (0020): bookings with dates, a resolved address and
the booking reference, with the nights nobody has booked counted for you. The
one rule to know is that `check_out` is exclusive — a stay covers nights, not
days.

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

And Phase 13, which decides who sees any of it. An invite is issued to an email
address rather than being eight characters anyone can pass on, and membership
carries a role and a list of modules — enforced in the database, so a friend
without the money grant gets no rows rather than a hidden menu item. Documents,
stay allowance and health can never be shared outside the couple at all.
Settings collects the rest: shared preferences, personal ones, work hours,
notification choices, and leaving.

And Phase 14, health — the only module where being in the couple grants
nothing. Everything is private until a scope is explicitly shared, revoking is
one click and takes effect on the partner's next query, and deleting is
immediate and permanent. The cycle estimate always carries its variance, an
irregular cycle is shown as a range rather than a date, and the border-
restriction check links to the official page and never says whether anything is
allowed.

And 0015 made it run unattended: the three sweeps are on pg_cron, and the
dashboard finally fills the stay-allowance slot it reserved back in phase 5.

Typecheck, lint, 774 unit tests, 206 database assertions and a production build
pass.

### The two operator steps left

1. **Vercel Deployment Protection answers 401** to every server-to-server call
   — all three sweeps, and the GitHub Actions keep-alive that stops the free
   Supabase project auto-pausing. Either turn protection off for production, or
   issue a Protection Bypass token and store it as the `vercel_bypass_token`
   Vault secret and the `VERCEL_BYPASS_TOKEN` repository secret. Both paths are
   already supported in code.
2. **`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` on Vercel.** Without the
   first, `/api/fx` throws and every foreign-currency expense saves unconverted
   — quietly, since the client treats a failed lookup as a normal degraded
   state. `CRON_SECRET` must equal the `cron_secret` Vault secret; read it with
   `select decrypted_secret from vault.decrypted_secrets where name =
   'cron_secret'`.

Sign-in is now settled on the server: `src/app/(app)/layout.tsx` redirects an
unauthenticated request before any app JavaScript ships. Pairing and profile
setup stay client-side gates, because they depend on the couple query.

### What is stubbed

- No `Placeholder` routes remain. Every route in the spec exists.
- Receipt photos on an expense: `receipt_media_id` is on the row and the
  gallery can hold the file, but the expense form has no picker.
- Per-week *budgets*. `period = 'week'` is modelled, constrained and indexed;
  only trip-period budgets can be set from the UI.
- All three sweeps are scheduled (0015) and fire, but the app answers 401
  until Vercel Deployment Protection is resolved. See D73.
- The blend narrows to a city by matching the trip title against the cities in
  the wishlist. It could read the chosen destination now that Module 4 exists;
  it does not yet.
- `airport_routes` is empty, so every flight duration on the board is a
  great-circle estimate. They are marked "est", which is the honest state until
  there is a dataset to seed from.
- `coarseTimezoneFromLongitude` in `lib/geocode.ts` is still a placeholder for
  `tz-lookup`. Choosing a destination sets the trip's timezone only when the
  candidate carries one, and the city search does not return zones.
- The allowance override form is still not built. `useUpsertRule` works and the
  policies are proven; the seeded defaults cover the common cases.
- Flight notifications still have nowhere to go. `push_subscriptions` exists
  now and the per-category toggles are in Settings, but there is no service
  worker and nothing is sent.
- Flight tracking is live once `AERODATABOX_API_KEY` is set on Vercel. Without
  it every flight is manual and the live view sits at degradation level 6 —
  a supported state, not a broken one. Spend is capped at 550 of 600 a month
  and reconciled against the provider's own balance. See D79.
- The gallery grid paginates rather than virtualising. `@tanstack/react-virtual`
  is installed for when a library is big enough to need it.
- Videos are refused by the uploader. The schema, the size cap and a
  poster-frame helper exist; the pipeline does not.
- The daily-exchange strip has its table, logic and hooks but no surface yet.
- Group spaces are expressible in the schema — `couples.kind`, roles, grants,
  a partner-only size cap — but there is no way to create one and no switcher.
- The health cycle calendar is a history list, not a month grid, and predicted
  dates do not yet appear on the trip calendar.

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

### D69 — An invite code was a bearer token, and is not any more

Sign-in worked, so the hole was easy to miss: `join_couple(code)` admitted
whoever presented eight valid characters. A code read aloud on a call, pasted
into a chat, or left in a screenshot was a way into somebody's passport
numbers.

Invites are now rows issued to an email address, and `join_couple` compares
that address against the one on the account actually signing in — read from
`auth.users` under definer rights, never from anything the client can set. A
valid, live, unexpired code presented by the wrong person raises
`EMAIL_MISMATCH`, and the UI says exactly that rather than "wrong code", which
would send somebody hunting for a typo that is not there.

Two supporting properties: one live invite per address per space, superseded
on re-invite so revoking cannot leave an older code working; and nobody can
select an invite by code through the API — resolution happens inside the RPC,
so a code cannot even be confirmed to exist by someone it was not sent to.

### D70 — Module grants are RLS, not a hidden nav item

A friend along for one trip has no business in the document vault. So
`couple_members` carries a role and a grant list, and **every module-scoped
policy was rebuilt on `can_see(couple_id, module)`**. A guest without `money`
does not get an empty expenses screen; they get zero rows from the database
however they ask. `AccessProvider` filters the nav from `my_modules()`, so the
hidden link and the unreadable table answer to the same row.

Documents, stay allowance and health are refused to any non-couple role
outright, by one function called from both the invite path and the membership
trigger — the mistake is caught while somebody is looking at it, *and* a
hand-written row cannot get past the first check.

Two bugs this turned up, both mine, both in the migration that introduced it:

- **Creating a policy under a new name does not replace the old one.** Postgres
  ORs every policy that applies, so a permissive `couple write` added beside
  0007's `write own` would have handed every member edit rights over each
  other's wishlist saves. Every policy now reuses its original name and keeps
  whatever extra condition it already carried. This is the single easiest way
  to loosen RLS while believing you tightened it.
- **The two-person cap counted members, not partners**, so a couple plus one
  friend was "full". It counts owning roles now, which is the rule D1's
  guarantee actually rests on.

The shape is deliberately more general than a couple — `couples.kind`, a
partner-only size cap, one-*couple*-per-user rather than one-space-per-user —
so trip groups can be added without rewriting every policy a third time.

### D71 — Health is the one module where membership grants nothing

Every other table in this app is couple-scoped: if you are in the couple, you
can read it. `0014` has no policy keyed on `is_couple_member` and none keyed on
`can_see` either. The owner reads their own rows; a partner reads a scope only
while an unrevoked consent row says so.

The module grant and the consent are independent on purpose: granting somebody
the health module lets them open the screen, and gets them no data at all.

Three consequences worth stating, all from spec 12.6:

- **Revocation is instant**, because `revoked_at` is checked inside the policy.
  There is no cache to expire and no job to run — the partner's very next query
  returns nothing. Asserted directly in the RLS test.
- **A viewer has no write policy at all.** Read-only by construction rather
  than by convention.
- **Deletion is hard.** No `deleted_at` exists anywhere in this module — the
  one place the house rule about soft-deleting anything a user would regret
  losing is deliberately reversed. Somebody deleting their health data means
  it, and it happens in one RPC transaction so a partial failure cannot leave
  them believing they erased something they had not.

`health_consents` is readable only by its owner, which is why the partner view
cannot tell "not shared" from "nothing logged" — and says so, rather than
guessing. "What does my partner track?" is not a question this app answers.

### D72 — A prediction that cannot be rendered without its caveat

Spec 12.3 says never present a prediction without the variance and the estimate
label. Making that a rule to remember would mean losing it the first time a
component only wanted the date, so `Prediction` is a union: the "no" case
carries a reason and no date at all, and the "yes" case carries `variance`,
`earliest`, `latest` and an `isEstimate` that has no false branch. Rendering
goes through `describePrediction`, which produces a range for an irregular
cycle and never a day.

Nothing in the module computes fertility or ovulation, and nothing decides
whether a medication may be carried. The restriction helpers match a name,
state that restrictions exist in that country, and hand back the official link.
No data reads "not checked" — never "safe" — and that copy is asserted in a
test, because the copy is the feature.

### D73 — The sweeps had routes and no schedule, and one of them costs money

Three cron routes existed and nothing ever called them. That is not a
tidiness problem for the flight one: without `deactivate_finished_flights`
firing, a flight whose landing was missed polls AeroDataBox until the month's
600 units are gone. 0015 schedules all three with pg_cron, calling back into
the app through pg_net.

The base URL and the shared secret live in Vault, not in the migration — a
migration is committed to a public repository and a shared secret in one is
not a secret. `invoke_sweep()` reads them per call, so rotating is one
`vault.update_secret` and no re-scheduling.

**Firing one by hand immediately found something no test would have.** Vercel
Deployment Protection answers 401 to any request without a browser session,
which is every one of these calls *and* the GitHub Actions keep-alive that
stops the free Supabase project auto-pausing. Both now optionally send
`x-vercel-protection-bypass`, so either resolution — turning protection off
for production, or issuing a bypass token — works.

### D74 — pg_net's grants, and the limit of what could be closed

Enabling pg_net creates a `net` schema whose functions Supabase grants to
`anon` and `authenticated`. On paper that lets the key shipped in the browser
bundle ask the database to make an HTTP request: SSRF with the database's
network position.

It could not be revoked. Those grants were made by `supabase_admin`, and a
role can only revoke what it granted — running as `postgres`, the revoke
silently no-ops. Worth recording precisely, because the first two attempts
looked like they had worked until the privilege was re-checked.

What keeps it closed is that PostgREST only routes schemas on the project's
exposed list, which defaults to `public, graphql_public`. `net` is not on it.
**The standing check:** Project Settings → API → Exposed schemas. If `net`
ever appears, remove it; do not rely on the grants.

This is the third time the same lesson has bitten in this codebase (0004,
0012, and here): revoking from `anon` and `authenticated` does nothing while
`PUBLIC` still holds the grant, and revoking anything does nothing if you did
not grant it.

### D75 — Priority 3 was reserved for two phases and never filled

The dashboard has carried a `stay_allowance` alert kind and a priority slot
since phase 5, and nothing ever built one. So the allowance module could
compute — correctly, and with tests — that a planned trip would put somebody
over a Schengen limit, and the screen people open most never mentioned it.
Knowing something with real-world consequences and not saying it is worse
than never having computed it.

`allowanceAlert()` fills the slot. It returns null for `ok` *and* for
`untracked`: there is no rule for that country, and inventing reassurance from
an absence is what this module refuses to do everywhere else.

It is built in a separate hook rather than added to the `dashboard()` payload,
because it needs the allowance rules and the entry log — two more queries, for
a warning that is usually absent. Adding the country to the RPC would have
meant restating a hundred and forty lines of JSON construction in a second
migration and maintaining both.

### D76 — A flight with no endpoints is not a flight

`flights` has carried `origin_iata`, `origin_lat` and `origin_tz` since 0010
and nothing in the app could fill them. The Add Flight form asked for a
number, a date, two times and a traveller — no airports. The only thing that
could supply a route was the AeroDataBox lookup, and with no key configured,
which is the documented supported baseline, every flight saved null: `??? →
???`, no great circle, no meeting time.

Manual entry is this module's baseline, so the baseline has to be able to name
an airport. 0016 adds an `airports` reference table with ~135 rows carrying
coordinates and IANA zones — seeded by migration, read by anyone signed in,
written by nobody, the same shape as `visa_rules` and
`medication_restrictions`. An airport not in the table still saves; it just
carries no coordinates, which degrades the map rather than the flight.

Two further bugs surfaced, either of which would have kept the map blank even
with a working key: the insert never wrote `origin_lat`/`lng` at all, and
typed times were parsed in the *browser's* zone. "Departs 11:25 from Dubai"
means 11:25 in Dubai whoever is typing it — which, for this app's users, is
usually somebody who is not in Dubai.

### D77 — Legs belong to a journey, and that is what makes a layover checkable

The module could hold single flights with no way to say two were the same
booking, which fails the ordinary case: a return ticket with a connection is
four flights, one reference, two directions.

The schema already modelled it — `journeys` has `direction` and `booking_ref`,
`flights` has `journey_id` and `leg_index` — and `addJourney` had no caller.
`JourneyBuilder` uses it: one screen that adapts rather than branching, where
a new leg prefills its origin from the previous leg's destination and turning
on "return" seeds the way home from the way out reversed.

The payoff is that **`connectionRisk` finally renders**. It was written and
tested in phase 10 and never shown, because nothing knew which flights
connected. Connections are treated as international, taking the 90-minute
minimum: the flight row carries an IATA code and no country, so it cannot be
decided there, and of the two wrong answers, warning about a short domestic
layover beats silence on a short international one.

`summariseJourney` orders by `leg_index` rather than by time, so a leg with no
times yet still sits in the right place while a booking is being entered.

### D78 — The cycle section is a default, not a rule; the fertile window is arithmetic

Two decisions that could each have gone badly.

**Who sees it.** `profiles.gender` sets the default, because showing period
tracking to somebody who does not menstruate is noise. But gender is not the
same question as "do you want to track this" — a woman past menopause, on
continuous contraception, or simply uninterested should be able to turn it
off, and somebody the default would hide it from should be able to turn it on.
So `tracks_cycle` is a nullable override that always wins. A hard gender gate
would be un-overridable and wrong for real people.

**What it predicts.** Spec 12.2 rules out fertility guidance. This adds the
estimated window every mainstream cycle app shows and no guidance at all:
ovulation placed a luteal phase before the next expected period, the five days
before to one day after around it, labelled an estimate in every branch and
inheriting the cycle's variance.

The line, asserted in a test rather than trusted: it never says a day is safe,
never mentions contraception, never advises on conceiving. It reports the
arithmetic and stops.

Calendar arithmetic is not a measurement — ovulation is observed with basal
temperature or an LH test. So `cycle_logs.ovulation_on` exists: what she
records replaces the estimate for that cycle *and* the next estimate derives
its luteal length from it, falling back to 14 days when the derived figure is
implausible. Predicted, corrected, and the correction feeds forward.

### D79 — The spend ceiling is a number, and our counter is not the only source

The guard stopped at 600 × 0.9 = 540: the right ballpark by accident, because
a ratio is not the thing being promised. `HARD_CAPS` is an explicit 550, with
`LIMITS` kept as the billed figure so the pair reads as "550 of the 600 we pay
for". The fifty between them is headroom, not padding — a call can reach the
provider and fail before it is recorded.

Which is the real point: `api_usage` **can only undercount**. It misses a call
that succeeded upstream and failed on our side, anything else using the key,
and everything if the table is cleared. Undercounting is the direction that
costs money.

So above 70% of the cap the guard reads the provider's own balance and refuses
below fifty remaining whatever our arithmetic says. That check is itself
budgeted — the balance endpoint may be metered, and a guard that burns quota
to check quota is self-defeating — so it is cached six hours in
`provider_quota` (0018) and only consulted near the ceiling. Normal months:
zero extra calls. RapidAPI's response headers are preferred where present,
since they cost nothing.

A test now walks `src/`, `supabase/` and `.env.example` and fails on anything
key-shaped or on any `NEXT_PUBLIC_` variable whose name implies a secret. The
pattern is verified against a real key shape so it cannot pass vacuously. A
key committed once is in every clone and every branch forever, and `git rm`
does not remove it from history.

### D80 — `SIGNED_IN` does not mean somebody signed in

Switching tabs, or away to another app and back, made the whole app appear to
reload: every screen dropped to its skeleton and refetched. It was blamed on
Vercel, which is worth recording because it was entirely client-side and
reproduced on `npm run dev`.

`AuthProvider` cleared the TanStack cache on the event name:

```ts
if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') queryClient.clear()
```

That reads correctly and is wrong, because `SIGNED_IN` is not the event
supabase-js's name suggests. `_onVisibilityChanged` calls `_recoverAndRefresh`
on every `visibilitychange`, and its ordinary path — session present, nowhere
near expiry — ends in `_notifyAllSubscribers('SIGNED_IN', currentSession)`.
It is re-broadcast to sibling tabs over a BroadcastChannel too. So every tab
focus emptied the entire cache, `CoupleProvider.isLoading` and
`AccessProvider.isLoading` went true, and the shell blanked with them.

The cache is stale when the *identity* behind it changes, so `identityChanged`
compares user ids held in a ref. Sign-in, sign-out and switching accounts still
clear; a focus, a token refresh and a cross-tab echo do not. The provider also
holds the previous `Session` object when the id and access token both match, so
a focus no longer re-renders every `useAuth` consumer.

`refetchOnWindowFocus: true` stays on — it is wanted, and it is not what caused
this. A background refetch keeps `data`, so `isLoading` stays false and nothing
flashes. It was the `clear()` that removed the data underneath it, and no
component gates a skeleton on `isFetching`.

### D81 — An assistant gets a credential of its own, and RLS still decides

The MCP server runs outside the browser and has to act as one person. Three
ways that could have gone:

1. **Hand it the service-role key.** Bypasses RLS, which would make application
   code the only thing between a prompt-injected instruction in a pasted
   itinerary and every couple's rows. Refused outright — non-negotiable #1.
2. **Copy a browser refresh token out of devtools.** Works, and it is the whole
   session: no scope, no name, no expiry anybody can see, and revoking it means
   signing out everywhere.
3. **A personal access token, exchanged for a short-lived user JWT.** What was
   built, on the user's own suggestion.

`access_tokens` (0019) holds a name, a scope, and the SHA-256 of a token —
never the token. `/api/mcp/token` verifies a presented one and returns a
**ten-minute JWT** with that user's `sub` and the ordinary `authenticated`
role, signed with `SUPABASE_JWT_SECRET`. Everything after that is a normal
PostgREST request under the normal policies. The service role appears once, in
that handler, to answer *which user is this* — and it returns a JWT, never
data. A test asserts it is not reachable from anywhere under `src/mcp`.

Two things the database enforces rather than the UI. The `token_hash` column is
unreadable: `revoke select` had to be **table-level** with the safe columns
granted back by name, because default privileges hand `authenticated` a
table-wide SELECT and a column-level revoke against that is silently useless —
the RLS suite caught this. And a partner cannot revoke somebody's token; the
test for it asserts the token survives rather than expecting an error, because
RLS filters rows out of an UPDATE instead of refusing it.

### D82 — The tray is the write path, and health is not a scope

`suggest_itinerary` writes to `suggestion_tray` with `source: 'ai'` — the value
0003 reserved and nothing had ever used. It does not touch `itinerary_items`,
and a test greps the tool sources to keep it that way. The tool description
tells the model in as many words that the plan was *not* changed, because a
model that thinks it wrote will report back that it did, and the person finds
out later.

`add_wishlist_item` and `log_expense` write directly. The line is who is
deciding: a generated day-plan is the assistant's proposal and belongs in the
tray; "add the ramen place my sister mentioned" is the person dictating, and
routing their own sentence through a review queue is ceremony.

Health and documents are not merely off by default — `FORBIDDEN_MODULES`
refuses them, no tool declares them, and two tests fail if that changes: one on
the declared module, one grepping for `cycle_logs` and friends in case a tool
is mislabelled. Allowance is sensitive too but is somebody's immigration
history rather than a secret, so it can be scoped to on purpose.

Ten tools, five modules. No LLM key is needed anywhere in Meridian for this —
the intelligence is the client's — so `NEXT_PUBLIC_ENABLE_AI=false` remains
true and non-negotiable #8 holds for free.

### D83 — The service worker caches shared bytes and nothing else

Making this a PWA meant deciding what may live on a device, and the honest
answer turned out to be narrower than the obvious one.

**HTML pages are not cached.** Tempting, and wrong here: `/trips/[id]/money` is
a Server Component that reads the trip server-side, so a page can carry one
person's data in its markup. A Cache Storage bucket is per-origin, not
per-account, so a cached page can outlive a sign-out and be served to whoever
signs in next on a shared device. Navigations go to the network and fall back
to `/offline` — which says the connection is gone rather than showing a plan
that may have changed.

Cached: `/_next/static/*` (content-hashed, so a URL never changes meaning),
the icons, the manifest, the offline page. Never cached: anything on the
Supabase host, `/api/*`, any URL carrying a `token`/signature parameter — those
are the 300-second signed URLs from non-negotiable #3, and caching one keeps a
credential alive past its window — any request with an `Authorization` header,
and every non-GET.

`sw.test.ts` loads the real `public/sw.js` in a VM and exercises its actual
predicates, rather than re-implementing the deny-list in a test that would pass
forever while the shipped worker drifted. A live Playwright run then asserted
the same thing from the other end: after loading the app on three device
profiles, no Supabase or `/api` entry existed in any cache.

So offline is deliberately shallow. Real offline reads would need a per-account
encrypted store, which is a different feature with different risks.

### D84 — Installing is three cases, not a boolean

There is no cross-browser way to offer an install. Chromium fires
`beforeinstallprompt` and hands over a `prompt()`; Safari fires nothing and has
no API, so installing means the user finding Share → Add to Home Screen; desktop
Firefox does not install web apps at all. `installOffer` therefore returns
`prompt`, `manual` or `hidden`, and the banner renders a button, instructions,
or nothing.

Shown once. Dismissal is remembered, but `installed` is checked first and wins,
because the two can disagree — somebody who installed from the browser's own
menu never touched our banner, and `appinstalled` is what catches that.

Two detections that are easy to get wrong and are pinned by tests: an iPad has
reported a desktop Safari UA since iPadOS 13, so without a touch-point check
every iPad is told it cannot install; and Chrome and Firefox on iOS are WebKit
underneath but their share sheets have no Add to Home Screen, so the
instructions are shown only to Safari proper.

### D85 — Installing the app exposed two layout bugs that a browser tab hid

Neither was caused by this work; both would have shipped as "the installed app
is broken".

The mobile tab bar sat at `bottom-0` with no `env(safe-area-inset-bottom)`, so
its last row rendered underneath the home indicator on any modern iPhone. In a
browser tab the toolbar absorbs that strip, which is exactly why nobody had
noticed — in standalone mode there is no toolbar.

And `appleWebApp.statusBarStyle` was set to `black-translucent`, which hands the
page the strip under the clock and requires every sticky header to add its own
top inset. The header had none. Changed to `default`, which has iOS reserve the
space — same result, nothing to get wrong.

Also: Next 16 emits only the standardised `mobile-web-app-capable`, which Apple
did not originally implement, so `apple-mobile-web-app-capable` is emitted
alongside it via `metadata.other`. Without it an older iPhone opens the
installed icon in a Safari window with the address bar still showing.

The install banner is pinned above the tab bar via a `--bottom-nav-height`
custom property that AppShell sets on `<html>` while mounted, rather than a
hard-coded `4rem` — sign-in and the offline page have no tab bar, and a banner
hovering over a phantom one looks broken.

### D86 — A notification has to be worth the interruption

Push finally has somewhere to go: `push_subscriptions` has existed since 0013
with nothing sending to it. Consent is enforced inside `sendPushTo` against the
`notify_*` columns rather than at each call site, so the only way to send
something unwanted is to delete that check.

The bar for sending is high on purpose. This app exists because two people are
in different places, so a notification often arrives at four in the morning for
one of them. `flightNotification` fires only on take-off, landing, diversion,
cancellation, or a departure time moving by fifteen minutes or more — and it
compares against what we previously believed rather than the schedule, so a
flight already known to be an hour late does not re-notify for another two
minutes. Everything else is visible in the app.

Every message is tagged with the flight id, so three slips leave one
notification showing the current answer rather than a history of the slippage.
Endpoints returning 404 or 410 are deleted: the push service is saying that
browser is gone, and retrying forever against it is the alternative.

### D87 — The MCP server covers the app, and the tray rule got sharper

The first cut was ten tools over five modules, mostly reads — against 175 api
functions over fourteen. Trips could be listed but not created, the itinerary
could be read but not edited, flights had no writes at all, and destinations,
allowance, health and documents had nothing. Thirty tools over eight modules
now.

Expanding it forced the tray rule to be stated more precisely than "nothing
auto-inserts". The rule was never about inserts — it is about *generated*
content. A model that invents a week and writes it into a shared plan produces
a trip nobody agreed to; "put dinner at Cafe Younes on the Tuesday" is one
thing the person already decided, and routing their own sentence through a
review queue is ceremony.

So the invariant changed shape. It used to be "no tool inserts into
`itinerary_items`". It is now two: only the itinerary module may write them at
all, and **no direct-write trips tool may accept a list of items** — bulk means
generated, and generated means the tray. `add_journey` still takes its legs as
an array, because a connection is one booking and splitting it would let half a
journey exist, which is why that invariant is scoped to the trips module rather
than applied to every array anywhere.

Two modules are read-only on purpose rather than unfinished. Allowance rules
carry a `verified_on` date and a source URL because they change without notice,
and a Schengen rule rewritten from a model's memory is the confident, plausible,
wrong answer that gets somebody stopped at a border. Documents return metadata
only — never `storage_path`, never a signed URL, never `number_last4`. Signed
URLs live 300 seconds precisely so they cannot outlive the moment they were
needed; minting one into a model's context defeats the mechanism entirely.

### D88 — Health is the owner's to give, so it became opt-in rather than banned

`FORBIDDEN_MODULES` hard-blocked health and documents. That was the right first
move and the wrong permanent one, and the argument that changed it is simple: a
personal access token *is* its owner. RLS restricts health to
`owner_id = auth.uid()`, so the only person whose cycle logs a token can reach
is the person who created the token. Refusing that was not protecting a partner
— it was overriding somebody's choice about their own data.

`SENSITIVE_TOKEN_MODULES` replaces it. Never in a default scope, always
tickable, and the Settings copy says at the moment of ticking that the data will
reach whichever AI service the token is plugged into — because that, not the
database boundary, is what actually changes.

Two guarantees got *stronger* in the process, and both are tested. Health
queries pin `owner_id` to the caller in the query itself, not only through RLS:
0014 lets a partner read a scope they were granted consent for, which is right
in the app and wrong here, since consent was given so a person could look with
their own eyes rather than so an assistant could sweep up what they were
trusted with. And there is no health delete tool at all —
`delete_all_health_data()` is irreversible by design, and a tool for it would
put total erasure one hallucinated call away.

### D89 — Complete coverage, and the one tool deliberately still missing

Thirty-nine tools over nine modules — every module the app has. The last gaps
closed were photos, the suggestion tray from the reading side, wishlist
verdicts, budgets, and a `get_overview` that leans on the same `dashboard()`
RPC the home screen uses, so the assistant and the screen cannot drift about
what is next.

**There is no accept tool, and there will not be one.** `list_suggestions`
shows what is waiting and `dismiss_suggestion` clears one out, but accepting is
absent on purpose. A server that could both write a draft and accept it has a
direct write to the itinerary with two extra steps — which is worse than an
honest direct write, because the result looks reviewed. Dismissing is fine: the
worst case is a suggestion nobody wanted going away, and it changes no plan.

Two more deliberate omissions, for the same family of reason. `vote_on_wishlist_item`
always votes as the caller and takes no user id — two verdicts exist precisely
because they are two people's, and one that could answer for both empties the
feature. And photos return captions and dates but never `path_original` or a
signed URL, on the same 300-second argument as documents.

### D90 — The cycle is a calendar, and an estimate is drawn as an estimate

The cycle screen was a list of dates and one sentence. It answered "when is the
next one" in prose and nothing else — which is the wrong shape for a question
whose answer is a set of days.

Now a month grid. Four things are drawn and they are deliberately not
interchangeable: a **logged** period is solid, a **projected** one is outlined
and dashed, the fertile window is a wash behind the day, and ovulation is a dot
— filled when she recorded it, hollow when the app worked it out.

Solid versus dashed is carrying spec 12.7. On a calendar, "never render an
estimate as a fact" is mostly a statement about borders: a filled square and an
outlined one read as different kinds of claim before any legend is consulted,
which is what a glance needs. `calendarMarks` writes projections first and logs
second so a fact always overwrites a guess on the same square — a period logged
where one was predicted must read as logged, and getting that ordering backwards
would show somebody a prediction for a period they already had.

**The variance grows with distance, which is the honest part.** Cycle three's
start is three cycle lengths summed, so it carries three errors, not one. For
independent errors that is `spread × √n`, and drawing cycle six as confidently
as cycle one would be a lie the calendar could trivially avoid. Six is the cap
for the same reason: past that the window is wider than the cycle and the
drawing says nothing. Projections already overtaken by the calendar are dropped,
so somebody who stopped logging does not open the app to a prediction for last
spring.

Editing lives on the calendar rather than in a separate form, because the
calendar is where the mistake is noticed. Tapping the day a period actually
started is more direct than finding a date field, and — the point — correcting a
projection is the *same gesture* as logging a new one. A correction is not a
special case; it is the truth arriving later. Everything downstream is derived,
so a corrected start moves every estimate after it with no extra machinery.

One wording fix worth recording: a perfectly regular logger produces a variance
of zero, and "give or take 0 days" reads as a guarantee. No estimate from six
data points is one, so the phrase is dropped rather than printed with a zero.

### D91 — A Google Maps link carries two coordinate pairs, and the obvious one is wrong

Saving a place meant typing a name and hoping the geocoder found it. Now a
pasted Google Maps link fills the name, the full address and the pin.

The parser is the substance, because Google emits at least six URL shapes and
the differences are not cosmetic. In `/maps/place/…/@12.95,74.85,17z/data=…`
there are **two** coordinate pairs: `@lat,lng` is where the camera was pointing
when the link was copied, and `!3d…!4d…` inside the opaque data payload is the
place. Pan the map before copying and they differ by a suburb. Reading the
first — which is the one that looks obvious — pins the wrong spot while the name
and address look perfectly correct. The `!3d!4d` pair wins, a camera-derived pin
is labelled `camera` so the UI can caveat it, and a test pins the precedence.

Coordinates are validated rather than parsed: `Number()` is happy with a
longitude of 700, and 0,0 is refused outright because null island is what a
broken parse produces far more often than a real pin.

**The address needs a second service.** The link never carries one, so
`reverseGeocode` asks Nominatim at `zoom=18` — lower and it answers with a
suburb, which is not an address. A miss comes back as HTTP 200 with an `error`
field rather than a 404, which is worth knowing: reading that as a hit saves a
place whose address is the string "Unable to geocode".

Short links (`maps.app.goo.gl`) are opaque — even the path is an id — so they
are *recognised*, never guessed at, and resolved server-side where a redirect
can be followed.

### D92 — Two bugs found by testing the round trip rather than the code

Both were invisible to unit tests that looked at the pieces separately.

**The links this app saves could not be read back.** `googleMapsUrlFor` emits
`?query=12.87,74.84(Cafe Younes)` — Google's own documented labelled form — and
the parser's coordinate regex demanded the parameter be *only* a pair. The
round-trip test that existed used the *unlabelled* form and passed. So a saved
place would silently lose its pin the next time it was opened. Found by
generating a URL and feeding it straight back in.

**An SSRF bypass in the shared guard**, inherited from `/api/extract` when it
was extracted for reuse. The IPv6 check looked for a trailing dotted quad to
catch IPv4-mapped addresses — but WHATWG `URL` *normalises*
`::ffff:127.0.0.1` into `::ffff:7f00:1`, hex, no dots. The regex matched
nothing and loopback went straight through. Now the hextets are decoded back to
an address. The extraction is what surfaced it: writing tests for a guard that
had been sitting untested in a route handler.

### D93 — Itinerary items could hold a location and had no way to get one

`itinerary_items` has carried `lat`, `lng`, `address` and `maps_url` since
phase 3, and `ItemEditor` had a single free-text `place_name` box. So an item
added by hand was permanently invisible on the map — the columns existed, the
form could not fill them, and nothing said so.

Both forms now take a pasted map link, offer a name search, and show the pin on
a small map that can be long-pressed to correct it. Seeing the pin is the check
that matters: a camera-derived coordinate looks right in every field except the
one nobody can read, and a map shows it instantly.

Moving a pin by hand clears the address, because an address that described the
old coordinates has become a claim about somewhere else.

The MCP `add_wishlist_item` tool takes a map link too, and reads coordinates
only out of it — never from the model. A model asked where somewhere is will
produce a plausible latitude, and a pin confidently in the wrong suburb is worse
than no pin at all.

### D94 — Nobody types coordinates, and nobody is shown them either

Latitude and longitude are machine facts. A person who reads
"12.86980, 74.84300" has learned nothing they can check, and a person asked to
*enter* it has been handed the app's job.

No form ever had raw coordinate inputs — but three surfaces were still printing
them back: `PlacePicker` fell through to `toFixed(5)` when it had no address,
the trip map said "Add something here — 12.8698, 74.8430", and the destinations
page confirmed a pick with two decimals of latitude. All three now show the
address, or say plainly that there is no street address at that spot, which is
a true and useful sentence where a pair of decimals is neither.

**The address is derived, continuously.** An earlier version cleared the address
when a pin moved, told the person in the UI that it would be looked up on save,
and then never did it — so a moved pin saved with nothing. The lookup now lives
inside `PlacePicker`, fired whenever there are coordinates and no address, so no
form can forget it. That placement is the fix: the previous arrangement asked
every caller to remember, and the first caller did not.

Two supporting changes. `useReverseGeocode` rounds to five decimals for its
cache key — about a metre — because not rounding misses the cache on every pixel
of a drag. And search now leads in the itinerary editor, with "use my location"
beside it: typing three letters of a name is the fastest route to a located
place, and burying it under a field that asks somebody to go and fetch a URL
made the clumsy path look like the intended one.

### D95 — The model names the place; the geocoder decides where it is

For the MCP to plan on the couple's behalf it has to be able to locate places.
The tempting shape — let the tools take `lat` and `lng` — is the one that
quietly breaks everything.

Asked where a café is, a language model produces a latitude. It is plausible,
correctly formatted, and often a kilometre out or in the wrong city. A pin that
is confidently wrong is worse than no pin, because nothing about it looks
wrong: the name is right, the address reads fine, and only the map shows the
problem — which is exactly what nobody checks for a place they have not been to
yet.

So **no tool in the server accepts a coordinate**, and a test asserts it by
walking every input schema for `lat`/`lng`/`latitude`/`longitude`. Instead
there is `find_place`, and `locate_query` on everything that stores a location —
including each item inside a `suggest_itinerary` draft, so a whole AI-planned
day arrives with real pins and can actually be drawn and routed rather than
being a list of words.

One bug this surfaced: `searchPlaces` never sent a `User-Agent`. Browsers set
one automatically, so it had always worked — and Nominatim refuses requests
without it, which the MCP server geocoding from a laptop would have hit
immediately. The failure would have read as "place search is unavailable"
rather than as a missing header.

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

### D96 — The trip's front page is the trip, not a form

Opening a trip used to redirect straight to the plan, so the first thing the app
showed about a trip was a list to fill in. Everything that makes a trip a trip —
the flights, the days, the chosen city, the places already saved — was spread
across eight tabs, each fine for editing and none of them able to answer *what
does this look like?* Answering that meant reading four screens and holding
them in your head.

`src/modules/trips/journey.ts` merges them into one ordered timeline and one
drawable route. It is pure and tested, because every visual decision on the new
screen reads from it. Two rules in it are easy to get wrong and are pinned by
tests:

- **Flights bracket a day; they do not sit inside it.** An arrival at 06:00
  comes before everything planned that day and a departure at 21:00 after,
  regardless of whether anything else has a time. Sorting flights in with items
  by time would be right by accident and wrong whenever an item has none.
- **`rest` and `open` stay distinct.** A day left blank on a long stay is the
  point of the trip (non-negotiable #6); a day nobody has reached yet is not.
  The model keeps them apart so the screen can, and so the MCP can say
  "kept clear on purpose — do not fill this" rather than offering to fill it.

### D97 — One screen that does not grow

The obvious build for "the whole trip at once" is one card per day down the
page. It is also wrong: a fortnight becomes a page nobody scrolls to the end
of, and the shape of the trip — where the flights are, where the empty stretch
is — is the first casualty.

So the layout is three fixed regions: a map, a horizontally scrolling strip of
day chips, and one day's detail in a panel with a ceiling and its own scroll.
Tapping through fourteen days moves nothing. The map stays an overview
deliberately — it does not re-fit when the selected day changes, because a map
that resets your pan every time you tap is the most annoying thing a map can
do while you are looking at it.

Each chip carries the date and at most three marks: a plane for a travel day, a
moon for a day kept clear, dots for how much is planned, and — for the
signed-in person only — a dot for a period day. Anything more is a tap away.
The marks are also spoken: each chip's `aria-label` says "travel day",
"2 planned", "period expected", so nothing is available only as a colour.

### D98 — The view asks for almost nothing, because almost nothing is unknown

The brief was to reduce manual entry, so every part of this screen is derived:

| Shown | Derived from |
| --- | --- |
| The days | `trip_days`, or the trip's own dates when no rows exist yet |
| Which days are travel | The flights pointed at the trip |
| Where the trip is that day | The chosen `trip_destinations` and their date range |
| Which day to open on | Today if the trip is running; the first flight if it has not started; the last day if it is over |
| What to offer adding | Saved places within 60 km of the trip that are not already on the plan |
| The cycle marks | Predictions the health module was already making |

The only input is a tap. Adding a nearby saved place takes one more, and it
lands on the day already in view — dated, placed, attributed — because all of
that was known before the tap. `pushToItinerary` grew an optional date for
exactly this: with none, saves land in the idea pool as the blend screen wants;
with one, they land on that day. Making somebody push to a pool and then drag
onto a day is asking twice for one decision.

Two things are deliberately withheld on a day that is blank on a long stay: the
"nothing planned" line, and the nearby-places offer. Non-negotiable #6 says a
`RestfulEmpty` and nothing else, and an invitation to fill the day would undo
the only thing it is there for.

### D99 — The cycle on a shared screen is the viewer's own, by construction

The journey is a screen both partners look at, and the health module already
supports a partner reading a consented scope. Passing an owner id into a trip
view would eventually be passed the partner's, and consent given so a person
could look with their own eyes is not consent to have it drawn onto a shared
planning surface.

So `useCycleWindow` takes a date range and no owner: it reads the signed-in
person's logs and nobody else's. RLS would refuse without consent anyway; this
makes the refusal unnecessary by never asking. The section is hidden entirely
for anyone whose profile does not track a cycle, and the words stay the
calendar's own — "period expected", "in the estimated fertile window" — because
`describeDayMark` is now shared between the two screens rather than duplicated.

### D100 — `get_trip_journey`, so the assistant sees the same trip the screen does

The MCP could already assemble this: `get_trip`, `list_flights`,
`list_itinerary`, `list_destinations`, then merge. Four calls, plus the two
ordering rules from D96 that the model would have to reimplement correctly
every time.

`get_trip_journey` calls `buildJourney` — the same function the screen calls —
and renders it as text, including the saved places near the trip that are not
yet planned. One call, and the assistant and the couple are demonstrably
looking at the same trip. It is read-only, and the nearby list ends with a line
saying nothing is added on its own, because non-negotiable #5 is a rule the
model has to be told about rather than one it can infer.

### D101 — Where they sleep is a table, and `check_out` is exclusive

The app could say which *city* a trip was in on a given day and not which bed.
That was the largest hole in the journey view — "where are we staying" is the
question a couple asks most often on a trip, and the answer lived in an email.

`accommodations` (0020) is the standard couple-scoped table, with one decision
worth stating: the dates are `check_in` / `check_out`, not `arrive_on` /
`depart_on` like `trip_destinations`, because the two ranges do not mean the
same thing. A destination's range covers *days in a city*, inclusive at both
ends. A stay covers *nights*, and **`check_out` is exclusive** — three nights
from the 4th is check-in 04, check-out 07.

Every consequence follows from that one line. "Which stay covers this date" is
`check_in <= date < check_out`. "Is this the morning we leave" is equality with
`check_out`. The night of the check-out date belongs to whatever comes next, not
to the booking being left. Getting it backwards shows somebody a hotel on a
night they had already handed the key back for — a mistake that looks correct on
screen and is discovered at a locked door, which is why `modules/stays/logic.ts`
is pure and has twenty tests whose entire subject is that one rule.

The database refuses `check_out <= check_in`, which catches a zero-night stay
and *not* an off-by-one. Nothing can catch that but the wording, so the MCP tool
descriptions state it in capitals.

### D102 — The booking reference is the one column a model never sees

`booking_ref` is the thing you cannot reconstruct from memory at a front desk at
1am, which is exactly why it is stored — and exactly why it does not travel.
`tools/stays.ts` selects an explicit column list that omits it, asserted in
`registry.test.ts` by walking every `.select(` in the file, on the same
reasoning as document numbers: a reference sitting in a model's context is a
reference that has left the couple's control.

### D103 — The journey answers "near where?" with the bed, not the trip

Nearby saved places were offered within 60 km of the *trip's* centre, which is a
weak filter on a city break and a useless one across two cities. `dayCentre`
prefers the night's accommodation, then anything already planned that day, then
the trip. "Near where you are sleeping tonight" is the question somebody
actually has.

Two smaller things fell out of the same work. A booked bed now outranks an
arrival airport when deciding where the trip is centred — it is a firmer
statement about where the trip happens than a candidate city nobody chose. And
each booking is drawn on the route once, on the night they move in: a hotel
plotted on every night of a week is six identical points and a line that never
leaves it.

### D104 — The blend finally reads the destination it was always meant to

Since Phase 6 the blend guessed which city a trip was about by matching the
trip's *title* against cities people had saved. That worked for "Lisbon in May"
and for nothing else, and it was written before the destinations module existed.

`blendCity` now takes the chosen destination first and keeps the title match
underneath as the fallback for a trip nobody has filled a board in for.
Returning null still means no narrowing, which stays the safe direction to be
wrong in: showing too much is a longer list, showing too little hides somebody's
own save from them.

### D105 — A domestic connection is judged as one

`connectionRisk` has always taken an `isInternational` flag and `connectionsFor`
never passed it, so every connection took the international 90-minute minimum.
A comfortable 70-minute hop between two domestic gates was reported as tight,
which is the kind of wrong that trains somebody to ignore the warning.

`connectionsFor` now takes a `countryOf` lookup, fed by `useAirportCountries`
against the `airports` table. The rule it applies: a connection is international
if *either* leg crosses a border, because immigration is the cost and you clear
it on the way out too — a domestic hop feeding a long-haul departure is still an
international connection.

An airport missing from the ~135-row reference table returns null, and unknown
is treated as international on purpose. The international minimum is the longer
one, and telling somebody they have plenty of time when they do not is the
failure that makes them miss a flight.

### D106 — A rule checked two years ago no longer looks fresh

Every visa rule, stay allowance and medication restriction carries `verified_on`
and, until now, nothing read it. A rule checked in 2024 rendered identically to
one checked yesterday: same wording, same source link, same quiet confidence.
For data that changes with no notice, that is the worst possible shape.

`lib/advisory.ts` computes the age and says so, on every surface that renders a
rule — the allowance note, the destination board's visa column, the medication
restrictions, and the MCP's `list_allowance_rules`, because a model told only
"verified 2024-01-01" will report the rule as fact.

Six months is a judgement, not a fact: visa rules change roughly yearly and
announce themselves badly, so six months is short enough to catch a change
before somebody books on it and long enough that a fresh rule is not nagging
about itself. Past eighteen months the wording escalates from "worth confirming"
to "treat it as a starting point".

Two things it deliberately does not do. Nothing re-checks anything — the rule
may well still be correct, and what changes is only how much weight a reader
puts on it. And a *missing* `verified_on` is not stale: it was never claimed to
be checked at all, so saying "6 months old" about it would be inventing a fact.

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
