#!/bin/sh
set -eu

action=${1:-up}
profile=${ASA_COMPOSE_PROFILE:-dev}
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$repo_root"
if [ "$action" = up ] && [ -f .asa/installed-release.json ]; then
  echo 'This installation uses published releases. Use sh tools/asa-manager.sh update.' >&2
  exit 78
fi
. "$script_dir/installation-identity.sh"

case "$profile" in
  base|dev|test|staging|production) ;;
  *)
    echo "ASA_COMPOSE_PROFILE must be base, dev, test, staging or production" >&2
    exit 64
    ;;
esac

if [ -z "${ASA_BUILD_REVISION:-}" ]; then
  ASA_BUILD_REVISION=unknown
  if [ -e .git ]; then
    ASA_BUILD_REVISION=$(git -c safe.directory="$repo_root" rev-parse HEAD 2>/dev/null || printf unknown)
  fi
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

assert_startup_identity() (
  case "$profile" in
    production) default_project=asa-lab-production ;;
    staging) default_project=asa-lab-staging ;;
    *) default_project=asa-lab-dev ;;
  esac
  set -- -f compose.yaml
  if [ "$profile" != base ]; then set -- "$@" -f "compose.$profile.yaml"; fi
  asa_assert_installation_identity "$repo_root" "$default_project" false "$@"
)

