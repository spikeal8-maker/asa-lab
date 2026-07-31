#!/bin/sh
set -eu

output=${1:-backups/asa-lab.dump}
profile=${ASA_COMPOSE_PROFILE:-base}
umask 077
mkdir -p "$(dirname "$output")"

case "$profile" in
  base|dev|test|staging) ;;
  *)
    echo "ASA_COMPOSE_PROFILE must be base, dev, test or staging" >&2
    exit 64
    ;;
esac

set -- -f compose.yaml
if [ "$profile" != "base" ]; then
  set -- "$@" -f "compose.${profile}.yaml"
fi

docker compose "$@" exec -T postgres sh -eu -c \
  'exec pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  >"$output"

test -s "$output"
printf 'Docker backup PASS: %s\n' "$output"
