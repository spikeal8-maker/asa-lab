#!/usr/bin/env python3
"""Run the complete owner-gated R0 contract suite.

This wrapper does not weaken any validator. It executes each existing command as
an independent process, streams output, and fails on the first non-zero exit.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
VALIDATORS = (
    "tools/validate_r0_diff.py",
    "tools/validate_r0_human_contract.py",
    "tools/validate_tinkercad_parity.py",
    "tools/validate_target_execution.py",
    "tools/validate_architecture.py",
    "tools/validate_project_map.py",
    "tools/validate_test_catalog.py",
)


def main() -> int:
    print("ASA Lab R0 validation suite")
    print(f"python={sys.executable}")
    print(f"repository={ROOT}")

    for index, relative_path in enumerate(VALIDATORS, start=1):
        path = ROOT / relative_path
        if not path.is_file():
            print(f"R0 FAIL: missing validator {relative_path}", file=sys.stderr)
            return 1

        print(f"\n[{index}/{len(VALIDATORS)}] {relative_path}")
        completed = subprocess.run(
            [sys.executable, str(path)],
            cwd=ROOT,
            check=False,
        )
        if completed.returncode != 0:
            print(
                f"R0 FAIL: {relative_path} exited with {completed.returncode}",
                file=sys.stderr,
            )
            return completed.returncode or 1

    print("\nASA Lab R0 validation suite: PASS")
    print(f"validators={len(VALIDATORS)}")
    print("currentGate=R0")
    print("ownerDecisionRequired=true")
    print("productCodeAllowed=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
