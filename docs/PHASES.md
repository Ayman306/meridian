# Phase plan

Derived from spec Part 15 (Build Order). One phase per commit, each independently
reviewable. A phase is done when its acceptance criteria pass and `docs/MEMORY.md`
records what changed.

| Phase | Module | Status | Why here |
| --- | --- | --- | --- |
| 0 | Foundations | ✅ done | Scaffold, lib, providers, shell, RLS primitives |
| — | *Next.js migration* | ✅ done | Owner's decision after phase 3. See D19–D23 in `MEMORY.md`. |
| 1 | 1 — Auth & Couple | ✅ done | Everything depends on `couple_id` |
| 2 | 3 — Trips | ✅ done | The container most other data attaches to |
| 3 | 5 — Itinerary | ✅ done | The main planning surface |
| 4 | 8 — Documents | ✅ done | Highest standalone value, no dependencies |
| 5 | 2 — Dashboard | ✅ done | Needs the above to have anything to show |
| — | *Milestone* | ✅ | Plan one real trip end to end with no other tool |
| 6 | 7 — Wishlist & Blend | ✅ done | Depends on Itinerary |
| 7 | 6 — Map | ✅ done | Depends on Itinerary, Wishlist |
| 8 | 4 — Destinations | ✅ done | Depends on Trips |
| 9 | 10 — Stay Allowance | ✅ done | Depends on Destinations, Trips |
| 10 | 9 — Flights | ✅ done | First external API; polling discipline matters |
| 11 | 11 — Gallery | ✅ done | Largest module; free-tier storage drives its design |
| 12 | 13 — Budget | ✅ done | Self-contained |
| 13 | 14 — Settings | ✅ done | Grows throughout; formalised here |
| 14 | 12 — Health | ✅ done | Last. Consent-first. Design it together. |

**All fourteen phases are done.** Later parts of the spec (16 — Going Public,
17 — Licensing & Payments) remain out of scope until the app is in real use.
What is left is the deferred list at the end of each phase below — none of it
blocks using the app, and most of it is a screen for something whose schema,
logic and policies already exist and are tested.

---

## Phase 0 — Foundations

Spec: Part 0, Part 15 Stage 0.

- [x] Vite + React 18 + TS + Tailwind scaffold
- [x] `profiles`, `couples`, `couple_members` + `is_couple_member()` + `partner_id()`
- [x] Profile auto-create trigger on `auth.users`
- [x] `AuthProvider`, `CoupleProvider`, `ThemeProvider`, `AppShell`, routing skeleton
- [x] `lib/dates.ts`, `lib/fractional.ts`, `lib/errors.ts`, `lib/constants.ts`
- [x] `EmptyState`, `RestfulEmpty`, `ErrorState`, `Skeleton`, `DualTime`, `PersonBadge`
- [x] GitHub Actions keep-alive cron against `health()`
- [x] CI: typecheck, lint, test, build
- [x] Migrations verified against a real Postgres, RLS assertions in CI
- [x] `supabase/setup.sql` — one paste to stand up a project — generated and
      CI-checked against the migrations
- [x] `docs/SETUP.md` covering the project, Google OAuth and `.env.local`
- [x] Supabase project live (`ylrpxrfneonjzctgtnmj`, ap-northeast-1), migrations
      0001–0004 applied, RLS confirmed on all ten tables
- [x] Function grants hardened after the Supabase linter flagged them (0004)
- [x] `src/types/database.ts` regenerated from the live schema
- [ ] **Needs a human:** sign in once with two Google accounts to confirm the
      app is wired to the same policies the database tests prove.

**Verify before Phase 2 can be called complete:** two accounts pair, and account A
cannot read account B's rows via a direct query with A's JWT.

## Phase 1 — Auth & Couple

Spec: Module 1.

- [x] Google OAuth sign-in, session persisted, cache cleared on sign-out
- [x] Couple creation with an 8-char code (no I/L/O/0/1), 7-day expiry
- [x] Join via a single transactional RPC — never client-side validation
- [x] Code is single-use: nulled on join, so a third account cannot reuse it
- [x] Profile setup: home city (geocoded), timezone (detected, editable),
      nationality, accent colour
