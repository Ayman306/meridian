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

| Tool | Module | Writes? |
| --- | --- | --- |
| `list_trips`, `get_trip` | trips | no |
| `get_itinerary` | trips | no |
| `suggest_itinerary` | trips | **to the tray only** |
| `list_wishlist` | wishlist | no |
| `add_wishlist_item` | wishlist | yes |
| `get_budget` | money | no |
| `log_expense` | money | yes |
| `list_flights` | flights | no |

### Nothing lands on an itinerary by itself

`suggest_itinerary` writes to the **suggestion tray**, not to the plan. It shows
up in the trip for one of you to accept or dismiss, and only becomes real
itinerary items when somebody presses accept. This is non-negotiable #5 in
`CLAUDE.md`, and there is a test that fails if any tool ever inserts into
`itinerary_items` directly.

The other two writes — a wishlist save and an expense — are immediate, because
those are you dictating a fact rather than an assistant generating a plan.

### What it cannot do, ever

**Health and documents are unreachable.** Not "off by default" — a token cannot
be scoped to them, the tools do not exist, and `registry.test.ts` fails if one
is ever added. Cycle logs, medications, passport and visa numbers stay in the
app.

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
