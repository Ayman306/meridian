# Edge Functions

Every third-party API key lives here as a function secret. None of them may ever
appear in the browser bundle (spec 0.9, non-negotiable #2).

| Function | Trigger | Purpose | Phase |
| --- | --- | --- | --- |
| `flight-lookup` | On demand | Validate a flight number + date on save (1 AeroDataBox unit) | 10 |
| `flight-status` | Client, every 60s while the module is open | OpenSky position + AeroDataBox status, server-gated by max-age | 10 |
| `flight-sweep` | pg_cron, every 30 min | Notify when nobody has the app open | 10 |
| `expiry-sweep` | pg_cron, daily 08:00 | Document expiry + stay-allowance warnings | 4 |
| `ai-suggest` | On demand, optional | The only module that may be disabled entirely | later |

Secrets are set with `supabase secrets set NAME=value` and read via
`Deno.env.get('NAME')`. Never commit one.

Budget discipline matters here — AeroDataBox allows roughly 600 units a month
and the cache max-age is enforced server-side, shared between both partners,
with a hard stop once a flight has landed.
