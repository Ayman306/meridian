# Meridian

Travel planning for long-distance couples. Two passports, two time zones, one shared trip.

A browser app on Supabase, built to run entirely on free tiers.

## Stack

React 18 · Vite · TypeScript · Tailwind · TanStack Query · Zustand · React Hook Form + Zod ·
Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) · date-fns-tz · Leaflet

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm run dev
```

You need a Supabase project first:

1. Create one, then apply everything in `supabase/migrations/` in order.
2. Enable the Google auth provider (scopes: `openid email profile`) and add your
   dev and production origins to the redirect allowlist.
3. Regenerate types: `supabase gen types typescript --project-id <ref> > src/types/database.ts`.
4. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as repository secrets so the
   keep-alive workflow can stop the free-tier project auto-pausing.

## Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:run` | Vitest, single pass |

## Layout

```
src/
  lib/           dates, fractional indexing, errors, supabase client, constants
  providers/     Auth, Couple, Theme
  components/    ui primitives, layout, shared (DualTime, PersonBadge, states)
  modules/       one folder per feature: api · hooks · logic · schemas · pages
  types/         database (generated) and domain (hand-written)
supabase/
  migrations/    numbered SQL, applied in order
  functions/     Edge Functions — where every third-party API key lives
docs/
  SPEC.md        the full implementation spec
  PHASES.md      build order and per-phase definition of done
  MEMORY.md      decisions, deviations, open questions
```

Modules never reach into each other's internals — cross-module access goes
through `modules/<name>/index.ts`.

## Status

Phase 1 of 14. See `docs/PHASES.md`.

## Licence

MIT
