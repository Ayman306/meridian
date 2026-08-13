# Meridian — Implementation Documentation

Complete module-by-module build specification. Browser app, Supabase backend, free-tier only.

**How to use this:** each module is self-contained — schema, logic, services, screens, edge cases, acceptance criteria. Hand one module at a time to the coding agent. Build in the order given in Part 15.

# PART 0 — ARCHITECTURE

## 0.1 Stack

|  |  |  |
| :-: | :-: | :-: |
| \*\*Layer\*\* | \*\*Choice\*\* | \*\*Notes\*\* |
| Framework | \*\*React 18 + Vite + TypeScript\*\* | Browser app, SPA |
| Routing | \*\*React Router v6\*\* | Nested routes, loaders not required |
| Styling | \*\*Tailwind CSS + shadcn/ui\*\* | Copy-in components, no runtime dep |
| Server state | \*\*TanStack Query v5\*\* | Cache, invalidation, optimistic updates |
| Client state | \*\*Zustand\*\* | Only UI state: modals, filters, drag state |
| Forms | \*\*React Hook Form + Zod\*\* | Zod schemas shared with validation |
| Backend | \*\*Supabase\*\* | Postgres, Auth, Storage, Realtime, Edge Functions |
| Dates | \*\*date-fns + date-fns-tz\*\* | Never hand-roll timezone maths |
| Maps | \*\*Leaflet + OpenStreetMap\*\* | No API key, no card required |
| Geocoding | \*\*Nominatim\*\* (rate-limited) or \*\*Photon\*\* | Free, no key |
| Flight data | \*\*AeroDataBox\*\* via RapidAPI | Free tier \\\~600 units/month |
| Charts | \*\*Recharts\*\* | Budget module only |
| Drag & drop | \*\*@dnd-kit/core\*\* | Itinerary reordering |
| Image processing | \*\*browser-image-compression\*\* + Canvas | Client-side derivatives |
| Hosting | \*\*Vercel\*\* or \*\*Cloudflare Pages\*\* | Free tier, SPA build |

## 0.2 Project structure

src/

  main.tsx

  App.tsx

  routes.tsx

  lib/

    supabase.ts           \# client singleton

    queryClient.ts

    dates.ts              \# ALL timezone logic lives here

    fractional.ts         \# sort\_order key generation

    errors.ts             \# normalized error shapes

    constants.ts

  types/

    database.ts           \# generated: supabase gen types typescript

    domain.ts             \# hand-written domain types

  providers/

    AuthProvider.tsx

    CoupleProvider.tsx    \# couple\_id + both profiles, app-wide

    ThemeProvider.tsx

  components/

    ui/                   \# shadcn primitives

    layout/               \# AppShell, Nav, PageHeader

    common/               \# EmptyState, ErrorState, Loading, ConfirmDialog

    DualTime.tsx          \# used everywhere

    PersonBadge.tsx       \# whose-pick marker

  modules/

    auth/

    dashboard/

    trips/

    destinations/

    itinerary/

    map/

    wishlist/

    documents/

    flights/

    stay-allowance/

    gallery/

    health/

    budget/

    settings/

  \# each module folder:

  \#   index.ts            \# public exports only

  \#   api.ts              \# supabase queries, returns typed data

  \#   hooks.ts            \# useQuery / useMutation wrappers

  \#   logic.ts            \# pure functions, unit-testable

  \#   schemas.ts          \# zod

  \#   types.ts

  \#   components/

  \#   pages/

supabase/

  migrations/

  functions/

    flight-poll/

    flight-lookup/

    ai-suggest/

    expiry-sweep/

**Rule:** modules never import from each other's internals. Cross-module access goes through modules/x/index.ts only. This keeps modules independently buildable.

## 0.3 Core conventions

**Every table has:**

id           uuid primary key default gen\_random\_uuid()

couple\_id    uuid not null references couples(id) on delete cascade

created\_at   timestamptz not null default now()

updated\_at   timestamptz not null default now()

created\_by   uuid references profiles(id)

Exception: health tables use owner\_id and are owner-scoped, not couple-scoped.

**updated\_at** **trigger** applied to every table:

create or replace function set\_updated\_at()

returns trigger language plpgsql as $$

begin new.updated\_at = now(); return new; end $$;

**Soft delete** on anything a user would regret losing (media, itinerary\_items, documents):

deleted\_at timestamptz null

All queries filter deleted\_at is null. A cron hard-deletes after 30 days.

**Naming:** tables plural snake\_case, columns snake\_case, TS types PascalCase singular.

## 0.4 The couple model

Exactly two members. Enforced:

create table couples (

  id uuid primary key default gen\_random\_uuid(),

  name text,

  anniversary\_date date,

  invite\_code text unique,

  invite\_expires\_at timestamptz,

  created\_at timestamptz default now()

);

create table couple\_members (

  couple\_id uuid references couples(id) on delete cascade,

  user\_id uuid references profiles(id) on delete cascade,

  joined\_at timestamptz default now(),

  primary key (couple\_id, user\_id)

);

\-- Hard cap at 2

create or replace function enforce\_couple\_size()

returns trigger language plpgsql as $$

begin

  if (select count(\*) from couple\_members where couple\_id = new.couple\_id) \>= 2 then

    raise exception 'A couple already has two members';

  end if;

  return new;

end $$;

create trigger couple\_size\_check

  before insert on couple\_members

  for each row execute function enforce\_couple\_size();

**The RLS helper used by every policy:**

create or replace function is\_couple\_member(target uuid)

returns boolean language sql security definer stable

set search\_path = public as $$

  select exists (

    select 1 from couple\_members

    where couple\_id = target and user\_id = auth.uid()

  );

$$;

**Standard policy applied to every couple-scoped table:**

alter table \<t\> enable row level security;

create policy "couple read" on \<t\>

  for select using (is\_couple\_member(couple\_id));

create policy "couple write" on \<t\>

  for all using (is\_couple\_member(couple\_id))

      with check (is\_couple\_member(couple\_id));

**Get the partner** — used constantly:

create or replace function partner\_id()

returns uuid language sql security definer stable as $$

  select cm2.user\_id

  from couple\_members cm1

  join couple\_members cm2 on cm1.couple\_id = cm2.couple\_id

  where cm1.user\_id = auth.uid() and cm2.user\_id \!= auth.uid()

  limit 1;

$$;

## 0.5 Timezone handling — the single most error-prone area

**Rules, no exceptions:**

1.  All timestamps stored as timestamptz (UTC). Never timestamp.
2.  Calendar dates with no time (trip start, document expiry, cycle start) stored as date. **Never convert these to timestamps** — a birthday is not a moment.
3.  Timezone conversion happens only at render time, only in lib/dates.ts.
4.  Each profile stores an IANA timezone string (America/Toronto), never an offset.

// lib/dates.ts

import { formatInTimeZone, toZonedTime } from 'date-fns-tz'

export function dualTime(utc: string, tzA: string, tzB: string) {

  return {

    a: formatInTimeZone(utc, tzA, 'HH:mm'),

    b: formatInTimeZone(utc, tzB, 'HH:mm'),

    sameDay: formatInTimeZone(utc, tzA, 'yyyy-MM-dd')

             === formatInTimeZone(utc, tzB, 'yyyy-MM-dd'),

    dayOffset: /\* -1, 0, +1 \*/

  }

}

// Trip-local dates: an itinerary item at "10:00 in Lisbon" is stored as

// scheduled\_date (date) + start\_time (time) + the trip's timezone.

// Resolve to UTC only when comparing against real instants (e.g. flights).

export function tripLocalToUtc(date: string, time: string, tripTz: string): Date

**Itinerary items store local wall-clock time, not UTC.** "Dinner at 8pm" means 8pm where they are, regardless of what happens to be true in UTC. Store scheduled\_date date + start\_time time and interpret in the destination's timezone.

**Flights store UTC**, because a flight departs at an absolute instant.

Getting this distinction wrong is the most likely source of subtle bugs in the whole app.

## 0.6 Ordering — fractional indexing

Drag-and-drop reordering must not rewrite every row. Use fractional string keys.

// lib/fractional.ts

// Generates a key strictly between a and b. Either may be null (start/end).

export function keyBetween(a: string | null, b: string | null): string

Column: sort\_key text not null. Index on (parent\_id, sort\_key).

Use the fractional-indexing npm package rather than writing it — the edge cases around key length growth are non-obvious.

## 0.7 Error and loading conventions

Every data view handles four states explicitly. No exceptions.

|  |  |  |
| :-: | :-: | :-: |
| \*\*State\*\* | \*\*Component\*\* | \*\*Rule\*\* |
| Loading | \\\<Skeleton /\\\> matching final layout | Never a spinner on a full page |
| Error | \\\<ErrorState onRetry /\\\> | Says what failed and offers retry |
| Empty (nothing yet) | \\\<EmptyState action /\\\> | An invitation. One clear action. |
| Empty (by design) | \\\<RestfulEmpty /\\\> | E.g. an open day. \*\*Offers nothing.\*\* |

The distinction between the two empty states is a real product requirement, not polish. See Module 5.

## 0.8 Realtime sync

Two users editing the same trip simultaneously is normal. Subscribe to Postgres changes on the active trip's tables and invalidate the relevant TanStack Query keys.

