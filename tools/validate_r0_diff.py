#!/usr/bin/env python3
"""Prove that the R0 target-contract PR contains governance only.

R0 may change product/architecture/delivery contracts, evidence and validators.
It must not silently change runtime product code, database migrations, API
schemas or repository binaries before the owner approves the target model.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_BRANCH = "assistant/tinkercad-parity-baseline"

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
FORBIDDEN_BINARY_SUFFIXES = {
    ".7z",
    ".avi",
    ".bin",
    ".bmp",
    ".dll",
    ".exe",
    ".gif",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".pptx",
    ".tar",
    ".webm",
    ".xlsx",
    ".zip",
}
REQUIRED_CHANGED = {
    "AGENTS.md",
    "START_HERE_FOR_AI.md",
    "docs/delivery/BOT_RUNBOOK.md",
    "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md",
    "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml",
    "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md",
    "docs/delivery/R0_CONVERGENCE_CURRENT_STATE.md",
    "docs/delivery/R0_OWNER_DECISION.md",
    "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md",
    "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml",
    "docs/product/TARGET_PLATFORM_INDEX.md",
    "tools/validate_tinkercad_parity.py",
    "tools/validate_target_execution.py",
    "tools/validate_r0.py",
    "tools/validate_r0_diff.py",
    "tools/validate_r0_human_contract.py",
}


def run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


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
        completed = run_git(["rev-parse", "--verify", candidate])
        if completed.returncode == 0:
            return candidate
    raise RuntimeError(
        "cannot resolve R0 base ref; fetch origin/main or set ASA_R0_BASE_REF"
    )


def current_branch() -> str:
    completed = run_git(["branch", "--show-current"])
    if completed.returncode != 0:
        raise RuntimeError(f"cannot read current branch: {completed.stderr.strip()}")
    return completed.stdout.strip()


def working_tree_lines() -> list[str]:
    completed = run_git(["status", "--porcelain=v1", "--untracked-files=all"])
    if completed.returncode != 0:
        raise RuntimeError(f"git status failed: {completed.stderr.strip()}")
    return [line for line in completed.stdout.splitlines() if line.strip()]


def changed_files(base: str) -> list[str]:
    completed = run_git(["diff", "--name-only", f"{base}...HEAD"])
    if completed.returncode != 0:
        raise RuntimeError(
            f"git diff failed for {base}...HEAD: {completed.stderr.strip()}"
        )
    return [
        line.strip().replace("\\", "/")
        for line in completed.stdout.splitlines()
        if line.strip()
    ]


def binary_diff_paths(base: str) -> list[str]:
    completed = run_git(["diff", "--numstat", f"{base}...HEAD"])
    if completed.returncode != 0:
        raise RuntimeError(
            f"git diff --numstat failed for {base}...HEAD: {completed.stderr.strip()}"
        )
    result: list[str] = []
    for line in completed.stdout.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3 and (parts[0] == "-" or parts[1] == "-"):
            result.append(parts[2].replace("\\", "/"))
    return result


def is_allowed(path: str) -> bool:
    return path in ALLOWED_EXACT or path.startswith(ALLOWED_PREFIXES)


def main() -> int:
    try:
        base = resolve_base()
        branch = current_branch()
        dirty = working_tree_lines()
        changed = changed_files(base)
        binary_paths = binary_diff_paths(base)
    except RuntimeError as error:
        print(f"R0 diff gate BLOCKED: {error}", file=sys.stderr)
        return 78

    errors: list[str] = []

    allow_detached = os.getenv("ASA_R0_ALLOW_DETACHED", "").strip() == "1"
    if branch != EXPECTED_BRANCH and not (allow_detached and branch == ""):
        errors.append(
            f"R0 validator must run on {EXPECTED_BRANCH}; current branch is {branch or '<detached>'}"
        )

    if dirty:
        preview = "; ".join(dirty[:10])
        suffix = " ..." if len(dirty) > 10 else ""
        errors.append(f"working tree must be clean before R0 PASS: {preview}{suffix}")

    if not changed:
        errors.append("R0 contract diff is empty; expected target/evidence/governance changes")

    for path in changed:
        if path.startswith(FORBIDDEN_PREFIXES):
            errors.append(f"R0 contract PR changes forbidden product/runtime path: {path}")
        elif not is_allowed(path):
            errors.append(f"R0 contract PR changes unapproved path: {path}")
        if Path(path).suffix.lower() in FORBIDDEN_BINARY_SUFFIXES:
            errors.append(f"R0 contract PR contains forbidden binary/evidence file: {path}")

    if binary_paths:
        errors.append(
            "R0 contract PR contains binary git diff entries: "
            + ", ".join(sorted(binary_paths))
        )

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
    print(f"- branch: {branch}")
    print(f"- base: {base}")
    print(f"- changed files: {len(changed)}")
    print("- working tree: clean")
    print("- product/runtime paths changed: 0")
    print("- migrations/schemas changed: 0")
    print("- repository binaries changed: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
