#!/usr/bin/env bash
# The governance gate. Single definition, invoked identically by:
#   - a local agent, via `pnpm gate:governance`
#   - .github/workflows/spec-validation.yml
#   - an owner evidence run
#
# The CI job runs this without Node installed, so nothing here may depend on
# pnpm. Adding a validator means adding it here and nowhere else.
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python3

run() {
  echo "── $*"
  "$@"
}

run "$PYTHON" -m compileall -q tools

# State consistency first: every later validator reads the active task from
# docs/execution/current.yaml, so a drifted control plane must fail loudly here
# rather than silently steering the rest of the run.
run "$PYTHON" tools/validate_control_plane.py

run "$PYTHON" tools/validate_architecture.py
run "$PYTHON" tools/validate_capability_map.py
run "$PYTHON" tools/validate_project_map.py
run "$PYTHON" tools/validate_test_catalog.py
run "$PYTHON" tools/validate_delivery_program.py
run "$PYTHON" tools/validate_infrastructure_focus.py

echo "governance gate: PASS"
