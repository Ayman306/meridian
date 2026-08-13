# Setting up Supabase

Everything here is free tier. Budget fifteen minutes.

The SQL has already been verified: `supabase/tests/run.sh` applies all three
migrations to a real Postgres and runs 39 assertions against them, including
the isolation check the spec gates on. CI runs it on every push. So the parts
below that you cannot automate — creating the project, and Google OAuth — are
the only places something can go wrong.

---

## 1. Create the project

At [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.

| Field | What to pick |
| --- | --- |
| Name | `meridian` |
| Region | The one nearest whichever of you opens the app more. Every read pays this latency; it cannot be changed later without recreating the project. |
| Password | Generate one and put it in your password manager. You will need it only for `psql` and backups. |

Provisioning takes a couple of minutes.

## 2. Create the schema

Dashboard → **SQL Editor** → **New query**. Paste the whole of
[`supabase/setup.sql`](../supabase/setup.sql) and run it.

That one file is every migration concatenated, in order. It is generated from
`supabase/migrations/` by `npm run db:bundle`, and CI fails if the two drift
apart, so it cannot go stale.

It is safe to run twice — every statement is idempotent.

**Check it worked.** Dashboard → **Table Editor** should show ten tables:

```
categories        couple_members    couples          itinerary_items
profiles          suggestion_tray   trip_days        trip_statuses
trip_travelers    trips
```

Each should show **RLS enabled**. If any table shows RLS off, stop and say so —
that is the one thing that must never ship.

## 3. Google sign-in

Two halves. Do the Google side first, because you need its two values.

### Google Cloud

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project (or reuse one).
2. **APIs & Services → OAuth consent screen**. External. Fill in the app name
   and your email. Scopes: `openid`, `email`, `profile` — **only** these three.
   They are all non-sensitive, which is why Google does not require app
   verification. Adding any other scope changes that.
3. Under **Test users**, add both of your Google accounts. While the app is
   unpublished only listed accounts can sign in — which for a two-person app is
   a feature, not a limitation.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised JavaScript origins:
     `http://localhost:3000` and your deployed origin
   - Authorised redirect URI: the callback Supabase shows you in the next step,
     which looks like `https://<project-ref>.supabase.co/auth/v1/callback`
5. Copy the **Client ID** and **Client secret**.

### Supabase

1. Dashboard → **Authentication → Sign In / Providers → Google**. Enable it and
   paste the client ID and secret.
2. Dashboard → **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` while developing, your real origin later
   - Redirect URLs — add both:
     ```
     http://localhost:3000/auth/callback
     https://your-app.example.com/auth/callback
     ```

`/auth/callback` is this app's own route, which swaps the OAuth code for a
session cookie. Miss it and sign-in will complete at Google and then bounce you
back to the login page.

## 4. Point the app at it

Dashboard → **Project Settings → API**. You need two values:

- **Project URL**
- the **anon / publishable** key — the one explicitly labelled public

```bash
cp .env.example .env.local
```

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key>
NEXT_PUBLIC_ENABLE_AI=false
```

`.env.local` is gitignored, along with every other `.env*` except the template.
Nothing here is committed.

> **The anon key is meant to be public.** It ends up in the browser bundle by
> design; RLS is what protects the data, which is why the policies matter so
> much. The **service_role** key is the opposite — it bypasses RLS entirely.
> Do not put it in `.env.local` until a Route Handler actually needs it, and
> never prefix it `NEXT_PUBLIC_`.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## 5. Try it with two accounts

The point of this app is two people, so test it as two:

1. Sign in with your first Google account. You land on **/pair**.
2. Create a couple. Copy the eight-character code.
3. In a private window, sign in with the second account and enter the code.
4. Both should now see the same trips.

Then check the isolation holds, which is the spec's gate before any more
building: sign in with a **third** account and confirm it sees nothing — no
trips, no couple, and only its own profile. The automated suite already proves
this at the database level; doing it once by hand confirms the app is wired to
the same policies.

## 6. Deploy (optional, but it makes the cron work)

Vercel's free tier fits. Import the repo, set the two `NEXT_PUBLIC_` variables
in the project settings, and deploy. Then:

- add the deployed origin to Google's authorised origins and to Supabase's
  redirect URLs, both with `/auth/callback`
- add an `APP_URL` repository secret in GitHub pointing at the deployed origin

That last one matters more than it looks. A free Supabase project pauses after
about seven days idle, and a couple who plan a trip in March and fly in June
would find the app dead when they came back. The keep-alive workflow pings
`/api/health` every two days to prevent it.

---

## Regenerating types

`src/types/database.ts` is hand-maintained against the migrations until a
project exists. Once yours does, replace it with the generated article:

```bash
export SUPABASE_PROJECT_REF=<your-project-ref>
npm run db:types
```

## Running the database tests yourself

```bash
npm run db:test
```

Needs a local Postgres you can create databases on. It builds a throwaway
database, applies the migrations, and asserts the policies actually hold —
including that a stranger can neither read nor write another couple's rows.

`supabase/tests/00_shim.sql` fakes the small part of Supabase's `auth` schema
the migrations touch. It exists only for the test harness and must never be
applied to a real project.

## If something is wrong

| Symptom | Cause |
| --- | --- |
| Sign-in loops back to `/login` | `/auth/callback` is missing from Supabase's redirect URLs |
| `redirect_uri_mismatch` from Google | The Supabase callback URL is not in Google's authorised redirect URIs |
| "Missing NEXT_PUBLIC_SUPABASE_URL" | No `.env.local`, or the dev server was not restarted after creating it |
| Signed in, but the app shows nothing | The migrations did not run — check the Table Editor for the ten tables |
| A query returns `[]` when rows exist | Expected if you are not a member of that couple. That is RLS working. |