supabase.channel(\`trip:${tripId}\`)

  .on('postgres\_changes',

      { event: '\*', schema: 'public', table: 'itinerary\_items',

        filter: \`trip\_id=eq.${tripId}\` },

      () =\> queryClient.invalidateQueries({ queryKey: \['itinerary', tripId\] }))

  .subscribe()

**Conflict policy: last write wins.** With two trusted users this is correct and simple. Do not build CRDTs.

Show a subtle presence indicator when the partner is viewing the same trip.

## 0.9 Edge Functions

All third-party API keys live here. Never in the browser bundle.

|  |  |  |
| :-: | :-: | :-: |
| \*\*Function\*\* | \*\*Trigger\*\* | \*\*Purpose\*\* |
| flight-lookup | On demand | Validate flight number + date on save (1 unit) |
| flight-status | Client, every 60s while module open | Two sources: OpenSky position (cheap, \\\~60s) + AeroDataBox status (gated by max-age). Module 9.2/9.2b |
| flight-sweep | pg\\\_cron, every 30 min | Notifications when nobody has the app open |
| expiry-sweep | pg\\\_cron daily 08:00 | Document expiry + stay allowance warnings |
| ai-suggest | On demand, optional | Only module that may be disabled |

Standard shape:

Deno.serve(async (req) =\> {

  const auth = req.headers.get('Authorization')

  if (\!auth) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(url, anonKey, {

    global: { headers: { Authorization: auth } }

  })

  const { data: { user } } = await supabase.auth.getUser()

  if (\!user) return json({ error: 'unauthorized' }, 401)

  // ... work, using service-role client only where RLS must be bypassed

})

## 0.10 Free-tier constraints that shape design

|  |  |
| :-: | :-: |
| \*\*Constraint\*\* | \*\*Consequence\*\* |
| \\\~1 GB storage | Gallery stores \*\*no originals\*\* — 400px thumb + 1600px display only |
| \\\~5 GB/mo egress | Grid loads thumbs only; lazy-load; thumbhash placeholders |
| \\\~500 MB database | Metadata only. Never store binary in Postgres. |
| Project auto-pauses after \\\~7 days idle | \*\*GitHub Actions cron pings a health endpoint every 2 days\*\* |
| No automated backups | Monthly manual pg\\\_dump + storage sync |
| AeroDataBox \\\~600 units/mo | Status only. Server-enforced cache max-age, shared between partners, hard stop on landing. |
| OpenSky \\\~4,000 credits/day | Live position. Generous enough for true 60s polling. Always send a bounding box — credits scale with area. |

# MODULE 1 — AUTH & COUPLE

**Purpose:** get two people signed in and linked. Everything else depends on couple\_id existing.

## 1.1 Schema

create table profiles (

  id uuid primary key references auth.users(id) on delete cascade,

  display\_name text,

  avatar\_url text,

  home\_city text,

  home\_country text,

  home\_lat numeric, home\_lng numeric,

  timezone text not null default 'UTC',        -- IANA

  nationality text,                            -- ISO 3166-1 alpha-2

  second\_nationality text,

  accent\_color text default 'amber',

  created\_at timestamptz default now(),

  updated\_at timestamptz default now()

);

alter table profiles enable row level security;

create policy "read self" on profiles

  for select using (id = auth.uid());

create policy "read partner" on profiles

  for select using (id = partner\_id());

create policy "update self" on profiles

  for update using (id = auth.uid());

Auto-create on signup:

create or replace function handle\_new\_user()

returns trigger language plpgsql security definer

set search\_path = '' as $$

begin

  insert into public.profiles (id, display\_name, avatar\_url)

  values (new.id,

          new.raw\_user\_meta\_data-\>\>'full\_name',

          new.raw\_user\_meta\_data-\>\>'avatar\_url');

  return new;

end $$;

create trigger on\_auth\_user\_created

  after insert on auth.users

  for each row execute function handle\_new\_user();

## 1.2 Features

**Sign in**

  - Google OAuth only (scopes: openid, email, profile — all non-sensitive, no Google verification required)
  - Redirect back to app, session persisted in localStorage
  - Auto-refresh token
  - Sign out clears TanStack Query cache

**Couple creation**

  - First user creates a couple, becomes member 1
  - Generates 8-char alphanumeric invite code, 7-day expiry
  - Code displayed with copy button

**Couple joining**

  - Second user enters code
  - Validates: exists, not expired, couple has \< 2 members
  - On success: insert couple\_members, null the invite code
  - Both users now see shared data

**Profile setup**

  - Prompted once after joining: home city, timezone, nationality, accent colour
  - Timezone auto-detected via Intl.DateTimeFormat().resolvedOptions().timeZone, editable
  - Home city geocoded via Nominatim → lat/lng (needed for distance calculations)

## 1.3 Logic

**Invite code generation** — exclude ambiguous characters:

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'  // no I, L, O, 0, 1

**Join validation** — must be a single transactional RPC, not client-side checks:

create or replace function join\_couple(code text)

returns uuid language plpgsql security definer as $$

declare target uuid;

begin

  select id into target from couples

   where invite\_code = upper(code)

     and invite\_expires\_at \> now()

   for update;

  if target is null then raise exception 'INVALID\_CODE'; end if;

  if (select count(\*) from couple\_members where couple\_id = target) \>= 2

    then raise exception 'COUPLE\_FULL'; end if;

  if exists (select 1 from couple\_members where user\_id = auth.uid())

    then raise exception 'ALREADY\_PAIRED'; end if;

  insert into couple\_members (couple\_id, user\_id) values (target, auth.uid());

  update couples set invite\_code = null where id = target;

  return target;

end $$;

**Distance between partners** — Haversine, used by Dashboard:

export function haversineKm(a: LatLng, b: LatLng): number

## 1.4 State: solo mode

A user who has signed in but not yet paired must not see a broken app.

  - All modules hidden except Settings and the pairing screen
  - Pairing screen shows their own invite code + a field to enter one
  - This is a real, potentially long-lived state (partner may join days later)

## 1.5 Services

signInWithGoogle(): Promise\<void\>

signOut(): Promise\<void\>

getCouple(): Promise\<Couple | null\>

createCouple(name?): Promise\<Couple\>

joinCouple(code): Promise\<Couple\>

regenerateInviteCode(): Promise\<string\>

updateProfile(patch): Promise\<Profile\>

getPartner(): Promise\<Profile | null\>

## 1.6 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /login | Google sign-in |
| /pair | Create or join couple |
| /setup | Profile: city, timezone, nationality, colour |

## 1.7 Edge cases

  - User signs in on a second browser → same session, no re-pairing
  - Both users try to create a couple → each has their own; one must leave and join the other. Provide a "leave couple" action in Settings (dangerous, confirm twice).
  - Invite code expired → clear message, offer regenerate (only the creator can)
  - Partner deletes account → surviving user sees a degraded but functional app; all shared data remains, partner shows as "Former partner"

## 1.8 Acceptance

  - Two accounts pair via code and see identical trip data
  - A third account cannot join with the same code
  - User A cannot read User B's rows before pairing (verify by direct query with A's JWT)
  - Profile trigger populates name and avatar from Google
  - Expired code rejected with a distinct error

# MODULE 2 — DASHBOARD

**Purpose:** the home screen. Answers "when do we next see each other, and is anything wrong?" in one glance.

## 2.1 Schema

None of its own. Reads from trips, flights, documents, gallery, stay\_allowances.

Optional materialised cache if queries get slow (they won't at this scale):

create table dashboard\_cache (

  couple\_id uuid primary key references couples(id) on delete cascade,

  payload jsonb not null,

  computed\_at timestamptz default now()

);

## 2.2 Features

**Countdown block**

  - Days until next trip start date
  - Destination name and dates
  - Live-updating (recompute at midnight in each user's timezone)
  - States: no trip / trip planned no dates / dates set / travel day / together / departing

**Dual clocks**

  - Current time in both home cities
  - Day-of-week and date, with +1 / −1 day indicator when they differ
  - Day/night indicator per city (sunrise/sunset computed locally, no API — use suncalc)
  - When together, collapse to one clock

**Days together counter**

  - Total nights spent together this calendar year
  - Derived from past trips: sum of overlapping days where both had arrived
  - Lifetime total as a secondary figure

**Distance**

  - Haversine between the two current locations
  - When one is travelling, use the flight's current position if available, else destination

**Alerts strip** — highest priority first:

1.  Document expiring \< 90 days
2.  Passport under 9 months validity
3.  Stay allowance breach on a planned trip
4.  Flight delay on an active flight
5.  Unresolved trip with no dates \> 60 days old (gentle)

**Active flight card**

  - Only shown on travel day
  - Status, times, and the "leave at" figure (Module 9)

**Quick actions**

  - Open active trip
  - Add photo
  - Add itinerary item

## 2.3 Logic

**Days-together calculation:**

For each past/current trip:

  both\_present\_start = max(traveler\_A.arrival\_date, traveler\_B.arrival\_date)

  both\_present\_end   = min(traveler\_A.departure\_date, traveler\_B.departure\_date)

  nights = max(0, both\_present\_end - both\_present\_start)

Sum across trips, filtered by year.

Trips missing per-person dates fall back to trip start/end. Trips with no dates contribute 0.

**Countdown state machine:**

no trips                          → EMPTY

next trip, no start\_date          → PLANNING

next trip, start\_date \> today     → COUNTDOWN (n days)

today == any traveler arrival     → TRAVEL\_DAY

both arrived, before departure    → TOGETHER (day n of m)

one departure today               → DEPARTING

**Recompute triggers:** on mount, on window focus, on realtime change, and at local midnight (schedule a timeout to the next midnight in the user's tz).

## 2.4 Services

getDashboard(): Promise\<{

  countdown: CountdownState

  clocks: { self: ClockInfo; partner: ClockInfo }

  daysTogetherYear: number

  daysTogetherLifetime: number

  distanceKm: number

  alerts: Alert\[\]

  activeFlight: Flight | null

}\>

Implemented as one Postgres RPC returning a single JSON payload — avoids six round trips on the most-visited screen.

## 2.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| / | Dashboard |

## 2.6 Edge cases

  - No trips at all → countdown block becomes an invitation with one action
  - Trip exists with no dates → show "Planning: Lisbon" with no number, not "NaN days"
  - Both partners in the same city → collapse clocks, hide distance, show "Together"
  - Flight data unavailable → show scheduled times with a "last checked" stamp, never an error
  - Year boundary → days-together counter resets Jan 1 in whose timezone? Use the viewer's.

## 2.7 Acceptance

  - Countdown correct across a timezone boundary (test with tz set to Kiribati and Hawaii)
  - Clocks update every minute without re-rendering the whole page
  - Alerts sorted by severity, max 3 shown, rest behind "see all"
  - Dashboard loads in one network request

# MODULE 3 — TRIPS

**Purpose:** the container everything else attaches to. Deliberately permissive — a trip needs only a title.

## 3.1 Schema

create table trip\_statuses (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  name text not null,

  color text,

  sort\_order int not null default 0,

  is\_terminal boolean default false        -- e.g. 'Completed', 'Cancelled'

);

\-- seeded: Idea, Planning, Booked, Active, Completed, Cancelled

create table trips (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  title text not null,

  start\_date date,

  end\_date date,

  date\_precision text default 'unknown',

    -- 'exact' | 'month' | 'season' | 'year' | 'unknown'

  is\_open\_ended boolean default false,

  timezone text,                    -- destination tz, set when chosen

  status\_id uuid references trip\_statuses(id),

  cover\_media\_id uuid,

  notes text,

  custom jsonb default '{}',

  created\_by uuid references profiles(id),

  created\_at timestamptz default now(),

  updated\_at timestamptz default now(),

  deleted\_at timestamptz,

  constraint valid\_range check (

    start\_date is null or end\_date is null or end\_date \>= start\_date

  )

);

create table trip\_travelers (

  trip\_id uuid references trips(id) on delete cascade,

  user\_id uuid references profiles(id),

  origin\_airport text,

  arrival\_date date,

  departure\_date date,

  notes text,

  primary key (trip\_id, user\_id)

);

create table trip\_days (

  id uuid primary key default gen\_random\_uuid(),

  trip\_id uuid not null references trips(id) on delete cascade,

  date date not null,

  day\_type text default 'open',

    -- 'travel' | 'planned' | 'open' | 'rest' | 'work'

  title text,

  note text,

  unique (trip\_id, date)

);

create index on trips (couple\_id, start\_date);

create index on trip\_days (trip\_id, date);

## 3.2 Features

**Create trip**

  - Title required, everything else optional
  - Dates prominent but skippable
  - Date precision selector when dates are vague
  - Status defaults to "Idea"

**Trip list**

  - Grouped: Active → Upcoming → Planning (no dates) → Past
  - Sort: upcoming by start\_date asc; planning by updated\_at desc; past by start\_date desc
  - Card shows: title, destination (if chosen), date range, nights, countdown, doc readiness, cover image

**Trip detail header**

  - Title inline-editable
  - Date range editable
  - Status dropdown
  - Tab bar: Plan · Map · Docs · Money · Photos

**Per-traveler dates**

  - Each partner sets their own arrival and departure
  - Defaults to trip start/end
  - Overlap ("together" window) computed and displayed

**Duration**

  - nights = end\_date - start\_date — always derived, never stored
  - Long-stay mode triggers at nights \> 5

**Day scaffolding**

  - On setting dates, generate trip\_days rows for the range
  - On extending dates, generate the new days only
  - On shortening, warn if the removed days have itinerary items; never silently delete

**Archive / delete**

  - Soft delete, restorable for 30 days
  - Deleting a trip cascades to itinerary, days, travelers — but NOT gallery media (photos survive, become unfiled)

## 3.3 Logic

**Nights calculation:**

nights(trip) = trip.end\_date && trip.start\_date

  ? differenceInCalendarDays(end\_date, start\_date)

  : null

Note: 12th–16th = 4 nights, 5 days. Label carefully; users think in nights for accommodation and days for planning. Show both.

**Together window:**

togetherStart = max(travelerA.arrival\_date, travelerB.arrival\_date)

togetherEnd   = min(travelerA.departure\_date, travelerB.departure\_date)

togetherNights = max(0, differenceInCalendarDays(togetherEnd, togetherStart))

If negative, they don't overlap — surface this as a warning, it's almost certainly a data-entry error.

**Date precision affects display, not storage:** | Precision | Stored | Displayed | |---|---|---| | exact | 2026-11-12 | Nov 12, 2026 | | month | 2026-11-01 | November 2026 | | season | 2026-03-01 | Spring 2026 | | year | 2026-01-01 | 2026 | | unknown | null | "Dates TBD" |

Countdowns only render for exact. Never show "247 days" for a trip that's only pinned to a season.

**Day regeneration** on date change:

new\_days = date\_range(new\_start, new\_end)

existing = select date from trip\_days where trip\_id = X

to\_add   = new\_days - existing

to\_remove = existing - new\_days

if any to\_remove has itinerary\_items:

   → prompt: "3 items are scheduled on removed days. Move to Ideas, or cancel?"

else

   → delete silently

## 3.4 Services

listTrips(filter?): Promise\<TripSummary\[\]\>

getTrip(id): Promise\<TripDetail\>

createTrip(input): Promise\<Trip\>

updateTrip(id, patch): Promise\<Trip\>

setTripDates(id, start, end, precision): Promise\<{ trip: Trip; conflicts: Item\[\] }\>

setTravelerDates(tripId, userId, arrival, departure): Promise\<void\>

setDayType(tripId, date, type): Promise\<void\>

deleteTrip(id): Promise\<void\>

restoreTrip(id): Promise\<void\>

## 3.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /trips | List |
| /trips/new | Create |
| /trips/:id | Detail (redirects to /plan) |
| /trips/:id/plan | Itinerary (Module 5) |
| /trips/:id/map | Map (Module 6) |
| /trips/:id/docs | Documents (Module 8) |
| /trips/:id/money | Budget (Module 13) |
| /trips/:id/photos | Gallery (Module 11) |

## 3.6 Edge cases

  - Trip with no dates → no countdown, no day grid, itinerary is pure idea pool
  - Trip with start but no end → open-ended; day grid renders 30 days forward with a "still going" marker
  - Overlapping trips → allowed (a stay can nest inside a longer one), but warn
  - Trip in the past with status "Planning" → nudge to update status, don't auto-change
  - Deleting a trip with photos → photos survive, reassigned to "Unfiled"

## 3.7 Acceptance

  - Trip creatable with title alone
  - Setting dates generates exactly the right trip\_days rows
  - Shortening dates with scheduled items prompts rather than deleting
  - Nights count correct across DST boundaries and month ends
  - Long-stay mode activates at 6 nights, not 5

# MODULE 4 — DESTINATIONS

**Purpose:** decide *where*. A comparison workspace, not a recommender. No pricing.

## 4.1 Schema

create table trip\_destinations (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid not null references trips(id) on delete cascade,

  city text not null,

  country\_code text,                 -- ISO 3166-1 alpha-2

  lat numeric, lng numeric,

  timezone text,

  state text default 'candidate',    -- 'candidate' | 'chosen' | 'rejected'

  arrive\_on date, depart\_on date,    -- for multi-city

  sort\_key text,

  notes text,

  board jsonb default '{}',          -- cached computed columns

  created\_at timestamptz default now()

);

create table visa\_rules (

  id uuid primary key default gen\_random\_uuid(),

  passport\_country text not null,    -- ISO alpha-2

  destination\_country text not null,

  tier int not null,                 -- 0..5, see below

  label text,                        -- 'Visa-free 90 days', 'eTA required'

  max\_days int,

  source\_url text,

  verified\_on date,

  unique (passport\_country, destination\_country)

);

\-- Seeded from an open dataset. Shared reference table, not couple-scoped.

create table airport\_routes (

  origin\_iata text,

  dest\_iata text,

  duration\_minutes int,

  is\_direct boolean,

  primary key (origin\_iata, dest\_iata)

);

\-- Cached. Duration between two airports is effectively constant.

visa\_rules and airport\_routes are public read, no RLS write for users.

## 4.2 Features

**Add candidate**

  - City search via Nominatim → name, country, lat/lng
  - Timezone resolved from coordinates (tz-lookup package, offline, no API)
  - Multiple candidates per trip

**Comparison board**

  - Columns = candidates, rows = attributes
  - Horizontally scrollable on narrow screens
  - Attributes:

      - Flight hours, her
      - Flight hours, you
      - Travel fairness (visual, see logic)
      - Visa tier, her passport
      - Visa tier, your passport
      - Season / weather band for the trip month
      - Rough daily cost band
      - Wishlist items saved for that city
      - Stay allowance headroom (from Module 10)

**Choose / reject**

  - Marking one chosen sets the trip's destination and timezone
  - Others become rejected but stay visible (the reasoning is worth keeping)
  - Reversible

**Optional scoring**

  - All weights default to 0 (off)
  - Sliders for: duration, fairness, visa friction, season, cost, wishlist match
  - Ranking shown only when at least one weight \> 0
  - Weights persisted per couple, not per trip

**Equal-distance lens**

  - Toggle: show only candidates where |hours\_A − hours\_B| \< 2
  - No cost implication, purely fairness

## 4.3 Logic

**Visa tiers:** | Tier | Meaning | Friction | |---|---|---| | 0 | Visa-free | 0 | | 1 | eVisa / ETA online | 2 | | 2 | Visa on arrival | 4 | | 3 | Embassy appointment | 12 | | 4 | Difficult / long lead time | 20 | | 5 | Effectively unavailable | exclude |

Combined friction = friction(A) + friction(B). If either is 5, exclude the destination and say why.

**Every visa display must:**

  - Show verified\_on date
  - Link to source\_url
  - Carry the line "Advisory only — confirm with the embassy"

This is non-negotiable. Immigration consequences are severe.

**Flight duration:**

1.  Look up airport\_routes cache
2.  Miss → estimate from great-circle distance: minutes ≈ 30 + (km / 800) \* 60
3.  Mark estimated values visually distinct from known ones

**Fairness:**

diff = Math.abs(hoursA - hoursB)

fairness = diff \< 2  ? 'balanced'

         : diff \< 5  ? 'slight'

         : diff \< 10 ? 'skewed'

         :             'heavy'

Display as a two-sided bar, not a number. Show *which* partner it's skewed toward.

**Season band** — no API. Use a static climate table keyed by (country\_code, month) giving one of: cold | mild | warm | hot | rainy | storm. Seed from Köppen classification. Good enough, never stale, free.

**Scoring (only when enabled):**

score = w1\*normHours + w2\*normFairness + w3\*normVisa

      + w4\*normSeason + w5\*normCost - w6\*normWishlist

Normalise each to 0..1 across the current candidate set. Always show the contributing breakdown on tap — never a bare number.

**Board caching:** compute once on candidate add, store in board jsonb. Nothing here goes stale (durations are constant, visa rules change yearly, seasons never). Recompute only on explicit refresh or when trip month changes.

## 4.4 Services

searchCity(q): Promise\<CityResult\[\]\>

addCandidate(tripId, city): Promise\<Destination\>

computeBoard(tripId): Promise\<BoardRow\[\]\>

setDestinationState(id, state): Promise\<void\>

getVisaRule(passport, dest): Promise\<VisaRule | null\>

saveScoringWeights(weights): Promise\<void\>

## 4.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /trips/:id/where | Destination board |

## 4.6 Edge cases

  - Missing visa rule → show "Unknown — check officially" with a link, never assume visa-free
  - Dual nationality → compute both passports, show the better tier, label which
  - No trip dates → season column shows "set dates to compare", others still work
  - Single candidate → board renders as a single column, still useful
  - Same country as one partner's home → that partner shows "Home", not a visa tier

## 4.7 Acceptance

  - Board renders with one candidate and with five
  - Visa rows always show verified date and source link
  - Scoring hidden until a weight is moved
  - Estimated flight durations visually distinct from cached ones
  - Choosing a destination sets trip.timezone correctly

# MODULE 5 — ITINERARY

**Purpose:** the planning surface. Scheduling is optional; an unscheduled pile of ideas is a first-class state.

## 5.1 Schema

create table categories (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  name text not null,

  icon text,

  color text,

  is\_default boolean default false,

  sort\_order int default 0

);

\-- seeded: Food, Sight, Activity, Transport, Stay, Admin, Rest

create table itinerary\_items (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid not null references trips(id) on delete cascade,

  title text not null,

  -- ALL nullable: null = lives in the idea pool

  scheduled\_date date,

  start\_time time,

  end\_time time,

  duration\_minutes int,

  destination\_id uuid references trip\_destinations(id) on delete set null,

  place\_name text, lat numeric, lng numeric,

  address text, maps\_url text,

  category\_id uuid references categories(id) on delete set null,

  notes text,

  url text,

  cost\_estimate numeric, currency text,

  proposed\_by uuid references profiles(id),   -- whose pick

  source text default 'manual',               -- manual|wishlist|blend|ai

  state text default 'idea',                  -- idea|accepted|booked|done|skipped

  sort\_key text not null,

  created\_at timestamptz default now(),

  updated\_at timestamptz default now(),

  deleted\_at timestamptz

);

create index on itinerary\_items (trip\_id, scheduled\_date, sort\_key);

create index on itinerary\_items (trip\_id) where scheduled\_date is null;

create table suggestion\_tray (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid references trips(id) on delete cascade,

  payload jsonb not null,

  source text,                    -- 'blend' | 'ai'

  generated\_at timestamptz default now(),

  accepted\_at timestamptz,

  dismissed\_at timestamptz

);

## 5.2 Features

**Idea pool**

  - Items with scheduled\_date is null
  - Always visible at the top of the plan view
  - Add without any date/time
  - Drag from pool onto a day to schedule
  - Drag from a day back to the pool to unschedule

**Day list view** (short trips, ≤5 nights)

  - One section per day
  - Items ordered by start\_time, then sort\_key for untimed items
  - Untimed items on a scheduled day are valid — they float to the top of that day
  - Day header shows date, day type, and item count

**Month grid view** (long stays, \>5 nights)

  - Calendar grid for the trip range
  - Each cell: date, day type glyph, item count dot
  - Click a day → day detail panel
  - **Blank days render as restful, not empty** — no prompt, no "add something" CTA

**Week view**

  - Optional middle ground, 7 columns with time rows
  - Only worth building if month view feels too coarse

**Item editor**

  - Title (required)
  - Date + time (both optional, independently)
  - Duration or end time
  - Place search → name, coords, maps link
  - Category
  - Cost estimate
  - Notes, URL
  - Whose pick (defaults to current user, editable)

**Day types**

  - travel · planned · open · rest · work
  - Set manually per day
  - travel auto-set on days matching a flight date
  - planned auto-set when a day gains its first item, but **only if currently** **open** — never overwrite a manual rest or work

**Work hours overlay**

  - Per-profile working hours + employer timezone in Settings
  - On work days, render the working block in local destination time
  - Shows which evenings are actually free

**Suggestion tray**

  - Anything generated lands here, never in the itinerary
  - Accept single / accept all / regenerate / dismiss
  - Accepted items become normal itinerary items with source preserved

**Bulk actions**

  - Move selected items to another day
  - Move to idea pool
  - Change category
  - Delete (soft)

## 5.3 Logic

**The two empty states — a real requirement, not polish:**

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Context\*\* | \*\*Component\*\* | \*\*Copy\*\* | \*\*Action offered\*\* |
| Trip has zero items | EmptyState | "Nothing saved yet" | "Add your first idea" |
| A day on a short trip is blank | EmptyState (subtle) | "Nothing planned" | "Add" (quiet) |
| \*\*A day on a long stay is blank\*\* | RestfulEmpty | "Open" | \*\*none\*\* |

On stays longer than 5 nights, blank days are the desired state. The UI must never suggest filling them. This is the single most important behavioural rule in the module.

**Scheduling transitions:**

pool → day:     set scheduled\_date, sort\_key = keyBetween(last, null)

day → pool:     set scheduled\_date = null, start\_time = null

day → day:      set scheduled\_date, recompute sort\_key for target day

reorder in day: sort\_key = keyBetween(prev, next)

All are single-row updates. Never rewrite sibling rows.

**Ordering within a day:**

sort(items) = \[

  ...timed.sort(by start\_time),      // timed first, chronological

  ...untimed.sort(by sort\_key)        // then untimed, manual order

\]

Debatable alternative: untimed first. Pick one and be consistent — mixing is confusing.

**Conflict detection** (warn, never block):

  - Two timed items overlap → soft warning badge
  - Travel time between consecutive items exceeds the gap → "tight connection" badge, computed from straight-line distance × 1.4 ÷ assumed speed
  - More than 4 items in a day on a long stay → "busy day" note, informational only

**Pacing heuristics** (used by the blend generator, Module 7):

  - No 3 consecutive items of the same category
  - At most one "anchor" (duration \> 180 min) per day
  - Minimum 45 min gap between items in different locations
  - Leave the first and last day of a trip light

**Day type auto-assignment:**

if day matches a flight date          → travel

else if day has ≥1 item AND type = open → planned

else                                   → unchanged

Never demote a manually set type.

## 5.4 Services

listItems(tripId): Promise\<{ pool: Item\[\]; byDate: Record\<string, Item\[\]\> }\>

createItem(input): Promise\<Item\>

updateItem(id, patch): Promise\<Item\>

scheduleItem(id, date, afterId?): Promise\<Item\>

unscheduleItem(id): Promise\<Item\>

reorderItem(id, beforeId, afterId): Promise\<Item\>

bulkMove(ids, date | null): Promise\<void\>

deleteItem(id): Promise\<void\>

listTray(tripId): Promise\<Suggestion\[\]\>

acceptSuggestion(id): Promise\<Item\>

dismissSuggestion(id): Promise\<void\>

## 5.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /trips/:id/plan | Plan (pool + day list or month grid) |
| /trips/:id/plan/:date | Day detail |

## 5.6 Edge cases

  - Trip with no dates → only the pool renders; scheduling controls hidden entirely
  - Item scheduled outside the trip range (date changed after) → show in a "Outside trip dates" group, offer to move
  - Two users drag the same item simultaneously → last write wins; realtime refresh corrects the loser's view
  - Item with end\_time \< start\_time → treat as crossing midnight, render as such
  - Deleting a category → items keep category\_id = null, don't cascade-delete items

## 5.7 Acceptance

  - Item creatable with title only, lands in pool
  - Drag pool → day → pool round-trips without data loss
  - Reordering 50 items issues exactly one UPDATE
  - Long-stay blank day shows no call to action
  - Month grid renders a 31-day trip without scroll jank
  - Manual rest day type survives adding an item

# MODULE 6 — MAP

**Purpose:** spatial view of everything with coordinates. Read-mostly.

## 6.1 Schema

None. Reads itinerary\_items, wishlist\_items, trip\_destinations, accommodations, media.

## 6.2 Features

**Base map**

  - Leaflet + OpenStreetMap tiles
  - No API key, no billing account
  - Attribution required and must remain visible

**Layers** (toggleable)

  - Itinerary items (scheduled)
  - Idea pool items
  - Wishlist saves
  - Accommodation
  - Photo locations

**Filters**

  - By day (single day / all days / date range)
  - By person (whose pick)
  - By category
  - By state (idea / booked / done)

**Pin design**

  - Colour = whose pick
  - Icon = category
  - Numbered when a day filter is active (shows order)
  - Cluster when zoomed out (leaflet.markercluster)

**Day route**

  - When a single day is selected, draw a line connecting its items in order
  - Straight lines, not road routing (no free routing API without a key)
  - Show total straight-line distance as a rough indicator, labelled as such

**Interactions**

  - Click pin → popup: title, time, category, whose pick, "Open in Google Maps"
  - Popup action: schedule this idea / move to another day
  - Long-press map → add item at that location

**Fit bounds**

  - Auto-fit to visible pins on filter change
  - Manual "recenter" control

## 6.3 Logic

**Google Maps deep link** — always built from coordinates plus name:

\`https://www.google.com/maps/search/?api=1\&query=${encodeURIComponent(name)}\&query\_place\_id=\`

// or, coords-only:

\`https://www.google.com/maps/search/?api=1\&query=${lat},${lng}\`

Prefer coordinates — a name alone can resolve to the wrong city.

**Geocoding via Nominatim** — usage policy requires care:

  - Max 1 request/second
  - Descriptive User-Agent header required
  - **Debounce search input by 600ms and cache every result** in a local geocode\_cache table keyed by query string
  - Never bulk-geocode

**Clustering threshold:** cluster below zoom 13, individual pins above.

**Missing coordinates:** items without lat/lng are excluded from the map but shown in a "Not on map (7)" counter with a shortcut to add locations.

## 6.4 Services

getMapData(tripId, filters): Promise\<MapPin\[\]\>

geocode(query): Promise\<GeocodeResult\[\]\>       // debounced + cached

reverseGeocode(lat, lng): Promise\<Address\>

## 6.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /trips/:id/map | Trip map |
| /map | All-time map (every place across all trips) |

## 6.6 Edge cases

  - Zero pins → map centred on the destination, with an empty-state overlay
  - Pins spanning multiple continents (multi-city trip) → fit bounds may zoom out to world level; cap minimum zoom
  - Nominatim rate limit hit → fall back to cached results, show a quiet "search unavailable" note
  - Tiles fail to load (offline) → grey map with a message, pins still render at correct relative positions

## 6.7 Acceptance

  - Map renders with no API key configured
  - Day filter draws numbered pins in itinerary order
  - Geocode search debounced and cached (verify: same query twice = one network call)
  - OSM attribution visible at all zoom levels

# MODULE 7 — WISHLIST & BLEND

**Purpose:** independent saving, then a shared view of overlap. The *view* is the feature; generation is optional.

## 7.1 Schema

create table wishlist\_items (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  user\_id uuid not null references profiles(id),   -- who saved it

  title text not null,

  city text, country\_code text,

  lat numeric, lng numeric,

  place\_name text, address text, maps\_url text,

  category\_id uuid references categories(id) on delete set null,

  intensity int check (intensity between 1 and 5),  -- nullable

  url text, notes text, image\_url text,

  created\_at timestamptz default now(),

  deleted\_at timestamptz

);

create table wishlist\_verdicts (

  wishlist\_id uuid references wishlist\_items(id) on delete cascade,

  user\_id uuid references profiles(id),

  verdict text not null,          -- 'yes' | 'no' | 'maybe'

  created\_at timestamptz default now(),

  primary key (wishlist\_id, user\_id)

);

create index on wishlist\_items (couple\_id, city);

**Design note:** verdicts are a separate table so each partner can react to the other's saves without mutating them.

## 7.2 Features

**Save a place**

  - Title required
  - City optional — save before a destination is chosen
  - Link paste → attempt to extract title and image from OpenGraph tags (Edge Function, since CORS blocks client-side fetch)
  - Intensity 1–5, optional
  - Category, notes

**Wishlist views**

  - All saves, filterable by city / category / person
  - Grouped by city
  - "Unfiled" group for saves with no city

**Blend view** — the core screen, five sections:

|  |  |
| :-: | :-: |
| \*\*Section\*\* | \*\*Contents\*\* |
| \*\*Both of us\*\* | Independently saved by both, matched by proximity + name similarity |
| \*\*Her picks\*\* | Hers only, sorted by intensity desc |
| \*\*Your picks\*\* | Yours only, sorted by intensity desc |
| \*\*Clashes\*\* | One saved, the other voted no |
| \*\*Undecided\*\* | No verdict from the partner yet |

**Verdicts**

  - On the partner's saves: yes / no / maybe
  - Optional — an unvoted list is fine
  - Changing a verdict is one click, no confirmation

**Push to itinerary**

  - Single item → creates an itinerary\_item in the idea pool with source = 'wishlist' and proposed\_by preserved
  - Bulk push all "both of us" items

**Draft generator** (no AI required)

  - Button, never automatic
  - Output lands in the suggestion tray
  - Regenerate with modifiers: slower / faster / more food / skip museums

## 7.3 Logic

**Duplicate detection for "both of us":**

isSameePlace(a, b) =

     (a.lat && b.lat && haversineM(a, b) \< 150)

  || (normalize(a.title) === normalize(b.title) && a.city === b.city)

normalize = s =\> s.toLowerCase()

  .replace(/\[^a-z0-9\]/g, '')

  .replace(/^(the|a|le|la|el)/, '')

150m radius catches the same restaurant saved from two different sources. Tune if false positives appear.

**Draft generation algorithm** — pure TypeScript, no model:

INPUT: wishlist items for the destination, trip days, pace preference

OUTPUT: array of { date, ordered items }

1\. SELECT

   - all "both of us" items

   - all items with intensity 5 from either partner

   - fill remaining slots alternating between partners, intensity desc

2\. CLUSTER

   - k-means on lat/lng where k = number of available days

   - each cluster becomes one day's geographic area

3\. ASSIGN

   - map clusters to days; keep clusters near accommodation on

     arrival/departure days

4\. ORDER WITHIN DAY

   - nearest-neighbour from the day's start point (accommodation)

   - 2-opt improvement pass (n is small, this is cheap)

5\. PACE

   - enforce: max 1 anchor (\>180min) per day

   - enforce: no 3 consecutive same-category items

   - insert a gap after any anchor

   - respect pace setting: relaxed = 2-3 items/day, packed = 5-6

6\. BALANCE

   - if one partner's picks dominate a day, swap in one of the other's

     from the same cluster

   - alternate whose pick opens each day

7\. EMIT to suggestion\_tray — never write to itinerary\_items directly

**Slot capacity by pace:** | Pace | Items/day | Anchors/day | |---|---|---| | Relaxed | 2 | 1 | | Normal | 4 | 1 | | Packed | 6 | 2 |

**Long-stay override:** on trips \> 5 nights, the generator plans **at most 40% of days** and leaves the rest open. Never fill a month.

## 7.4 Services

listWishlist(filters): Promise\<WishlistItem\[\]\>

addWishlistItem(input): Promise\<WishlistItem\>

extractFromUrl(url): Promise\<{ title, image, description }\>   // Edge Function

setVerdict(itemId, verdict): Promise\<void\>

getBlend(city): Promise\<BlendGroups\>

pushToItinerary(itemIds, tripId): Promise\<Item\[\]\>

generateDraft(tripId, opts): Promise\<Suggestion\>

## 7.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /wishlist | All saves |
| /trips/:id/blend | Blend view for the trip's destination |

## 7.6 Edge cases

  - No destination chosen → blend groups by city across all saves
  - Only one partner has saved anything → show their list plainly, no empty "both of us" section
  - All items lack coordinates → clustering falls back to category grouping
  - Fewer items than days → generator plans only the days it can fill, leaves the rest open
  - Item pushed to itinerary twice → detect and warn, don't silently duplicate

## 7.7 Acceptance

  - Same restaurant saved by both, from different URLs, appears in "Both of us"
  - Draft generator runs with no AI configured
  - Generated draft appears in tray, never in the itinerary
  - 25-night trip generates ≤10 planned days
  - Verdict change reflects on the partner's screen within 2s (realtime)

# MODULE 8 — DOCUMENTS

**Purpose:** encrypted vault plus an expiry engine. Drives the per-trip readiness score.

## 8.1 Schema

create table document\_types (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  name text not null,

  has\_expiry boolean default true,

  requires\_country boolean default false,

  sort\_order int default 0

);

\-- seeded: Passport, Visa, eTA/ESTA, PR Card, Travel Insurance,

\--         Vaccination, Driving Licence, Booking, Other

create table documents (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  owner\_id uuid not null references profiles(id),

  type\_id uuid references document\_types(id),

  label text not null,

  country\_code text,

  number\_last4 text,              -- NEVER the full number

  issued\_on date,

  expires\_on date,

  storage\_path text,              -- private bucket

  file\_name text, file\_size int, mime\_type text,

  is\_shared boolean default true, -- visible to partner

  notes text,

  created\_at timestamptz default now(),

  updated\_at timestamptz default now(),

  deleted\_at timestamptz

);

create table trip\_document\_requirements (

  id uuid primary key default gen\_random\_uuid(),

  trip\_id uuid references trips(id) on delete cascade,

  user\_id uuid references profiles(id),

  type\_id uuid references document\_types(id),

  is\_satisfied boolean default false,

  document\_id uuid references documents(id) on delete set null,

  note text

);

create index on documents (couple\_id, expires\_on);

**RLS nuance:** documents are couple-scoped for read *only when* is\_shared = true.

create policy "read own or shared" on documents

  for select using (

    owner\_id = auth.uid()

    or (is\_couple\_member(couple\_id) and is\_shared = true)

  );

create policy "write own" on documents

  for all using (owner\_id = auth.uid())

      with check (owner\_id = auth.uid());

## 8.2 Storage

Private bucket docs, path {couple\_id}/{owner\_id}/{document\_id}/{filename}.

create policy "read own docs" on storage.objects for select using (

  bucket\_id = 'docs'

  and is\_couple\_member(((storage.foldername(name))\[1\])::uuid)

);

create policy "write own docs" on storage.objects for insert with check (

  bucket\_id = 'docs'

  and ((storage.foldername(name))\[2\])::uuid = auth.uid()

);

Access via signed URLs, 300s expiry, generated on demand. Never public.

## 8.3 Features

**Upload**

  - PDF, JPG, PNG, HEIC
  - Max 10 MB per file
  - Client-side compression for images before upload
  - Metadata form: type, label, country, expiry, last 4 digits

**Vault list**

  - Grouped by owner, then type
  - Expiry countdown per document
  - Colour: green \> 12mo, amber 3–12mo, red \< 3mo
  - Filter by owner / type / expiring

**Viewer**

  - Inline PDF and image preview via signed URL
  - Download original
  - Never render the full document number as text

**Expiry engine**

  - Daily cron sweep
  - Alert thresholds: 12mo, 6mo, 3mo, 1mo, expired
  - **Passport special rule:** most countries require 6 months validity beyond entry, so passports alert at **9 months** with an explanatory message
  - Push/email notification to the owner, visible to both

**Trip readiness**

  - Per trip, per person: required types vs held documents
  - Requirements auto-derived: passport always; visa if visa\_rules.tier \> 0; insurance if configured as required
  - Manual requirements addable
  - Score displayed as 4/6, with the missing items named

**Biometric / re-auth gate**

  - Vault requires re-entering the session (WebAuthn if available, else password/OAuth re-prompt) after 15 minutes idle

## 8.4 Logic

**Passport validity check:**

function passportStatus(expires: Date, tripEnd?: Date) {

  const ref = tripEnd ?? new Date()

  const monthsAtTravel = differenceInMonths(expires, ref)

  if (monthsAtTravel \< 0)  return { level: 'expired' }

  if (monthsAtTravel \< 6)  return { level: 'blocking',

    msg: 'Under 6 months validity at travel — many countries refuse entry' }

  if (monthsAtTravel \< 9)  return { level: 'warning',

    msg: 'Renew soon — the 6-month rule will apply before you travel' }

  return { level: 'ok' }

}

**Readiness computation:**

required(trip, user) =

    \[Passport\]

  + (visa\_rules(user.nationality, trip.country).tier \> 0 ? \[Visa\] : \[\])

  + (couple\_settings.require\_insurance ? \[Insurance\] : \[\])

  + manual\_requirements

satisfied = required.filter(t =\>

   documents.some(d =\> d.owner\_id === user

                    && d.type\_id === t

                    && (\!d.expires\_on || d.expires\_on \> trip.end\_date)))

score = satisfied.length / required.length

**Critical:** a document that expires *before the trip ends* does not satisfy the requirement. Check against trip.end\_date, not today.

**Alert dedupe:** store last\_alerted\_threshold per document so the 6-month alert fires once, not daily.

## 8.5 Services

listDocuments(filters): Promise\<Document\[\]\>

uploadDocument(file, meta): Promise\<Document\>

getSignedUrl(id): Promise\<string\>          // 300s

updateDocument(id, patch): Promise\<Document\>

deleteDocument(id): Promise\<void\>

getTripReadiness(tripId): Promise\<{ \[userId\]: ReadinessReport }\>

addRequirement(tripId, userId, typeId): Promise\<void\>

## 8.6 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /documents | Vault |
| /documents/:id | Viewer |
| /trips/:id/docs | Trip readiness |

## 8.7 Edge cases

  - Document with no expiry (birth certificate) → has\_expiry = false, no countdown
  - Document expiring mid-trip → flagged as blocking, message names the date
  - File upload fails midway → no orphan DB row; create the row only after successful upload
  - Partner marks a document private after sharing → immediately disappears from the other's view (RLS enforces)
  - Deleting a document → soft delete; storage object deleted by the 30-day cron, not immediately

## 8.8 Acceptance

  - Passport with 7 months validity triggers the 9-month warning with explanation
  - Readiness score checks expiry against trip end date, not today
  - Private document invisible to partner (verify by direct query with partner JWT)
  - Signed URL expires after 300s
  - No storage object left orphaned after a failed upload

# MODULE 9 — FLIGHTS

**Purpose:** one unified flight engine. Two free data sources, one reconciled state, one map. Always shows something useful, never an error.

**Design thesis:** status (schedule, gate, landed) and position (lat/lng) come from different providers with different reliability and wildly different budgets. The module's job is to **fuse them into a single confident state** and degrade gracefully when either fails.

## 9.1 The two sources

|  |  |  |
| :-: | :-: | :-: |
|   | \*\*AeroDataBox\*\* | \*\*OpenSky Network\*\* |
| Provides | Schedule, gate, terminal, delay, status, aircraft reg | Live lat/lng, altitude, heading, velocity |
| Budget | \\\~600 units/\*\*month\*\* | \\\~4,000 credits/\*\*day\*\* |
| Cost per flight | Must stay ≤ \\\~85 | \\\~600 for a 10h flight — trivial |
| Coverage | Global, airline-reported | Volunteer ADS-B. \*\*No ocean coverage.\*\* |
| Latency | Minutes | Seconds |
| Auth | RapidAPI key | OAuth2 client credentials |
| Refresh strategy | \*\*Cache-gated\*\*, tiered max-age | \*\*Free-flowing\*\*, \\\~60s while airborne |

Neither alone is sufficient. AeroDataBox knows the flight landed; OpenSky knows where it is right now. The engine needs both, and must work when either is missing.

## 9.2 Unified flight state

Everything the UI renders comes from one computed object. Never let a screen read two sources and try to reconcile them itself.

type FlightState = {

  // Identity

  id, flightNumber, callsign, icao24, registration

  airline: { iata, icao, name }

  traveler: Profile            // who is ON the plane

  watcher: Profile | null      // the partner on the ground, if any

  // Phase — drives everything: polling, map, notifications, copy

  phase: 'scheduled' | 'checkin' | 'boarding' | 'departed'

       | 'enroute' | 'descending' | 'landed'

       | 'cancelled' | 'diverted' | 'unknown'

  // Times, all UTC; render dual via lib/dates

  times: {

    scheduledDeparture, estimatedDeparture, actualDeparture

    scheduledArrival,   estimatedArrival,   actualArrival

    delayMinutes: number          // signed; negative = early

  }

  // Airports

  origin: { iata, name, tz, lat, lng, terminal?, gate? }

  dest:   { iata, name, tz, lat, lng, terminal?, gate?, belt? }

  // Position — always present, but confidence varies

  position: {

    lat, lng, altitudeM, headingDeg, velocityMs, verticalRateMs

    confidence: 'live' | 'stale' | 'estimated' | 'none'

    recordedAt: string

    ageSeconds: number

  }

  // Progress

  progress: {

    fraction: number             // 0..1

    distanceFlownKm, distanceRemainingKm

    minutesRemaining: number

    source: 'position' | 'time'  // which basis was used

  }

  // Provenance — the UI MUST be able to show where each part came from

  freshness: {

    status:   { source: 'aerodatabox' | 'cache' | 'manual', ageSeconds }

    position: { source: 'opensky' | 'cache' | 'interpolated', ageSeconds }

    degraded: boolean

    notices: string\[\]            // human-readable, shown as quiet notes

  }

  handoff: HandoffPlan | null    // only when watcher exists

}

**Rule:** a screen never sees a raw API response. The flight-status Edge Function returns FlightState\[\] and nothing else.

## 9.3 Schema

create table journeys (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid references trips(id) on delete cascade,

  traveler\_id uuid not null references profiles(id),

  direction text not null,          -- 'outbound' | 'return'

  booking\_ref text,

  created\_at timestamptz default now()

);

create table flights (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  journey\_id uuid references journeys(id) on delete cascade,

  leg\_index int default 1,

  -- Identity

  flight\_number text not null,      -- normalized 'AC42'

  callsign text,                    -- 'ACA42' (OpenSky)

  icao24 text,                      -- aircraft hex, cached after first fix

  registration text,

  airline\_iata text, airline\_name text,

  flight\_date date not null,

  -- Route

  origin\_iata text, origin\_name text, origin\_tz text,

  origin\_lat numeric, origin\_lng numeric,

  dest\_iata text, dest\_name text, dest\_tz text,

  dest\_lat numeric, dest\_lng numeric,

  -- Times (UTC)

  scheduled\_departure timestamptz, scheduled\_arrival timestamptz,

  estimated\_departure timestamptz, estimated\_arrival timestamptz,

  actual\_departure timestamptz,    actual\_arrival timestamptz,

  -- Status detail

  gate text, terminal text, baggage\_belt text, aircraft\_type text,

  phase text default 'scheduled',

  has\_checked\_bags boolean default true,

  -- Source bookkeeping

  tracking\_active boolean default true,

  status\_polled\_at timestamptz,

  position\_polled\_at timestamptz,

  status\_error\_count int default 0,

  position\_error\_count int default 0,

  manual\_override jsonb,            -- user-entered values always win

  raw\_status jsonb,

  created\_at timestamptz default now(),

  updated\_at timestamptz default now()

);

create table flight\_positions (

  id uuid primary key default gen\_random\_uuid(),

  flight\_id uuid not null references flights(id) on delete cascade,

  lat numeric not null, lng numeric not null,

  altitude\_m numeric, heading numeric,

  velocity\_ms numeric, vertical\_rate numeric,

  on\_ground boolean default false,

  source text default 'opensky',

  recorded\_at timestamptz not null,

  created\_at timestamptz default now()

);

create table flight\_events (

  id uuid primary key default gen\_random\_uuid(),

  flight\_id uuid references flights(id) on delete cascade,

  event\_type text not null,   -- phase\_change|delay|gate|diverted|landed

  from\_value jsonb, to\_value jsonb,

  notified\_user\_id uuid references profiles(id),

  notified\_at timestamptz,

  created\_at timestamptz default now()

);

create table api\_usage (

  id uuid primary key default gen\_random\_uuid(),

  provider text not null,             -- 'aerodatabox' | 'opensky'

  flight\_id uuid references flights(id) on delete set null,

  units int default 1,

  success boolean, error text,

  called\_at timestamptz default now()

);

create table airline\_codes (

  iata text primary key, icao text not null, name text

);

create table airport\_wait\_times (

  iata text primary key,

  immigration\_minutes int, baggage\_minutes int,

  notes text, updated\_by uuid references profiles(id)

);

create index on flights (tracking\_active, scheduled\_departure)

  where tracking\_active = true;

create index on flight\_positions (flight\_id, recorded\_at desc);

create index on api\_usage (provider, called\_at);

airline\_codes and airport\_wait\_times are shared reference data — public read, no couple scoping.

## 9.4 The orchestrator

One Edge Function, flight-status. The client calls it every 60s with all visible flight IDs. It decides what to actually fetch.

CLIENT (60s tick, batched)

   │  POST /flight-status { flightIds\[\], force? }

   ▼

┌──────────────────────────────────────────────────┐

│ 1. Load flights (RLS-scoped)                     │

│ 2. For each: compute phase                       │

│ 3. Decide per source, independently:             │

│      needStatus?   = statusAge \> maxAge(phase)   │

│      needPosition? = airborne && posAge \> 55s    │

│ 4. Check quota per provider                      │

│ 5. Fetch in parallel, ISOLATED try/catch each    │

│ 6. Persist → triggers Realtime to both partners  │

│ 7. Reconcile → build FlightState                 │

│ 8. Return FlightState\[\]                          │

└──────────────────────────────────────────────────┘

**Isolation is the core robustness property.** OpenSky failing must not block the status update, and vice versa. Each source is wrapped separately; a failure degrades one field group and sets a notice, never the whole response.

const \[statusResult, positionResult\] = await Promise.allSettled(\[

  needStatus   ? withQuota('aerodatabox', () =\> fetchStatus(f))   : null,

  needPosition ? withQuota('opensky',     () =\> fetchPosition(f)) : null,

\])

// Each handled independently; neither can reject the request.

### Cache max-age by phase (AeroDataBox only)

|  |  |  |
| :-: | :-: | :-: |
| \*\*Phase / time to event\*\* | \*\*Max age\*\* | \*\*Calls in phase\*\* |
| \\\> 48h before departure | 24h | \\\~2 |
| 48h – 6h | 6h | \\\~7 |
| 6h – 1h | 30 min | \\\~10 |
| 1h → departed | 10 min | \\\~6 |
| Enroute, \\\> 1h out | 15 min | \\\~32 |
| \*\*Final hour before landing\*\* | \*\*2 min\*\* | \\\~30 |
| Landed / cancelled | never | 0 |

**\~85 calls per flight.** Six flights a year ≈ 510 calls annually against 600/month.

### Position cadence (OpenSky)

|  |  |
| :-: | :-: |
| \*\*Phase\*\* | \*\*Interval\*\* |
| Before departure | none |
| Departed / enroute / descending | \*\*60s\*\* |
| Landed | none |

\~600 credits for a 10h flight against 4,000/day. Comfortable.

### Quota guard

async function withQuota\<T\>(provider: string, fn: () =\> Promise\<T\>) {

  const used = await usageInWindow(provider)   // month for ADB, day for OpenSky

  const limit = LIMITS\[provider\]

  if (used \>= limit \* 0.9) {

    throw new QuotaError(provider)             // caught, becomes a notice

  }

  const result = await fn()

  await recordUsage(provider, result.ok)

  return result

}

Above 90%, serve cache and surface a quiet notice. **Never let a loop exhaust the allowance silently.**

### One poll serves both partners

Both read the same row. Whoever refreshes first pays; the other gets it via Realtime.

Partner A ──┐

            ├──→ flight-status ──→ \[ADB?\] \[OpenSky?\] ──→ flights row

Partner B ──┘                                              │

                                              ┌────────────┴────────────┐

                                              ▼                         ▼

                                        Realtime → A             Realtime → B

## 9.5 Reconciliation — when sources disagree

This is where robustness is won or lost. The two providers *will* contradict each other.

### Precedence

1\. manual\_override        — the user is always right

2\. actual\_\* timestamps    — a recorded fact beats an estimate

3\. OpenSky position       — for "is it airborne, where is it"

4\. AeroDataBox status     — for schedule, gate, terminal, phase

5\. scheduled times        — the floor; always available

### Specific conflicts and their rules

|  |  |
| :-: | :-: |
| \*\*Conflict\*\* | \*\*Resolution\*\* |
| ADB says landed, OpenSky shows airborne | \*\*ADB wins on phase\*\*, but keep showing the last position with a "position may lag" notice. Airlines report gate arrival; ADS-B can drop earlier. |
| OpenSky shows on\\\_ground at destination, ADB still enroute | \*\*Set phase to\*\* \*\*landed\*\* and set actual\\\_arrival from the position timestamp. ADS-B ground contact is a hard fact; ADB lags. This is the case where OpenSky wins. |
| ADB has no estimated\\\_arrival, position exists | Compute ETA from position + velocity + remaining great-circle distance. Mark progress.source = 'position'. |
| Position exists but far off the route corridor | \*\*Diverted.\*\* Flag it, recompute destination from the nearest major airport ahead, void the handoff. |
| Both sources silent | Fall back to scheduled times + interpolated position, degraded: true. |
| ADB cancelled but position moving | Trust ADB for the \*booking\*; the aircraft may be flying a different rotation. Show cancelled, stop tracking. |

function reconcile(f: FlightRow, pos: Position | null): FlightState {

  // 1. Ground contact at destination is definitive

  if (pos?.onGround && distanceKm(pos, f.dest) \< 10 && \!f.actual\_arrival) {

    f.actual\_arrival = pos.recordedAt

    f.phase = 'landed'

  }

  // 2. Airborne contradicts a 'scheduled' phase

  if (pos && \!pos.onGround && f.phase === 'scheduled') {

    f.phase = 'enroute'

    f.actual\_departure ??= pos.recordedAt

  }

  // 3. Off-corridor = diverted

  if (pos && corridorDeviationKm(pos, f) \> 200 && f.phase === 'enroute') {

    f.phase = 'diverted'

  }

  // 4. Manual override always last, always wins

  return applyOverride(f, f.manual\_override)

}

### The degradation ladder

The screen **always** renders. There is no error state on the live view.

|  |  |  |
| :-: | :-: | :-: |
| \*\*Level\*\* | \*\*Available\*\* | \*\*What the user sees\*\* |
| 1 | Both sources live | Full: live position, gate, ETA, handoff. No notices. |
| 2 | Status live, position stale | Plane at last known point, dimmed. \*"Position last seen 12 min ago."\* |
| 3 | Status live, no position | Interpolated marker, hollow. \*"Estimated — no radar coverage."\* |
| 4 | Position live, status stale | Live plane, gate/terminal greyed. \*"Gate info may be out of date."\* |
| 5 | Neither, cache exists | Everything from cache with ages shown. \*"Last updated 40 min ago."\* |
| 6 | No cache at all | Scheduled times only. \*"Showing scheduled times."\* |
| 7 | Quota exhausted | Level 5 or 6 + a Settings notice. Manual refresh disabled with a reason. |

**Levels 3 and 6 are normal operating states, not failures.** A trans-Atlantic flight spends hours at level 3, and a flight booked three weeks out sits at level 6 the whole time. The copy must not sound alarmed.

## 9.6 Phase state machine

Phase drives polling cadence, map rendering, notification routing, and copy. Compute it once, derive everything from it.

scheduled ──(T-3h)──→ checkin ──(gate posted)──→ boarding

                                                     │

                                       (actual\_departure | airborne)

                                                     ▼

                                                 departed

                                                     │ (\>10 min airborne)

                                                     ▼

                                                  enroute

                                                     │ (\<60 min to arrival

                                                     │  OR descending)

                                                     ▼

                                                descending

                                                     │ (on\_ground at dest

                                                     │  OR actual\_arrival)

                                                     ▼

                                                  landed ──→ tracking off

  any ──→ cancelled ──→ tracking off

  enroute ──→ diverted ──→ tracking continues to new destination

function computePhase(f, pos, now): Phase {

  if (f.manual\_override?.phase) return f.manual\_override.phase

  if (f.status === 'cancelled') return 'cancelled'

  if (f.actual\_arrival || (pos?.onGround && nearDest(pos, f))) return 'landed'

  if (isDiverted(pos, f)) return 'diverted'

  const airborne = pos && \!pos.onGround

  const toArrival = minutesUntil(f.estimatedArrival ?? f.scheduledArrival, now)

  const toDeparture = minutesUntil(f.estimatedDeparture ?? f.scheduledDeparture, now)

  if (airborne || f.actual\_departure) {

    if (toArrival \<= 60 || pos?.verticalRate \< -2) return 'descending'

    if (minutesSince(f.actual\_departure, now) \> 10) return 'enroute'

    return 'departed'

  }

  if (f.gate && toDeparture \<= 60) return 'boarding'

  if (toDeparture \<= 180) return 'checkin'

  return 'scheduled'

}

**Hard stop — set** **tracking\_active = false** **when any is true:**

  - phase is landed or cancelled
  - actual\_arrival is set
  - scheduled\_arrival \< now() - 6h (safety sweep for missed landings)
  - status\_error\_count \> 10

A daily pg\_cron enforces all four regardless of app usage. **This is the guard against one stuck flight consuming the month.**

## 9.7 Map binding

The map is not a separate screen — it's the primary rendering of FlightState. Reuses Module 6's Leaflet setup, no new dependency.

### Layers, bottom to top

|  |  |  |
| :-: | :-: | :-: |
| \*\*Layer\*\* | \*\*Content\*\* | \*\*Notes\*\* |
| Base | OSM tiles | Dark variant during the flight's night side |
| Route | Great-circle origin → dest | @turf/great-circle. \*\*Never a straight line\*\* — on Mercator that's geometrically wrong and looks wrong. |
| Flown | Solid portion, origin → aircraft |   |
| Remaining | Dashed portion, aircraft → dest |   |
| Trail | Breadcrumb from flight\\\_positions | Downsampled to \\\~1 point/2 min for render |
| Airports | Origin and destination pins | Labelled with IATA + local time |
| Aircraft | Marker rotated to heading | Style varies by confidence — see below |
| Watcher | The waiting partner's home | Optional. Makes the closing gap literal. |

### Aircraft marker by confidence

|  |  |  |
| :-: | :-: | :-: |
| \*\*Confidence\*\* | \*\*Style\*\* | \*\*Label\*\* |
| live | Solid, full opacity, rotated to heading | "Live · 40s ago" |
| stale | Solid, 50% opacity | "Last seen 12 min ago" |
| estimated | \*\*Hollow outline, dashed stroke\*\* | "Estimated — no radar coverage" |
| none | No marker; route only | "Position unavailable" |

**Never render an interpolated guess in the same style as a real fix.** This is the single most important rule in the map layer — it's the difference between "informative" and "lying to someone waiting at an airport."

### Antimeridian handling

A flight crossing ±180° longitude will draw a line the wrong way around the globe if you naively connect coordinates.

// Split the great circle at the antimeridian into separate polylines

const line = greatCircle(origin, dest, { npoints: 100 })

const segments = splitAtAntimeridian(line)   // turf handles this

segments.forEach(seg =\> L.polyline(seg).addTo(map))

Test explicitly with a Tokyo → Los Angeles route.

### Interpolation between polls

Positions arrive every 60s; the marker should not teleport.

// Animate between last two fixes using dead reckoning from heading + velocity

function interpolate(last: Position, elapsedMs: number) {

  const distM = last.velocityMs \* (elapsedMs / 1000)

  return destinationPoint(last, last.heading, distM)

}

Animate over \~1s with requestAnimationFrame, respecting prefers-reduced-motion. Dead reckoning between real fixes is honest; extrapolating for 3 hours is not — that's what level 3 and the hollow marker are for.

### Auto-fit and follow

  - Default: fit bounds to the full route
  - "Follow aircraft" toggle: centre on the marker, keep zoom
  - Recentre control always available
  - Never auto-pan while the user is dragging

### Progress computation

function progress(f, pos): Progress {

  const total = greatCircleKm(f.origin, f.dest)

  if (pos && pos.confidence \!== 'estimated') {

    const flown = greatCircleKm(f.origin, pos)

    return { fraction: clamp01(flown / total),

             distanceFlownKm: flown, distanceRemainingKm: total - flown,

             minutesRemaining: (total - flown) / (pos.velocityMs \* 3.6) \* 60,

             source: 'position' }

  }

  // Time-based fallback

  const frac = elapsedFraction(f.actualDeparture ?? f.scheduledDeparture,

                               f.estimatedArrival ?? f.scheduledArrival)

  return { fraction: frac, ..., source: 'time' }

}

Show which basis was used. A position-derived ETA is materially better than a schedule-derived one, and the user should be able to tell.

## 9.8 Features

**Both partners' flights, always visible**

traveler\_id determines *whose* flight it is, not who may see it. Either partner can add, edit, and track any flight.

ACTIVE NOW

  ● Her · AC 42 · YYZ → LIS · Enroute · lands 18:50 your time

UPCOMING

  ○ Your · EK 512 · COK → LIS · Nov 11

  ○ Her · AC 43 · LIS → YYZ · Dec 5

PAST

  ✓ Your · EK 511 · Feb 2026

**Add flight**

  - Manual: flight number + date. **The baseline, not the fallback.**
  - Paste confirmation text → regex extraction
  - Screenshot/PDF → vision parsing (optional, needs AI module)
  - All routes converge on a confirm-before-save step
  - Assign to self or partner

**Validation on save** — one flight-lookup call resolves airline, route, times, timezones, and caches callsign. Costs 1 unit, once per flight ever. If unresolvable, save anyway with manual times and phase = 'unknown'.

**Live view** — the map is the primary surface, with a detail panel beneath: dual times, phase badge, gate/terminal/belt, progress bar, freshness notices, and the handoff card.

**Auto-refresh while open**

  - 60s tick, cleared on unmount
  - **Paused when the tab is hidden**; immediate refresh on focus
  - Manual refresh with a 60s client cooldown and the same server-side max-age check — spamming it cannot burn quota
  - Data age always visible

**Both-flying case** — when both partners fly to the same destination, neither is waiting. Suppress the handoff, show both arrival times and the gap between them, and render both aircraft on one map.

**Multi-leg journeys** — legs grouped under a journey; connection window and risk computed between them.

**Notifications** — routed to the partner **not** on the flight.

|  |  |  |
| :-: | :-: | :-: |
| \*\*Event\*\* | \*\*Traveller\*\* | \*\*Watcher\*\* |
| Gate assigned | ✓ | — |
| Boarding | ✓ | — |
| Departed | — | ✓ |
| Delay \\\> 15 min | — | ✓ |
| Diverted | — | ✓ |
| "Leave now" | — | ✓ |
| Landed | — | ✓ |

Notifications fire from the **background sweep**, not the in-app poll — the watcher shouldn't need the app open to learn the flight landed.

**Background sweep** — pg\_cron every 30 min, only for flights in the 6h-before → landed window. Same max-age rules. \~20 extra calls per flight, and it guarantees notifications regardless of app usage.

**Flight history** — past flights per trip and lifetime; total distance flown, as a Dashboard stat.

## 9.9 The arrival handoff

The highest-value output in the module. Only computed when a watcher exists.

function computeHandoff(f: FlightState, watcher: Profile): HandoffPlan {

  const landing = f.times.actualArrival

               ?? f.times.estimatedArrival

               ?? f.times.scheduledArrival

  const disembark   = 15

  const immigration = waitTime(f.dest.iata, 'immigration', f)

  const baggage     = f.hasCheckedBags ? waitTime(f.dest.iata, 'baggage', f) : 0

  const walk        = 10

  const readyAt = addMinutes(landing, disembark + immigration + baggage + walk)

  const drive   = estimateDrive(watcher.home, f.dest)

  const buffer  = 15

  return {

    leaveAt: subMinutes(readyAt, drive + buffer),

    readyAt,

    breakdown: { disembark, immigration, baggage, walk, drive, buffer },

    confidence: f.freshness.status.ageSeconds \< 900 ? 'good' : 'rough',

    voidReason: f.phase === 'diverted' ? 'Flight diverted' : null

  }

}

**Immigration defaults** (static, overridable per airport in airport\_wait\_times):

|  |  |
| :-: | :-: |
| \*\*Case\*\* | \*\*Minutes\*\* |
| Domestic | 0 |
| Schengen internal | 5 |
| International, e-gate eligible | 20 |
| International, standard | 45 |
| Known-busy airport | 60 |

After each real arrival, prompt the watcher: *"How long did she actually take?"* — one tap writes back to airport\_wait\_times. **The estimate improves with every trip**, which is the payoff of building this for two people rather than millions.

**Drive time without a routing key:** great-circle × 1.4 ÷ 45 km/h. Labelled an estimate. Swap the function if a routing key is ever added.

**Always show the breakdown, not just a time.** A bare "leave at 19:10" is untrustworthy; the same figure with its components is actionable.

**Void the handoff on diversion.** Say so loudly. A confidently wrong airport run is the worst failure this module can produce.

## 9.10 Connection risk

buffer  = leg2.scheduledDeparture - (leg1.estimatedArrival ?? leg1.scheduledArrival)

minimum = sameTerminal ? 45 : isInternational ? 90 : 60

risk = buffer \< minimum \* 0.7 ? 'high'

     : buffer \< minimum       ? 'tight'

     :                          'ok'

Surface high risk **as soon as leg 1's delay is known** — that's when it's actionable, not after the connection is missed. Notify both partners in this case; the traveller can act on it.

## 9.11 Services

// Reads

listFlights(filter?): Promise\<Flight\[\]\>

getFlightStates(ids, force?): Promise\<FlightState\[\]\>   // Edge Function, batched

getFlightTrack(id): Promise\<Position\[\]\>

getQuotaUsage(): Promise\<{ aerodatabox: Usage; opensky: Usage }\>

// Writes

lookupFlight(number, date): Promise\<FlightInfo\>        // 1 unit

addFlight(input): Promise\<Flight\>

parseConfirmation(text): ParsedFlight\[\]                // client-side regex

addJourney(tripId, travelerId, direction): Promise\<Journey\>

updateFlight(id, patch): Promise\<Flight\>

setManualOverride(id, override): Promise\<Flight\>

reportActualWait(iata, kind, minutes): Promise\<void\>   // improves handoff

stopTracking(id): Promise\<void\>

deleteFlight(id): Promise\<void\>

## 9.12 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /flights | All flights, grouped by status |
| /flights/:id | Live map + detail panel |
| /trips/:id/flights | Trip flights |

## 9.13 Edge cases

**Data**

  - Flight number valid but unknown to ADB → save, phase = 'unknown', allow manual times
  - Codeshare → the operating carrier's number is what both APIs know; prompt for it on lookup failure
  - Callsign not in airline\_codes → position tracking unavailable, status still works
  - OpenSky returns a different aircraft with a recycled callsign → validate the fix is within the route corridor before accepting

**Geography**

  - Overnight flights → arrival date ≠ departure date; never assume same-day
  - Date-line crossing → local arrival time can precede local departure time. Handle explicitly.
  - Antimeridian route → split the polyline, or it draws the wrong way round the globe
  - Polar routes → great-circle rendering matters most here; a straight line is absurdly wrong

**Operational**

  - Diverted → new destination prominent, handoff voided with a stated reason, tracking continues
  - Cancelled → stop tracking, notify both, prompt to add the replacement
  - Both partners flying → two states, no handoff, both aircraft on one map
  - Quota exhausted mid-flight → degradation level 5/6, quiet notice, manual refresh disabled with a reason
  - Tab open overnight on a landed flight → tracking\_active false, zero calls regardless of the ticking UI
  - Both partners open the module simultaneously → at most one call per source

## 9.14 Acceptance

**Cost control**

  - One hour with the module open on an upcoming flight → ≤2 AeroDataBox calls (verify via api\_usage)
  - Both partners viewing simultaneously → one call per source, not two
  - Hidden tab makes zero requests; focus triggers immediate refresh
  - Manual refresh spammed 20× → at most one API call
  - Quota guard blocks calls above 90% of either allowance
  - Landed flight stops all polling within one cycle
  - Safety sweep deactivates a flight whose landing was missed

**Correctness**

  - AC 42, ac0042, AC42 normalise identically
  - AC42 resolves to callsign ACA42 and finds the aircraft
  - icao24 cached after first fix; later polls pass it directly
  - State vector fields read by array index, not by key
  - OpenSky token cached, not re-fetched per request
  - Ground contact at destination sets landed even while ADB says enroute
  - Position 300 km off-corridor flags diverted and voids the handoff
  - Overnight date-line flight renders correct local dates at both ends

**Map**

  - Route drawn as a great circle, not a straight Mercator line
  - Tokyo → Los Angeles renders without crossing the globe the wrong way
  - Mid-ocean gap renders a **hollow, dashed** marker labelled "estimated"
  - Marker interpolates smoothly between 60s fixes, no teleporting
  - prefers-reduced-motion disables marker animation

**Robustness**

  - OpenSky failure does not block a status update, and vice versa
  - Every degradation level renders without an error state
  - Freshness ages visible on both status and position
  - Handoff shows its breakdown, not just a time
  - Post-arrival wait-time feedback writes to airport\_wait\_times

# MODULE 10 — STAY ALLOWANCE

**Purpose:** how long each of them is legally permitted to stay. Prevents a serious real-world mistake.

## 10.1 Schema

create table allowance\_rules (

  id uuid primary key default gen\_random\_uuid(),

  passport\_country text not null,

  destination\_country text not null,   -- or region code, e.g. 'SCHENGEN'

  rule\_type text not null,             -- 'rolling'|'per\_entry'|'per\_year'|'per\_visa'

  max\_days int not null,

  window\_days int,                     -- required for 'rolling'

  region\_members text\[\],               -- for zone rules like Schengen

  source\_url text,

  verified\_on date,

  unique (passport\_country, destination\_country)

);

create table entry\_exit\_log (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  user\_id uuid not null references profiles(id),

  country\_code text not null,

  entered\_on date not null,

  exited\_on date,                      -- null = currently present

  trip\_id uuid references trips(id) on delete set null,

  is\_estimated boolean default false,

  notes text,

  created\_at timestamptz default now()

);

create index on entry\_exit\_log (user\_id, country\_code, entered\_on);

## 10.2 Features

**Rule setup**

  - Per person, per country
  - Auto-populated from visa\_rules.max\_days where available
  - Manually editable — the user's actual visa may differ from the generic rule
  - Source link and verified date always shown

**Entry/exit log**

  - Manual entry
  - Auto-suggested from trip dates and flight arrivals ("Add Nov 12 – Dec 5 in Portugal to your log?")
  - Marked is\_estimated when derived rather than confirmed
  - Open-ended entries (no exit) = currently present

**Current status**

  - Days used in the current window
  - Days remaining
  - Must-leave-by date
  - Per person, per country

**Planning check**

  - When a trip has dates and a destination, evaluate whether it would breach
  - Warning shown **at planning time**, on the trip and the destination board
  - Shows the exact date the limit would be hit

**Zone handling**

  - Schengen and similar treated as one country for counting
  - Days in any member count against the zone total

## 10.3 Logic — the rolling window

This is the part people get wrong, and the consequences are severe.

**The rule:** "X days in any rolling Y days" means the limit must hold on **every single day** of the stay, not just on arrival.

function daysUsedOn(log: Stay\[\], date: Date, windowDays: number): number {

  const windowStart = subDays(date, windowDays - 1)

  let count = 0

  for (const stay of log) {

    const from = max(\[stay.entered\_on, windowStart\])

    const to   = min(\[stay.exited\_on ?? date, date\])

    if (to \>= from) count += differenceInCalendarDays(to, from) + 1

  }

  return count

}

function checkPlannedStay(log, plannedFrom, plannedTo, rule) {

  const combined = \[...log, { entered\_on: plannedFrom, exited\_on: plannedTo }\]

  let worstDay = null, worstCount = 0

  // MUST evaluate every day of the planned stay

  for (const d of eachDayOfInterval({ start: plannedFrom, end: plannedTo })) {

    const used = daysUsedOn(combined, d, rule.window\_days)

    if (used \> worstCount) { worstCount = used; worstDay = d }

    if (used \> rule.max\_days) {

      return { ok: false, breachDate: d, used, limit: rule.max\_days }

    }

  }

  return { ok: true, peak: worstCount, peakDate: worstDay,

           headroom: rule.max\_days - worstCount }

}

**Counting conventions — get these right:**

  - Entry day and exit day **both count** as days present
  - A same-day in-and-out counts as 1 day
  - The window is inclusive of the evaluation date
  - Days are calendar days in the destination's timezone, not 24h periods

**Must-leave-by date:**

function mustLeaveBy(log, currentEntry, rule) {

  let d = new Date()

  while (daysUsedOn(log, d, rule.window\_days) \<= rule.max\_days) {

    d = addDays(d, 1)

  }

  return subDays(d, 1)   // last permissible day

}

**Other rule types:**

  - per\_entry — reset on each entry; simply count days since last entry
  - per\_year — count within the calendar year
  - per\_visa — count since the visa's issue date

**Mandatory disclaimer** on every screen in this module:

Advisory only. Rules change and individual circumstances differ. Confirm with the destination's immigration authority before travelling.

Plus the source\_url and verified\_on. This module must never present itself as authoritative.

## 10.4 Services

getAllowanceStatus(userId, country): Promise\<{

  used, remaining, mustLeaveBy, rule, windowStart

}\>

checkTrip(tripId): Promise\<{ \[userId\]: AllowanceCheck }\>

logEntry(userId, country, from, to?): Promise\<void\>

suggestLogFromTrip(tripId): Promise\<Suggestion\[\]\>

upsertRule(input): Promise\<AllowanceRule\>

## 10.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /allowance | Status per person per country |
| Inline | Warning banner on trip and destination screens |

## 10.6 Edge cases

  - No rule configured → show "not tracked", never assume unlimited
  - Overlapping log entries → merge and warn; likely a data-entry error
  - Currently present (no exit date) → count through today, recompute daily
  - Dual nationality → check the passport they'd actually use; let them choose
  - Resident/PR status → allowance doesn't apply; add a "no limit" rule type
  - Trip spanning two windows → the algorithm handles it, but test explicitly

## 10.7 Acceptance

  - Schengen 90/180 case: 89 days used, 5-day trip planned → correctly flags breach
  - Breach detected on a mid-stay day, not just the arrival date
  - Entry and exit days both counted
  - Disclaimer and source link present on every view
  - Zone rule counts days across all Schengen members

# MODULE 11 — GALLERY

**Purpose:** the shared photo library. Must stay alive between trips, and must fit \~1 GB.

## 11.1 Schema

create table media (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  uploader\_id uuid not null references profiles(id),

  trip\_id uuid references trips(id) on delete set null,

  itinerary\_item\_id uuid references itinerary\_items(id) on delete set null,

  path\_display text not null,      -- 1600px

  path\_thumb text not null,        -- 400px

  path\_original text,              -- NULL on free tier

  thumbhash text,                  -- \~25 byte placeholder

  media\_type text default 'photo', -- 'photo' | 'video'

  mime\_type text, bytes int,

  width int, height int, duration\_s int,

  taken\_at timestamptz,

  lat numeric, lng numeric,

  caption text,

  is\_favorite boolean default false,

  phash text,                      -- perceptual hash

  search\_tsv tsvector,

  uploaded\_at timestamptz default now(),

  deleted\_at timestamptz

);

create table albums (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  title text not null,

  kind text default 'manual',      -- 'trip' | 'manual' | 'exchange'

  trip\_id uuid references trips(id) on delete cascade,

  cover\_media\_id uuid references media(id) on delete set null,

  created\_by uuid references profiles(id),

  sort\_order int default 0,

  created\_at timestamptz default now()

);

create table album\_media (

  album\_id uuid references albums(id) on delete cascade,

  media\_id uuid references media(id) on delete cascade,

  sort\_key text,

  primary key (album\_id, media\_id)

);

create table media\_comments (

  id uuid primary key default gen\_random\_uuid(),

  media\_id uuid references media(id) on delete cascade,

  author\_id uuid references profiles(id),

  body text not null,

  created\_at timestamptz default now()

);

create table share\_links (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  created\_by uuid references profiles(id),

  token text unique not null,

  target\_type text not null,       -- 'media' | 'album'

  target\_id uuid not null,

  allow\_download boolean default false,

  passcode\_hash text,

  expires\_at timestamptz not null,

  revoked\_at timestamptz,

  view\_count int default 0,

  created\_at timestamptz default now()

);

create table daily\_exchange (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  user\_id uuid references profiles(id),

  media\_id uuid references media(id) on delete cascade,

  exchange\_date date not null,

  unique (couple\_id, user\_id, exchange\_date)

);

create index on media (couple\_id, taken\_at desc) where deleted\_at is null;

create index on media using gin (search\_tsv);

## 11.2 Storage

Private bucket media, path {couple\_id}/{media\_id}/{variant}.jpg.

create policy "couple media access" on storage.objects for all using (

  bucket\_id = 'media'

  and is\_couple\_member(((storage.foldername(name))\[1\])::uuid)

);

## 11.3 Features

**Upload pipeline**

  - Multi-select, drag-and-drop onto the page
  - **Client-side processing before upload** (critical for free tier):

    1.  Read EXIF (exifr) → taken\_at, GPS, orientation
    2.  Auto-rotate per orientation
    3.  HEIC → JPEG (heic2any)
    4.  Generate 1600px display JPEG q75 (Canvas)
    5.  Generate 400px thumb JPEG q70
    6.  Compute thumbhash (thumbhash package)
    7.  Compute perceptual hash for dedupe
  - Upload both variants directly to storage via signed URL
  - **Originals are never uploaded**
  - Queue with per-file progress, pause/resume, retry with exponential backoff
  - Queue persisted to IndexedDB so a page refresh doesn't lose it

**Dedupe**

  - Compare phash against existing; Hamming distance \< 6 = likely duplicate
  - Prompt: skip / upload anyway
  - Never auto-reject

**Grid**

  - Square thumbnails, virtualised (react-virtual)
  - Thumbhash placeholder renders instantly
  - Grouped by trip, then by date
  - Infinite scroll, 60 per page
  - **Loads** **path\_thumb** **only** — never display or original

**Lightbox**

  - Loads path\_display
  - Keyboard nav, swipe on touch
  - Caption edit inline
  - Favourite toggle
  - Comments panel
  - Metadata: date, place, uploader
  - Preload next/previous

**Albums**

  - Auto-created per trip
  - Manual albums, many-to-many
  - Cover selection
  - Reorder within album

**Auto-bucketing**

  - Match taken\_at + GPS against itinerary items
  - Within 500m and ±2h → link itinerary\_item\_id
  - Runs after upload, non-blocking

**Search & filter**

  - Full-text across captions (Postgres tsvector)
  - Filter: uploader, date range, trip, favourites, has-location, media type

**Download**

  - Single → fetch display variant, trigger browser download
  - Bulk → sequential client-side, with progress. **No server-side ZIP** (memory limits)

**Share**

  - Generate link: token, expiry (default 7 days), download permission, optional passcode
  - Public route renders the shared target read-only
  - Active links list with instant revoke
  - Never a raw storage URL

**Trash**

  - Soft delete, restorable
  - 30-day retention, then cron hard-deletes both DB row and storage objects

**Daily exchange**

  - One photo per person per day while apart
  - Distinct strip at the top of the gallery
  - Gentle daily reminder (opt-in)
  - Builds a continuous strip between trips

**Same-moment pairing**

  - Both uploaded photos within 3 min and 100m → show side by side

**Recap**

  - Post-trip: map of photo locations, count, distance covered, favourites

## 11.4 Logic

**Derivative generation:**

async function processImage(file: File) {

  const exif = await exifr.parse(file, { gps: true })

  let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  const display = await resizeToBlob(bitmap, 1600, 0.75)

  const thumb   = await resizeToBlob(bitmap, 400,  0.70)

  const hash    = rgbaToThumbHash(...await downscaleToRgba(bitmap, 100))

  const phash   = await perceptualHash(bitmap)

  return { display, thumb, hash, phash,

           takenAt: exif?.DateTimeOriginal,

           lat: exif?.latitude, lng: exif?.longitude,

           width: bitmap.width, height: bitmap.height }

}

**Size targets:** display ≈ 300 KB, thumb ≈ 40 KB → \~340 KB per photo → **\~2,900 photos in 1 GB**. With originals it would be 250. This single decision is what makes the free tier viable.

**Upload with retry:**

for each file:

  status = pending → processing → uploading → done | failed

  on failure: retry with backoff 1s, 2s, 4s, 8s (max 4 attempts)

  persist queue state to IndexedDB after every transition

**Auto-bucketing match:**

match = itineraryItems.find(i =\>

  i.lat && photo.lat

  && haversineM(i, photo) \< 500

  && Math.abs(differenceInMinutes(photo.taken\_at, i.startInstant)) \< 120)

**Share token:** 32 bytes from crypto.getRandomValues, base64url. Validation Edge Function checks: exists, not revoked, not expired, passcode matches. Returns short-lived signed URLs — never the storage path.

**Hard-delete cron (daily):**

\-- delete storage objects first, then rows

select id, path\_display, path\_thumb from media

where deleted\_at \< now() - interval '30 days';

Order matters: delete the objects, then the rows. The reverse leaves orphaned files that consume the quota invisibly.

**Egress discipline:**

  - Grid: thumb only
  - Lightbox: display only
  - Preload at most 2 ahead
  - Cache-Control: max-age=31536000, immutable on variants (content-addressed paths never change)

## 11.5 Services

listMedia(filters, cursor): Promise\<Page\<Media\>\>

uploadMedia(files, opts): UploadQueue          // observable

getMediaUrl(media, variant): Promise\<string\>   // signed

updateMedia(id, patch): Promise\<Media\>

deleteMedia(ids): Promise\<void\>

restoreMedia(ids): Promise\<void\>

createAlbum(input): Promise\<Album\>

addToAlbum(albumId, mediaIds): Promise\<void\>

createShareLink(target, opts): Promise\<ShareLink\>

revokeShareLink(id): Promise\<void\>

resolveShare(token, passcode?): Promise\<SharedPayload\>

addComment(mediaId, body): Promise\<Comment\>

postDailyExchange(file): Promise\<Media\>

## 11.6 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /gallery | Grid |
| /gallery/:id | Lightbox |
| /gallery/albums | Albums |
| /gallery/trash | Trash |
| /trips/:id/photos | Trip album |
| /s/:token | Public share view (no auth) |

## 11.7 Edge cases

  - HEIC on a browser without native support → heic2any fallback; warn it's slow for large batches
  - No EXIF date → fall back to file lastModified, then upload time
  - Video → skip derivative generation, store as-is with a size cap (200 MB), generate a poster frame
  - Storage quota exceeded → upload fails cleanly with a clear message and a link to the usage view
  - Duplicate detected → prompt, never silently skip
  - Share link to a deleted photo → 404 with a plain message, not a stack trace
  - Two users upload the same photo simultaneously → both stored; dedupe prompt on the second

## 11.8 Acceptance

  - 50-photo upload completes with a page refresh mid-way (queue survives)
  - No original ever reaches storage
  - Grid network payload for 60 items is under 3 MB
  - Thumbhash placeholder visible before any image loads
  - Revoked share link returns 403 immediately
  - Hard-delete cron removes storage objects, verified by bucket listing

# MODULE 12 — HEALTH

**Purpose:** private health tracking with granular, revocable sharing. **Build last. Design with her, not for her.**

## 12.1 Schema

**Owner-scoped, not couple-scoped.** This is the only module where that's true.

create table health\_consents (

  id uuid primary key default gen\_random\_uuid(),

  owner\_id uuid not null references profiles(id) on delete cascade,

  viewer\_id uuid not null references profiles(id) on delete cascade,

  scope text not null,          -- 'cycle'|'cycle\_predictions'|'symptoms'

                                -- |'medications'|'vaccinations'|'notes'

  granted\_at timestamptz default now(),

  revoked\_at timestamptz,

  unique (owner\_id, viewer\_id, scope)

);

create table cycle\_logs (

  id uuid primary key default gen\_random\_uuid(),

  owner\_id uuid not null references profiles(id) on delete cascade,

  started\_on date not null,

  ended\_on date,

  flow text,                    -- 'light'|'medium'|'heavy'

  symptoms text\[\],

  notes text,

  created\_at timestamptz default now()

);

create table health\_records (

  id uuid primary key default gen\_random\_uuid(),

  owner\_id uuid not null references profiles(id) on delete cascade,

  kind text not null,           -- 'medication'|'vaccination'|'condition'|'allergy'

  label text not null,

  detail jsonb default '{}',

  dosage text, frequency text,

  started\_on date, valid\_until date,

  document\_id uuid references documents(id) on delete set null,

  created\_at timestamptz default now()

);

create table medication\_restrictions (

  id uuid primary key default gen\_random\_uuid(),

  country\_code text not null,

  substance text not null,

  restriction text,             -- brief factual label

  source\_url text not null,

  verified\_on date

);

**RLS — consent enforced in the database, not the UI:**

alter table cycle\_logs enable row level security;

create policy "owner full access" on cycle\_logs

  for all using (owner\_id = auth.uid())

      with check (owner\_id = auth.uid());

create policy "viewer with active consent" on cycle\_logs

  for select using (

    exists (

      select 1 from health\_consents c

      where c.owner\_id = cycle\_logs.owner\_id

        and c.viewer\_id = auth.uid()

        and c.scope = 'cycle'

        and c.revoked\_at is null

    )

  );

Same pattern per scope on health\_records. **A hidden tab is not privacy — the database must refuse the read.**

## 12.2 Features

**Consent management**

  - Per-scope toggles, owner-controlled
  - Default: everything off
  - Revoke is one click, immediate, no confirmation friction, no notification pressure on the owner
  - A clear list of exactly what is currently shared

**Cycle log**

  - Start date, end date, flow, symptoms, notes
  - Calendar view
  - History list

**Predictions**

  - Rolling average of the last 6 cycles
  - Next expected start, ± variance
  - **Always labelled as an estimate**
  - No fertility or contraception guidance — that is a regulated medical claim and out of scope

**Medications**

  - Name, dosage, frequency
  - Supply duration calculator for long stays
  - Link to a prescription document

**Vaccinations**

  - Record, date, valid-until
  - Linked to the documents module

**Border restrictions**

  - For a trip destination, flag medications that may be restricted
  - **Only ever links to the official source.** Never asserts the rule.
  - Copy: "Some medications are restricted in Japan. Check the official guidance before travelling." + link

**Trip integration**

  - Predicted cycle dates optionally shown on the trip calendar (only with cycle\_predictions consent)
  - Medication supply check against trip length

**Export & delete**

  - Full JSON export of own data
  - Hard delete of all health data, immediate, no soft-delete grace period

## 12.3 Logic

**Cycle prediction:**

function predict(logs: CycleLog\[\]) {

  const recent = logs.slice(-6)

  if (recent.length \< 3) return { available: false, reason: 'need 3+ cycles' }

  const lengths = recent.slice(1).map((c, i) =\>

    differenceInDays(c.started\_on, recent\[i\].started\_on))

  const mean = average(lengths)

  const sd = standardDeviation(lengths)

  return {

    available: true,

    nextStart: addDays(last(recent).started\_on, Math.round(mean)),

    variance: Math.round(sd),

    confidence: sd \< 3 ? 'regular' : sd \< 7 ? 'variable' : 'irregular',

    basedOn: recent.length,

    isEstimate: true          // always

  }

}

Never present a prediction without the variance and the estimate label. Irregular cycles must not be shown as a confident date.

**Medication supply:**

daysOfSupply = quantityRemaining / dosesPerDay

shortfall = tripNights - daysOfSupply

if (shortfall \> 0) → "You'll run short by N days"

**Consent check in the client** (belt and braces — RLS is the real gate):

const canView = (scope) =\> consents.some(c =\>

  c.owner\_id === partnerId && c.viewer\_id === myId

  && c.scope === scope && \!c.revoked\_at)

## 12.4 Services

listConsents(): Promise\<Consent\[\]\>

grantConsent(viewerId, scope): Promise\<void\>

revokeConsent(viewerId, scope): Promise\<void\>

listCycles(ownerId): Promise\<CycleLog\[\]\>

logCycle(input): Promise\<CycleLog\>

getPrediction(ownerId): Promise\<Prediction\>

listHealthRecords(ownerId, kind?): Promise\<HealthRecord\[\]\>

checkMedicationRestrictions(countryCode): Promise\<Restriction\[\]\>

exportHealthData(): Promise\<Blob\>

deleteAllHealthData(): Promise\<void\>

## 12.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /health | Own health home |
| /health/cycle | Cycle log + calendar |
| /health/medications | Medications |
| /health/sharing | Consent management |
| /health/partner | Partner's shared data (only what's consented) |

## 12.6 Design rules — non-negotiable

  - Private by default. Nothing shared until explicitly shared.
  - Partner's view is read-only and **visibly limited** — show what isn't shared, not a seamless illusion
  - No gamification, no streaks, no celebratory styling
  - No analytics or error-reporting SDK on any health route
  - Predictions labelled as estimates, always
  - No medical advice, diagnosis, fertility, or contraception guidance
  - Revocation is instant and frictionless

## 12.7 Edge cases

  - Fewer than 3 cycles logged → no prediction, explain why
  - Irregular cycles (sd \> 7) → show a range, not a date
  - Consent revoked while partner is viewing → next query fails at RLS; handle gracefully with "no longer shared"
  - Owner deletes their data while shared → partner's view empties immediately
  - Medication with no restriction data → say "not checked", never "safe"

## 12.8 Acceptance

  - Partner cannot read cycle\_logs without consent (verify by direct query with partner JWT)
  - Revoking consent blocks reads immediately, no cache staleness
  - Prediction shows variance and estimate label in all cases
  - Export produces complete JSON
  - Delete removes all rows, no soft-delete residue

# MODULE 13 — BUDGET

**Purpose:** track shared trip spending and who owes whom. Multi-currency, two-person settlement.

## 13.1 Schema

create table expense\_categories (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  name text not null, icon text, color text, sort\_order int default 0

);

\-- seeded: Flights, Stay, Food, Transport, Activities, Shopping, Other

create table expenses (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid references trips(id) on delete cascade,

  itinerary\_item\_id uuid references itinerary\_items(id) on delete set null,

  description text not null,

  amount numeric(12,2) not null check (amount \> 0),

  currency text not null,

  amount\_base numeric(12,2),        -- converted to couple base currency

  fx\_rate numeric(16,8),

  fx\_date date,

  paid\_by uuid not null references profiles(id),

  split\_type text default 'equal',  -- 'equal'|'exact'|'percent'|'full'

  split\_detail jsonb,               -- { userId: amount|percent }

  category\_id uuid references expense\_categories(id) on delete set null,

  spent\_on date not null default current\_date,

  receipt\_media\_id uuid references media(id) on delete set null,

  notes text,

  created\_by uuid references profiles(id),

  created\_at timestamptz default now(),

  deleted\_at timestamptz

);

create table settlements (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid references trips(id) on delete set null,

  from\_user uuid references profiles(id),

  to\_user uuid references profiles(id),

  amount numeric(12,2) not null,

  currency text not null,

  settled\_on date not null default current\_date,

  method text, notes text,

  created\_at timestamptz default now()

);

create table budgets (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null references couples(id) on delete cascade,

  trip\_id uuid references trips(id) on delete cascade,

  category\_id uuid references expense\_categories(id) on delete cascade,

  amount numeric(12,2), currency text,

  period text default 'trip',       -- 'trip' | 'week'

  unique (trip\_id, category\_id, period)

);

create table fx\_rates (

  base text not null, quote text not null, rate numeric(16,8) not null,

  rate\_date date not null,

  primary key (base, quote, rate\_date)

);

create index on expenses (trip\_id, spent\_on) where deleted\_at is null;

## 13.2 Features

**Add expense**

  - Description, amount, currency, date, who paid
  - Split: equal / exact amounts / percentage / one person covers it
  - Category
  - Optional receipt photo (stored via the gallery module)
  - Optional link to an itinerary item

**Currency**

  - Couple base currency in Settings
  - Each expense keeps its original currency
  - Converted to base using the rate **on the spend date**, cached in fx\_rates
  - Historical rates never recalculated — a past expense's converted value is fixed

**Balance**

  - Running "who owes whom" across a trip
  - Lifetime balance across all trips
  - One line, plainly stated: "You owe her €142.50"

**Settlement**

  - Record a payment
  - Resets or reduces the balance
  - History of settlements

**Trip summary**

  - Total spent, by category, by person
  - Per-day average
  - **Per-week view for long stays** — a month-long total is hard to reason about
  - Budget vs actual per category, when budgets are set

**Charts** (Recharts)

  - Category breakdown (donut)
  - Spend over time (line)
  - Per-person contribution (stacked bar)

**Export**

  - CSV of all expenses for a trip

## 13.3 Logic

**Split calculation:**

function shares(expense): Record\<userId, number\> {

  switch (expense.split\_type) {

    case 'equal':

      return { \[a\]: amount/2, \[b\]: amount/2 }

    case 'exact':

      // split\_detail: { userId: amount }, must sum to amount

      return expense.split\_detail

    case 'percent':

      // split\_detail: { userId: pct }, must sum to 100

      return mapValues(split\_detail, p =\> amount \* p / 100)

    case 'full':

      // payer covers it entirely; no debt created

      return { \[expense.paid\_by\]: amount }

  }

}

**Validation:** exact splits must sum to the total within 0.01; percent splits to 100. Reject otherwise — silent rounding errors compound.

**Balance:**

function balance(expenses, settlements, userA, userB) {

  let net = 0   // positive = B owes A

  for (const e of expenses) {

    const s = shares(e)

    if (e.paid\_by === userA) net += s\[userB\] ?? 0

    else                     net -= s\[userA\] ?? 0

  }

  for (const st of settlements) {

    if (st.from\_user === userB) net -= st.amount

    else                        net += st.amount

  }

  return round2(net)

}

All arithmetic in the **base currency**, using each expense's stored amount\_base. Never convert at read time.

**FX handling:**

on expense save:

  if currency === base: amount\_base = amount, fx\_rate = 1

  else:

    rate = fx\_rates\[base\]\[currency\]\[spent\_on\]

        ?? fetch from exchangerate.host for that date

        ?? nearest earlier cached date

    amount\_base = round2(amount / rate)

    store rate and fx\_date

Cache aggressively — one rate per currency pair per day. Never re-fetch a past date.

**Rounding:** always to 2 decimals, and when splitting an odd cent, give it to the payer. Store the discrepancy nowhere; just be consistent.

**Per-week aggregation** for long stays:

weeks = eachWeekOfInterval({ start: trip.start\_date, end: trip.end\_date })

// group expenses by week index, show a small sparkline per week

## 13.4 Services

listExpenses(tripId, filters): Promise\<Expense\[\]\>

addExpense(input): Promise\<Expense\>

updateExpense(id, patch): Promise\<Expense\>

deleteExpense(id): Promise\<void\>

getBalance(tripId?): Promise\<Balance\>

addSettlement(input): Promise\<Settlement\>

getTripSummary(tripId): Promise\<Summary\>

setBudget(tripId, categoryId, amount): Promise\<void\>

getFxRate(from, to, date): Promise\<number\>

exportCsv(tripId): Promise\<Blob\>

## 13.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /trips/:id/money | Trip expenses + summary |
| /money | Lifetime balance and history |

## 13.6 Edge cases

  - Expense in a third currency (neither partner's home) → converts to base, shows original alongside
  - FX API unavailable → save with amount\_base = null, flag for later conversion, retry on a cron
  - Negative balance rounding → always display absolute value with a direction, never "-€0.00"
  - Deleting a settled expense → warn that the balance will change
  - Expense before any trip exists → allow trip\_id = null, counts toward lifetime only

## 13.7 Acceptance

  - Equal split of an odd amount (€10.01) balances exactly
  - Past expense's converted value unchanged after FX rates move
  - Settlement zeroes the balance
  - CSV export opens cleanly in a spreadsheet
  - Per-week view renders for a 30-night trip

# MODULE 14 — SETTINGS

**Purpose:** everything configurable, plus data ownership controls.

## 14.1 Schema

create table couple\_settings (

  couple\_id uuid primary key references couples(id) on delete cascade,

  base\_currency text default 'USD',

  distance\_unit text default 'km',        -- 'km' | 'mi'

  date\_format text default 'iso',

  week\_starts\_on int default 1,           -- 0 = Sunday

  ai\_enabled boolean default false,

  require\_insurance boolean default false,

  long\_stay\_threshold int default 5,      -- nights

  show\_departure\_countdown boolean default false,

  updated\_at timestamptz default now()

);

create table user\_settings (

  user\_id uuid primary key references profiles(id) on delete cascade,

  theme text default 'system',

  accent\_color text default 'amber',

  work\_hours\_start time, work\_hours\_end time,

  work\_timezone text, work\_days int\[\],     -- \[1,2,3,4,5\]

  notify\_flights boolean default true,

  notify\_documents boolean default true,

  notify\_allowance boolean default true,

  notify\_daily\_exchange boolean default false,

  notify\_partner\_activity boolean default false,

  quiet\_hours\_start time, quiet\_hours\_end time,

  updated\_at timestamptz default now()

);

create table push\_subscriptions (

  id uuid primary key default gen\_random\_uuid(),

  user\_id uuid references profiles(id) on delete cascade,

  endpoint text not null unique,

  keys jsonb not null,

  user\_agent text,

  created\_at timestamptz default now()

);

## 14.2 Features

**Profile**

  - Display name, avatar, home city, timezone, nationality
  - Accent colour (drives the whose-pick marker throughout the app)

**Couple**

  - Couple name, anniversary date
  - Partner info, read-only
  - Regenerate invite code
  - Leave couple (destructive, double confirmation)

**Preferences**

  - Base currency
  - Distance units
  - Date format
  - Week start day
  - Long-stay threshold (default 5 nights)
  - Departure countdown toggle — **default off**

**Work hours**

  - Start/end, timezone, working days
  - Feeds the itinerary work-day overlay

**Notifications**

  - Per-category toggles
  - Quiet hours
  - Web Push subscription management (per browser/device)

**AI**

  - Enable/disable toggle — **default off**
  - Endpoint URL and key (stored as an Edge Function secret, never in the browser)
  - Test connection button

**Data**

  - Export everything: JSON of all tables + a manifest
  - Download all photos (bulk, client-side)
  - Storage usage: MB used vs limit, breakdown by module
  - Delete account

**Categories**

  - Manage itinerary categories, expense categories, document types, trip statuses
  - Rename, recolour, reorder, add, delete
  - Deleting sets referencing rows to null, never cascades to content

## 14.3 Logic

**Storage usage:**

select

  sum(bytes) filter (where deleted\_at is null) as active\_bytes,

  sum(bytes) filter (where deleted\_at is not null) as trash\_bytes,

  count(\*) as file\_count

from media where couple\_id = $1;

Show trash separately — users are often surprised that deleted photos still count.

**Export bundle:**

{

  exported\_at, couple, profiles,

  trips, trip\_days, trip\_travelers, trip\_destinations,

  itinerary\_items, wishlist\_items, wishlist\_verdicts,

  documents,        // metadata only; files downloaded separately

  flights, journeys,

  allowance\_rules, entry\_exit\_log,

  media,            // metadata + paths

  expenses, settlements, budgets,

  categories, settings

  // health data EXCLUDED — exported separately by its owner only

}

Health data is deliberately not in the couple export. It belongs to its owner and is exported only from /health.

**Account deletion:**

1\. Confirm twice, typing the couple name

2\. Delete storage objects (media + docs)

3\. Delete DB rows (cascades from couples)

4\. Delete auth user

5\. Sign out

Offer export first, prominently.

**Web Push:** VAPID keys stored as Edge Function secrets. Subscription per browser; prune subscriptions that return 410 Gone.

## 14.4 Services

getSettings(): Promise\<{ couple: CoupleSettings; user: UserSettings }\>

updateCoupleSettings(patch): Promise\<void\>

updateUserSettings(patch): Promise\<void\>

subscribeToPush(): Promise\<void\>

unsubscribeFromPush(): Promise\<void\>

getStorageUsage(): Promise\<UsageReport\>

exportAllData(): Promise\<Blob\>

deleteAccount(confirmation): Promise\<void\>

listCategories(kind): Promise\<Category\[\]\>

upsertCategory(kind, input): Promise\<Category\>

deleteCategory(kind, id): Promise\<void\>

## 14.5 Routes

|  |  |
| :-: | :-: |
| \*\*Route\*\* | \*\*Screen\*\* |
| /settings | Index |
| /settings/profile | Profile |
| /settings/couple | Couple |
| /settings/preferences | Units, formats, thresholds |
| /settings/notifications | Notifications |
| /settings/categories | Category management |
| /settings/data | Export, usage, delete |

## 14.6 Acceptance

  - Accent colour change reflects across itinerary, map pins, and gallery immediately
  - Export produces a valid JSON bundle covering every module
  - Storage usage matches actual bucket size within 5%
  - Deleting a category nulls references without deleting content
  - Push notification received on a real device

# PART 15 — BUILD ORDER

## Stage 0 — Foundations (before any module)

1.  Vite + React + TS + Tailwind + shadcn scaffold
2.  Supabase project, region chosen deliberately
3.  profiles, couples, couple\_members + is\_couple\_member() + partner\_id()
4.  Google OAuth configured, profile trigger
5.  AuthProvider, CoupleProvider, AppShell, routing skeleton
6.  lib/dates.ts, lib/fractional.ts, lib/errors.ts
7.  EmptyState, RestfulEmpty, ErrorState, Skeleton, DualTime, PersonBadge
8.  **GitHub Actions keep-alive cron** (prevents free-tier auto-pause)
9.  supabase gen types typescript wired into the build

**Verify before proceeding:** two accounts pair, and account A cannot read account B's rows via direct query.

## Stage 1 — Core loop

|  |  |  |
| :-: | :-: | :-: |
| \*\*Order\*\* | \*\*Module\*\* | \*\*Why here\*\* |
| 1 | \*\*1 Auth & Couple\*\* | Everything depends on couple\\\_id |
| 2 | \*\*3 Trips\*\* | The container for most other data |
| 3 | \*\*5 Itinerary\*\* | The main planning surface |
| 4 | \*\*8 Documents\*\* | Highest standalone value, no dependencies |
| 5 | \*\*2 Dashboard\*\* | Needs the above to have anything to show |

**Milestone:** plan one real trip end to end with no other tool.

## Stage 2 — Depth

|  |  |  |
| :-: | :-: | :-: |
| \*\*Order\*\* | \*\*Module\*\* | \*\*Depends on\*\* |
| 6 | \*\*7 Wishlist & Blend\*\* | Itinerary |
| 7 | \*\*6 Map\*\* | Itinerary, Wishlist |
| 8 | \*\*4 Destinations\*\* | Trips |
| 9 | \*\*10 Stay Allowance\*\* | Destinations, Trips |

## Stage 3 — Live & media

|  |  |  |
| :-: | :-: | :-: |
| \*\*Order\*\* | \*\*Module\*\* | \*\*Notes\*\* |
| 10 | \*\*9 Flights\*\* | First external API; do the polling discipline properly |
| 11 | \*\*11 Gallery\*\* | Largest module; the free-tier constraint drives its design |
| 12 | \*\*13 Budget\*\* | Self-contained |

## Stage 4 — Personal

|  |  |  |
| :-: | :-: | :-: |
| \*\*Order\*\* | \*\*Module\*\* | \*\*Notes\*\* |
| 13 | \*\*14 Settings\*\* | Grows throughout; formalise it here |
| 14 | \*\*12 Health\*\* | Last. Consent-first. Design it together. |

## Cross-cutting checklist per module

  - Migration written and applied
  - RLS policies written **before** any screen
  - Types regenerated
  - logic.ts pure functions unit-tested
  - All four states handled (loading / error / empty / restful-empty)
  - Realtime subscription where two-user conflict is likely
  - Mobile viewport verified (browser app, but used on phones)
  - Keyboard navigable, visible focus rings
  - Acceptance criteria met

## Non-negotiables across the whole build

1.  **RLS before UI.** Never ship a screen whose table lacks policies.
2.  **No API keys in the browser bundle.** All third-party calls via Edge Functions.
3.  **No public storage buckets.** Signed URLs only.
4.  **Advisory data is labelled advisory.** Visa and stay-allowance screens always carry the source link, verified date, and disclaimer.
5.  **Nothing auto-inserts.** Generated content goes to the suggestion tray.
6.  **Open days are not empty days.** On long stays, blank is the goal.
7.  **Health data is owner-private by default**, consent enforced in the database.
8.  **The app works with AI disabled.** Test with the flag off before turning it on.

*End of implementation documentation.*

# PART 16 — GOING PUBLIC

*Read this only once Parts 0–15 are shipped and you've both used the app for a full trip. It exists so that Phase 1 decisions don't quietly foreclose Phase 2 — not to be built now.*

## 16.1 What already survives, and what doesn't

The good news first: **the hardest architectural work is already done.** Every table is scoped by couple\_id with RLS enforced at the database. Multi-tenancy is not a rewrite — it's the model you already built.

|  |  |  |
| :-: | :-: | :-: |
| \*\*Already multi-tenant\*\* | \*\*Needs real work\*\* | \*\*Breaks completely\*\* |
| RLS on every table | Onboarding for strangers | \*\*Third-party API economics\*\* |
| couple\\\_id scoping | Cost attribution per couple | \*\*Storage cost model\*\* |
| Couple invite/pairing flow | Rate limiting and abuse | \*\*Health data compliance\*\* |
| Storage path partitioning | Support and error visibility | \*\*Free-tier everything\*\* |
| Per-couple settings and categories | Performance at scale |   |

The third column is where the effort goes. Two of those three are not engineering problems.

## 16.2 The API economics problem — solve this first

**This is the thing that makes or breaks a public launch, and it is not obvious.**

Free API tiers are **per-account, not per-user**. Your \~600 AeroDataBox units and \~4,000 OpenSky credits are shared across *every couple on the platform*.

AeroDataBox: 600 units/month ÷ \~85 units per flight

           = 7 tracked flights per MONTH, across ALL users

OpenSky:     4,000 credits/day ÷ \~600 credits per flight

           = \~6 concurrent tracked flights per DAY, across ALL users

**Ten couples break this. Not a thousand — ten.**

Three viable answers, in order of preference:

### Option A — Paid API tier, absorbed into pricing

Move to a commercial flight-data plan and price the product to cover it. Model the unit economics before committing:

cost\_per\_couple\_month =

    (flights\_per\_couple\_month × units\_per\_flight × cost\_per\_unit)

  + storage\_gb × storage\_rate

  + egress\_gb × egress\_rate

  + (platform\_fixed\_cost / active\_couples)

Realistically a long-distance couple tracks 1–2 flights a month. If flight data lands around a few cents per tracked flight at commercial rates, it's affordable — but **verify current pricing before designing around it**, and build the model on real numbers, not these placeholders.

### Option B — Bring your own key

Each couple registers their own free AeroDataBox and OpenSky accounts and pastes the keys into Settings. Keys stored encrypted, used only in Edge Functions.

  - **Pro:** costs scale to zero, free tier stays genuinely free, quota is per-couple by construction
  - **Con:** onboarding friction that most users won't tolerate
  - **Verdict:** excellent as a *power-user option* and a free-tier fallback; unacceptable as the only path

### Option C — Tiered by feature

Free tier omits live flight tracking entirely. Paid tier includes it. This is honest and it maps cost to value cleanly — flight tracking is genuinely the most expensive feature per user.

**Recommended combination:** Option C as the default, with Option B available so free users who want tracking can bring their own keys.

### Quota enforcement becomes mandatory

create table couple\_quotas (

  couple\_id uuid primary key references couples(id) on delete cascade,

  plan text not null default 'free',

  flight\_units\_used int default 0,

  flight\_units\_limit int default 0,

  storage\_bytes\_used bigint default 0,

  storage\_bytes\_limit bigint default 1073741824,

  ai\_tokens\_used int default 0,

  period\_start date not null,

  byo\_keys jsonb            -- encrypted, if using Option B

);

Every metered call checks and decrements. The api\_usage table you already built becomes the audit trail. **Enforce at the Edge Function, never the client.**

## 16.3 Storage economics

The second cost that scales linearly with users.

Per couple per year (measured, not guessed):

  \~2 trips × \~1,500 photos = 3,000 photos

  × 340 KB (thumb + display, no originals)

  ≈ 1 GB per couple per year, growing forever — nobody deletes memories

|  |  |  |
| :-: | :-: | :-: |
| \*\*Couples\*\* | \*\*Year 1\*\* | \*\*Year 3\*\* |
| 100 | 100 GB | 300 GB |
| 1,000 | 1 TB | 3 TB |
| 10,000 | 10 TB | 30 TB |

Two consequences:

**Move media to Cloudflare R2.** Zero egress fees, and egress is the meter that grows — photos are viewed far more often than uploaded. Because Part 0 put every storage call behind uploadMedia() / getSignedUrl() / deleteMedia(), this is a one-file change. That abstraction was written for exactly this moment.

**Per-couple storage limits, enforced and visible.** Free tier gets a hard cap; paid tiers get more. Show usage prominently — surprise is worse than the limit. And **offer originals as a paid feature**: free stores thumb + display, paid stores originals too. The column already exists.

## 16.4 Health data — the compliance wall

**This is the highest-risk item in the entire public launch, and it is a legal problem, not a technical one.**

Under GDPR, health and reproductive data is **special category data (Article 9)**. Under PIPEDA it's sensitive personal information. Storing cycle data for strangers in multiple jurisdictions carries obligations that a hobby project does not:

  - Explicit, granular, freely-given consent — separate from the general terms
  - Documented lawful basis, and a Data Protection Impact Assessment
  - Data residency and cross-border transfer rules
  - Breach notification duties, typically within 72 hours
  - Right to erasure that provably reaches backups
  - Potential need for a Data Protection Officer depending on scale

Reproductive health apps also have a genuinely bad recent record on this, and public scrutiny is high.

**Three options, and I'd argue strongly for the first:**

|  |  |
| :-: | :-: |
| \*\*Option\*\* | \*\*Assessment\*\* |
| \*\*Ship publicly without the health module\*\* | \*\*Recommended.\*\* Cut it from the public build. The other 13 modules carry the product. |
| Client-side E2E encryption, zero-knowledge | Server stores ciphertext it cannot read. Materially reduces exposure but doesn't eliminate obligations, and key recovery is a hard UX problem. |
| Full compliance programme | Legal counsel, DPIA, DPO, audits. Realistic only with funding and a company behind it. |

The health module was designed for one person who chose to build it with her partner. **That justification does not transfer to strangers.** If it ships publicly, it should be opt-in, end-to-end encrypted, and reviewed by an actual lawyer — not shipped because the code already exists.

## 16.5 Other legal and policy work

Genuinely required before a public launch:

  - **Terms of Service and Privacy Policy** — specific to what you actually collect
  - **Data processing agreements** with Supabase and every third-party provider
  - **Cookie/consent banner** if you add analytics
  - **Age gate** — under-13 users trigger COPPA in the US and equivalents elsewhere
  - **Content policy and reporting** — user-uploaded photos means CSAM scanning obligations. This is not optional and not something to improvise. Investigate a hash-matching service before accepting public uploads.
  - **Data export and deletion** — you already built both; now they're legal requirements with deadlines
  - **Licence check on every data source.** OpenSky is free for *non-commercial* use. A public product with paid tiers is commercial. **You will need a different arrangement or a different provider.** Verify this before launch — it's the kind of thing that's easy to miss and hard to unwind.

That last point deserves emphasis: the whole free-position architecture in Module 9 rests on a non-commercial licence. Going public invalidates it.

## 16.6 Onboarding for strangers

Everything Part 0 deliberately skipped now has to exist.

**The pairing problem is the interesting one.** Meridian is useless with one user, so the empty single-user state is your entire funnel:

  - Solo mode must be genuinely useful for days or weeks while the partner is convinced to join
  - Invite by link and email, not just an 8-character code
  - Reminder to the inviter if the code goes unused
  - A preview of what the app looks like once paired
  - Handle gracefully: partner never joins, partner joins then leaves, both create couples separately

**Also needed:** progressive disclosure (14 modules will overwhelm a new user — reveal Trips, Documents, and Gallery first), sensible seeded defaults, sample data for an empty account, and a way to change your mind about a couple.

## 16.7 Performance

At two users, nothing is slow. At scale, these bite:

|  |  |
| :-: | :-: |
| \*\*Area\*\* | \*\*Work\*\* |
| Indexes | Composite indexes on every (couple\\\_id, sort\\\_column) query path |
| N+1 | Audit every list view; the Dashboard RPC pattern generalises well |
| Pagination | Gallery already uses cursors; extend to trips, expenses, itinerary |
| Realtime | One channel per couple, not per table. Connection limits are real. |
| Edge Functions | Cold starts on Deno; keep them small and dependency-light |
| Bundle | Route-level code splitting; the map and chart libraries are heavy |
| Images | CDN in front of storage; Cache-Control: immutable on content-addressed paths |
| Postgres | Connection pooling (Supavisor) becomes mandatory |
| Cron | Flight sweep across thousands of flights needs batching and a work queue, not one big query |

**Add observability before you need it:** structured logs, Sentry with release tracking, per-endpoint latency, and a dashboard of API quota consumption per provider. At two users you debug by asking your girlfriend what happened. At two thousand, you can't.

## 16.8 Abuse and safety

New attack surface that didn't exist with two trusted users:

  - **Share links** — currently expiring and revocable, which is right. Add rate limiting on token resolution and monitor for enumeration attempts.
  - **Storage abuse** — someone will use the gallery as free file hosting. Per-couple caps, file type validation, and size limits.
  - **Signup abuse** — email verification, and rate limits on couple creation.
  - **Scraping your Edge Functions** — per-user rate limits on every endpoint, especially the metered ones.
  - **Malicious uploads** — validate MIME types server-side, never trust the client. Strip EXIF from shared images (location data in a public share link is a real privacy leak).

That last one is worth doing in Phase 1 anyway.

## 16.9 What stays exactly as it is

Worth stating, because the temptation on a public launch is to change everything:

  - **The two-person couple model.** Don't generalise to groups. The constraint is the product.
  - **The flexibility charter.** No required fields, nothing auto-inserts, open days stay open.
  - **RLS-first security.** It's already correct; scale doesn't change it.
  - **Advisory data stays advisory.** Visa and stay-allowance disclaimers matter *more* with strangers, not less.
  - **No ads, no engagement mechanics.** A product about a relationship should not be optimised for time-in-app.

## 16.10 Suggested sequence

|  |  |
| :-: | :-: |
| \*\*Stage\*\* | \*\*Work\*\* |
| \*\*0\*\* | Use it yourselves for a full trip. Cut whatever you didn't open. |
| \*\*1\*\* | Decide the API cost model (§16.2). Everything else depends on it. |
| \*\*2\*\* | Legal foundation: ToS, privacy policy, licence review, health-module decision |
| \*\*3\*\* | Multi-tenancy hardening: quotas, rate limits, per-couple storage caps |
| \*\*4\*\* | Move media to R2; add CDN and observability |
| \*\*5\*\* | Onboarding, solo mode, progressive disclosure |
| \*\*6\*\* | Private beta — 5–10 couples you know. Real feedback, contained risk. |
| \*\*7\*\* | Public launch |

**Do not skip stage 0.** The most valuable thing about building this for two people is finding out which of the 14 modules you actually use. Ship publicly only what survived contact with your own lives — that's a far better filter than any amount of market research.

# PART 17 — LICENSING & PAYMENTS

*Phase 2. Depends on the API cost model in §16.2 being settled first — you cannot price what you haven't costed.*

## 17.1 Licensing model

Two separate questions people conflate: **what licence covers the code**, and **what agreement covers the users**.

### The code

|  |  |
| :-: | :-: |
| \*\*Model\*\* | \*\*Fit\*\* |
| \*\*Proprietary / all rights reserved\*\* | \*\*Recommended.\*\* Simplest. You keep the code private and sell access to the hosted service. |
| Open core | Core open (AGPL), paid features closed. Only worth it if you want contributors, and it invites self-hosting that competes with you. |
| Fully open source | Ideologically nice, commercially hard for a solo maintainer with a hosted product. |

Ship proprietary. You can always open-source later; the reverse is effectively impossible.

Add to the repo root: LICENSE (proprietary notice), NOTICE (third-party attributions), and a dependency licence audit — license-checker in CI, failing the build on any GPL/AGPL dependency that would infect a proprietary product.

### The users

You need three documents. Don't write them from scratch — use a reputable generator and have a lawyer review, especially given the data you handle.

|  |  |
| :-: | :-: |
| \*\*Document\*\* | \*\*Covers\*\* |
| \*\*Terms of Service\*\* | The contract. Acceptable use, availability, liability limits, termination, governing law. |
| \*\*Privacy Policy\*\* | What you collect, why, where it's stored, retention, sub-processors, user rights. |
| \*\*Subscription Terms\*\* | Billing cycle, renewal, cancellation, refunds, price changes, trial terms. |

**Non-negotiable clauses for this product specifically:**

  - **Advisory data disclaimer.** Visa, stay-allowance, flight, and medication information is informational only. Users must verify with official sources. This one matters — immigration consequences are severe.
  - **No medical advice.** Explicit, prominent, and repeated in-product if the health module ever ships publicly.
  - **Data ownership.** Users own their content. You have a limited licence to store and display it in order to run the service. Nothing more — no training rights, no marketing use.
  - **Couple data on separation.** What happens when one partner leaves. See §17.7; it's a real scenario for this product and users will ask.
  - **Service availability.** No SLA on free tiers. Be honest.

### Third-party licences you must clear before charging money

|  |  |
| :-: | :-: |
| \*\*Dependency\*\* | \*\*Issue\*\* |
| \*\*OpenSky Network\*\* | \*\*Free for non-commercial use only.\*\* A paid product is commercial. Contact them for terms, or move position data to a commercial provider. \*\*This blocks launch.\*\* |
| OpenStreetMap | ODbL — attribution required, permitted commercially. Tile \*hosting\* has usage policies; use a commercial tile provider (Mapbox, MapTiler, Stadia) at scale rather than OSM's own tile servers. |
| Nominatim | Public instance forbids heavy/commercial use. Self-host or use a paid geocoder. |
| AeroDataBox | Check the RapidAPI plan's commercial terms. |
| Fonts | Verify web-embedding rights for any commercial font. |

The OpenSky one is the sharpest: **the entire free live-position architecture in Module 9 rests on a non-commercial licence.** Resolve it before you take a single payment.

## 17.2 Choosing a payment provider

The decision that matters most for a solo developer selling globally is **Merchant of Record (MoR) versus direct**.

|  |  |  |
| :-: | :-: | :-: |
|   | \*\*Merchant of Record (Paddle, Lemon Squeezy)\*\* | \*\*Direct (Stripe)\*\* |
| Who sells to the customer | The provider. They're the seller of record. | You. |
| Global sales tax / VAT / GST | \*\*They handle registration, collection, and remittance.\*\* | \*\*Your problem, in every jurisdiction.\*\* |
| Fees | Higher (\\\~5% + fixed) | Lower (\\\~2.9% + fixed) |
| Payout | Consolidated | Direct |
| Invoicing, refunds, chargebacks | Handled | Yours |
| Setup complexity | Low | Moderate |

**Recommendation: Merchant of Record.**

The extra \~2% buys you out of global tax compliance, and that is not a small thing. Selling a digital subscription to consumers in the EU means VAT MOSS obligations from the first euro. Add the UK, India, Australia, Canada, and a dozen US states with digital-goods tax, and a solo developer is looking at either a permanent compliance burden or a real risk of getting it wrong.

Stripe is the better choice **only** if you already have a company with an accountant handling multi-jurisdiction tax, or you're selling in one country.

**Practical note:** verify current provider availability and terms for a UAE-registered entity before committing — payment provider country support changes, and it's the kind of thing that's painful to discover after building the integration.

## 17.3 Pricing model

**The billing unit is the couple, not the user.** One subscription, two seats. This is unusual and it's correct — the product is meaningless with one user, and charging per-seat would mean charging double for a two-person product.

A structure that maps cost to value:

|  |  |  |
| :-: | :-: | :-: |
|   | \*\*Free\*\* | \*\*Paid\*\* |
| Trips, itinerary, map, wishlist | ✓ | ✓ |
| Documents & expiry alerts | ✓ | ✓ |
| Destination board, stay allowance | ✓ | ✓ |
| Budget | ✓ | ✓ |
| Gallery storage | 1 GB | 25 GB+ |
| Original-resolution photos | — | ✓ |
| \*\*Live flight tracking\*\* | Bring your own API key | ✓ Included |
| AI suggestions | — | ✓ |
| Support | Community | Email |

**Why flight tracking is the paywall:** it's genuinely the most expensive feature per user (§16.2), the value is obvious and emotional, and it's used exactly when people care most. Gating it is honest rather than artificial.

**Offer annual at a discount.** For a product about a long-term relationship, an annual cycle fits how people think about it, and it dramatically improves cash flow and churn.

**Grandfather early users.** The couples who used it first should keep their price forever. Cheap to honour, and it's how you get the people who'll tell others.

## 17.4 Schema

create table plans (

  id text primary key,                    -- 'free' | 'plus\_monthly' | 'plus\_annual'

  name text not null,

  price\_cents int not null,

  currency text not null default 'USD',

  interval text,                          -- 'month' | 'year' | null for free

  provider\_price\_id text,                 -- Paddle/Stripe price identifier

  is\_active boolean default true,

  sort\_order int default 0

);

create table plan\_entitlements (

  plan\_id text references plans(id) on delete cascade,

  key text not null,                      -- 'storage\_bytes' | 'flight\_tracking'

                                          -- | 'ai\_suggestions' | 'originals'

  value jsonb not null,                   -- 26843545600 | true

  primary key (plan\_id, key)

);

create table subscriptions (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid not null unique references couples(id) on delete cascade,

  plan\_id text not null references plans(id),

  provider text not null,                 -- 'paddle' | 'stripe'

  provider\_subscription\_id text unique,

  provider\_customer\_id text,

  status text not null,

    -- 'trialing'|'active'|'past\_due'|'paused'|'canceled'|'expired'

  payer\_user\_id uuid references profiles(id),

  current\_period\_start timestamptz,

  current\_period\_end timestamptz,

  trial\_ends\_at timestamptz,

  cancel\_at\_period\_end boolean default false,

  canceled\_at timestamptz,

  grace\_period\_ends\_at timestamptz,

  created\_at timestamptz default now(),

  updated\_at timestamptz default now()

);

create table payment\_events (

  id uuid primary key default gen\_random\_uuid(),

  provider text not null,

  provider\_event\_id text not null,

  event\_type text not null,

  payload jsonb not null,

  processed\_at timestamptz,

  error text,

  received\_at timestamptz default now(),

  unique (provider, provider\_event\_id)     -- IDEMPOTENCY. Non-negotiable.

);

create table invoices (

  id uuid primary key default gen\_random\_uuid(),

  couple\_id uuid references couples(id) on delete set null,

  provider\_invoice\_id text unique,

  amount\_cents int, currency text,

  status text, invoice\_url text,

  period\_start date, period\_end date,

  issued\_at timestamptz

);

create index on subscriptions (status, current\_period\_end);

create index on payment\_events (processed\_at) where processed\_at is null;

**RLS:** both partners read the subscription; only the payer\_user\_id may modify it. plans and plan\_entitlements are public read.

## 17.5 Entitlement enforcement

**Rule: entitlements are checked server-side, always. The client may hide a button; it may never be what grants access.**

create or replace function has\_entitlement(target\_couple uuid, ent\_key text)

returns boolean language sql security definer stable as $$

  select coalesce((

    select (pe.value)::text::boolean

    from subscriptions s

    join plan\_entitlements pe on pe.plan\_id = s.plan\_id

    where s.couple\_id = target\_couple

      and pe.key = ent\_key

      and s.status in ('active', 'trialing')

      and (s.current\_period\_end \> now() or s.grace\_period\_ends\_at \> now())

  ), false);

$$;

Three enforcement points, all required:

1.  **Edge Functions** — check before any metered external call

if (\!await hasEntitlement(coupleId, 'flight\_tracking')) {

  return json({ error: 'upgrade\_required', feature: 'flight\_tracking' }, 402)

}

1.  **RLS policies** — for entitlement-gated writes

create policy "originals require paid plan" on media

  for insert with check (

    is\_couple\_member(couple\_id)

    and (path\_original is null or has\_entitlement(couple\_id, 'originals'))

  );

1.  **Quota checks** — storage before upload, API units before fetch

**Handle 402 gracefully in the client.** A paywall should explain what the feature does and what it costs, not just refuse. Never let a user hit a wall mid-task with no explanation.

## 17.6 Webhooks — where billing bugs live

Almost every payment integration bug traces to webhook handling. Four rules:

**1. Verify the signature.** Reject anything unsigned or mismatched. This is the only thing standing between you and a forged "subscription activated" request.

**2. Idempotency.** Providers retry. The same event will arrive more than once, sometimes days apart.

const { error } = await supabase.from('payment\_events').insert({

  provider, provider\_event\_id: event.id, event\_type: event.type, payload: event

})

if (error?.code === '23505') return json({ ok: true })  // already seen

**3. Acknowledge fast, process async.** Return 200 within a couple of seconds. Insert the raw event, return, and let a worker process it. Slow handlers cause retries, which cause duplicates.

**4. Never trust the client for entitlement.** A successful redirect from the checkout page is *not* proof of payment. Only the webhook is.

Checkout success page  →  "Setting up your subscription…"

                          (poll until the webhook lands, \~2-5s)

Webhook received       →  subscription row updated

                       →  Realtime pushes to both partners

**Events to handle:**

|  |  |
| :-: | :-: |
| \*\*Event\*\* | \*\*Action\*\* |
| subscription.created / activated | Set plan, status, period. Notify both partners. |
| subscription.updated | Plan change, quantity, renewal date |
| payment.succeeded | Extend period, clear past\\\_due, write invoice |
| payment.failed | Set past\\\_due, start dunning, set grace period |
| subscription.canceled | Set cancel\\\_at\\\_period\\\_end; \*\*access continues to period end\*\* |
| subscription.paused / resumed | Suspend or restore entitlements |
| refund.issued | Reconcile access, log it |

**Reconciliation job.** Webhooks get lost. Run a daily job that fetches all active subscriptions from the provider and reconciles against your table. Log every discrepancy. This will catch things, and the alternative is a user paying for access they don't have.

## 17.7 Lifecycle and the couple-specific edge cases

**Trial:** 14 days, no card up front if the provider allows. Trials that require a card convert better but feel worse — for a product built on trust between two people, err toward not asking.

**Dunning:** on failed payment, past\_due with a **7-day grace period during which access continues**. Notify *both* partners, not just the payer — the other person may be able to fix it. Provider handles retries. On grace expiry, downgrade to free.

**Cancellation:** access runs to the end of the paid period. Never cut off mid-period. Ask why on the way out, one optional question.

**Downgrade with data over the new limit** — the important one, because photos are irreplaceable:

On downgrade, if storage\_used \> free\_limit:

  1. Data is NEVER deleted automatically

  2. Account enters 'over\_quota': read + download work, uploads blocked

  3. 90-day window with clear notice and a prominent export option

  4. After 90 days, still don't delete — keep blocking uploads

     and escalate the notice

Deleting someone's photos because they stopped paying is the fastest way to destroy trust in a product like this. Block writes, never destroy.

### The scenarios unique to a couples product

**Who pays?** One partner subscribes; both get access. payer\_user\_id records who. Only they can change or cancel it, but both can see the status — a paywall the other partner can't even see the cause of is a bad experience.

**Transferring the payer.** If she pays and then he wants to take over, that's a real request. Implement it: cancel one subscription, start another, prorate through the provider. Don't make them contact support.

**They separate.** The hardest case, and it will happen.

  - Either partner can leave the couple
  - **Both keep a full export of everything** — that's non-negotiable, the memories are shared
  - The subscription follows the payer
  - The other partner reverts to solo/free with their data intact
  - Shared media stays available to both for a defined window, then follows whoever created the couple
  - **Write this into the Terms explicitly.** People will ask, and finding out at the worst moment that their photos are gone is unforgivable.

Handle this with care in the copy too. It's a difficult moment for someone, and the interface shouldn't be cheerful about it.

## 17.8 Implementation checklist

  - Provider account, entity verified, tax details submitted
  - Products and prices created; provider\_price\_id mapped into plans
  - Sandbox end-to-end: subscribe, renew, fail, cancel, refund
  - Webhook endpoint deployed, **signature verification enforced**
  - Idempotency verified — replay the same event 5×, confirm one effect
  - has\_entitlement() enforced in Edge Functions **and** RLS
  - Storage quota enforced before upload
  - Over-quota state blocks writes without deleting anything
  - 402 responses render a real paywall, not an error
  - Daily reconciliation job with discrepancy alerts
  - Billing portal linked from Settings
  - Invoices retrievable by the payer
  - Dunning emails to **both** partners
  - Couple-separation flow implemented and covered in the Terms
  - Third-party commercial licences cleared — **especially OpenSky**
  - ToS, Privacy Policy, Subscription Terms published and lawyer-reviewed
  - Spend caps and quota alarms on every metered provider

## 17.9 Sequencing

Payments go **last**, after §16's multi-tenancy work and after a private beta. Reasons:

1.  You can't price what you haven't costed, and costing needs real usage data from real couples.
2.  Beta users tell you which features they'd actually pay for. It's rarely the one you expect.
3.  Taking money converts a side project into a business with obligations — support expectations, refund handling, tax filings, and the licence constraints above.

**A defensible sequence:** private beta free → gather cost and usage data → resolve commercial licensing → introduce paid tier with early users grandfathered → open signups.

*End of documentation.*
