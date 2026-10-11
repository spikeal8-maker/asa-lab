#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 "$root/tools/log_collector.py" prepare --root "$root"
python3 "$root/tools/log_collector.py" reconcile --root "$root"
