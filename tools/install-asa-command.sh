#!/bin/sh
# Install only a pointer to the versioned repo command; do not replace any existing command.
set -eu
fail() { printf 'ASA INSTALL: %s\n' "$*" >&2; exit 64; }
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
