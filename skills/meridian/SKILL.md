---
name: meridian
description: Use Meridian, a shared travel planner for a long-distance couple, through its MCP server. Covers trips, day-by-day itineraries, accommodation, flights, destinations, the shared wishlist, money and settlements, photos, stay-allowance rules, and (opt-in) health records and travel documents. Use when asked to plan or change a trip, add or move something on an itinerary, book or record a stay, log a flight or an expense, save a place, work out who owes whom, summarise "what did I miss" or "what's happening", check how many days are left on a visa allowance, or check whether a passport or vaccination is still valid. Trigger phrases include "my trip", "our trip", "the itinerary", "add to the plan", "where are we staying", "what did she add", "what did he add", "who owes what", "our wishlist", "Meridian".
---

# Meridian

Meridian is a planning app used by exactly two people who are usually in two
time zones. Everything is shared between them. When you write, **you are writing
into somebody else's plan as well as the plan of the person talking to you** —
that fact drives most of the rules below.

You reach it through an MCP server with up to 47 tools. Every read is limited by
the database to what this account can actually see; there is no way to reach
another couple's data, and nothing you do here can widen that.

---

## 1. Before anything else: the seven rules

These are not style preferences. Breaking one produces a wrong plan, a false
report, or a claim about somebody's paperwork that is not yours to make.

**1. `suggest_itinerary` does not change the itinerary.** It puts a draft in a
review tray. It becomes real only when one of them opens the app and presses
accept. Say *"I've put a draft in your tray"* — never *"I've updated your
itinerary."* There is deliberately no accept tool.

**2. Generated plans go to the tray; dictated items go straight in.** If they
said *"put dinner at Cafe Younes on Tuesday"*, that is a decision they already
made — use `add_itinerary_item`. If you invented the day, use
`suggest_itinerary`. Calling `add_itinerary_item` in a loop to build out a day
is evading rule 1, not following it.

**3. `check_out` is exclusive.** Three nights from the 4th is
`check_in: 2026-06-04`, `check_out: 2026-06-07`. The 7th is the morning they
leave, not a night they have. Get this wrong and you book a night that does not
exist, or lose one that does.

**4. Never fill a day marked `rest`.** `get_trip_journey` prints
`kept clear on purpose — do not fill this`. On a long stay, a blank day is the
point of the trip. If a day should be blank, mark it `rest` with `set_trip_day`
rather than inventing something to put on it, and list days you skipped in
`open_days` so the reviewer sees it was a choice.

**5. Never pass coordinates. No tool accepts them.** Anything that saves a
location takes `locate_query` (a place name) or `maps_url`, and the server looks
it up. A guessed latitude produces a pin confidently in the wrong suburb that
looks correct in every field a person reads. Use `find_place` first if you are
unsure which "Borough Market" they mean.

**6. Allowance and document data is advisory.** Every number from
`list_allowance_rules` must be quoted with its source and verified date, and
with the fact that it is not immigration advice. `list_entries` is the crossing
log the counts are derived from — if it is incomplete, say the total is
incomplete rather than presenting it as authoritative.

**7. Health data is the token owner's own, and nobody else's.** `list_cycles`,
`log_cycle`, `list_health_records` and `add_health_record` read and write only
the account holding the token, whatever sharing exists in the app. Never advise
on dosage or substitution — record what you were told, exactly as told.

Two more worth knowing: **you can never vote for the partner**
(`vote_on_wishlist_item` casts your own verdict only — two verdicts from two
people is the whole point), and **`whats_new` reports creations only**. Nothing
in this app records who last *edited* a row, so never attribute an edit.

---

## 2. What is deliberately not available

Do not look for these, and do not tell the user they exist:

