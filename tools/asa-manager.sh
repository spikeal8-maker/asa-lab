#!/bin/sh
set -eu
command -v python3 >/dev/null 2>&1 || { echo 'Python 3.11 or newer is required.' >&2; exit 78; }
exec python3 "$(dirname -- "$0")/asa_manager.py" "$@"