- [x] Solo mode: a signed-in unpaired user sees `/pair`, not a broken app
- [x] Regenerate code (members only, refused once the couple is full)
- [ ] Leave couple — RPC exists; the Settings screen that calls it lands in Phase 13

## Phase 2 — Trips

Spec: Module 3.

- [x] `trip_statuses` (seeded), `trips`, `trip_travelers`, `trip_days` + RLS
- [x] Create with a title alone; dates prominent but skippable
- [x] Date precision: exact / month / season / year / unknown — display only,
      and countdowns render for `exact` alone
- [x] Trip list grouped Active → Upcoming → Planning → Past, each sorted by what
      you'd reach for first
- [x] Per-traveler arrival/departure, defaulting to the trip's dates, and the
      computed "together" window — a non-overlap is surfaced, not clamped
- [x] Day scaffolding via `sync_trip_days()`: generate on set, extend on
      lengthen, **prompt** before dropping annotated days
- [x] Long-stay mode at > 5 nights
- [x] Soft delete with a confirm; restore RPC in place
- [x] Realtime on trips / travelers / days — last write wins
- [ ] The bin screen that lists and restores deleted trips (Settings, Phase 13)

## Phase 3 — Itinerary

Spec: Module 5.

- [x] `categories` (seeded), `itinerary_items`, `suggestion_tray` + RLS
- [x] Idea pool: everything with `scheduled_date is null`, always visible
- [x] Day list for short trips, month grid for long stays
- [x] **Blank days on a long stay render `RestfulEmpty` — no call to action**
- [x] Drag pool → day → pool, one UPDATE per move, optimistic
- [x] Item editor: title required, everything else optional
- [x] Day types, with manual types never demoted (enforced by DB trigger)
- [x] Conflict badges: overlap, tight connection, busy day — warn, never block
- [x] Items stranded by a date change surface in "Outside the trip dates"
- [x] Shortening a trip unschedules affected items instead of deleting them
- [x] Realtime on items and the suggestion tray
- [ ] Week view — the spec calls it optional; skipped until the month grid
      proves too coarse in real use
- [ ] Bulk actions UI — `useBulkMove` exists, no multi-select surface yet
- [ ] Work-hours overlay — needs the Settings fields (Phase 13)
- [x] Suggestion tray UI — shipped in Phase 6, once Blend had something to put
      in it

## Next.js migration

Not a spec phase — an owner's decision taken after phase 3 (memory D19).

- [x] Next 16 App Router + React 19; Vite and React Router removed
- [x] Cookie-based auth via `@supabase/ssr`, browser and server clients split
- [x] `src/proxy.ts` refreshes the session on every request
- [x] `/auth/callback` route exchanges the OAuth code for a session
- [x] Auth gate on the server, pairing and setup gates on the client
- [x] Supabase Edge Functions replaced by Route Handlers under `src/app/api`,
      with `/api/health` live and a documented route table for the rest
- [x] `assertCronRequest()` guarding the service-role handlers still to come
- [x] Keep-alive workflow repointed at `/api/health`
- [x] All 110 tests still pass, untouched

## Phase 4 — Documents

Spec: Module 8.

- [x] `document_types` (seeded), `documents`, `trip_document_requirements`
- [x] RLS nuance: readable by the owner, or by the partner when `is_shared` —
      un-sharing hides it immediately, proven by assertion
- [x] Private `docs` bucket with four storage policies, signed URLs at 300s
- [x] Upload with a 10 MB cap and MIME allowlist, enforced in the bucket too
- [x] No orphans either way: the row is rolled back if the upload fails
- [x] Expiry bands, the passport 9-month rule with its explanation, and
      `shouldAlert` dedupe so a threshold fires once rather than daily
- [x] Trip readiness scored against `trip.end_date`, not today
- [x] The full number is never stored — the form asks for the last four
- [ ] Daily expiry sweep — `crossedThreshold`/`shouldAlert` are written and
      tested. The cron pattern now exists (`/api/cron/flight-sweep`); this one
      needs the notification channel that Phase 13 brings
- [ ] Client-side image compression before upload (spec 8.3)
- [ ] Vault re-auth gate after 15 minutes idle (spec 8.3) — needs the Settings
      surface for the WebAuthn fallback, so it follows Phase 13

## Phase 5 — Dashboard

Spec: Module 2.