| Missing | Why |
| --- | --- |
| Booking references on stays | The one thing you cannot reconstruct at a front desk. Stays in the app. |
| Document numbers, files, links | `list_documents` is metadata and expiry dates only. |
| Photo images or URLs | `list_photos` is captions, dates and metadata. |
| An "accept suggestion" tool | Accepting is a person's job, on purpose. |
| `add_integration` / add a webhook | Naming a URL the app will POST their activity to is one tool call away from exfiltrating everything. A person does that in Settings. `list_integrations` reads them; the signing secret is never returned. |
| Any bulk delete of health data | Same reasoning. |

Every write that removes something is a soft delete — recoverable in the app for
thirty days. Say so when you remove something; it lowers the stakes of a
mistake.

---

## 3. Connecting

The token is created by the account owner in **Settings → Connected assistants →
New token**. It starts `mrd_`, is shown once, and is stored hashed. It is scoped
per module at creation time.

**Local, over stdio** — Claude Desktop `claude_desktop_config.json`:

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

Claude Code:

```bash
claude mcp add meridian \
  --env MERIDIAN_URL=https://your-meridian.vercel.app \
  --env MERIDIAN_TOKEN=mrd_... \
  -- npm --prefix /absolute/path/to/meridian run mcp
```

Rather than putting the token in a config file, write it to `~/.meridian/token`
(mode 600) and leave `MERIDIAN_TOKEN` unset.

**Remote, over HTTP** — for a hosted client with no laptop to run a process:

```
POST https://<deployment>/api/mcp/rpc
Authorization: Bearer mrd_...
Content-Type: application/json
```

JSON-RPC 2.0, methods `initialize`, `tools/list`, `tools/call`. The token is
re-verified on every call, so revoking it in Settings takes effect immediately.
There is no OAuth server — a client that can only do OAuth must use stdio.

**Scopes.** A new token defaults to `trips, wishlist, destinations, money,
photos, flights, allowance`. `health` and `documents` are opt-in and never
granted by default, because granting one means that data travels to a model
provider. Tools outside the token's scope are not merely refused — they are
never listed. If a tool you expect is absent, the owner did not grant that
module; say so rather than working around it.

---

## 4. Where to start

| They asked | Call first |
| --- | --- |
| Anything open-ended — "what's happening", "what should I be doing" | `get_overview` |
| Anything about one specific trip | `get_trip_journey` |
| "What did I miss", a morning briefing, "what has she been up to" | `whats_new` |
| Anything needing an id | `list_trips` — every other tool's `trip_id` comes from here |
| "Does this place exist / which one do you mean" | `find_place` |

`get_overview` takes no arguments and answers in one call what otherwise takes
four. `get_trip_journey` is the single most useful read in the server: it
returns every day of a trip in order with its flights, planned items, where
they are sleeping, and which destination they are at — plus the nights with
nowhere booked and the saved places near the trip that are not on the plan yet.
Read it before you suggest anything.

### Reading a journey

```
Day 4 · 2026-06-07 · Lisbon · kept clear on purpose — do not fill this
    check out of Pensão Alfama
    sleeping at Hotel Convento
    09:30 · Flight TP1234 lands LIS
    13:00 · Lunch · Time Out Market [idea]
```

- `kept clear on purpose — do not fill this` → rule 4. Leave it alone.
- `open` → genuinely unplanned, and fair game to suggest for.
- `check out of X` on a day where they also sleep somewhere else is a
  changeover — that day already has work in it.
- `[idea]` / `[accepted]` / `[booked]` / `[done]` / `[skipped]` is the item's
  state. `idea` is not yet agreed.
- Arrivals are printed at the front of a day and departures at the back,
  regardless of clock time — that is the shape of a travel day, not a sort bug.

---

## 5. The tools, by what you are trying to do

`R` = read-only, `W` = writes. Bracketed name is the module the token must have.

### Getting oriented — [trips]

