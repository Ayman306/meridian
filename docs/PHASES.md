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

**All fourteen phases are done, and so is every deferred item that code can
close.** Later parts of the spec (16 — Going Public, 17 — Licensing & Payments)
remain out of scope until the app is in real use.

### What is left

Exactly two checkboxes, and neither is code:

1. **Sign in with two Google accounts on the live project.** The policies are
   proven by 200-plus assertions against a real Postgres in CI. What is unproven
   is that the deployed app is wired to those same policies, and only the owner
   can prove it.
2. The same item, restated where it was first noticed.

Everything else that used to be on this page is either done or has become a
**stated decision** rather than an open box. Those are marked as bullets rather
than checkboxes, because a decision is not a task somebody forgot:

| Decided against | Why, in one line |
| --- | --- |
| Week view | Three ways to read a trip's shape already exist; a fourth answers nothing new |
| Virtualised gallery grid | The grid is grouped into variable-height day sections, and `loading="lazy"` already avoids the real cost |
| Screenshot/PDF parsing | Needs a model, and non-negotiable #8 is that everything works with AI off |
| Third-party splits | Out of scope by the couple model, per the spec |
| Group spaces UI | Deferred at the owner's decision; the schema stays forward-compatible |
| Offline reads of the plan | Needs an encrypted on-device store — different feature, different risks |
| Background Sync | Chromium only, so a fallback path is needed anyway and then it earns nothing |
| OAuth 2.1 for the remote MCP | Hand-rolling an authorization server is security-critical code with silent failure modes |

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
- [ ] **Needs a human, and cannot be closed from here:** sign in once with two
      Google accounts on the live project. The policies are proven by 200+
      assertions against a real Postgres in CI; what is unproven is that the
      deployed app is wired to those same policies. Nobody but the owner can
      do this.

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
- [x] **Leave couple** — the RPC and the Settings screen that calls it, with a
      type-to-confirm and a plain statement that the partner keeps everything

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
- [x] **The bin**, in Settings, with a per-trip countdown rather than a
      sentence about policy

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
- **Week view: decided against.** The spec calls it optional. There are now
  three ways to read a trip's shape — the journey day strip (whole trip,
  compact), the day list (short trips), the month grid (long stays). A fourth
  would be a fourth thing to keep consistent for no question it uniquely
  answers.
- [x] **Bulk actions** — selection is a mode, not always-on: checkboxes on a
      plan somebody is reading is clutter; the same checkboxes after they
      pressed "select several" is the feature
- [x] **Work-hours overlay**, converted into the trip's clock. The fields had
      to move to `profiles` first (0021) — on `user_settings` they were
      own-only, so the overlay could never have drawn the partner's. See D107
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
- [x] **Daily expiry sweep** — `/api/cron/document-sweep`, scheduled at 04:15
      UTC (0023). Alerts once per threshold, and only the owner
- [x] Client-side compression — `lib/images.ts` has resized every upload to
      1600px/400px since Phase 11; documents share that pipeline
- [x] **Vault idle gate**, honouring `vault_lock_minutes`. Described honestly
      as a screen lock rather than a second access control — RLS is what stops
      a read; this stops a passport being on screen when a phone is handed
      over. See D108

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
- [x] **Active flight card**, above the countdown, rendering nothing at all
      when nothing is flying
- [x] Stay-allowance alerts on the dashboard — priority 3 filled
- [x] Stay-allowance alerts — `checkPlannedStay` fills priority 3

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
- [x] **Push all**, on Your picks, Their picks and Undecided — and
      deliberately not on Clashes, where a bulk button would make disagreement
      a single tap
- [x] **Blend scoped by the chosen destination** — `blendCity` reads the trip's
      chosen destination, with the old title match kept as a fallback. See D104.
- [x] ~~superseded~~ — it matched on the trip title until
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
- [x] **Photo and accommodation layers.** Photos off by default and capped at
      300, or the map becomes a heat map of wherever a phone was out
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
- [x] **Coordinate→timezone**, from the nearest listed airport rather than
      `tz-lookup`'s ~100 KB polygon dataset. Refuses past 500 km instead of
      guessing — a wrong zone shifts every time on the trip. See D109
- [x] **`airport_routes` seeded** — 90 published block times, directional,
      for the routes these trips are built from. A missing pair still falls
      back to the estimate

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
- [x] **Rule overrides** — writes a new row scoped to the person rather than
      editing the seeded one, so the original keeps its source and date
- [x] Allowance alerts on the dashboard (0015 phase) — priority 3 filled
- [x] ~~reserved~~ — the check now fills it

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
- [x] **Notifications** — the flight sweep sends web push, gated on each
      person's own `notify_flights`
