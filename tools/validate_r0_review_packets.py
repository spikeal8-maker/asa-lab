#!/usr/bin/env python3
"""Validate the two owner decision packets required by R0 convergence."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION = ROOT / "docs/delivery/R0_FOUNDATION_REVIEW_PR34.md"
R1_SELECTION = ROOT / "docs/delivery/R0_R1_CANDIDATE_SELECTION.md"


def read(path: Path) -> str:
    if not path.is_file():
        raise ValueError(f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require(text: str, marker: str, source: str) -> None:
    if marker not in text:
        raise ValueError(f"{source} misses required marker: {marker}")


def main() -> int:
    try:
        foundation = read(FOUNDATION)
        for marker in (
            "PR №34",
            "ограниченный foundation candidate",
            "Personal Electronics project не требует Classroom",
            "не завершённая Tinkercad",
            "OWNER FOUNDATION DECISION: ACCEPTED",
            "Parity completion: NOT CLAIMED",
            "порт `5173`",
        ):
            require(foundation, marker, FOUNDATION.name)

        for forbidden in (
            "PR №34 автоматически merge",
            "полная Tinkercad parity достигнута",
        ):
            if forbidden in foundation:
                raise ValueError(f"{FOUNDATION.name} contains forbidden claim: {forbidden}")

        selection = read(R1_SELECTION)
        for marker in (
            "PR №59",
            "PR №60",
            "sessions_v2",
            "Рекомендуемый базовый кандидат: PR №60",
            "PR №59 не выбрасывается",
            "join-class controllers",
            "R1 CANDIDATE DECISION: PR #60 SELECTED",
            "Ни №59, ни №60 не merge",
        ):
            require(selection, marker, R1_SELECTION.name)

        if "PR №59 и PR №60 одновременно" in selection:
            raise ValueError("selection packet must not permit parallel R1 candidates")
        if "автоматически merge PR №60" in selection:
            raise ValueError("selection recommendation must not become automatic merge")

        if selection.index("R0B integration") > selection.index("R1 CANDIDATE DECISION"):
            raise ValueError("selection procedure must precede the decision record")

    except (OSError, ValueError) as error:
        print(f"ASA R0 review packets FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 review packets PASS")
    print("- PR 34 foundation scope: explicit")
    print("- PR 59/60 comparison: explicit")
    print("- recommended R1 base: PR 60, owner decision still required")
    print("- automatic merge: forbidden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