- [x] One RPC, one round trip (`dashboard()`), as spec 2.4 asks
- [x] Countdown state machine: empty / planning / countdown / travel day /
      together / departing, with countdowns only for exact dates
- [x] Dual clocks ticking on the minute boundary, with a day/night indicator
      computed locally — no API, no library
- [x] Nights together this year and lifetime, split correctly across new year
- [x] Distance between home cities
- [x] Alert strip, sorted by the spec's priority order, capped at three
- [x] Everything timezone-dependent resolved against the *viewer's* midnight
- [ ] Active flight card — waits on Phase 10
- [x] Stay-allowance alerts on the dashboard — priority 3 filled
- [ ] ~~reserved~~ — `checkPlannedStay` can
      fill it once the dashboard RPC returns destination countries

## Phase 6 — Wishlist & Blend

Spec: Module 7.

- [x] `wishlist_items`, `wishlist_verdicts` + RLS: both partners read
      everything, each writes only their own — including verdicts
- [x] Verdicts in their own table, so reacting to a save never edits it
- [x] Save a place with a title alone; city optional, before any destination
- [x] Link paste → OpenGraph title and image, via `/api/extract`
- [x] Place search sets coordinates, city and country in one pick
- [x] Blend view: both of us / your picks / their picks / undecided / clashes,
      each section hidden rather than shown empty
- [x] "Both of us" computed by proximity (150 m) or normalised name in a city
- [x] Verdicts optimistic — one click, no confirmation, click again to un-vote
- [x] Push to the idea pool through one RPC: attribution preserved, a second
      push warns instead of duplicating
- [x] Draft generator: select → cluster → order → pace → balance, pure
      TypeScript, no model. Long stays get 40% of days at most
- [x] Generated drafts land in the suggestion tray and nowhere else
- [x] Suggestion tray UI on the plan tab — Keep or Discard, nothing automatic
- [x] Realtime on saves and verdicts
- [ ] Bulk "push all undecided" — only "both of us" and multi-select ship now
- [x] **Blend scoped by the chosen destination** — `blendCity` reads the trip's
      chosen destination, with the old title match kept as a fallback. See D104.
- [ ] ~~superseded by the line above~~ — it matched on the trip title until
      Module 4 (Phase 8) gives trips a destination

## Phase 7 — Map

Spec: Module 6.

- [x] Leaflet + OSM tiles, no API key, attribution always visible
- [x] Layers: scheduled, idea pool, wishlist (wishlist on the all-time map only)
- [x] Filters by day, person, category and state
- [x] Pins coloured by whose pick, numbered when a single day is selected
- [x] Clustering below zoom 13 (`leaflet.markercluster`)
- [x] Day route drawn as straight lines, labelled as not walking distance
- [x] Popup with title, time, whose pick and a Google Maps link built from
      coordinates first
- [x] Long-press (or right-click) the map to add an item at that location
- [x] Items without coordinates counted in "Not on map (n)", never dropped
- [x] `/map` — every place across every trip and the whole wishlist
- [x] Geocode cache table, 600 ms debounce, one network call per query
- [ ] Photo and accommodation layers — those modules do not exist yet
- [x] Empty map centred on the destination — Module 4 landed in Phase 8, so a
      trip with a chosen city has coordinates to open over

## Phase 8 — Destinations

Spec: Module 4.

- [x] `trip_destinations` + RLS; `visa_rules` and `airport_routes` as shared
      reference data, readable by any signed-in user and writable by nobody
- [x] Add candidates by city search — name, country and coordinates in one pick
- [x] Comparison board: candidates across, attributes down, scrolling sideways
      on a phone with the row header still attached
- [x] Flight hours per partner, cache first and great-circle second, with the
      estimate visibly marked as one
- [x] Fairness as a two-sided bar that names who flies further, never a number
- [x] Visa tier per partner, dual nationality resolved to the better passport
      and labelled with which one
- [x] **Every visa cell carries its source link, verified date and the
      "advisory only" line** — non-negotiable #4
- [x] A missing rule reads "Unknown — check officially", and costs as much
      friction as an embassy appointment in the scoring
- [x] Tier 5 excludes a candidate and says why
- [x] Season band from a static climate table — no API, never stale
- [x] Rough daily cost band, and wishlist saves per candidate city
- [x] Stay-allowance headroom per partner, from Module 10
- [x] Choose / unchoose in one transaction: rivals become rejected but stay
      visible, and the trip takes the destination's timezone
