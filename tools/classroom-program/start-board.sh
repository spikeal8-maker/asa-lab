#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python3 classroomctl.py board --output classroom-board.html
printf 'Откройте: %s/classroom-board.html\n' "$PWD"
