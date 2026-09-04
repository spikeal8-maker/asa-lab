#!/bin/sh
set -eu

backup=${1:?usage: docker-restore.sh BACKUP [RESTORE_DATABASE]}
restore_database=${2:-asalab_restore_test}
profile=${ASA_COMPOSE_PROFILE:-base}

case "$restore_database" in
  *_test) ;;
  *)
    echo "restore database must end in _test" >&2
    exit 78
    ;;
esac

test -s "$backup"

case "$profile" in
  base|dev|test|staging|production) ;;
  *)
    echo "ASA_COMPOSE_PROFILE must be base, dev, test, staging or production" >&2
    exit 64
    ;;
esac

set -- -f compose.yaml
if [ "$profile" != "base" ]; then
  set -- "$@" -f "compose.${profile}.yaml"
fi

docker compose "$@" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
  'dropdb --if-exists --force -U "$POSTGRES_USER" "$RESTORE_DATABASE";
   createdb -U "$POSTGRES_USER" "$RESTORE_DATABASE"'

docker compose "$@" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
  'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$RESTORE_DATABASE"' \
  <"$backup"

docker compose "$@" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -c "SELECT count(*) FROM schema_migrations"' \
  >/dev/null

printf 'Docker restore PASS: %s -> %s\n' "$backup" "$restore_database"
