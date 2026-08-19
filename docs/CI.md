# Running the checks without GitHub Actions

GitHub Actions bills minutes on private repositories. When that allowance runs
out, workflows stop running entirely — they do not queue and they do not warn,
they simply never start. Two things were relying on it, and only one of them
matters urgently.

| What it did | Consequence if it stops | Replacement |
| --- | --- | --- |
| **Keep-alive** — pinged `/api/health` every two days | **The app dies.** A free Supabase project pauses after ~7 days idle, and it does so silently | Vercel Cron, in `vercel.json`. Already configured |
| **CI** — typecheck, lint, test, build, migrations, RLS | Nothing breaks; you lose the signal that something broke | `npm run verify`, locally, before you push |

---

## 1. The keep-alive is now Vercel's job

`vercel.json` declares a cron that hits `/api/health` once a day. That route
calls the `health()` RPC, so it genuinely wakes Postgres rather than only
proving Next is up — an endpoint that skipped the database would keep passing
while the database slept.

Nothing to install: Vercel reads `vercel.json` on the next deploy. Confirm it
under **Project → Settings → Cron Jobs** after deploying.

Three things worth knowing:

- **Hobby allows one run per day**, not the two-day cadence the Action used.
  That is still comfortably inside a seven-day pause window.
- **Cron runs only on production.** Preview deployments do not fire it, which is
  what you want.
- **Deployment Protection does not block it.** Vercel invokes its own crons
  internally, so the 401 problem the Action had with protection turned on does
  not arise here.

If you would rather not depend on Vercel for this either, any free uptime
pinger works — cron-job.org and UptimeRobot both have free tiers. Point it at
`https://<your-app>/api/health` daily. The route is safe to expose: it returns
`{ ok: true }` and nothing about the couple.

> There is a decent chance this is belt-and-braces. `pg_cron` inside Supabase
> already runs the flight sweep every 30 minutes and three more jobs nightly,
> and that is database activity. But "probably fine" is a poor reason to remove
> the only thing standing between you and a paused project, so the cron stays.

## 2. CI is now `npm run verify`

```bash
npm run verify
```

Runs exactly what the workflow ran, in the same order, and stops at the first
failure:

1. `typecheck` — `tsc --noEmit`
2. `lint` — eslint
3. `test:run` — the full vitest suite
4. `db:bundle --check` — that `supabase/setup.sql` still matches the migrations
5. `db:test` — every migration against a real Postgres, then the RLS assertions
6. `build` — `next build`

**Step 5 needs a local Postgres.** Without one it is skipped with a warning
rather than failing, so `verify` still works on a machine that has no database
— but understand that the RLS assertions are the checks worth having most, and
skipping them is not the same as passing them.

<details>
<summary>Getting Postgres locally</summary>

```bash
# Debian/Ubuntu
sudo apt-get install -y postgresql postgresql-client
sudo service postgresql start
sudo -u postgres createuser -s "$USER"

# macOS
brew install postgresql@17 && brew services start postgresql@17
```

Then `npm run db:test` should print `All RLS and schema assertions passed.`
</details>

### Make it automatic

```bash
node scripts/install-hooks.mjs
```

Installs a `pre-push` hook that runs `verify` before every push. This is
strictly better than CI for catching your own mistakes: it fails on your
machine in the time it takes to make tea, rather than five minutes later in a
tab you had already closed.

Bypass it for a genuine emergency with `git push --no-verify`. The hook is a
seatbelt, not a lock.

## 3. If you want the workflows back

Two ways, both free:

**Make the repository public.** Actions minutes are free and unlimited on public
repos. Nothing secret is committed here — `.env` has never been tracked, only
`.env.example` with placeholders, and the test suite has a scanner that fails if
a real-looking key appears. The trade is that your itinerary *code* becomes
readable; your itinerary *data* is in Supabase behind RLS and is not affected.

**Register a self-hosted runner.** Minutes are not billed for self-hosted
runners, even on private repos. Any always-on machine works — an old laptop, a
Raspberry Pi, an Oracle Cloud Always Free VM. Under **Settings → Actions →
Runners → New self-hosted runner**, follow the instructions, then change
`runs-on: ubuntu-latest` to `runs-on: self-hosted` in `.github/workflows/ci.yml`.

The database job needs Docker on that machine for its `services:` block, or you
can drop the service and point `PGHOST` at a Postgres you already run.

## 4. What already checks itself, for free

Worth knowing so you do not rebuild it:

- **Vercel builds every push.** `next build` type-checks as it goes, so a type
  error fails the preview deployment whether or not Actions ran.
- **The preview deployment is a real environment.** Clicking through it catches
  the class of thing no unit test does.
- **`npm run mcp:doctor`** verifies the MCP token exchange against the live
  project, which CI never could — it needs real secrets.