- [x] Optional scoring: all weights zero, ranking hidden until one moves, and
      the breakdown always one tap away
- [x] Equal-distance lens
- [ ] `tz-lookup` for coordinate→timezone — the city search returns a country
      but not a zone, so a chosen destination sets the trip's timezone only
      when the candidate carries one
- [ ] `airport_routes` is empty, so every duration is an estimate. Seeding it
      needs a real dataset; the "est" marker is honest until then

## Phase 9 — Stay Allowance

Spec: Module 10.

- [x] `allowance_rules` holding both seeded defaults and personal overrides —
      an override wins, because a resident permit is a fact about the person
- [x] `entry_exit_log`, shared to read and personal to write
- [x] Rolling window evaluated on **every day** of a planned stay, not just
      arrival — the spec's central point, and the acceptance test for it
- [x] Entry and exit days both count; a same-day in-and-out is one day
- [x] Zone rules: days in any Schengen member count against one total
- [x] `per_entry`, `per_year`, `per_visa` and `none` (resident/PR)
- [x] Overlapping rows merged before counting and surfaced as a warning
- [x] Must-leave-by date, walked forward rather than subtracted
- [x] Open-ended stays counted through today, so the answer changes overnight
- [x] Suggestions from trips with exact dates and a chosen destination —
      offered, never written, and only for your own crossings
- [x] Inline warning on the trip and on the destination board, silent when the
      stay comfortably fits
- [x] **Disclaimer, source link and verified date on every surface** — a
      missing rule reads "not tracked", never "no limit"
- [ ] Editing a rule from the UI — `useUpsertRule` exists, the form does not.
      The seeded defaults cover the common cases; overrides land with Settings
- [x] Allowance alerts on the dashboard (0015 phase) — priority 3 filled
- [ ] ~~reserved~~ —
      the check is now available to fill it

## Phase 10 — Flights

Spec: Module 9, the largest in the document.

- [x] `journeys`, `flights`, `flight_positions`, `flight_events`, `api_usage`,
      `airline_codes`, `airport_wait_times` + RLS
- [x] Either partner reads **and edits** any flight — `traveler_id` says whose
      it is, not who may see it
- [x] Positions are insertable only by the service role: a fabricated aircraft
      location is the worst thing this module could render
- [x] Manual entry as the baseline — a flight number and a date is enough
- [x] Paste a confirmation, get the flight, route, date and booking reference
- [x] One lookup per flight ever resolves airline, route, times and callsign
- [x] Phase state machine, and everything derived from it
- [x] Reconciliation: ground contact at the destination beats the airline's
      "enroute"; airborne beats "scheduled"; off-corridor means diverted;
      manual override beats everything and is applied last
- [x] Cache max-age by phase, from 24h out to 2 min in the final hour
- [x] Quota guard at 90%, counted from the database rather than memory
- [x] Isolated sources — OpenSky failing cannot block a status update
- [x] The hard stop, enforced by `deactivate_finished_flights()` on a cron
- [x] 60s tick, paused on a hidden tab, immediate on focus; manual refresh
      goes through the same server-side max-age, so spamming it costs nothing
- [x] All seven degradation levels render; there is no error state on the live
      view
- [x] Great-circle route split at the antimeridian — Tokyo → Los Angeles
      renders correctly, with a test
- [x] Aircraft marker styled by confidence; an estimate is **hollow and
      dashed**, never drawn like a real fix
- [x] Dead reckoning between fixes, respecting `prefers-reduced-motion`
- [x] Breadcrumb trail, downsampled; follow-aircraft toggle
- [x] Arrival handoff with its full breakdown, voided loudly on a diversion
- [x] Post-arrival feedback writes measured wait times back
- [x] Connection risk between legs of a journey
- [x] Both-flying case suppresses the handoff and reports the arrival gap
- [ ] Notifications — the events are recorded (`flight_events`) and the sweep
      that would send them runs, but there is no channel yet. Push needs
      `push_subscriptions` from Module 14 (Phase 13)
- [ ] Screenshot/PDF parsing — needs the AI module, and the spec marks it
      optional
