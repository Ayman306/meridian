# Phase plan

Derived from spec Part 15 (Build Order). One phase per commit, each independently
reviewable. A phase is done when its acceptance criteria pass and `docs/MEMORY.md`
records what changed.

| Phase | Module | Status | Why here |
| --- | --- | --- | --- |
| 0 | Foundations | ✅ done | Scaffold, lib, providers, shell, RLS primitives |
| 1 | 1 — Auth & Couple | ✅ done | Everything depends on `couple_id` |
| 2 | 3 — Trips | ⬜ next | The container most other data attaches to |
| 3 | 5 — Itinerary | ⬜ | The main planning surface |
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

## Phase 2 — Trips (next)

Spec: Module 3.

- [ ] `trip_statuses` (seeded), `trips`, `trip_travelers`, `trip_days` + RLS
- [ ] Create with a title alone; dates prominent but skippable
- [ ] Date precision: exact / month / season / year / unknown — display only
- [ ] Trip list grouped Active → Upcoming → Planning → Past
- [ ] Per-traveler arrival/departure and the computed "together" window
- [ ] Day scaffolding: generate on set, extend on lengthen, **prompt** on shorten
- [ ] Long-stay mode at > 5 nights
- [ ] Soft delete, restorable 30 days; photos survive as Unfiled
