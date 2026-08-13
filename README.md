# Meridian

Travel planning for long-distance couples. Two passports, two time zones, one shared trip.

One repo, frontend and backend, built to run entirely on free tiers.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind · TanStack Query · Zustand ·
React Hook Form + Zod · Supabase (Postgres, Auth, Storage, Realtime) · date-fns-tz · Leaflet

Frontend and backend live in this one repo: the app under `src/app`, the schema
under `supabase/migrations`, and the server-side work as Route Handlers under
`src/app/api`.

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
4. Add `APP_URL` as a repository secret, pointing at the deployed origin, so the
   keep-alive workflow can stop the free-tier project auto-pausing.

## Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:run` | Vitest, single pass |

## Layout

```
src/
  app/           App Router: routes, layouts, and api/ Route Handlers
  proxy.ts       refreshes the Supabase session on every request
  lib/           dates, fractional indexing, errors, supabase clients, constants
  providers/     Auth, Couple, Theme
  components/    ui primitives, layout, shared (DualTime, PersonBadge, states)
  modules/       one folder per feature: api · hooks · logic · schemas · pages
  types/         database (generated) and domain (hand-written)
supabase/
  migrations/    numbered SQL, applied in order
docs/
  SPEC.md        the full implementation spec
  PHASES.md      build order and per-phase definition of done
  MEMORY.md      decisions, deviations, open questions
```

Server-side work — anything holding a third-party API key — lives in
`src/app/api`. See its README for the route table and the two handler kinds.

Modules never reach into each other's internals — cross-module access goes
through `modules/<name>/index.ts`.

## Status

Phase 3 of 14, on Next.js. See `docs/PHASES.md`.

## Licence

MIT