- [x] `pg_cron` schedule for the sweep (0015)
- [ ] ~~schedule~~ — the route and its secret exist; the
      schedule is one statement to run once the app is deployed

## Phase 11 — Gallery

Spec: Module 11.

- [x] `media`, `albums`, `album_media`, `media_comments`, `share_links`,
      `daily_exchange` + RLS
- [x] Private `media` bucket, path `{couple_id}/{media_id}/{variant}.jpg`, four
      storage policies keyed on the first path segment
- [x] **Originals are never uploaded.** Two derivatives per photo, generated on
      the device: a 1600px display and a 400px thumb, ~340 KB together
- [x] EXIF read for date and GPS; HEIC converted only when it turns up
- [x] Thumbhash computed at upload and rendered before any image loads
- [x] Perceptual hash and a duplicate prompt that always offers "upload anyway"
- [x] Upload queue: one at a time, per-file progress, pause, retry with 1/2/4/8s
      backoff, and IndexedDB persistence so a refresh does not lose it
- [x] Grid loads **thumbs only**, sixty a page, grouped by the viewer's day
- [x] Lightbox loads one display and preloads at most one neighbour each way
- [x] Caption editing, favourites, comments, keyboard and swipe navigation
- [x] Full-text search over captions via a tsvector kept by trigger
- [x] Filters: uploader, favourites, has-location, trip, date range
- [x] Albums, auto-created per trip and idempotent
- [x] Share links: 32 random bytes, expiry, optional passcode, instant revoke,
      resolved server-side so a storage path is never handed out
- [x] Trash with a per-photo countdown, and a sweep that deletes **objects
      before rows**
- [x] Storage usage and "room for about N more photos"
- [x] Auto-bucketing, same-moment pairing and the trip recap, all tested
- [ ] Virtualised grid — `@tanstack/react-virtual` is installed but the grid
      paginates instead. Worth doing once a library is big enough to need it
- [ ] Videos — the schema and the size cap are in place; derivative generation
      and a poster frame are stubbed and the uploader refuses them for now
- [ ] The daily-exchange strip UI — the table, the logic and the hooks exist;
      the surface at the top of the gallery does not
- [ ] Bulk download and the recap screen — `buildRecap` is written and tested
- [x] `pg_cron` schedule for the media sweep (0015)

---

## Phase 12 — Budget

Spec: Module 13.

- [x] `expense_categories`, `expenses`, `settlements`, `budgets`, `fx_rates` +
      RLS, and `couples.base_currency`
- [x] Categories seeded by trigger on couple creation, and backfilled for
      couples that predate the migration
- [x] **Money is integer cents throughout `logic.ts`** — floats drift, and the
      drift lands in the one number a person acts on
- [x] All four split types, with `shares()` summing to the total *exactly* and
      the odd cent going to the payer
- [x] Exact and percent splits rejected when they do not add up, with a message
      that names the shortfall rather than saying "invalid"
- [x] Balance signed toward the viewer, zeroed by settlements, never "-€0.00"
- [x] FX fixed at save time and never recomputed; the rate and its date are
      stored beside the converted amount so the row is auditable
- [x] Rate provider is keyless (Frankfurter/ECB), cached forever, weekend dates
      keyed under both the ECB's date and the one asked for
- [x] A failed rate lookup still saves the expense; `amount_base is null` is
      the retry flag and the whole working set for the nightly sweep
- [x] `fx_rates` readable by anyone signed in and writable by nobody through
      the API — a poisoned rate is a wrong number in a balance
- [x] Trip summary: totals, by category, by person, per-day average over
      *elapsed* days, and the per-week view for stays of a fortnight or more
- [x] Budget vs actual per category, shown only where a budget is set, and the
      bar keeps going past 100% rather than clipping
- [x] Three charts in hand-written SVG rather than Recharts (D66)
- [x] CSV export with both amounts, the rate, and a BOM so Excel reads UTF-8
- [x] Realtime on `expenses` and `settlements` — two people entering expenses
      on the same evening is exactly when a stale balance misleads
- [x] Deleting an expense or undoing a settlement warns with the number
- [x] 47 unit tests, 17 new RLS assertions
- [ ] Receipt photos — `receipt_media_id` exists and the gallery can store
      them; the picker in the expense form does not
- [ ] Linking an expense to an itinerary item — column and index are there,
      no UI
