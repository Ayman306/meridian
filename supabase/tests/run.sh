#!/usr/bin/env bash
#
# Applies every migration to a throwaway database and runs the RLS assertions
# against it. This is how the spec's Stage 0 gate — "two accounts pair, and
# account A cannot read account B's rows" — is verified without a live project.
#
#   ./supabase/tests/run.sh
#
# Needs a local Postgres and the ability to create databases.
set -euo pipefail

DB="${MERIDIAN_TEST_DB:-meridian_test}"
PSQL_ARGS=(-v ON_ERROR_STOP=1 -q)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run() { psql "${PSQL_ARGS[@]}" -d "$DB" "$@"; }

echo "==> recreating $DB"
psql -q -d postgres -c "drop database if exists $DB" >/dev/null
psql -q -d postgres -c "create database $DB" >/dev/null

echo "==> applying the Supabase shim (test harness only)"
run -f "$ROOT/supabase/tests/00_shim.sql" >/dev/null

echo "==> applying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  run -f "$file" >/dev/null
done

echo "==> running assertions"
run -f "$ROOT/supabase/tests/rls_test.sql"

echo
echo "==> schema summary"
run -c "
  select tablename,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tablename) as policies,
         rowsecurity as rls
  from pg_tables t
  where schemaname = 'public'
  order by tablename;
"

echo "==> tables without RLS (must be empty)"
run -tAc "
  select tablename from pg_tables
  where schemaname = 'public' and not rowsecurity;
" | grep . && { echo 'FAILED: a public table has no RLS'; exit 1; } || echo '    none'
