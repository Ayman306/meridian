# Route Handlers

Server-side work lives here. This replaces the Supabase Edge Functions the spec
originally called for (spec 0.9) — same guarantees, one language, one deploy.
See decision D19 in `docs/MEMORY.md`.

Every third-party API key is a server-only env var read via `process.env`
inside these handlers. None may ever be prefixed `NEXT_PUBLIC_`, which is what
non-negotiable #2 amounts to under Next.

| Route | Trigger | Purpose | Phase |
| --- | --- | --- | --- |
| `GET /api/health` | GitHub Actions, every 2 days | Keeps the free-tier project from auto-pausing | done |
| `POST /api/extract` | Pasting a link into the wishlist | Reads OpenGraph tags from a page the browser cannot fetch itself (CORS) | done |
| `POST /api/flights/lookup` | On demand | Validate a flight number + date on save (1 AeroDataBox unit) | 10 |
| `GET /api/flights/status` | Client, every 60s while the module is open | OpenSky position + AeroDataBox status, server-gated by max-age | 10 |
| `POST /api/cron/flight-sweep` | pg_cron, every 30 min | Notify when nobody has the app open | 10 |
| `POST /api/cron/expiry-sweep` | pg_cron, daily 08:00 | Document expiry + stay-allowance warnings | 4 |
| `POST /api/ai/suggest` | On demand, optional | The only feature that may be disabled entirely | later |

## The two kinds of handler

**User-initiated.** Read the caller with `createServerSupabase()` and let RLS do
its job. The handler runs as that user and can reach nothing they could not
reach themselves.

One extra rule for any handler that fetches a URL the user supplied, which today
means `/api/extract`: the URL is hostile until proven otherwise. Scheme
allowlist, private and link-local ranges refused, redirects followed by hand
rather than by `fetch`, a timeout, and a cap on how much of the body is read.
See D40 in `docs/MEMORY.md` for what each of those is defending against.

**Cron-initiated.** No user is present, so there is nothing for RLS to key off.
These verify the `x-cron-secret` header with `assertCronRequest()` and only then
use `createAdminSupabase()`, which bypasses RLS. Two rules: check the secret
first, and scope every query yourself, because the database will no longer do it
for you.

pg_cron calls these with `net.http_post`, passing `CRON_SECRET` as a header.

## Budget discipline

AeroDataBox allows roughly 600 units a month. The cache max-age is enforced
here, server-side, shared between both partners, with a hard stop once a flight
has landed — never in the client, where two browsers would double the spend.
