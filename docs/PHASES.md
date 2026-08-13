# Phase plan

Derived from spec Part 15 (Build Order). One phase per commit, each independently
reviewable. A phase is done when its acceptance criteria pass and `docs/MEMORY.md`
records what changed.

| Phase | Module | Status | Why here |
| --- | --- | --- | --- |
| 0 | Foundations | ✅ done | Scaffold, lib, providers, shell, RLS primitives |
| 1 | 1 — Auth & Couple | ✅ done | Everything depends on `couple_id` |
| 2 | 3 — Trips | ✅ done | The container most other data attaches to |
| 3 | 5 — Itinerary | ⬜ next | The main planning surface |
| 4 | 8 — Documents | ⬜ | Highest standalone value, no dependencies |
| 5 | 2 — Dashboard | ⬜ | Needs the above to have anything to show |
| — | *Milestone* | | Plan one real trip end to end with no other tool |
| 6 | 7 — Wishlist & Blend | ⬜ | Depends on Itinerary |
| 7 | 6 — Map | ⬜ | Depends on Itinerary, Wishlist |
| 8 | 4 — Destinations | ⬜ | Depends on Trips |
| 9 | 10 — Stay Allowance | ⬜ | Depends on Destinations, Trips |
| 10 | 9 — Flights | ⬜ | First external API; polling discipline matters |
| 11 | 11 — Gallery | ⬜ | Largest module; free-tier storage drives its design |
| 12 | 13 — Budget | ⬜ | Self-contained |
| 13 | 14 — Settings | ⬜ | Grows throughout; formalised here |
| 14 | 12 — Health | ⬜ | Last. Consent-first. Design it together. |

Later parts of the spec (16 — Going Public, 17 — Licensing & Payments) are out of
scope until the app is in real use.

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
- [ ] **Blocked on a Supabase project:** apply migrations, configure Google OAuth,
      wire `supabase gen types typescript` into the build, and run the two-account
      RLS verification below.

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

## Phase 3 — Itinerary (next)

Spec: Module 5.

- [ ] `categories` (seeded), `itinerary_items`, `suggestion_tray` + RLS
- [ ] Idea pool: everything with `scheduled_date is null`, always visible
- [ ] Day list for short trips, month grid for long stays
- [ ] **Blank days on a long stay render `RestfulEmpty` — no call to action**
- [ ] Drag pool → day → pool, one UPDATE per move
- [ ] Item editor: title required, everything else optional
- [ ] Day types, with manual types never demoted
- [ ] Conflict badges: overlap, tight connection, busy day — warn, never block
