#!/bin/sh
set -eu

profile=${1:-dev}

case "$profile" in
  base|dev|test|staging) ;;
  *)
    echo "usage: $0 [base|dev|test|staging]" >&2
    exit 64
    ;;
esac

set -- -f compose.yaml
if [ "$profile" != "base" ]; then
  set -- "$@" -f "compose.${profile}.yaml"
fi

exec docker compose "$@" down --remove-orphans
