#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

profile=${ASA_COMPOSE_PROFILE:-production}
transport=${ASA_COMPOSE_TRANSPORT:-auto}
backup_directory=${ASA_BACKUP_DIRECTORY:-backups}
check_only=${ASA_UPDATE_CHECK_ONLY:-false}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  case "$profile" in
    base)
      if [ "$include_frp" = true ]; then
        docker compose -f compose.yaml -f compose.frp.yaml "$@"
      else
        docker compose -f compose.yaml "$@"
      fi
      ;;
    dev|staging|production)
      if [ "$include_frp" = true ]; then
        docker compose -f compose.yaml -f "compose.${profile}.yaml" -f compose.frp.yaml "$@"
      else
        docker compose -f compose.yaml -f "compose.${profile}.yaml" "$@"
      fi
      ;;
    *) die "unsupported ASA_COMPOSE_PROFILE: $profile" ;;
  esac
}

env_value() {
  name=$1
  sed -n "s/^${name}=//p" .env | tail -n 1
}

latest_schema_version() {
  latest=''
  for migration in migrations/[0-9]*_*.sql; do
    version=${migration##*/}
    version=${version%%_*}
    version=$(printf '%s' "$version" | sed 's/^0*//')
    [ -n "$version" ] || version=0
    if [ -z "$latest" ] || [ "$version" -gt "$latest" ]; then latest=$version; fi
  done
  [ -n "$latest" ] || die 'cannot determine schema version from migrations/*.sql'
  printf '%s\n' "$latest"
}

assert_container_running() {
  service=$1
  container_id=$(compose ps -q "$service")
  [ -n "$container_id" ] || die "service $service is absent; guarded update is not a bootstrap command"
  [ "$(docker inspect --format '{{.State.Running}}' "$container_id")" = true ] ||
    die "service $service is not running"
  printf '%s\n' "$container_id"
}

container_working_directory() {
  docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$1"
}

mixed_origin_services() {
  drift=''
  for service in postgres api web; do
    container_id=$(compose ps -q "$service")
    [ -n "$container_id" ] || continue
    working_directory=$(container_working_directory "$container_id")
    if [ "$working_directory" != "$repo_root" ]; then
      [ -n "$working_directory" ] || working_directory='<missing>'
      drift="${drift}${service}=${working_directory};"
    fi
  done
  printf '%s\n' "$drift"
}

backup_database() {
  output_path=$1
  container_path="/tmp/asa-lab-update-$$.dump"
  cleanup_backup() {
    compose exec -T -e "BACKUP_PATH=$container_path" postgres sh -c 'rm -f "$BACKUP_PATH"' >/dev/null 2>&1 || true
  }
  trap cleanup_backup EXIT HUP INT TERM
  compose exec -T -e "BACKUP_PATH=$container_path" postgres sh -eu -c \
    'pg_dump --format=custom --no-owner --no-acl --dbname="$POSTGRES_DB" --username="$POSTGRES_USER" --file="$BACKUP_PATH"; pg_restore --list "$BACKUP_PATH" >/dev/null; chmod 0644 "$BACKUP_PATH"'
  compose cp "postgres:$container_path" "$output_path"
  cleanup_backup
  trap - EXIT HUP INT TERM
  [ -s "$output_path" ] || die "backup is empty or missing: $output_path"
}

backup_hash() {
  path=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    die 'sha256sum or shasum is required to verify the backup receipt'
  fi
}

save_rollback_image() {
  service=$1
  revision=$2
  container_id=$(compose ps -q "$service")
  [ -n "$container_id" ] || return 0
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  [ -n "$image_id" ] || return 0
  tag="asa-lab-${service}:rollback-$(printf '%.8s' "$revision")"
  docker image tag "$image_id" "$tag"
  printf '%s\n' "$tag"
}

assert_github_ci_success() {
  revision=$1
  origin=$(git remote get-url origin)
  case "$origin" in
    https://github.com/*|git@github.com:*) ;;
    *) die 'origin is not a supported GitHub repository; exact CI status cannot be verified' ;;
  esac
  repository=$(printf '%s' "$origin" | sed -E 's#^.*github\.com[/:]##')
  repository=${repository%.git}
  case "$repository" in
    */*) ;;
    *) die 'cannot derive owner/repository from origin' ;;
  esac
  if command -v gh >/dev/null 2>&1; then
    ci_line=$(gh run list --repo "$repository" --commit "$revision" \
      --json headSha,name,status,conclusion,url --limit 20 \
      --jq ".[] | select(.headSha == \"$revision\" and .name == \"ASA Lab Governance and Code Gates\") | [.status, (if .conclusion == \"\" then \"pending\" else .conclusion end), .url] | @tsv" \
      2>/dev/null | head -n 1) || ci_line=''
    if [ -n "$ci_line" ]; then
      set -- $ci_line
      ci_status=$1
      ci_conclusion=$2
      ci_url=$3
      [ "$ci_status" = completed ] && [ "$ci_conclusion" = success ] ||
        die "required GitHub workflow is $ci_status/$ci_conclusion: $ci_url"
      printf 'CI OK: %s\n' "$ci_url"
      return 0
    fi
  fi

  GITHUB_REPOSITORY=$repository
  TARGET_SHA=$revision
  export GITHUB_REPOSITORY TARGET_SHA
  compose exec -T -e GITHUB_REPOSITORY -e TARGET_SHA -e GH_TOKEN api node -e '
    const repository = process.env.GITHUB_REPOSITORY;
    const revision = process.env.TARGET_SHA;
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "asa-lab-guarded-updater",
    };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const url = `https://api.github.com/repos/${repository}/actions/runs?head_sha=${revision}&branch=main&per_page=30`;
    fetch(url, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GitHub API ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const run = (payload.workflow_runs || []).find((candidate) =>
          candidate.head_sha === revision && candidate.name === "ASA Lab Governance and Code Gates");
        if (!run) throw new Error(`required workflow was not found for ${revision}`);
        if (run.status !== "completed" || run.conclusion !== "success") {
          throw new Error(`workflow is ${run.status}/${run.conclusion || "pending"}: ${run.html_url}`);
        }
        console.log(`CI OK: ${run.html_url}`);
      })
      .catch((problem) => {
        console.error(`CI BLOCKED: ${problem.message}`);
        process.exit(1);
      });
  '
}

wait_exact_readiness() {
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if compose exec -T api node -e '
      const expectedRevision = process.env.ASA_BUILD_REVISION;
      const expectedSchema = Number(process.env.ASA_EXPECTED_SCHEMA_VERSION);
      Promise.all([
        fetch("http://127.0.0.1:4611/health/ready")
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
        fetch("http://web:4610/build-metadata.json")
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
      ]).then(([ready, webMetadata]) => {
          const deployment = ready.deployment || {};
          if (ready.status !== "ready" || deployment.revision !== expectedRevision ||
              webMetadata.revision !== expectedRevision ||
              Number(deployment.schemaVersion) !== expectedSchema ||
              Number(deployment.expectedSchemaVersion) !== expectedSchema ||
              deployment.synchronized !== true) process.exit(1);
        })
        .catch(() => process.exit(1));
    ' >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

write_receipt() {
  path=$1
  shift
  : >"$path"
  for line in "$@"; do printf '%s\n' "$line" >>"$path"; done
}

main() {
  if [ "${1:-}" = '--check' ]; then check_only=true; shift; fi
  [ "$#" -eq 0 ] || die 'usage: docker-update.sh [--check]'

  command -v git >/dev/null 2>&1 || die 'git is required'
  command -v docker >/dev/null 2>&1 || die 'docker is required'
  docker version --format '{{.Server.Version}}' >/dev/null
  docker compose version >/dev/null

  [ -f .env ] || die '.env is missing; guarded update never invents production secrets'
  project_name=$(env_value COMPOSE_PROJECT_NAME)
  [ -n "$project_name" ] || die 'COMPOSE_PROJECT_NAME is required to preserve the existing PostgreSQL volume'
  if [ "$profile" = production ]; then
    [ "$(env_value ASA_SEED_DEV)" = false ] || die 'production requires ASA_SEED_DEV=false in .env'
  fi
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ "$COMPOSE_PROJECT_NAME" != "$project_name" ]; then
    die 'process COMPOSE_PROJECT_NAME differs from .env; PostgreSQL volume selection is ambiguous'
  fi
  COMPOSE_PROJECT_NAME=$project_name
  export COMPOSE_PROJECT_NAME

  [ "$(git branch --show-current)" = main ] || die 'guarded update is allowed only from main'
  [ -z "$(git status --porcelain)" ] || die 'working tree is dirty; updater never discards local changes'

  case "$transport" in
    auto) if [ -f compose.frp.yaml ]; then include_frp=true; else include_frp=false; fi ;;
    frp) [ -f compose.frp.yaml ] || die 'ASA_COMPOSE_TRANSPORT=frp but compose.frp.yaml is missing'; include_frp=true ;;
    none) include_frp=false ;;
    *) die "unsupported ASA_COMPOSE_TRANSPORT: $transport" ;;
  esac

  compose config --quiet
  postgres_container_id=$(assert_container_running postgres)
  database_origin=$(container_working_directory "$postgres_container_id")
  [ -n "$database_origin" ] || die 'running PostgreSQL has no Compose working-directory label; deployment root is unknown'
  [ "$database_origin" = "$repo_root" ] ||
    die "this checkout is not the database deployment root; PostgreSQL belongs to $database_origin"
  origin_drift=$(mixed_origin_services)
  if [ -n "$origin_drift" ]; then
    printf 'WARNING: mixed Compose working directories detected: %s\n' "$origin_drift" >&2
  fi

  git fetch origin main
  set -- $(git rev-list --left-right --count HEAD...origin/main)
  ahead=$1
  behind=$2
  [ "$ahead" -eq 0 ] || die "local main has $ahead unpublished commit(s); merge/rebase is not automatic"
  old_revision=$(git rev-parse HEAD)
  target_revision=$(git rev-parse origin/main)
  assert_github_ci_success "$target_revision"
  if [ "$include_frp" = true ]; then transport_label=frp; else transport_label=none; fi
  printf 'CHECK project=%s profile=%s transport=%s\n' "$project_name" "$profile" "$transport_label"
  printf 'CHECK current=%s target=%s behind=%s\n' "$old_revision" "$target_revision" "$behind"

  if [ "$check_only" = true ]; then
    [ -z "$origin_drift" ] ||
      die 'CHECK BLOCKED: installation mixes containers from different checkouts; run the full guarded updater from the PostgreSQL deployment root'
    printf 'CHECK OK: no code, container or database changes were made.\n'
    exit 0
  fi

  case "$backup_directory" in
    /*) backup_root=$backup_directory ;;
    *) backup_root="$repo_root/$backup_directory" ;;
  esac
  mkdir -p "$backup_root"
  stamp=$(date -u +%Y%m%d-%H%M%SZ)
  backup_path="$backup_root/pre-update-$stamp-$(printf '%.8s' "$old_revision").dump"
  backup_database "$backup_path"
  backup_sha256=$(backup_hash "$backup_path")
  printf 'BACKUP OK: %s\n' "$backup_path"
  printf 'BACKUP SHA256: %s\n' "$backup_sha256"

  rollback_api=$(save_rollback_image api "$old_revision" || true)
  rollback_web=$(save_rollback_image web "$old_revision" || true)

  git pull --ff-only origin main
  new_revision=$(git rev-parse HEAD)
  remote_revision=$(git rev-parse origin/main)
  [ "$new_revision" = "$remote_revision" ] || die 'local main does not match origin/main after fast-forward'
  [ -z "$(git status --porcelain)" ] || die 'working tree became dirty after fast-forward'

  schema_version=$(latest_schema_version)
  ASA_BUILD_REVISION=$new_revision
  ASA_IMAGE_TAG=$(printf '%.12s' "$new_revision")
  ASA_EXPECTED_SCHEMA_VERSION=$schema_version
  export ASA_BUILD_REVISION ASA_IMAGE_TAG ASA_EXPECTED_SCHEMA_VERSION
  receipt_path="$backup_root/update-$stamp-$(printf '%.8s' "$new_revision").receipt.txt"

  if compose config --quiet && compose up -d --build && wait_exact_readiness &&
    [ -z "$(mixed_origin_services)" ]; then
    write_receipt "$receipt_path" \
      'status=success' "updated_at_utc=$stamp" "compose_project=$project_name" \
      "profile=$profile" "transport=$transport_label" "previous_revision=$old_revision" \
      "deployed_revision=$new_revision" "schema_version=$schema_version" \
      "backup_path=$backup_path" "backup_sha256=$backup_sha256" \
      "rollback_api_image=$rollback_api" "rollback_web_image=$rollback_web"
  else
    write_receipt "$receipt_path" \
      'status=failed_after_backup' "updated_at_utc=$stamp" "compose_project=$project_name" \
      "profile=$profile" "transport=$transport_label" "previous_revision=$old_revision" \
      "attempted_revision=$new_revision" "backup_path=$backup_path" \
      "backup_sha256=$backup_sha256" 'automatic_database_restore=forbidden'
    printf '%s\n' 'UPDATE STOPPED: volume was not removed and database restore was not attempted.' >&2
    compose ps >&2 || true
    compose logs --tail 120 api migration web >&2 || true
    exit 1
  fi

  printf 'UPDATE OK: revision=%s schema=%s synchronized=true\n' "$new_revision" "$schema_version"
  printf 'RECEIPT: %s\n' "$receipt_path"
  printf '%s\n' 'The PostgreSQL volume was preserved.'
}

main "$@"