assert_settings_encryption_key() {
  key_state=$(awk '
    {
      line = $0
      sub(/\r$/, "", line)
      if (NR == 1) sub(/^\357\273\277/, "", line)
      if (line !~ /^[ \t]*(export[ \t]+)?ASA_SETTINGS_ENCRYPTION_KEY([ \t=]|$)/) next
      count++
      sub(/^[ \t]*(export[ \t]+)?ASA_SETTINGS_ENCRYPTION_KEY[ \t]*/, "", line)
      if (substr(line, 1, 1) != "=") next
      sub(/^=[ \t]*/, "", line)
      quote = substr(line, 1, 1)
      if (quote == "\"" || quote == sprintf("%c", 39)) {
        rest = substr(line, 2)
        closing = index(rest, quote)
        if (closing == 0 || substr(rest, closing + 1) !~ /^[ \t]*(#.*)?$/) next
        line = substr(rest, 1, closing - 1)
      } else {
        sub(/[ \t]+#.*/, "", line)
        sub(/[ \t]+$/, "", line)
      }
      if ((length(line) == 64 && line !~ /[^a-fA-F0-9]/) ||
          (length(line) == 43 && line !~ /[^A-Za-z0-9_-]/)) valid = 1
    }
    END {
      if (count == 0) print "missing"
      else if (count > 1) print "duplicated"
      else if (!valid) print "invalid"
      else print "valid"
    }
  ' .env)
  if [ "$key_state" != valid ]; then
    echo "Existing .env has a $key_state ASA_SETTINGS_ENCRYPTION_KEY; no file changes were made." >&2
    echo "Restore the original key from the protected installation backup. Do not generate a replacement for stored integration credentials." >&2
    exit 78
  fi
}

create_environment() {
  case "$profile" in
    staging|production) production_like=true ;;
    *) production_like=false ;;
  esac
  if [ -f .env ]; then
    assert_settings_encryption_key
    if grep -Eq 'replace-with|CHANGE_ME|change-me' .env; then
      echo ".env still contains placeholder credentials; correct them in the saved configuration and preserve the existing ASA_SETTINGS_ENCRYPTION_KEY. Do not delete .env or generate a replacement key." >&2
      exit 78
    fi
    if ! grep -Eq '^MIGRATION_DATABASE_URL=[^[:space:]]' .env ||
       ! grep -Eq '^MIGRATION_EXPECT_DATABASE=[^[:space:]]' .env ||
       ! grep -Eq '^MIGRATION_CONFIRM=[^[:space:]]' .env; then
      echo "Legacy .env is missing the dedicated migration target guard." >&2
      echo "Add MIGRATION_DATABASE_URL, MIGRATION_EXPECT_DATABASE and MIGRATION_CONFIRM=APPLY:<exact-database-name>; generic DATABASE_URL is not accepted." >&2
      exit 78
    fi
    if ! grep -Eq '^ASA_BLOCKS_RUNTIME_SIGNING_KEY=[a-fA-F0-9]{64}[[:space:]]*$' .env; then
      printf '\nASA_BLOCKS_RUNTIME_SIGNING_KEY=%s\n' "$(random_hex 32)" >>.env
      echo "Added a private Blocks runtime signing key to .env."
    fi
    storage_present=0
    for name in ASA_OBJECT_STORAGE_ENDPOINT ASA_OBJECT_STORAGE_REGION ASA_OBJECT_STORAGE_BUCKET ASA_OBJECT_STORAGE_ACCESS_KEY ASA_OBJECT_STORAGE_SECRET_KEY ASA_OBJECT_STORAGE_FORCE_PATH_STYLE; do
      if grep -Eq "^${name}=[^[:space:]]" .env; then storage_present=$((storage_present + 1)); fi
    done
    if [ "$storage_present" -eq 0 ]; then
      storage_access=$(random_hex 16)
      storage_secret=$(random_hex 32)
      printf '\nASA_OBJECT_STORAGE_ENDPOINT=http://minio:9000\nASA_OBJECT_STORAGE_REGION=us-east-1\nASA_OBJECT_STORAGE_BUCKET=asa-blocks\nASA_OBJECT_STORAGE_ACCESS_KEY=%s\nASA_OBJECT_STORAGE_SECRET_KEY=%s\nASA_OBJECT_STORAGE_FORCE_PATH_STYLE=true\n' "$storage_access" "$storage_secret" >>.env
      echo "Added private self-hosted Blocks object-storage configuration to .env."
    elif [ "$storage_present" -ne 6 ]; then
      echo "Existing .env has an incomplete ASA_OBJECT_STORAGE_* configuration; complete or remove the whole set before continuing." >&2
      exit 78
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
  blocks_runtime_signing_key=$(random_hex 32)
  object_storage_access_key=$(random_hex 16)
  object_storage_secret_key=$(random_hex 32)
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
ASA_BLOCKS_RUNTIME_SIGNING_KEY=$blocks_runtime_signing_key
ASA_OBJECT_STORAGE_ENDPOINT=http://minio:9000
ASA_OBJECT_STORAGE_REGION=us-east-1
ASA_OBJECT_STORAGE_BUCKET=asa-blocks
ASA_OBJECT_STORAGE_ACCESS_KEY=$object_storage_access_key
ASA_OBJECT_STORAGE_SECRET_KEY=$object_storage_secret_key
ASA_OBJECT_STORAGE_FORCE_PATH_STYLE=true

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
  if grep -q '^ASA_SEARCH_SECRET=' .env; then
    search_revision=$(compose exec -T search cat /usr/local/share/asa-search/asa-commit.txt 2>/dev/null || true)
    [ "$search_revision" = "$ASA_BUILD_REVISION" ] || return 1
    compose exec -T search /usr/local/searxng/.venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3).read()" >/dev/null 2>&1 || return 1
  fi
  output=$(compose exec -T web wget -q -O - http://127.0.0.1:8080/health/ready 2>/dev/null || true)
  case "$output" in
    *'"status":"ready"'*|*'"status": "ready"'*)
      printf '%s' "$output" | grep -F "$ASA_BUILD_REVISION" >/dev/null || return 1
      printf '%s' "$output" | grep -Eq '"synchronized"[[:space:]]*:[[:space:]]*true' || return 1
      web=$(compose exec -T web wget -q -O - http://127.0.0.1:8080/build-metadata.json 2>/dev/null) || return 1
      printf '%s' "$web" | grep -F "$ASA_BUILD_REVISION" >/dev/null || return 1
      scratch=$(compose exec -T scratch wget -q -O - http://127.0.0.1:8080/asa-commit.txt 2>/dev/null) || return 1
      [ "$scratch" = "$ASA_BUILD_REVISION" ] || return 1
      compose exec -T scratch wget -q -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 ;;
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
  compose logs --tail=120 postgres migration minio minio-init api web scratch >&2 || true
  return 1
}

show_access() {
  echo
  echo "ASA Lab with Scratch is ready: ${ASA_BLOCKS_PARENT_ORIGIN:-http://127.0.0.1:4610}"
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
    assert_startup_identity
    [ -f .env ] || { echo 'No private environment. Use up for authorized installation.' >&2; exit 78; }
    compose config --quiet
    echo "Deployment doctor PASS: Docker, Compose and private configuration are ready."
    echo "Profile: $profile"
    echo "Revision: $ASA_BUILD_REVISION"
    echo "Schema: $ASA_EXPECTED_SCHEMA_VERSION"
    if [ "$profile" != test ]; then python3 tools/log_collector.py status --root "$repo_root" --profile "$profile"; fi
    ;;
  up)
    require_docker
    assert_startup_identity
    command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required for private configuration.' >&2; exit 69; }
    create_environment
    python3 tools/deployment/search_secret.py --create
    if [ "$profile" != test ]; then python3 tools/log_collector.py prepare --root "$repo_root" --profile "$profile"; fi
    compose config --quiet
    for service in minio search scratch api web; do compose build "$service"; done
    assert_startup_identity
    compose up -d --no-build
    wait_for_ready
    if [ "$profile" != test ]; then
      python3 tools/log_collector.py reconcile --root "$repo_root" --profile "$profile" || echo 'ASA ready; diagnostic collection is degraded. Inspect .asa/collector-operation.json.' >&2
    fi
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
    compose logs --tail=200 postgres migration minio minio-init api web scratch
    ;;
  down)
    require_docker
    assert_startup_identity
    compose down --remove-orphans
    echo "ASA Lab stopped; PostgreSQL and Blocks object-storage data volumes were preserved."
    ;;
  *)
    echo "usage: $0 [up|doctor|health|status|logs|down]" >&2
    exit 64
    ;;
esac
