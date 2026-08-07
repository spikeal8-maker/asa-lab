#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${TEST_DATABASE_URL:-}" || -z "${APP_TEST_DATABASE_URL:-}" ]]; then
  echo "BLOCKED: isolated database URLs are required" >&2
  exit 78
fi

for variable in TEST_DATABASE_URL APP_TEST_DATABASE_URL; do
  value="${!variable}"
  if [[ "${value%%\?*}" != */*_test ]]; then
    echo "BLOCKED: ${variable} must target a database ending in _test" >&2
    exit 78
  fi
done

echo "focused persistence: preparing pnpm"
corepack enable >/dev/null
corepack prepare pnpm@9.15.9 --activate >/dev/null
echo "focused persistence: installing locked workspace dependencies"
pnpm install --frozen-lockfile --prefer-offline
echo "focused persistence: building the Electronics provider used by the API"
pnpm nx run electronics:build
echo "focused persistence: applying migrations to isolated test database"
node tools/migrate.mjs --apply
echo "focused persistence: running Project API and RLS suite"
pnpm vitest run tests/portal/projects-api.spec.ts
