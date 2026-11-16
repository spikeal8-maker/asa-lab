"""Regression: production ASA state and rollback receipts must be private on POSIX.

The canonical manager is run by a normal Linux account whose umask may be 0002.
All private state must remain 0600 even after atomic replacement.
"""
from __future__ import annotations

import ast
from collections import Counter
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.paths import atomic_json as secure_atomic_json
from deployment.system import Installation


class StatePermissions(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "requires POSIX umask/permission semantics")
    def test_manager_private_state_writer_with_umask_0002_and_0022(self):
        names = (
            "runtime-configuration.json", "maintenance.json", "installed-release.json",
            "failed-switch.json", "release-selection.json", "installation.json"
        )
        for mask in (0o002, 0o022, 0o077):
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / ".asa"
                state.mkdir(mode=0o700)
                previous = os.umask(mask)
                try:
                    for name in names:
                        path = state / name
                        path.write_text('{"previous":true}\n', encoding="utf-8")
                        path.chmod(0o664)
                        asa_manager.private_atomic_json(path, {"ok": True})
                        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, name)
                        self.assertEqual(path.stat().st_uid, os.geteuid(), name)
                        asa_manager.private_atomic_json(path, {"ok": False})
                        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, name)
                        self.assertEqual(path.read_text(encoding="utf-8").count("false"), 1)
                    self.assertEqual(list(state.glob(".*.tmp")), [])
                finally:
                    os.umask(previous)

    @unittest.skipUnless(os.name == "posix", "requires POSIX umask/permission semantics")
    def test_actual_installation_receipt_with_permissive_umask(self):
        for mask in (0o002, 0o022, 0o077):
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                state = root / ".asa"
                state.mkdir(mode=0o700)
                receipt = state / "last-operation.json"
                receipt.write_text('{"old":true}\n', encoding="utf-8")
                receipt.chmod(0o664)
                install = SimpleNamespace(root=root, state=state)
                previous = os.umask(mask)
                try:
                    with mock.patch("deployment.operational.append_safely") as append, \
                            mock.patch("deployment.operational.from_manager_receipt", return_value={"validated": True}):
                        Installation.receipt(install, {"status": "success", "phase": "verify_entry"})
                        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)
                        self.assertEqual(receipt.stat().st_uid, os.geteuid())
                        self.assertIn('"status": "success"', receipt.read_text())
                        self.assertIn('"phase": "verify_entry"', receipt.read_text())
                        append.assert_called_once()
                        Installation.receipt(install, {"status": "failed"})
                        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)
                        self.assertIn('"status": "failed"', receipt.read_text())
                finally:
                    os.umask(previous)

    def test_private_state_call_sites_do_not_use_unsafe_writer(self):
        root = Path(__file__).resolve().parents[1]
        expected = Counter({
            "runtime-configuration.json": 1,
            "maintenance.json": 2,
            "installed-release.json": 1,
            "failed-switch.json": 1,
        })
        manager = ast.parse((root / "asa_manager.py").read_text(encoding="utf-8"))
        observed = Counter()
        for node in ast.walk(manager):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id not in ("atomic_json", "private_atomic_json") or not node.args:
                continue
            arg = node.args[0]
            if not isinstance(arg, ast.BinOp) or not isinstance(arg.op, ast.Div):
                continue
            if isinstance(arg.right, ast.Constant) and isinstance(arg.right.value, str):
                if arg.right.value in expected:
                    self.assertEqual(node.func.id, "private_atomic_json", arg.right.value)
                    observed[arg.right.value] += 1
        self.assertEqual(observed, expected)
        system = ast.parse((root / "deployment" / "system.py").read_text(encoding="utf-8"))
        calls = []
        for node in ast.walk(system):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id not in ("atomic_json", "private_atomic_json") or not node.args:
                continue
            arg = node.args[0]
            if isinstance(arg, ast.BinOp) and isinstance(arg.right, ast.Constant):
                if arg.right.value == "last-operation.json":
                    calls.append(node.func.id)
        self.assertEqual(calls, ["private_atomic_json"])

    @unittest.skipUnless(os.name == "posix", "requires POSIX file semantics")
    def test_private_atomic_replace_failure_preserves_previous_state(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "last-operation.json"
            old = b'{"protected":"existing"}\n'
            target.write_bytes(old)
            target.chmod(0o600)
            with mock.patch("deployment.paths.os.replace", side_effect=OSError("test failure")):
                with self.assertRaises(OSError):
                    secure_atomic_json(target, {"status": "new"})
            self.assertEqual(target.read_bytes(), old)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(list(Path(directory).glob(".*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
