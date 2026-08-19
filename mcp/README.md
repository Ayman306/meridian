# Meridian MCP server

Lets an AI assistant read your trips and propose changes to them, from outside
the app.

It speaks [MCP](https://modelcontextprotocol.io) over stdio, so it runs on your
own machine next to Claude Desktop, Claude Code or anything else that speaks the
protocol. A remote HTTP connector is the intended next step; the tools are
written to be transport-agnostic so that when it lands it wraps the same
registry rather than duplicating it.

## Setting it up

**1. Add the JWT secret to the deployment.** Supabase Dashboard → Project
Settings → API → JWT Settings → JWT Secret, then set `SUPABASE_JWT_SECRET` in
Vercel's environment variables. Without it the token exchange answers 503 and
nothing else in the app is affected.

**2. Make a token.** In Meridian: Settings → Connected assistants → New token.
Name it after the machine it will live on, and untick anything it does not need.
It is shown once — it is stored hashed, so there is no way to show it again.

**3. Point a client at it.** For Claude Desktop, in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/meridian", "run", "mcp"],
      "env": {
        "MERIDIAN_URL": "https://your-meridian.vercel.app",
        "MERIDIAN_TOKEN": "mrd_..."
      }
    }
  }
}
```

For Claude Code: `claude mcp add meridian --env MERIDIAN_URL=... --env
MERIDIAN_TOKEN=... -- npm --prefix /absolute/path/to/meridian run mcp`.

If you would rather not put the token in a config file, write it to
`~/.meridian/token` (mode 600) and leave `MERIDIAN_TOKEN` unset.

## What it can do

Thirty-nine tools across nine modules — every module the app has.

| Module | Tools | Writes |
| --- | --- | --- |
| **trips** | `get_overview`, `list_trips`, `get_trip`, `create_trip`, `update_trip`, `set_trip_day`, `get_itinerary`, `suggest_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `list_suggestions`, `dismiss_suggestion` | 8 of 13 |
| **money** | `get_budget`, `log_expense`, `list_settlements`, `record_settlement`, `set_budget`, `get_budgets` | 3 of 6 |
| **flights** | `list_flights`, `add_journey`, `update_flight`, `remove_flight` | 3 of 4 |
| **wishlist** | `list_wishlist`, `add_wishlist_item`, `vote_on_wishlist_item`, `remove_wishlist_item` | 3 of 4 |
| **destinations** | `list_destinations`, `add_destination`, `choose_destination` | 2 of 3 |
| **photos** | `list_photos`, `list_albums` | read-only |
| **allowance** | `list_allowance_rules`, `list_entries` | read-only |
| **health** *(opt-in)* | `list_cycles`, `log_cycle`, `list_health_records`, `add_health_record` | 2 of 4 |
| **documents** *(opt-in)* | `list_documents` | read-only |

Start with `get_overview` for open questions — it answers in one call what
otherwise takes four.

### A generated plan is not a dictated one

`suggest_itinerary` writes to the **suggestion tray**, not to the plan. It
appears in the trip for one of you to accept, and only then becomes real items.
That is non-negotiable #5, and a test fails if any tool outside the itinerary
module writes `itinerary_items`, or if a direct-write trips tool ever accepts a
*list* of items — bulk means generated, and generated means the tray.

Single items are different. "Put dinner at Cafe Younes on the Tuesday" is one
thing the person already decided, so `add_itinerary_item` writes it straight
through. Looping that call to build a day is evading the rule, and the tool
description says so.

### No accept tool, on purpose

`list_suggestions` shows what is waiting in the tray and `dismiss_suggestion`
clears one out, but nothing accepts. An assistant that could both write a draft
and accept it has a direct write to the itinerary with two extra steps — worse
than an honest direct write, because it looks reviewed. Accepting happens in the
app, by a person, looking at it.

### Read-only on purpose

**Photos** are metadata only — captions, dates, favourites. Never the image and
never a link: `path_original` is a key into a private bucket reached by signed
URLs that expire in 300 seconds.

**Allowance** rules are copied from official sources with a `verified_on` date.
A Schengen rule rewritten from a model's memory is the confident, plausible,
wrong answer that gets somebody stopped at a border — so those are read-only,
and every response carries the source, the date and the disclaimer.

**Documents** are metadata only: label, country, expiry. Never the storage path,
never a signed URL (they last 300 seconds precisely so they cannot outlive the
moment), never even the last four digits of a number.

### Health and documents are opt-in, not off-limits

These were refused outright in the first version. They are now reachable, but
only by a token whose owner ticked them, and never by default.

A token *is* its owner. RLS restricts health to `owner_id = auth.uid()`, and the
health tools narrow it again in the query itself — so a token can only ever read
the health data of whoever created it. Not their partner's, even where consent
was granted in the app: consent was given so a person could look with their own
eyes, not so an assistant could sweep up what they were trusted with. A test
asserts that filter is on every health query.

What genuinely changes when you grant these is that the data reaches an AI
provider. Settings says so plainly at the moment you tick the box.

There is no health delete tool. `delete_all_health_data()` is irreversible by
design, and a tool for it would put total erasure one hallucinated call away.

## How the credential works

The token in your config file is **not** a database credential. It is exchanged
at `/api/mcp/token` for a **ten-minute JWT** carrying your user id, and that JWT
is what talks to Postgres — so every read and write is judged by exactly the
same row-level security policies as your browser. An assistant cannot reach
another couple's data because the database refuses, not because this code
remembers to filter.

The service-role key, which *would* bypass RLS, appears nowhere in the tool
path. It is used once, inside the exchange handler, to answer "which user is
this token" — and that handler returns a JWT, never data.

Only the SHA-256 of your token is stored. The `token_hash` column is not
readable even by you: the table-level `SELECT` grant is revoked and the safe
columns are granted back by name (migration 0019).

Revoke from Settings and it stops working on the next exchange, within ten
minutes at the outside.

## Notes

- **Never print to stdout** from this server. stdout carries protocol frames;
  a stray `console.log` corrupts the stream and the client drops the connection
  with an error that points nowhere near the print. Use `console.error`.
- The tool list is built per request from the token's scope, so narrowing a
  token takes effect on the next client reconnect without touching this code.
