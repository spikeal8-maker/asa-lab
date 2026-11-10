#!/bin/sh
# Install the repo command. Production pins a separate checkout across release switches.
set -eu
fail() { printf 'ASA INSTALL: %s\n' "$*" >&2; exit 64; }
mode=${1:-}
[ "$#" -le 1 ] && { [ -z "$mode" ] || [ "$mode" = --production ]; } || fail 'Использование: install-asa-command.sh [--production]'
if [ "$mode" = --production ]; then
  PATH=/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/sbin:/usr/local/bin
  export PATH
fi
tools_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P) || fail 'Каталог инструментов недоступен'
if [ -n "${ASA_INSTALL_ROOT:-}" ]; then
  root=$(CDPATH= cd -- "$ASA_INSTALL_ROOT" && pwd -P) || fail 'ASA_INSTALL_ROOT недоступен'
else
  root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P) || fail 'Каталог ASA Lab недоступен'
fi
[ -f "$root/tools/asa_manager.py" ] || fail 'Не найдён исходный менеджер'
[ -x "$root/tools/asa" ] || fail 'tools/asa должен иметь исполняемый Git mode 100755'
bin_dir=${ASA_BIN_DIR:-/usr/local/bin}
[ -d "$bin_dir" ] || fail "Каталог команд не существует: $bin_dir"
[ -w "$bin_dir" ] || fail "Нет прав записи: $bin_dir"
target=$bin_dir/asa
if [ "$mode" = --production ]; then
  [ "$(id -u)" = 0 ] || fail 'Для подключения production команды нужны права root'
  [ -n "${ASA_INSTALL_ROOT:-}" ] || fail 'Укажите ASA_INSTALL_ROOT'
  case "$tools_root/" in "$root/"*) fail 'Инструменты должны быть вне каталога приложения' ;; esac
  case "$root/" in "$tools_root/"*) fail 'Приложение должно быть вне каталога инструментов' ;; esac
  bin_dir=$(CDPATH= cd -- "$bin_dir" && pwd -P) || fail 'Каталог команд недоступен'
  target=$bin_dir/asa
  trusted_dir() {
    path=$1
    while :; do
      [ "$(find -P "$path" -maxdepth 0 -type d -uid 0 ! -perm /022 -print)" = "$path" ] || fail "Небезопасный каталог: $path"
      [ "$path" != / ] || break
      path=$(dirname -- "$path")
    done
  }
  trusted_dir "$bin_dir"
  trusted_dir "$tools_root"
  [ -d "$tools_root/.git" ] && [ ! -L "$tools_root/.git" ] || fail 'Нужен отдельный Git checkout инструментов'
  bad=$(find -P "$tools_root/.git" \( ! -uid 0 -o -perm /022 -o \( ! -type d ! -type f \) \) -print -quit) || fail 'Не удалось проверить права Git checkout'
  [ -z "$bad" ] || fail 'Небезопасный Git checkout инструментов'
  git_clean() { env -i PATH=/usr/bin:/bin LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$tools_root" "$@"; }
  [ "$(git_clean config --local --get remote.origin.url)" = https://github.com/spikeal8-maker/asa-lab.git ] || fail 'Требуется официальный репозиторий ASA Lab по HTTPS'
  revision=$(git_clean rev-parse --verify HEAD) || fail 'Не найден коммит инструментов'
  git_clean merge-base --is-ancestor "$revision" refs/remotes/origin/main || fail 'Коммит инструментов отсутствует в origin/main'
  temp=$(mktemp "$bin_dir/.asa.XXXXXXXX") || fail 'Не создан файл команды'
  trap 'rm -f -- "$temp"' EXIT
  umask 077
  /usr/bin/python3 -I -S -B - "$tools_root" "$root" "$revision" > "$temp" <<'PY'
import shlex
import sys
print('#!/bin/sh\n# ASA Lab production launcher (install-asa-command.sh)')
for name, value in zip(('tools_root', 'install_root', 'revision'), sys.argv[1:]):
    print(f'{name}={shlex.quote(value)}')
PY
  cat >> "$temp" <<'SH'
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/sbin:/usr/local/bin
export PATH
fail() { printf 'ASA: %s\n' "$*" >&2; exit 64; }
git_clean() { env -i PATH=/usr/bin:/bin LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$tools_root" "$@"; }
path=$tools_root
while :; do
  [ "$(find -P "$path" -maxdepth 0 -type d -uid 0 ! -perm /022 -print)" = "$path" ] || fail "Небезопасный каталог инструментов: $path"
  [ "$path" != / ] || break
  path=$(dirname -- "$path")
done
for path in "$tools_root/.git" "$tools_root/tools"; do
  [ -d "$path" ] || fail "Недоступен каталог инструментов: $path"
  bad=$(find -P "$path" \( ! -uid 0 -o -perm /022 -o \( ! -type d ! -type f \) -o -name '*.pyc' \) -print -quit) || fail 'Не удалось проверить права инструментов'
  [ -z "$bad" ] || fail "Небезопасный файл инструментов: $bad"
done
untracked=$(git_clean ls-files --others -- tools) || fail 'Не удалось проверить файлы инструментов'
[ "$(git_clean rev-parse --verify HEAD)" = "$revision" ] &&
  git_clean diff --no-ext-diff --quiet "$revision" -- tools &&
  [ -z "$untracked" ] || fail 'Инструменты отличаются от установленного коммита; переподключите команду из проверенного checkout'
[ "${1:-}" != --launcher-verify ] || exit 0
unset ASA_PROFILE ASA_PYTHON PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE
ASA_INSTALL_ROOT=$install_root
ASA_PYTHON=/usr/bin/python3
export ASA_INSTALL_ROOT ASA_PYTHON
exec "$tools_root/tools/asa" "$@"
SH
  chmod 0755 "$temp"
  "$temp" --launcher-verify || fail 'Инструменты не прошли проверку'
  if [ -L "$target" ]; then
    [ "$(stat -c %u -- "$target")" = 0 ] && [ "$(readlink "$target")" = "$root/tools/asa" ] || fail "Неизвестная ссылка: $target"
  elif [ -e "$target" ]; then
    [ "$(find -P "$target" -maxdepth 0 -type f -uid 0 ! -perm /022 -print)" = "$target" ] &&
      [ "$(sed -n '2p' "$target")" = '# ASA Lab production launcher (install-asa-command.sh)' ] || fail "Существующая команда не будет перезаписана: $target"
  fi
  mv -fT -- "$temp" "$target"
  printf 'ASA: подключена постоянная команда %s\nПроверка: %s check\n' "$target" "$target"
  exit 0
fi
if [ -L "$target" ] && [ "$(readlink "$target")" = "$root/tools/asa" ]; then
  printf 'ASA: уже установлен %s -> %s\n' "$target" "$root/tools/asa"
  exit 0
fi
if [ -e "$target" ] || [ -L "$target" ]; then
  fail "Существующая команда не будет перезаписана: $target"
fi
ln -s "$root/tools/asa" "$target"
[ -x "$target" ] || fail "Проверьте исполняемые права: $target"
printf 'ASA: установлен %s -> %s\n' "$target" "$root/tools/asa"
printf 'Проверка: %s help\n' "$target"
