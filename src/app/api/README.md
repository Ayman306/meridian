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
| `POST /api/flights/lookup` | On save | Resolve airline, route, times and callsign (1 AeroDataBox unit, once per flight ever) | done |
| `POST /api/flights/status` | Client, every 60s while the module is open | Batched refresh; decides per flight per source whether a call is allowed | done |
| `POST /api/cron/flight-sweep` | pg_cron, every 30 min | Hard-stops finished flights, then refreshes the ones in play so the watcher learns without the app open | done |
| `GET /api/share/[token]` | A public share link, no session | Validates the token and mints short-lived signed URLs — never a storage path | done |
| `POST /api/cron/media-sweep` | pg_cron, daily | Hard-deletes trashed photos: **storage objects first, then rows** | done |
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

**Public.** `/api/share/[token]` answers with no session at all, which makes it
the only handler where the checks *are* the authorisation: the token exists, it
is not revoked, it has not expired, the passcode matches. It uses the service
role because there is no caller to authorise, and it returns parsed data plus
signed URLs rather than anything the client could reuse.

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

Concretely, in `lib/flights/`:

- `statusMaxAgeSeconds()` decides whether a call may happen at all. It is the
  single most expensive function in the codebase to get wrong.
- `withQuota()` reads spend from `api_usage` — the database, not a counter in a
  process that restarts — and refuses above 90% of the allowance.
- `refreshFlight()` settles both providers separately, so one being down
  degrades a field group with a notice rather than failing the request.
- `deactivate_finished_flights()` is the hard stop, enforced by cron whether or
  not anyone opens the app. Without it, one flight whose landing was missed
  polls until the month is gone.

Manual refresh goes through the same max-age check as the automatic tick, so
spamming the button cannot turn into spend.

## Order of operations in the media sweep

`/api/cron/media-sweep` deletes storage objects **before** the rows that point
at them, and only purges a row once its objects are gone. The reverse order
loses the only record of which files existed, leaving them in a bucket with a
one-gigabyte quota and nothing in the app able to find them. A partial failure
in this order is safe: the row survives and the next sweep tries again.
