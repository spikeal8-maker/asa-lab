#!/usr/bin/env python3
"""Validate live GitHub state for the R0 convergence contract.

Static YAML cannot prove that PRs and Issues still have the expected roles. This
validator uses the authenticated `gh` CLI. Network/auth failures are BLOCKED,
never PASS.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_DECISION_PATH = ROOT / "docs/delivery/R0_FOUNDATION_DECISION.yaml"
REPOSITORY = "spikeal8-maker/asa-lab"
API_TIMEOUT_SECONDS = 30

EXPECTED_PRS: dict[int, dict[str, Any]] = {
    29: {
        "title_prefix": "[MAP-UX]",
        "base": "main",
        "head": "assistant/map-ux-owner-view",
        "draft": True,
    },
    35: {
        "title_prefix": "[TRANSFER-ONLY]",
        "base": "agent/task-electronics-slice-001",
        "head": "assistant/electronics-workbench-redesign",
        "draft": True,
    },
    43: {
        "title_prefix": "[R0 TARGET CONTRACT]",
        "base": "main",
        "head": "assistant/tinkercad-parity-baseline",
        "draft": True,
    },
    45: {
        "title_prefix": "[TRANSFER-ONLY]",
        "base": "assistant/electronics-workbench-redesign",
        "head": "assistant/parity-p1-project-hub",
        "draft": True,
    },
    47: {
        "title_prefix": "[TRANSFER-ONLY]",
        "base": "assistant/parity-p1-project-hub",
        "head": "assistant/asa-visual-system",
        "draft": True,
    },
    59: {
        "title_prefix": "[FROZEN R1 CANDIDATE A]",
        "base": "agent/parity-p1-visual-integration",
        "head": "agent/parity-c1-identity",
        "draft": True,
    },
    60: {
        "title_prefix": "[FROZEN R1 CANDIDATE B]",
        "base": "agent/parity-p1-visual-integration",
        "head": "agent/account-vertical-001",
        "draft": True,
    },
}
PR34_EXPECTED = {
    "title_prefix": "[R0 FOUNDATION REVIEW]",
    "base": "main",
    "head": "agent/task-electronics-slice-001",
}

EXPECTED_ISSUES: dict[int, str] = {
    6: "[SUPERSEDED][TASK-ELEC-001]",
    7: "[SUPERSEDED][TASK-SEAT-001]",
    8: "[SUPERSEDED][TASK-ACT-001]",
    20: "[SUPERSEDED][TASK-REVIEW-001]",
    24: "[SUPERSEDED][TASK-PROJECT-SHELL-001]",
    25: "[SUPERSEDED][TASK-CHECKERS-LITE-001]",
    26: "[SUPERSEDED][TASK-ELECTRONICS-ALPHA-001]",
    36: "[EPIC][R0 CONVERGENCE]",
    37: "[R3]",
    38: "[R7]",
    39: "[R8]",
    40: "[R5]",
    41: "[R9]",
    42: "[R10]",
    44: "[R0 EVIDENCE]",
    48: "[R1][BLOCKED BY R0]",
    49: "[SUPERSEDED]",
    50: "[EVIDENCE]",
    52: "[EVIDENCE]",
    61: "[SUPERSEDED BY R0–R10]",
    62: "[R2]",
    63: "[R4]",
    64: "[R6]",
}

LEGACY_TASK_IDS = (
    "TASK-ELEC-001",
    "TASK-SEAT-001",
    "TASK-ACT-001",
    "TASK-REVIEW-001",
    "TASK-PROJECT-SHELL-001",
    "TASK-CHECKERS-LITE-001",
    "TASK-ELECTRONICS-ALPHA-001",
)


def load_foundation_decision() -> dict[str, Any]:
    if not FOUNDATION_DECISION_PATH.is_file():
        raise RuntimeError(
            f"missing foundation decision file: {FOUNDATION_DECISION_PATH.relative_to(ROOT)}"
        )
    try:
        document = yaml.safe_load(FOUNDATION_DECISION_PATH.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise RuntimeError(f"cannot read foundation decision: {error}") from error
    if not isinstance(document, dict):
        raise RuntimeError("foundation decision YAML must be an object")
    return document


def gh_api(path: str, fields: dict[str, str] | None = None) -> Any:
    command = ["gh", "api", "--method", "GET", path]
    for key, value in (fields or {}).items():
        command.extend(["-f", f"{key}={value}"])
    try:
        completed = subprocess.run(
            command,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=API_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"gh api {path} timed out after {API_TIMEOUT_SECONDS}s"
        ) from error
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"gh api {path} failed: {message}")
    payload = completed.stdout.lstrip("\ufeff")
    try:
        return json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"gh api {path} returned invalid JSON: {error}") from error


def validate_common_pr(number: int, pr: dict[str, Any], expected: dict[str, Any], errors: list[str]) -> None:
    title = str(pr.get("title", ""))
    if not title.startswith(expected["title_prefix"]):
        errors.append(
            f"PR #{number} title must start with {expected['title_prefix']!r}, got {title!r}"
        )
    if pr.get("base", {}).get("ref") != expected["base"]:
        errors.append(
            f"PR #{number} base must be {expected['base']}, got {pr.get('base', {}).get('ref')!r}"
        )
    if pr.get("head", {}).get("ref") != expected["head"]:
        errors.append(
            f"PR #{number} head must be {expected['head']}, got {pr.get('head', {}).get('ref')!r}"
        )


def validate_pr34(pr: dict[str, Any], decision: dict[str, Any], errors: list[str]) -> None:
    validate_common_pr(34, pr, PR34_EXPECTED, errors)
    status = decision.get("status")
    merge = decision.get("merge") if isinstance(decision.get("merge"), dict) else {}

    if status == "accepted_merged":
        if pr.get("state") != "closed" or pr.get("merged_at") is None:
            errors.append("PR #34 must be closed and merged for accepted_merged")
        if pr.get("draft") is not False:
            errors.append("PR #34 must not remain Draft after merge")
        expected_sha = merge.get("merge_commit_sha")
        actual_sha = pr.get("merge_commit_sha")
        if expected_sha != actual_sha:
            errors.append(
                f"PR #34 merge SHA must match foundation decision: expected {expected_sha!r}, got {actual_sha!r}"
            )
        if merge.get("merged_at") != pr.get("merged_at"):
            errors.append("PR #34 merged_at must match foundation decision")
    else:
        if pr.get("state") != "open":
            errors.append(f"PR #34 must remain open while foundation status is {status!r}")
        if pr.get("merged_at") is not None:
            errors.append("PR #34 must not be merged before foundation status accepted_merged")
        if pr.get("draft") is not True:
            errors.append("PR #34 must remain Draft before foundation merge")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 GitHub state BLOCKED: gh CLI is not installed", file=sys.stderr)
        return 78

    errors: list[str] = []
    try:
        foundation_decision = load_foundation_decision()
        for number, expected in EXPECTED_PRS.items():
            pr = gh_api(f"repos/{REPOSITORY}/pulls/{number}")
            if pr.get("state") != "open":
                errors.append(f"PR #{number} must be open, got {pr.get('state')!r}")
            if pr.get("merged_at") is not None:
                errors.append(f"PR #{number} must not be merged during R0 freeze")
            validate_common_pr(number, pr, expected, errors)
            if pr.get("draft") is not expected["draft"]:
                errors.append(
                    f"PR #{number} draft must be {expected['draft']}, got {pr.get('draft')!r}"
                )

        pr34 = gh_api(f"repos/{REPOSITORY}/pulls/34")
        validate_pr34(pr34, foundation_decision, errors)

        for number, prefix in EXPECTED_ISSUES.items():
            issue = gh_api(f"repos/{REPOSITORY}/issues/{number}")
            if "pull_request" in issue:
                errors.append(f"#{number} must be an Issue, not a pull request")
            if issue.get("state") != "open":
                errors.append(f"Issue #{number} must remain open for R0 traceability")
            title = str(issue.get("title", ""))
            if not title.startswith(prefix):
                errors.append(
                    f"Issue #{number} title must start with {prefix!r}, got {title!r}"
                )

        epic = gh_api(f"repos/{REPOSITORY}/issues/36")
        epic_body = str(epic.get("body", ""))
        for marker in ("PR №43", "R0", "R10", "PR №59", "PR №60"):
            if marker not in epic_body:
                errors.append(f"Issue #36 body misses R0 marker: {marker}")

        contract_pr = gh_api(f"repos/{REPOSITORY}/pulls/43")
        contract_body = str(contract_pr.get("body", ""))
        for marker in (
            "R0_OWNER_DECISION.md",
            "R0_FOUNDATION_DECISION.yaml",
            "R0_R1_CANDIDATE_DECISION.yaml",
            "python tools/validate_r0.py",
            "R1  Account",
            "R10 Multi-module",
        ):
            if marker not in contract_body:
                errors.append(f"PR #43 body misses marker: {marker}")

        for task_id in LEGACY_TASK_IDS:
            search = gh_api(
                "search/issues",
                {
                    "q": f'repo:{REPOSITORY} is:pr is:open in:title "{task_id}"',
                    "per_page": "20",
                },
            )
            if int(search.get("total_count", 0)) > 0:
                numbers = [item.get("number") for item in search.get("items", [])]
                errors.append(
                    f"legacy {task_id} must not have an open PR title; found "
                    + ", ".join(f"#{number}" for number in numbers)
                )

    except RuntimeError as error:
        print(f"ASA R0 GitHub state BLOCKED: {error}", file=sys.stderr)
        return 78

    if errors:
        print("ASA R0 GitHub state FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA R0 GitHub state PASS")
    print(f"- pull requests checked: {len(EXPECTED_PRS) + 1}")
    print(f"- issues checked: {len(EXPECTED_ISSUES)}")
    print(f"- PR34 foundation status: {foundation_decision.get('status')}")
    print("- transfer-only PRs: #35, #45, #47")
    print("- competing R1 candidates: #59, #60")
    print(f"- legacy executable task PR titles: 0 ({len(LEGACY_TASK_IDS)} task IDs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
