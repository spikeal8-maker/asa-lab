#!/usr/bin/env python3
"""Prove that the R0 target-contract PR contains governance only.

R0 may change product/architecture/delivery contracts, evidence and validators.
It must not silently change runtime product code, database migrations or API
schemas before the owner approves the target model.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

ALLOWED_EXACT = {
    ".gitattributes",
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "START_HERE_FOR_AI.md",
}
ALLOWED_PREFIXES = (
    "docs/",
    "tools/",
)
FORBIDDEN_PREFIXES = (
    "apps/",
    "packages/",
    "contexts/",
    "modules/",
    "migrations/",
    "schemas/",
    "crates/",
    "infra/",
)
REQUIRED_CHANGED = {
    "AGENTS.md",
    "START_HERE_FOR_AI.md",
    "docs/delivery/BOT_RUNBOOK.md",
    "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md",
    "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml",
    "docs/delivery/R0_OWNER_DECISION.md",
    "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md",
    "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml",
    "docs/product/TARGET_PLATFORM_INDEX.md",
    "tools/validate_tinkercad_parity.py",
    "tools/validate_target_execution.py",
    "tools/validate_r0.py",
    "tools/validate_r0_diff.py",
}


def candidate_bases() -> list[str]:
    explicit = os.getenv("ASA_R0_BASE_REF", "").strip()
    candidates = [explicit] if explicit else []
    candidates.extend(["origin/main", "main"])
    result: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in result:
            result.append(candidate)
    return result


def resolve_base() -> str:
    for candidate in candidate_bases():
        completed = subprocess.run(
            ["git", "rev-parse", "--verify", candidate],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if completed.returncode == 0:
            return candidate
    raise RuntimeError(
        "cannot resolve R0 base ref; fetch origin/main or set ASA_R0_BASE_REF"
    )


def changed_files(base: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"git diff failed for {base}...HEAD: {completed.stderr.strip()}"
        )
    return [line.strip().replace("\\", "/") for line in completed.stdout.splitlines() if line.strip()]


def is_allowed(path: str) -> bool:
    return path in ALLOWED_EXACT or path.startswith(ALLOWED_PREFIXES)


def main() -> int:
    try:
        base = resolve_base()
        changed = changed_files(base)
    except RuntimeError as error:
        print(f"R0 diff gate BLOCKED: {error}", file=sys.stderr)
        return 78

    errors: list[str] = []
    for path in changed:
        if path.startswith(FORBIDDEN_PREFIXES):
            errors.append(f"R0 contract PR changes forbidden product/runtime path: {path}")
        elif not is_allowed(path):
            errors.append(f"R0 contract PR changes unapproved path: {path}")

    missing = sorted(REQUIRED_CHANGED - set(changed))
    if missing:
        errors.append(
            "R0 contract diff misses required governance files: " + ", ".join(missing)
        )

    migration_like = [
        path
        for path in changed
        if path.endswith(".sql")
        or "/migration" in path.lower()
        or path.lower().startswith("migrations/")
    ]
    if migration_like:
        errors.append(
            "R0 contract PR must not contain migration/runtime SQL: "
            + ", ".join(sorted(migration_like))
        )

    if errors:
        print("ASA R0 diff gate FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA R0 diff gate PASS")
    print(f"- base: {base}")
    print(f"- changed files: {len(changed)}")
    print("- product/runtime paths changed: 0")
    print("- migrations/schemas changed: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
