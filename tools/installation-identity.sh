#!/bin/sh
# Sourced by startup/updater. Read-only; functions run in subshells to isolate variables.
asa_identity_fail() { printf '%s\n' "$1" >&2; return 1; }
asa_identity_path() { printf '%s' "$1" | sed 's#\\#/#g;s#/$##'; }

asa_validate_identity_inventory() (
  root_key=$(asa_identity_path "$1"); project=$2; expected_files=$3
  environment_exists=$4; require_existing=$5; inventory=$6
  seen='|'; owned=0; foreign=''
  while IFS='|' read -r r_project service r_root files image name; do
    if [ -n "$r_project$service$r_root$files$image$name" ] && [ -z "$name" ]; then
      asa_identity_fail 'ASA_IDENTITY_DOCKER: malformed inspection record.'; exit 1
    fi
    case "$service" in postgres|api|web|scratch) ;; *) continue ;; esac
    same_root=false
    [ -n "$r_root" ] && [ "$(asa_identity_path "$r_root")" = "$root_key" ] && same_root=true
    if [ "$r_project" != "$project" ]; then
      if [ "$same_root" = true ]; then
        asa_identity_fail "ASA_IDENTITY_PROJECT: $name already belongs to $r_project in this directory."; exit 1
      fi
      case "$r_project" in asa-lab|asa-lab-*|asa-lab_*) foreign="$foreign $name" ;; esac
      case "$image" in
        asa-lab-api[:@]*|asa-lab-web[:@]*|asa-lab-scratch[:@]*|*/asa-lab-api[:@]*|*/asa-lab-web[:@]*|*/asa-lab-scratch[:@]*) foreign="$foreign $name" ;;
      esac
      continue
    fi
    if [ "$environment_exists" != true ]; then
      asa_identity_fail 'ASA_IDENTITY_ENV: existing installation has no .env; never regenerate its secrets.'; exit 1
    fi
    if [ "$same_root" != true ]; then
      asa_identity_fail "ASA_IDENTITY_ROOT: $name has a different or missing deployment root. Use the existing installation."; exit 1
    fi
    if [ "$(asa_identity_path "$files")" != "$expected_files" ]; then
      asa_identity_fail "ASA_IDENTITY_FILES: $name has different/missing Compose files; preserve its overlays."
      exit 1
    fi
    case "$seen" in
      *"|$service|"*)
        asa_identity_fail "ASA_IDENTITY_DUPLICATE: multiple $service containers in $project."
        exit 1 ;;
    esac
    seen="$seen$service|"
    owned=$((owned + 1))
  done <<EOF
$inventory
EOF
  if [ "$owned" -eq 0 ] && { [ "$require_existing" = true ] || [ -n "$foreign" ]; }; then
    asa_identity_fail "ASA_IDENTITY_EXISTING: do not create another ASA installation; existing services:$foreign."
    exit 1
  fi
)

asa_assert_installation_identity() (
  root=$1; project=$2; require_existing=$3; shift 3
  exists=false
  if [ -f "$root/.env" ]; then
    exists=true
    project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$root/.env" | tail -n 1 | tr -d '\r')
  fi
  case "$project" in
    ''|*[!a-z0-9_-]*|[!a-z0-9]*) asa_identity_fail 'ASA_IDENTITY_PROJECT: invalid/missing project name.'; exit 1 ;;
  esac
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ "$COMPOSE_PROJECT_NAME" != "$project" ]; then
    asa_identity_fail 'ASA_IDENTITY_PROJECT: process project differs from the selected .env/default.'
    exit 1
  fi
  files=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -f ]; then
      shift
      [ "$#" -gt 0 ] || { asa_identity_fail 'ASA_IDENTITY_FILES: missing Compose file.'; exit 1; }
      case "$1" in /*) file=$1 ;; *) file="$root/$1" ;; esac
      [ -z "$files" ] || files="$files,"
      files="$files$(asa_identity_path "$file")"
    fi
    shift
  done
  [ -n "$files" ] || { asa_identity_fail 'ASA_IDENTITY_FILES: no explicit Compose files.'; exit 1; }
  ids=$(docker ps -aq --filter label=com.docker.compose.project) || {
    asa_identity_fail 'ASA_IDENTITY_DOCKER: cannot list containers; no mutation allowed.'; exit 1;
  }
  inventory=''
  if [ -n "$ids" ]; then
    # IDs are Docker-generated hexadecimal values, not caller-supplied arguments.
    case "$ids" in *[!a-f0-9[:space:]]*) asa_identity_fail 'ASA_IDENTITY_DOCKER: invalid container IDs.'; exit 1 ;; esac
    template='{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{.Config.Image}}|{{.Name}}'
    inventory=$(docker inspect --format "$template" $ids) || {
      asa_identity_fail 'ASA_IDENTITY_DOCKER: cannot inspect containers; no mutation allowed.'; exit 1;
    }
  fi
  asa_validate_identity_inventory "$root" "$project" "$files" "$exists" "$require_existing" "$inventory" || exit 1
  printf 'ASA_IDENTITY_OK: project=%s; existing root and Compose files verified.\n' "$project"
)
