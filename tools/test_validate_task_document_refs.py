#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "validate_task_document_refs.py"
SPEC = importlib.util.spec_from_file_location("validate_task_document_refs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def write_yaml(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def fixture(root: Path, revision: str = "1.3", include_refs: bool = True) -> None:
    write_yaml(
        root / MODULE.REGISTRY,
        {
            "strict_task_scopes": ["learning"],
            "documents": [
                {
                    "id": "LEARNING-TARGET",
                    "status": "canonical",
                    "revision": "1.3",
                    "lanes": ["learning"],
                }
            ],
        },
    )
    task = {"id": "TASK-LRN-COURSE-001"}
    if include_refs:
        task["normative_refs"] = [
            {"document": "LEARNING-TARGET", "revision": revision}
        ]
    write_yaml(
        root / MODULE.CURRENT,
        {
            "task": {"id": "TASK-PRIMARY-001"},
            "primary_lane": {"id": "admin-auth"},
            "parallel_lanes": [{"id": "learning", "task": task}],
        },
    )


class TaskDocumentRefsTests(unittest.TestCase):
    def test_exact_revision_passes(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            self.assertEqual(MODULE.validate(root), [])

    def test_stale_revision_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root, revision="1.2")
            errors = MODULE.validate(root)
            self.assertTrue(any("revision drift" in item for item in errors))

    def test_strict_lane_without_refs_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root, include_refs=False)
            errors = MODULE.validate(root)
            self.assertIn("lane learning must declare normative_refs", errors)

    def test_unknown_document_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            current = yaml.safe_load((root / MODULE.CURRENT).read_text(encoding="utf-8"))
            current["parallel_lanes"][0]["task"]["normative_refs"][0]["document"] = "UNKNOWN"
            write_yaml(root / MODULE.CURRENT, current)
            errors = MODULE.validate(root)
            self.assertTrue(any("unknown document UNKNOWN" in item for item in errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
