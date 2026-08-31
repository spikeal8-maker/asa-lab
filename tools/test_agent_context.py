#!/usr/bin/env python3
"""Regression tests for the compact lane context command."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("agent_context", HERE / "agent_context.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def fixture(root: Path) -> dict:
    (root / "docs/product/electronics").mkdir(parents=True)
    (root / "docs/product/electronics/README.md").write_text(
        "# Electronics\n\n### MATH-10 — meters\n\nContract.\n", encoding="utf-8"
    )
    (root / "AGENTS.md").write_text("policy", encoding="utf-8")
    return {
        "development_policy": {"mode": "direct_main"},
        "task": {
            "id": "TASK-PRIMARY-001",
            "issue": 1,
            "status": "in_progress",
            "checkpoint": "primary_checkpoint",
            "owner_acceptance": "pending",
            "branch": "main",
            "base_branch": "main",
            "pr": None,
        },
        "revisions": {"head_sha": "a" * 40},
        "gates": {"focused": {"commands": ["pnpm gate:primary"]}},
        "primary_lane": {"id": "primary", "owned_paths": ["contexts/primary/**"]},
        "parallel_lanes": [
            {
                "id": "electronics",
                "owned_paths": ["docs/product/electronics/**"],
                "task": {
                    "id": "TASK-ELECTRONICS-DOCS-001",
                    "issue": 63,
                    "status": "in_progress",
                    "checkpoint": "math_10a3_meter",
                    "owner_acceptance": "pending",
                    "branch": "main",
                    "base_branch": "main",
                    "pr": None,
                },
                "revisions": {"head_sha": "b" * 40},
                "gates": {"focused": {"commands": ["pnpm gate:electronics-m1"]}},
            }
        ],
        "integration": {"shared_paths": ["AGENTS.md"]},
        "blocking": [],
    }


def main() -> int:
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        document = fixture(root)
        path = root / "docs/execution/current.yaml"
        path.parent.mkdir(parents=True)
        path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
        lanes = MODULE.collect_lanes(document)
        if [lane["id"] for lane in lanes] != ["primary", "electronics"]:
            failures.append("primary and parallel lanes were not collected in order")
        electronics = MODULE.build_context(root, document, lanes[1])
        rendered = MODULE.render_text(electronics)
        for marker in (
            "scope: electronics",
            "task: TASK-ELECTRONICS-DOCS-001",
            "docs/product/electronics/README.md:3",
            "pnpm gate:electronics-m1",
        ):
            if marker not in rendered:
                failures.append(f"selected context misses {marker!r}")
        if "TASK-PRIMARY-001" in rendered:
            failures.append("selected lane leaks another lane task id")
        errors = MODULE.validate_all(root, document)
        failures.extend(errors)

    if failures:
        print("ASA Lab agent context tests: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("ASA Lab agent context tests: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
