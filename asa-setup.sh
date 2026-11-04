#!/usr/bin/env bash
# The acquisition command verifies GitHub attestation before installing this
# immutable, root-owned bundle. Do not run a mutable branch as root.
set -euo pipefail
unset CDPATH BASH_ENV ENV PYTHONHOME PYTHONPATH LD_PRELOAD LD_LIBRARY_PATH
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l

asa_setup_directory="$(cd -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
asa_setup_check=false
asa_setup_json=false
for asa_setup_argument in "$@"; do
  case "$asa_setup_argument" in
    --check|check|status|doctor|diagnose|restore-plan|--help|-h) asa_setup_check=true ;;
    --json) asa_setup_json=true ;;
  esac
done

asa_setup_bootstrap_failure() {
  local asa_setup_code="${1:-2}" asa_setup_outcome=BLOCKED asa_setup_dependency=BLOCKED
  local asa_setup_mark='[!]' asa_setup_color=33 asa_setup_attention='[!]'
  local asa_setup_title='ОСТАНОВЛЕНО — ПОДГОТОВКА НЕ ЗАВЕРШЕНА'
  if [[ "$asa_setup_code" == 1 ]]; then
    asa_setup_outcome=ERROR
    asa_setup_dependency=FAILED
    asa_setup_mark='[X]'
    asa_setup_color=31
    asa_setup_title='ОШИБКА — ПОДГОТОВКА НЕ ЗАВЕРШЕНА'
  else
    asa_setup_code=2
  fi
  if "$asa_setup_json"; then
    printf '{"format":"asa-setup-result-v1","mode":null,"outcome":"%s","exitCode":%s,"stage":"bootstrap","operationId":null,"installationId":null,"observedAt":"%s","accepted":false,"actionExecuted":false,"executionCompleted":false,"applicationAccepted":false,"dataProtectionConfirmed":false,"dependencies":{"status":"%s","reasonCode":"PYTHON_BOOTSTRAP"},"version":{"status":"NOT_RUN"},"data":{"status":"NOT_RUN"},"backup":{"status":"NOT_RUN"},"site":{"status":"NOT_RUN"},"diagnostics":{"status":"NOT_RUN"},"postActions":[],"reasonCode":"PYTHON_BOOTSTRAP","nextAction":"Проверьте официальный пакет, Ubuntu 24.04 amd64, root-доступ и подписанные источники apt.","error":{"code":"PYTHON_BOOTSTRAP","message":"Python 3.11+ не подготовлен; приложение не изменено.","action":"Проверьте официальный пакет, Ubuntu 24.04 amd64, root-доступ и подписанные источники apt."}}\n' \
      "$asa_setup_outcome" "$asa_setup_code" "$(/usr/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$asa_setup_dependency"
  else
    if [[ -t 1 && ! ${NO_COLOR+x} && ${TERM:-} != dumb ]]; then
      asa_setup_mark=$'\033['"${asa_setup_color}m${asa_setup_mark}"$'\033[0m'
      asa_setup_attention=$'\033[33m[!]\033[0m'
    fi
    printf '%s\n' "$asa_setup_mark ASA Setup: $asa_setup_title (код $asa_setup_code)" \
      "1. $asa_setup_mark Зависимости и владелец: нужен Python 3.11+." \
      "2. $asa_setup_attention Версия приложения: не выполнялось." \
      "3. $asa_setup_attention PostgreSQL и файлы: не выполнялось." \
      "4. $asa_setup_attention Резервирование: не выполнялось." \
      "5. $asa_setup_attention Сайт и пользовательский путь: не выполнялось." \
      "6. $asa_setup_attention Диагностика: не выполнялось." \
      'Следующее действие: проверьте официальный пакет, Ubuntu 24.04 amd64, root-доступ и подписанные источники apt.'
  fi
  exit "$asa_setup_code"
}

if ! /usr/bin/python3 -I -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' 2>/dev/null; then
  # Ubuntu 24.04 normally provides Python. This narrow fallback handles a
  # deliberately minimal clean host without sourcing /etc/os-release as code.
  "$asa_setup_check" && asa_setup_bootstrap_failure
  [[ "$(/usr/bin/id -u)" == 0 ]] || asa_setup_bootstrap_failure
  [[ "$asa_setup_directory" =~ ^/opt/asa-setup/[a-f0-9]{40}$ ]] || asa_setup_bootstrap_failure
  [[ ! -L "${BASH_SOURCE[0]}" ]] || asa_setup_bootstrap_failure
  for asa_setup_path in /opt /opt/asa-setup "$asa_setup_directory" "$asa_setup_directory/asa-setup.sh"; do
    [[ ! -L "$asa_setup_path" ]] || asa_setup_bootstrap_failure
    read -r asa_setup_uid asa_setup_mode < <(/usr/bin/stat -c '%u %a' -- "$asa_setup_path")
    [[ "$asa_setup_uid" == 0 && $((8#$asa_setup_mode & 8#022)) == 0 ]] || asa_setup_bootstrap_failure
  done
  [[ "$(/usr/bin/uname -m)" == x86_64 ]] || asa_setup_bootstrap_failure
  /usr/bin/grep -Eq '^ID=(ubuntu|"ubuntu")$' /etc/os-release || asa_setup_bootstrap_failure
  /usr/bin/grep -Eq '^VERSION_ID=(24\.04|"24\.04")$' /etc/os-release || asa_setup_bootstrap_failure
  umask 077
  asa_setup_log="$(/usr/bin/mktemp /tmp/asa-python-bootstrap.XXXXXXXX.log)"
  /usr/bin/apt-get update >"$asa_setup_log" 2>&1 || asa_setup_bootstrap_failure 1
  asa_setup_python_version="$(/usr/bin/apt-cache policy python3 | /usr/bin/awk '/Candidate:/ { print $2; exit }')"
  [[ "$asa_setup_python_version" =~ ^[A-Za-z0-9.+:~_-]+$ ]] || asa_setup_bootstrap_failure
  /usr/bin/apt-get --simulate --no-remove --no-upgrade install "python3=$asa_setup_python_version" >>"$asa_setup_log" 2>&1 || asa_setup_bootstrap_failure 1
  if /usr/bin/grep -Eq '^(Remv |Purg |Inst [^ ]+ \[)' "$asa_setup_log"; then
    asa_setup_bootstrap_failure
  fi
  /usr/bin/apt-get -y --no-remove --no-upgrade --no-install-recommends install "python3=$asa_setup_python_version" >>"$asa_setup_log" 2>&1 || asa_setup_bootstrap_failure 1
  /usr/bin/python3 -I -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' || asa_setup_bootstrap_failure 1
fi

exec /usr/bin/python3 -I -B "$asa_setup_directory/tools/asa_setup_launcher.py" "$@"
