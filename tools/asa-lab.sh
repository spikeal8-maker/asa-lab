#!/bin/sh
set -eu

action=${1:-up}
profile=${ASA_COMPOSE_PROFILE:-dev}
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$repo_root"

case "$profile" in
  base|dev|test|staging|production) ;;
  *)
    echo "ASA_COMPOSE_PROFILE must be base, dev, test, staging or production" >&2
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
  if [ -z "$ASA_EXPECTED_SCHEMA_VERSION" ]; then
    echo "No numbered SQL migrations were found." >&2
    exit 78
  fi
  export ASA_EXPECTED_SCHEMA_VERSION
fi

compose() {
  if [ "$profile" = "base" ]; then
    docker compose -f compose.yaml "$@"
  else
    docker compose -f compose.yaml -f "compose.${profile}.yaml" "$@"
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Install Docker Desktop or Docker Engine with Compose." >&2
    exit 69
  fi
  docker version >/dev/null
  docker compose version >/dev/null
}

random_hex() {
  bytes=${1:-24}
  od -An -N"$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

create_environment() {
  case "$profile" in
    staging|production) production_like=true ;;
    *) production_like=false ;;
  esac
  if [ -f .env ]; then
    if grep -Eq 'replace-with|CHANGE_ME|change-me' .env; then
      echo ".env still contains placeholder credentials; replace them or remove .env and rerun." >&2
      exit 78
    fi
    if ! grep -Eq '^MIGRATION_DATABASE_URL=[^[:space:]]' .env ||
       ! grep -Eq '^MIGRATION_EXPECT_DATABASE=[^[:space:]]' .env ||
       ! grep -Eq '^MIGRATION_CONFIRM=[^[:space:]]' .env; then
      echo "Legacy .env is missing the dedicated migration target guard." >&2
      echo "Add MIGRATION_DATABASE_URL, MIGRATION_EXPECT_DATABASE and MIGRATION_CONFIRM=APPLY:<exact-database-name>; generic DATABASE_URL is not accepted." >&2
      exit 78
    fi
    if ! grep -Eq '^ASA_SETTINGS_ENCRYPTION_KEY=([a-fA-F0-9]{64}|[A-Za-z0-9_-]{43})[[:space:]]*$' .env; then
      printf '\nASA_SETTINGS_ENCRYPTION_KEY=%s\n' "$(random_hex 32)" >>.env
      echo "Added a private runtime settings encryption key to .env."
    fi
    if [ "$production_like" = true ] && ! grep -Eq '^ASA_SEED_DEV=false[[:space:]]*$' .env; then
      echo "$profile requires ASA_SEED_DEV=false in .env." >&2
      echo "Refusing to seed development accounts into a production-like database." >&2
      exit 78
    fi
    return
  fi

  admin_password=$(random_hex)
  runtime_password=$(random_hex)
  teacher_password=$(random_hex)
  settings_encryption_key=$(random_hex 32)
  uid=$(id -u 2>/dev/null || printf 1000)
  gid=$(id -g 2>/dev/null || printf 1000)
  case "$profile" in
    production) project_name=asa-lab-production ;;
    staging) project_name=asa-lab-staging ;;
    *) project_name=asa-lab-dev ;;
  esac
  if [ "$production_like" = true ]; then seed_dev=false; else seed_dev=true; fi

  umask 077
  cat >.env <<EOF
# Generated locally by tools/asa-lab.sh. Never commit this file.
COMPOSE_PROJECT_NAME=$project_name
ASA_IMAGE_TAG=local
ASA_TEST_UID=$uid
ASA_TEST_GID=$gid

POSTGRES_DB=asalab
POSTGRES_USER=asalab_admin
POSTGRES_PASSWORD=$admin_password
ASA_APP_DB_PASSWORD=$runtime_password
MIGRATION_DATABASE_URL=postgres://asalab_admin:$admin_password@postgres:5432/asalab
MIGRATION_EXPECT_DATABASE=asalab
MIGRATION_CONFIRM=APPLY:asalab
APP_DATABASE_URL=postgres://asalab_app:$runtime_password@postgres:5432/asalab
ASA_SETTINGS_ENCRYPTION_KEY=$settings_encryption_key

ASA_WEB_PORT=4610
ASA_API_PORT=4611
ASA_SEED_DEV=$seed_dev
ASA_SEED_WORKSPACE=school-1580
ASA_SEED_TEACHER_EMAIL=teacher@school-1580.local
ASA_SEED_TEACHER_PASSWORD=$teacher_password
EOF
  chmod 600 .env
  echo "Created private .env with generated credentials."
}

environment_value() {
  key=$1
  sed -n "s/^${key}=//p" .env | tail -n 1
}

ready() {
  output=$(compose exec -T web wget -q -O - http://127.0.0.1:8080/health/ready 2>/dev/null || true)
  case "$output" in
    *'"status":"ready"'*|*'"status": "ready"'*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_ready() {
  attempts=0
  while [ "$attempts" -lt 150 ]; do
    if ready; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done

  echo "ASA Lab did not become ready within 5 minutes." >&2
  compose ps -a >&2 || true
  compose logs --tail=120 postgres migration api web >&2 || true
  return 1
}

show_access() {
  echo
  echo "ASA Lab is ready: http://127.0.0.1:4610"
  echo "Revision: $ASA_BUILD_REVISION"
  echo "Schema: $ASA_EXPECTED_SCHEMA_VERSION"
  if [ "$(environment_value ASA_SEED_DEV)" = "true" ]; then
    echo "Teacher: $(environment_value ASA_SEED_TEACHER_EMAIL)"
    echo "Password: $(environment_value ASA_SEED_TEACHER_PASSWORD)"
  fi
  echo "Credentials are stored only in .env."
}

case "$action" in
  doctor)
    require_docker
    create_environment
    compose config --quiet
    echo "Deployment doctor PASS: Docker, Compose and private configuration are ready."
    echo "Profile: $profile"
    echo "Revision: $ASA_BUILD_REVISION"
    echo "Schema: $ASA_EXPECTED_SCHEMA_VERSION"
    ;;
  up)
    require_docker
    create_environment
    compose config --quiet
    compose up -d --build
    wait_for_ready
    compose ps
    show_access
    ;;
  health)
    require_docker
    if ready; then
      echo "Docker health PASS: http://127.0.0.1:4610"
    else
      echo "Docker health FAIL" >&2
      exit 1
    fi
    ;;
  status)
    require_docker
    compose ps -a
    ;;
  logs)
    require_docker
    compose logs --tail=200 postgres migration api web
    ;;
  down)
    require_docker
    compose down --remove-orphans
    echo "ASA Lab stopped; PostgreSQL data volume was preserved."
    ;;
  *)
    echo "usage: $0 [up|doctor|health|status|logs|down]" >&2
    exit 64
    ;;
esac
