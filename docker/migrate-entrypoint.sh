#!/bin/sh
set -eu

node tools/migrate.mjs --apply
node docker/provision-runtime-role.mjs

if [ "${ASA_SEED_DEV:-false}" = "true" ]; then
  node tools/seed-dev.mjs
fi
