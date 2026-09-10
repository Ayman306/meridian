# Meridian MCP server

Lets an AI assistant read your trips and propose changes to them, from outside
the app — Claude on the web, Claude Desktop, the mobile app, or anything else
that speaks [MCP](https://modelcontextprotocol.io).

## Setting it up

Two things, once. Neither is a secret, and there is nothing to copy into a
config file.

**1. Turn on Supabase's OAuth server.** In the Supabase dashboard:

| Where | Set |
| --- | --- |
| Authentication → OAuth Server | Enable it |
| Authentication → OAuth Server → Authorization Path | `/oauth/consent` |
| Authentication → OAuth Server → Dynamic client registration | Enable it |
| Authentication → URL Configuration → Site URL | your deployment, e.g. `https://meridian-ay-za.vercel.app` |

The authorization path is combined with the Site URL, so those two together
have to point at this app's consent screen. If they don't add up, the flow
dead-ends on a blank page.

**2. Add the connector.** In Claude → Settings → Connectors → Add custom
connector:

```
https://<your-deployment>/api/mcp/rpc
```

That is the whole configuration. The client discovers everything else, registers
itself, and sends you to a consent screen where you tick what it may reach.

### Why there is nothing else to do

The app used to sign its own Supabase JWTs, which meant a `SUPABASE_JWT_SECRET`
in the deployment, an exchange endpoint, personal access tokens, a token file on
your laptop, and — briefly — a hand-written OAuth 2.1 server. All of it is gone
(migration 0032).

**Supabase Auth is the authorization server now.** It handles discovery, dynamic
client registration, PKCE, token issue, refresh rotation and revocation. It signs
the tokens, so this app holds no signing key of any kind, and a project using
asymmetric signing keys works identically — which the old design could not do at
all.

What is left on our side is two files' worth of MCP: a JSON-RPC endpoint and a
tool registry.

## What the app still owns

One thing: **which modules you approved.**

OAuth scopes describe identity — `openid`, `email`, `profile` — and have nothing
to say about whether an assistant may read a cycle log. So the consent screen
writes what you ticked to `mcp_grants`, one row per app per person, and
`/api/mcp/rpc` builds the tool list from it.

That table holds no token, no hash and no secret. It is the only part of the old
credential machinery that survived, because it is the only part Supabase cannot
answer.

## What it can do

Forty-seven tools across nine modules — every module the app has.

| Module | Tools | Writes |
| --- | --- | --- |
| **trips** | `get_overview`, `list_trips`, `get_trip`, `get_trip_journey`, `create_trip`, `update_trip`, `set_trip_day`, `list_stays`, `add_stay`, `update_stay`, `remove_stay`, `get_itinerary`, `suggest_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `list_suggestions`, `dismiss_suggestion`, `whats_new`, `list_integrations` | 11 of 20 |
| **money** | `get_budget`, `log_expense`, `list_settlements`, `record_settlement`, `set_budget`, `get_budgets` | 3 of 6 |
| **flights** | `list_flights`, `add_journey`, `update_flight`, `remove_flight` | 3 of 4 |
| **wishlist** | `list_wishlist`, `find_place`, `add_wishlist_item`, `vote_on_wishlist_item`, `remove_wishlist_item` | 3 of 5 |
| **destinations** | `list_destinations`, `add_destination`, `choose_destination` | 2 of 3 |
| **photos** | `list_photos`, `list_albums` | read-only |
| **allowance** | `list_allowance_rules`, `list_entries` | read-only |
| **health** *(opt-in)* | `list_cycles`, `log_cycle`, `list_health_records`, `add_health_record` | 2 of 4 |
| **documents** *(opt-in)* | `list_documents` | read-only |

Start with `get_overview` for open questions — it answers in one call what
otherwise takes four. For one trip, start with `get_trip_journey`: every day in
order with its flights, planned items and destination, the days deliberately
left blank, the nights with nowhere booked, and the saved places near the trip
that are not on the plan yet.

A guide book for the model on the other end lives in
[`skills/meridian/SKILL.md`](../skills/meridian/SKILL.md).

### Health and documents are off unless you tick them

They appear on the consent screen unticked, under a sentence saying what
granting them means. Somebody who skims and presses the button gets a useful
assistant and no health data.

Two properties hold regardless, and are asserted in `registry.test.ts`: a grant
can never reach the *other* person's health data, and documents expose metadata
only — never a storage path, never a signed URL, never a document number.

### A generated plan is not a dictated one

`suggest_itinerary` writes to the **suggestion tray**, not to the plan. It
appears in the trip for one of you to accept, and only then becomes real items.
A test fails if any tool outside the itinerary module writes `itinerary_items`,
or if a direct-write trips tool ever accepts a *list* of items — bulk means
generated, and generated means the tray.

Single items are different. "Put dinner at Cafe Younes on the Tuesday" is one
thing already decided, so `add_itinerary_item` writes it straight through.

### No accept tool, on purpose

`list_suggestions` shows what is waiting and `dismiss_suggestion` clears one out,
but nothing accepts. An assistant that could both write a draft and accept it has
a direct write to the itinerary with two extra steps — worse than an honest
direct write, because it looks reviewed.

## How a request is judged

The bearer token on a request is an ordinary Supabase access token, issued and
signed by Supabase. `/api/mcp/rpc` hands it back to Supabase to validate, which
is the only party that can say whether the session behind it is still alive —
so disconnecting an assistant takes effect on its very next call rather than
whenever a cache expires.

That token carries a real user id, so **every read and write is judged by exactly
the same row-level security policies as your browser.** An assistant cannot reach
another couple's data because the database refuses, not because this code
remembers to filter.

The service-role key, which *would* bypass RLS, appears nowhere in the MCP path
at all. Not carefully-scoped: absent.

## Notes

- There is no stdio server and no personal access tokens. Both existed because
  remote OAuth was hard, and it is not any more. Two ways in is two ways to get
  wrong.
- A client that cannot do OAuth cannot use this endpoint. That is the accepted
  cost of the above, and it is worth stating rather than discovering.
- The tool list is built per request from the grant, so disconnecting narrows
  what a reconnecting client is offered without touching this code.
