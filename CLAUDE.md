# Meridian — agent working notes

Travel planning for long-distance couples. Next.js 16 (App Router) + Supabase, free tier only.

**Read these before writing code:**

| File | What it is |
| --- | --- |
| `docs/SPEC.md` | The full implementation spec, verbatim. The source of truth. |
| `docs/MEMORY.md` | Application memory: phase status, decisions, deviations, open questions. Update it every phase. |
| `docs/PHASES.md` | The phase plan and what "done" means for each. |

## The rules that are not negotiable

These come from the spec (Part 15, "Non-negotiables") and apply to every change:

1. **RLS before UI.** Never ship a screen whose table lacks policies.
2. **No API keys in the browser bundle.** Third-party calls go through Route Handlers in `src/app/api`. A key must never be a `NEXT_PUBLIC_` var.
3. **No public storage buckets.** Signed URLs only, 300s.
4. **Advisory data is labelled advisory.** Visa and stay-allowance surfaces always carry source link, verified date, and disclaimer.
5. **Nothing auto-inserts.** Generated content lands in the suggestion tray.
6. **Open days are not empty days.** On stays over 5 nights, blank is the goal — `RestfulEmpty`, never a call to action.
7. **Health data is owner-private by default**, consent enforced in the database.
8. **The app works with AI disabled.** Test with `NEXT_PUBLIC_ENABLE_AI=false` first.

## Conventions

- **Module boundaries.** `src/modules/<name>/` contains `api.ts` (Supabase only), `hooks.ts` (TanStack wrappers), `logic.ts` (pure, unit-tested), `schemas.ts` (zod), `components/`, `pages/`, and `index.ts`. Modules import each other **only** through `index.ts`.
- **Server vs client.** Routes in `src/app` are Server Components by default and handle auth redirects. Anything using a hook, the browser Supabase client, or an event handler carries `'use client'` — including every `api.ts` and `hooks.ts`, since they are browser-only. `logic.ts` stays free of both.
- **Two Supabase clients.** `lib/supabase/client.ts` in the browser, `lib/supabase/server.ts` in Server Components and Route Handlers. Sessions are cookie-based; `src/proxy.ts` refreshes them.
- **Timezones.** All conversion lives in `src/lib/dates.ts`. Instants are `timestamptz`; calendar dates are `date` and never become timestamps. Itinerary items store trip-local wall-clock time; flights store UTC.
- **Ordering.** Fractional keys via `src/lib/fractional.ts`. A reorder is one UPDATE, never a rewrite of siblings.
- **Four states.** Every data view handles loading / error / empty / restful-empty explicitly. See `src/components/common/states.tsx`.
- **Errors.** Everything funnels through `toAppError` in `src/lib/errors.ts`. Never render a raw Postgres message.
- **Naming.** Tables plural snake_case, columns snake_case, TS types PascalCase singular.
- **Every couple-scoped table** gets `id`, `couple_id`, `created_at`, `updated_at`, `created_by`, the `set_updated_at` trigger, and the standard read/write RLS pair. Soft-delete (`deleted_at`) anything a user would regret losing.

## Checklist per module

- [ ] Migration written and applied
- [ ] RLS policies written **before** any screen
- [ ] `src/types/database.ts` updated to match
- [ ] `logic.ts` pure functions unit-tested
- [ ] All four states handled
- [ ] Realtime subscription where two-user conflict is likely
- [ ] Mobile viewport verified
- [ ] Keyboard navigable, visible focus rings
- [ ] Acceptance criteria from the spec met
- [ ] `docs/MEMORY.md` updated

## Commands

```bash
npm run dev         # next dev
npm run typecheck   # tsc --noEmit
npm run lint
npm run test:run    # vitest, single pass
npm run build
```

## Branch

Work happens on `claude/ldr-travel-app-foundation-56w6xg`. Never push to `main`.
