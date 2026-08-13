# Application memory

The durable record of how Meridian got built: what exists, what was decided and
why, where the code deviates from `docs/SPEC.md`, and what is still unanswered.

**Update this at the end of every phase.** It is written for whoever picks the
work up next — including a future session with no memory of this one.

---

## Current state

| | |
| --- | --- |
| Phase | 1 complete (Foundations + Auth & Couple) |
| Next | Phase 2 — Trips (spec Module 3) |
| Branch | `claude/ldr-travel-app-foundation-56w6xg` |
| Supabase project | **not yet provisioned** — see Open questions |
| Deployed | no |

### What runs today

Sign in with Google → create or join a couple by code → fill in a profile →
land in an app shell whose routes are all in place but whose module screens are
still placeholders. Typecheck, lint, 47 unit tests and a production build pass.

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

---

## Deviations from the spec

| Spec | Code | Why |
| --- | --- | --- |
| 1.3 `join_couple` raises `INVALID_CODE` for expiry | Raises `EXPIRED_CODE` | D3 — spec 1.7 needs the cases distinguished |
| 1.1 `profiles` columns | Adds `onboarded_at` | D4 |
| 0.4 `couple_members` | Adds a unique index on `user_id` | D1 |
| 0.2 module layout | `providers/` holds Auth/Couple/Theme as specified; `components/common/` also holds `ErrorBoundary` | A render crash on a phone in an airport must not be a blank page |

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
4. **Health module scope.** The spec says design it together, last. Left alone.
