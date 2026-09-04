#!/bin/sh
set -eu

profile=${1:-dev}
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$repo_root"

case "$profile" in
  base|dev|test|staging|production) ;;
  *)
    echo "usage: $0 [base|dev|test|staging|production]" >&2
    exit 64
    ;;
esac

if [ -z "${ASA_BUILD_REVISION:-}" ]; then
  ASA_BUILD_REVISION=$(git -c safe.directory="$repo_root" rev-parse HEAD 2>/dev/null || printf unknown)
  export ASA_BUILD_REVISION
fi

if [ -z "${ASA_EXPECTED_SCHEMA_VERSION:-}" ]; then
  ASA_EXPECTED_SCHEMA_VERSION=$(
    for migration in migrations/*.sql; do basename "$migration"; done |
      sed -n 's/^0*\([0-9][0-9]*\)_.*/\1/p' |
      sort -n |
      tail -n 1
  )
  test -n "$ASA_EXPECTED_SCHEMA_VERSION"
  export ASA_EXPECTED_SCHEMA_VERSION
fi

set -- -f compose.yaml
if [ "$profile" != "base" ]; then
  set -- "$@" -f "compose.${profile}.yaml"
fi

exec docker compose "$@" up -d --build
