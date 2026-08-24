#!/bin/sh
set -eu

action=${1:-up}
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$repo_root"

if [ -z "${ASA_BUILD_REVISION:-}" ]; then
  ASA_BUILD_REVISION=$(git -c safe.directory="$repo_root" rev-parse HEAD 2>/dev/null || printf unknown)
  export ASA_BUILD_REVISION
fi

compose() {
  docker compose -f compose.yaml -f compose.dev.yaml "$@"
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
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

create_environment() {
  if [ -f .env ]; then
    if grep -Eq 'replace-with|CHANGE_ME|change-me' .env; then
      echo ".env still contains placeholder credentials; replace them or remove .env and rerun." >&2
      exit 78
    fi
    return
  fi

  admin_password=$(random_hex)
  runtime_password=$(random_hex)
  teacher_password=$(random_hex)
  uid=$(id -u 2>/dev/null || printf 1000)
  gid=$(id -g 2>/dev/null || printf 1000)

  umask 077
  cat >.env <<EOF
# Generated locally by tools/asa-lab.sh. Never commit this file.
COMPOSE_PROJECT_NAME=asa-lab-dev
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

ASA_WEB_PORT=4610
ASA_API_PORT=4611
ASA_SEED_DEV=true
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
  echo "Teacher: $(environment_value ASA_SEED_TEACHER_EMAIL)"
  echo "Password: $(environment_value ASA_SEED_TEACHER_PASSWORD)"
  echo "Credentials are stored only in .env."
}

case "$action" in
  doctor)
    require_docker
    create_environment
    compose config --quiet
    echo "Deployment doctor PASS: Docker, Compose and private configuration are ready."
    echo "Revision: $ASA_BUILD_REVISION"
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