| Tool | Args | Notes |
| --- | --- | --- |
| `get_overview` R | — | Start here for open questions. |
| `whats_new` R | `hours` (24), `limit` (30) | Newest first, with who added it. Creations only. |
| `list_trips` R | `include_past` (false) | Where every `trip_id` comes from. |
| `get_trip` R | `trip_id` | Dates, day structure, per-day notes. |
| `get_trip_journey` R | `trip_id` | The whole picture. Read before suggesting. |
| `list_integrations` R | — | Connected webhooks and whether the last delivery worked. |

### Shaping a trip — [trips]

| Tool | Args |
| --- | --- |
| `create_trip` W | `title`, `start_date?`, `end_date?`, `date_precision?` (`exact\|month\|season\|year\|unknown`), `is_open_ended?`, `notes?` |
| `update_trip` W | `trip_id`, plus any of `title`, `start_date`, `end_date`, `date_precision`, `notes` |
| `set_trip_day` W | `trip_id`, `date`, `day_type?` (`travel\|planned\|open\|rest\|work`), `title?`, `note?` |

A trip with no dates is a normal state — leave them empty rather than guessing.
Changing dates rebuilds the day list and can strand items on days that no longer
exist; re-read `get_trip` after shortening one.

### Planning days — [trips]

| Tool | Args |
| --- | --- |
| `get_itinerary` R | `trip_id` — read before proposing, so you do not duplicate |
| `suggest_itinerary` W | `trip_id`, `note`, `pace?` (`relaxed\|balanced\|packed`), `days[]`, `open_days[]` — **goes to the tray** |
| `add_itinerary_item` W | `trip_id`, `title`, `scheduled_date?`, `start_time?`, `end_time?`, `place_name?`, `locate_query?`, `notes?`, `url?` |
| `update_itinerary_item` W | `item_id`, plus any of `title`, `scheduled_date`, `start_time`, `end_time`, `state`, `notes` |
| `remove_itinerary_item` W | `item_id` |
| `list_suggestions` R | `trip_id` — check whether a draft you left has been accepted |
| `dismiss_suggestion` W | `suggestion_id` — clears a draft nobody kept; changes no plan |

`suggest_itinerary.days` is `[{ date: "YYYY-MM-DD", items: [{ title,
place_name?, locate_query?, notes?, url? }] }]`. Include only the days you are
actually proposing for; put the ones you skipped in `open_days` so it reads as a
decision. Every drafted item is geocoded server-side from `locate_query` or
`place_name`, so the accepted plan arrives with real pins.

### Where they sleep — [trips]

| Tool | Args |
| --- | --- |
| `list_stays` R | `trip_id` |
| `add_stay` W | `trip_id`, `name`, `kind?` (`hotel\|apartment\|guesthouse\|family\|other`), `check_in?`, `check_out?`, `maps_url?`, `locate_query?`, `notes?` |
| `update_stay` W | `stay_id`, plus any of `name`, `check_in`, `check_out`, `notes`, `locate_query` |
| `remove_stay` W | `stay_id` |

`check_out` is exclusive (rule 3). The database refuses a check-out on or before
check-in, which catches a zero-night stay but will not catch an off-by-one — so
count the nights out loud before you write.

### Flights — [flights]

| Tool | Args |
| --- | --- |
| `list_flights` R | `trip_id?`, `include_past?` |
| `add_journey` W | `trip_id?`, `direction?` (`outbound\|return`), `booking_ref?`, `legs[]` |
| `update_flight` W | `flight_id`, plus any of `flight_number`, `flight_date`, `departure_time`, `arrival_time` |
| `remove_flight` W | `flight_id` |

A leg is `{ flight_number, flight_date, origin_iata, dest_iata, departure_time?,
arrival_time? }`. **Times are the local clock at each airport** — departure is
local at the origin, arrival is local at the destination, and neither is your
own clock or UTC. The server converts. A direct flight is one leg; a connection
is two legs in one call; a return is a second call with `direction: "return"`.

### Deciding where to go — [destinations]