- **Screenshot/PDF parsing: needs a model, and the app is built to run without
  one.** Non-negotiable #8 is that everything works with AI disabled, and this
  cannot. `JourneyBuilder` parses a pasted confirmation *email* with no model at
  all, which covers the same need for the case that actually happens. If the AI
  module is switched on later this is the first thing to build on it.
- [x] `pg_cron` schedule for the sweep (0015)
- [x] ~~schedule~~ — scheduled in 0015, alongside the other three sweeps

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
- [x] **Infinite scroll**, and *not* virtualisation — see the decision below.
      (`@tanstack/react-virtual` was a declared dependency that
      nothing imported; it has been removed.)
- [x] **Videos** — stored as uploaded with a poster frame in the thumb slot,
      and played with controls in the lightbox
- [x] **The daily-exchange strip** — two rows, one per person, so a gap is
      visible as a gap
- [x] **Recap and bulk download.** Sequential saves with a beat between them;
      no zip, because zipping in the browser holds every file in memory at once
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
- [x] **Receipt photos** — picked from the gallery rather than uploaded
      again, so the upload pipeline stays in one place
- [x] **Expense links** — to an itinerary item, and to a stay (0022, `on
      delete set null`: the money outlives the booking)
- [x] **Weekly budgets**, pro-rated on a short final week — otherwise every
      trip ending mid-week reports as comfortably under
- **Third-party splits: out of scope by the couple model**, and stated in the
  spec as such. `exact` and `percent` splits already handle any division between
  the two of them; a third payer needs a third member, which is the group-spaces
  question below.
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
- [x] **Push subscriptions** — service worker, VAPID, and the toggles wired
      to the sweeps
- [x] **Export everything / delete account.** The export is a client-side
      read so RLS decides what lands in it; the delete takes its user id from
      the verified session and never from the body
- [x] **Category management**, across all four lists
- [x] The trip bin — see Phase 2
- [x] Work-hours overlay — see Phase 3
- [x] Vault idle gate — see Phase 4
- **Group spaces: deliberately deferred, at the owner's decision.** The schema
  is forward-compatible (`spaces.kind`, unbounded membership) precisely so this
  stays possible. The UI is not a gap but a different product: splits, the
  blend, fairness, cycle consent and the whole "self and partner" shape of every
  module assume two people. Building it means reworking those, not adding a
  switcher.

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
- [x] **Vaccination and prescription links** — the owner's own documents
      only, since offering the partner's would leak which they hold
- [x] **Restriction seed widened** to 32 rows across 15 countries, chosen by
      the failure they prevent. Still a starting point with sources attached,
      and now marked stale past six months

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
- [x] **Airport list widened** to 169. An unlisted one was two silent
      degradations at once: no coordinates for the map, and no country, so the
      layover fell back to the international minimum.
- [x] **Domestic connections take the domestic minimum.** `connectionsFor`
      takes a `countryOf` lookup fed from `airports.country_code`; a connection
      is international if either leg crosses a border, and an unlisted airport
      is treated as international. See D105.
- [ ] **Needs a human:** nobody has paired on the live project, so the
      two-account isolation the spec gates on is proven in the harness and not
      in production. Same item as Phase 0's, and the only one on this page that
      code cannot close.
- [x] **An MCP server** (`mcp/`), so an assistant can read the plan and propose
      changes to it from outside the app. Personal access tokens in Settings,
      exchanged for ten-minute user JWTs so RLS still decides. Itinerary writes
      go to the suggestion tray; health and documents are unreachable. See D81
      and D82.
- [x] **Remote HTTP connector** — `/api/mcp/rpc`, authenticated by the
      existing personal access token. No OAuth server, deliberately: see the
      decision below and `mcp/README.md`.
- [x] **`add_journey`** takes a booking as its ordered legs, with times in
      each airport's own zone. `JourneyBuilder` still parses a pasted
      confirmation, which remains the most accurate route for a real booking.
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
- [x] **Stay ↔ expense** — 0022 added the column and the picker fills it.
- **Offline reads: decided against, for now.** Caching the shell is safe
  because it holds no data. Caching the plan means a per-account encrypted store
  on the device, with a key management problem and a stale-data problem, and it
  would put documents and health data on disk outside the browser's own
  protections. That is a different feature with different risks, not an
  extension of the service worker.
- **Background Sync: decided against.** Chromium only, so the app would need a
  queue-and-retry path anyway for everyone else — and once that exists, Background
  Sync saves nothing but adds a second write path that only some users exercise
  and nobody can test locally.