- [ ] Per-week *budgets* — `period = 'week'` is modelled and indexed; only
      trip-period budgets are settable
- [ ] Splits with an itemised third party, and any split that is not
      two-person — out of scope by the couple model
- [x] `pg_cron` schedule for the FX backfill (0015)

---

## Phase 13 — Settings, invites and access

Spec: Module 14, plus two things the spec does not cover.

- [x] `couple_settings`, `user_settings`, `push_subscriptions` + RLS, seeded by
      trigger so no screen ever meets a missing row
- [x] **Invites are bound to an email address.** The code was a bearer token:
      anyone holding eight characters could join. `join_couple` now compares
      the address on the account signing in against the one the invite was
      issued to, and refuses anyone else with `EMAIL_MISMATCH`
- [x] One live invite per address per space, superseded on re-invite, so
      revoking one code cannot leave another working
- [x] Roles on `couple_members`: owner, partner, friend, guest
- [x] **Module grants, enforced in RLS** — not by hiding nav items. A guest
      without `money` gets zero rows from the database, however they ask
- [x] Documents, stay allowance and health are never grantable outside the
      couple, refused by the database at both invite and membership
- [x] `couples.kind` and a partner-only size cap, so the same model extends to
      multi-person trip groups without a second policy rewrite
- [x] `AccessProvider` filters the nav from `my_modules()`, so a hidden link
      and an unreadable table always agree
- [x] Settings screen: shared preferences, personal preferences, work hours,
      notification toggles, vault lock, leave couple
- [x] Base currency moved to `couple_settings`, mirrored from `couples` by
      trigger so an older client cannot disagree with it
- [x] 21 unit tests, including one that reads the migration and fails if the
      TypeScript module lists drift from the SQL
- [x] 26 new RLS assertions, including a friend reading zero expenses, zero
      documents and zero of anyone's immigration history
- [ ] Push subscriptions — the table and the toggles exist; there is no
      service worker and nothing is sent
- [ ] Export everything / delete account (spec 14.2 "Data")
- [ ] Category management — renaming and recolouring itinerary categories,
      expense categories, document types and trip statuses
- [ ] The trip bin, and restoring a deleted trip
- [ ] Work-hours overlay on the itinerary — the fields are here now, the
      overlay is not
- [ ] Vault idle re-auth — `vault_lock_minutes` is stored; the gate is not built
- [ ] Group spaces have schema support but no UI: no way to create one, and no
      switcher

---

## Phase 14 — Health

Spec: Module 12. Built last, as the spec instructs.

- [x] `health_consents`, `cycle_logs`, `health_records`,
      `medication_restrictions` + RLS
- [x] **Owner-scoped, not couple-scoped** — the only module in the app where
      being in the couple grants nothing. No policy here keys on
      `is_couple_member`
- [x] Consent enforced in the database per scope, checked by one
      SECURITY DEFINER predicate
- [x] **Revocation is instant** — `revoked_at` is read in the policy itself, so
      the partner's next query returns nothing. No cache, no sweep
- [x] A viewer has no write policy at all: read-only by construction, not by
      convention
- [x] Per-kind scopes: sharing vaccinations does not share medications
- [x] **Hard delete**, in one RPC transaction. No `deleted_at` anywhere in this
      module — the one place the soft-delete house rule is deliberately
      reversed
- [x] Prediction is a union whose "no" case carries a reason, so a confident
      date cannot be rendered from thin data. Under 3 cycles: no prediction.
      Over sd 7: a range, never a day. `isEstimate` has no false branch
- [x] Medication supply check, which refuses to guess when the numbers are
      absent
- [x] Border restrictions that **link and never assert** — a match produces the
      spec's exact sentence plus the official URL, and no data reads "not
      checked", never "safe"
- [x] Partner view is visibly limited: it lists what is *not* shared rather
      than quietly rendering a shorter page, and never says whether an empty
      section means "not shared" or "nothing logged"
- [x] JSON export, and delete-everything behind a type-to-confirm
- [x] No analytics or error-reporting SDK on any route — there is none in the
      project at all
- [x] 29 unit tests, 18 new RLS assertions covering every acceptance criterion
      in spec 12.8
- [x] **Cycle calendar view** — a month grid with logged and projected periods,
      the fertile window and ovulation, projections drawn as projections with a
      window that widens as it compounds. See D90.
