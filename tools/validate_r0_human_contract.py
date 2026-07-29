#!/usr/bin/env python3
"""Validate the concise owner-gated human R0-R10 contract."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md"
CURRENT_STATE = ROOT / "docs/delivery/R0_CONVERGENCE_CURRENT_STATE.md"
OWNER_DECISION = ROOT / "docs/delivery/R0_OWNER_DECISION.md"

RELEASE_ISSUES = {
    "R0": 36,
    "R1": 48,
    "R2": 62,
    "R3": 37,
    "R4": 63,
    "R5": 40,
    "R6": 64,
    "R7": 38,
    "R8": 39,
    "R9": 41,
    "R10": 42,
}


def read(path: Path) -> str:
    if not path.is_file():
        raise ValueError(f"missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require(text: str, marker: str, source: str) -> None:
    if marker not in text:
        raise ValueError(f"{source} misses required marker: {marker}")


def main() -> int:
    try:
        contract = read(CONTRACT)
        current_state = read(CURRENT_STATE)
        owner = read(OWNER_DECISION)

        for marker in (
            "owner_review_required",
            "Current gate:** `R0`",
            "Product coding до активации:** запрещён",
            "one accepted baseline",
            "не создавать новые long-lived stacked product branches",
            "PR #59 ИЛИ PR #60",
            "python tools/validate_r0.py",
        ):
            require(contract, marker, CONTRACT.name)

        for release_id, issue in RELEASE_ISSUES.items():
            require(contract, f"Release {release_id}", CONTRACT.name)
            require(contract, f"**Issue:** №{issue}", CONTRACT.name)

        if contract.count("**Статус:** `in_review`") != 1:
            raise ValueError("human contract must contain exactly one in_review release (R0)")
        if contract.count("**Статус:** `blocked`") != 10:
            raise ValueError("human contract must contain exactly ten blocked releases (R1-R10)")

        for marker in (
            "PR №35/№45/№47",
            "PR №59/№60",
            "Issue №24",
            "Product coding",
            "OWNER DECISION: APPROVED",
        ):
            require(current_state, marker, CURRENT_STATE.name)

        for number in range(1, 6):
            require(owner, f"## Решение {number}.", OWNER_DECISION.name)
        require(owner, "Convergence order: accepted", OWNER_DECISION.name)

        forbidden_claims = (
            "R1 = ready",
            "TASK-PROJECT-SHELL-001 = ready",
            "product coding = allowed",
        )
        for claim in forbidden_claims:
            if claim in contract or claim in current_state:
                raise ValueError(f"R0 documents contain forbidden activation claim: {claim}")

    except (OSError, ValueError) as error:
        print(f"ASA R0 human contract FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 human contract PASS")
    print("- releases: R0-R10")
    print("- active gate: R0 only")
    print("- future releases blocked: 10")
    print("- owner decisions present: 5")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