| Tool | Args |
| --- | --- |
| `list_destinations` R | `trip_id` — a plan for the wrong city is worse than no plan |
| `add_destination` W | `trip_id`, `city`, `country_code?`, `arrive_on?`, `depart_on?`, `notes?` |
| `choose_destination` W | `destination_id` |

`add_destination` always lands as a candidate. Only call `choose_destination`
when they have actually said they decided — enthusiasm is not a decision.

### The shared wishlist — [wishlist]

| Tool | Args |
| --- | --- |
| `list_wishlist` R | `city?`, `limit` (40) |
| `find_place` R | `query`, `limit` (5) |
| `add_wishlist_item` W | `title`, `place_name?`, `city?`, `country_code?`, `notes?`, `url?`, `maps_url?`, `locate_query?` |
| `vote_on_wishlist_item` W | `wishlist_id`, `verdict` (`yes\|no\|maybe`) |
| `remove_wishlist_item` W | `wishlist_id` |

`add_wishlist_item` writes immediately — use it when they are telling you about
somewhere they want to go, not when you are generating ideas. Generated ideas go
through `suggest_itinerary`.

### Money — [money]

| Tool | Args |
| --- | --- |
| `get_budget` R | `trip_id?`, `limit` (50) — expenses with per-currency totals |
| `get_budgets` R | `trip_id` — the targets that were set |
| `log_expense` W | `description`, `amount`, `currency`, `spent_on`, `trip_id?`, `split_type?` (`equal\|full`), `notes?` |
| `list_settlements` R | `trip_id?`, `limit` (30) |
| `record_settlement` W | `amount`, `currency`, `settled_on`, `direction` (`i_paid_them\|they_paid_me`), `trip_id?`, `method?`, `notes?` |
| `set_budget` W | `trip_id`, `amount`, `currency`, `period?` (`trip\|week`) |

**Currency is required and must never be guessed from the destination** — people
pay in cards, in cash, and in the wrong country's currency all the time. Totals
are never summed across currencies, and you should not sum them either; report
"€340 and £85", not a converted total, unless they ask you to convert and you
say what rate you used.

"Who owes whom" needs both sides: `get_budget` for what was spent and
`list_settlements` for what has already been paid back. `record_settlement`
records that money moved — it does not move any.

### Photos — [photos]

`list_photos` R (`trip_id?`, `favourites_only?`, `limit` 40) and `list_albums` R
(`trip_id?`). Captions, dates and metadata only — no images, no links. Good for
"what did we do in Mangalore" answered from captions and dates.

### Stay allowance — [allowance]

`list_allowance_rules` R (`country?`) and `list_entries` R (`country?`,
`limit` 50). Read-only, and advisory — see rule 6. Always: the number, the
source, the verified date, and "this is not immigration advice."

### Health — [health], opt-in

`list_cycles` R (`limit`), `log_cycle` W (`started_on`, `ended_on?`, `flow?`
`light|medium|heavy`, `notes?`), `list_health_records` R (`kind?`
`medication|vaccination|condition|allergy`), `add_health_record` W (`kind`,
`label`, `dosage?`, `frequency?`, `started_on?`, `valid_until?`, `detail?`).

Owner's own data only. Do not infer a start date — record the one you were told.

### Documents — [documents], opt-in

`list_documents` R (`expiring_within_days?`). Labels, countries and expiry dates
only. Good for "is my passport still valid for this trip"; useless for anything
needing the number, and that is intentional.

---

## 6. Recipes

### Plan a few days of an upcoming trip

1. `list_trips` → the `trip_id`.
2. `get_trip_journey` → which days exist, which are travel days, which are
   `rest`, which destination is chosen, what is already planned, and which saved
   places are nearby but unused.
3. `list_wishlist` (optionally `city`) → things they have already shown interest
   in. Prefer these over your own inventions; they are evidence, not guesses.