- [x] **Predicted dates on the trip view** — the journey screen marks the
      signed-in person's own period days on the day strip. Deliberately *not*
      behind `cycle_predictions` consent: the journey is a screen both partners
      look at, so it reads the viewer's own logs and never an owner id. See D99.
- [ ] Linking a vaccination or prescription to a document — `document_id` is on
      the row, no picker
- [ ] The restriction seed is eleven rows across six countries. It is a
      starting point with sources attached, not a dataset

---

## After the phases — what real use turned up

Everything below came from actually running the app rather than from the spec.

- [x] **Vercel Deployment Protection** was answering 401 to every
      server-to-server call — the three sweeps, the keep-alive that stops the
      free Supabase project auto-pausing, and eventually anyone who is not on
      the Vercel team. Both paths now support a bypass token.
- [x] **Airports** (0016). The flight form could not name one, so every flight
      saved as `??? → ???`. See D76.
- [x] **Journeys** — connecting legs, return trips, and the layover warning
      that had been written since phase 10 and never rendered. See D77.
- [x] **Overflow.** The trip page had eight tabs in a non-scrolling flex row,
      about 480px on a 360px screen, which pushed the whole page sideways.
      Every tab strip scrolls now, with items that keep their width.
- [x] **Cycle tracking** is gated on gender with an explicit override, and
      predicts the fertile window as labelled arithmetic. See D78.
- [x] **The AeroDataBox cap** is an explicit 550, reconciled against the
      provider's real balance, with a secret scanner in the test suite. D79.
- [ ] Airport list is ~135 rows. An unlisted airport saves but carries no
      coordinates, so the map cannot draw that leg.
- [x] **Domestic connections take the domestic minimum.** `connectionsFor`
      takes a `countryOf` lookup fed from `airports.country_code`; a connection
      is international if either leg crosses a border, and an unlisted airport
      is treated as international. See D105.
- [ ] Nobody has paired on the live project yet, so the two-account isolation
      the spec gates on is proven in the harness and not in production.
- [x] **An MCP server** (`mcp/`), so an assistant can read the plan and propose
      changes to it from outside the app. Personal access tokens in Settings,
      exchanged for ten-minute user JWTs so RLS still decides. Itinerary writes
      go to the suggestion tray; health and documents are unreachable. See D81
      and D82.
- [ ] Remote HTTP connector for the MCP server, so it works from the Claude
      phone app rather than only a laptop. The tools are already
      transport-agnostic; what is missing is OAuth 2.1 with dynamic client
      registration, and a Deployment Protection bypass for the endpoint.
- [ ] No flight-booking write tool. A booking is legs, directions and times in
      the airport's own zone, all copied off a confirmation — `JourneyBuilder`
      parses a pasted email, which is both faster and honest about the source.
- [x] **Installable PWA** — manifest, icons, a service worker that caches only
      shared bytes, an offline page, and an install banner shown once that
      adapts to Chromium, iOS Safari and everything else. See D83–D85.
- [x] **Web push**, wired to the flight sweep and gated on the `notify_*`
      toggles that had been recorded since phase 13 with nothing reading them.
      See D86.
- [x] **Locations resolve themselves.** Paste a Google Maps link and the app
      takes the name, the full address and the pin from it; moving a pin
      re-resolves the address; no screen shows a coordinate and no MCP tool
      accepts one. See D91–D95.
- [x] **The trip's front page is the trip.** One journey view — map, a strip of
      every day, one day's detail — assembled from flights, days, destinations
      and the itinerary, with nearby saved places offered on the day in view.
      `get_trip_journey` gives the MCP the same assembly. See D96–D100.
- [x] **Accommodation is modelled** (0020). Bookings with dates, a resolved
      address and a booking reference; nights with nowhere booked are counted;
      the journey shows the bed on every day and centres its nearby-places
      offer on it. `check_out` is exclusive. See D101–D103.
- [ ] Nothing links a stay to an expense, so "what did the hotel cost" is still
      two screens. `expenses` has the columns; the picker does not exist.
- [ ] Offline reads of the plan. Would need a per-account encrypted store —
      a different feature with different risks than caching the shell.
- [ ] Background Sync for writes made offline. Chromium only, so the app would
      still need a fallback path.