4. `find_place` for anything you are unsure exists or is ambiguous.
5. `suggest_itinerary` — one call, only the days you are proposing for, the rest
   named in `open_days`, and a `note` that explains your reasoning in a sentence
   or two, because a human is about to read it cold.
6. Report: *"Draft is in your tray for days 3, 5 and 6 — I left 4 and 7 open
   because you have a check-out on 4 and it's a nine-night stay. Open Meridian
   to accept or throw it away."*

Do not call `list_suggestions` immediately to "confirm" — the draft is there;
checking it back proves nothing and costs a round trip. Use it later, when they
ask whether the draft was ever accepted.

### Morning briefing

1. `whats_new` with `hours: 12` (or since they last looked).
2. `get_overview` for what is next.
3. Optionally `get_trip_journey` on the nearest trip if something needs
   attention.

Lead with what the *partner* did — the user was there for their own edits.
Attribute by name, and never claim an edit had an author.

### Record a stay they just booked

1. `list_trips` → `trip_id`.
2. Count the nights out loud: *"the 12th to the 15th is three nights."*
3. `add_stay` with `check_in: 2026-06-12`, `check_out: 2026-06-15`,
   `locate_query: "Hotel Convento, Lisbon"`.
4. `get_trip_journey` afterwards only if you want to confirm the unbooked-nights
   list shrank; the tool's reply already confirms the write.

If they read you a booking reference, tell them it goes in the app — you cannot
store it and you should not put it in a note field as a workaround.

### Log a flight booking

`add_journey` once per direction, all legs of that direction in one call, in
travel order, times local at each airport. A DXB→BOM→GOI connection is two legs
in one call, not two calls.

### Answer "how many days do I have left in the Schengen area"

1. `list_allowance_rules` with `country`.
2. `list_entries` with the same `country`.
3. Answer with the number, the rule's source, its verified date, whether the
   crossing log looks complete, and the disclaimer. If the log has gaps, the
   answer is *"based on what's recorded, which may be incomplete"* — never a
   bare figure.

### Answer "who owes whom"

`get_budget` and `list_settlements`, per currency, then state the balance in
each currency separately. Do not net across currencies.

---

## 7. When something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| "There is no couple set up on this account yet" | Solo mode — one person signed in, partner has not joined. Legitimate, not an error. | Explain it plainly; they finish setup in the app. |
| `No tool called "x" is available to this token` | The module was not granted, or you invented the name. | Do not work around it. Name the module they would need to grant. |
| 401 on every call | Token revoked, expired, or mistyped. | New token in Settings → Connected assistants. |
| 503 from the token exchange | `SUPABASE_JWT_SECRET` is not set on the deployment. | Nothing else in the app is affected; it is a deployment setting. |
| A login page instead of JSON | Vercel Deployment Protection is on. | The endpoint needs a protection-bypass token. |
| `find_place` returns nothing | The name is too vague or genuinely unknown. | Ask which one they mean. Never fall back to guessing a location — there is no field to guess into anyway. |
| "No trip with that id, or it is not one you can see" | Wrong id, or deleted. | `list_trips` again. |
| A stay saved with no address | Geocoding found nothing. | Honest and fixable in the app. Say so; do not retry with a made-up address. |

Tool errors come back as readable text rather than protocol failures,
specifically so you can read what went wrong and fix it — usually by looking up
an id you did not have.

---

## 8. How to report back

- **Say what actually happened.** A tray draft is a proposal. A soft delete is
  recoverable for thirty days. A settlement is a record, not a transfer.
- **Name the other person.** "Ada added three places in Lisbon last night" is
  the sentence this app exists to produce.
- **Prefer their words.** If they said "the Lisbon trip", say that, not
  `trip_id 3fa9b2c1`.
- **Do not pad an empty result.** No activity is a normal morning. Say so in
  half a sentence and stop.
- **Flag what you left alone.** "I didn't touch the 7th — it's marked as a rest
  day" is more useful than silence, because it tells them the rule was seen and
  applied rather than missed.
