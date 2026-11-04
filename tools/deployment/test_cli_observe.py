"""Read-only filesystem, live-state and secret-boundary regressions."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import cli_observe as observe
from deployment.contracts import Blocked
from deployment.test_release_readonly import RELEASE


class ObservationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "installation"
        self.state = self.root / ".asa"
        self.state.mkdir(parents=True)
        self.config = {"format": "asa-setup-config-v1", "installationId": "c" * 32, "root": str(self.root),
                       "project": "asa-fixture", "profile": "production", "operatorUid": os.getuid() if hasattr(os, "getuid") else 1000,
                       "backup": {"policy": "best-effort", "cloud": {"enabled": False}, "schedule": {"enabled": False}},
                       "password": "NEVER_PRINT_THIS_SECRET", "token": "NEVER_PRINT_THIS_SECRET", "privateKey": "NEVER_PRINT_THIS_SECRET"}
        self.write("setup.json", self.config)
        self.write("installation.json", {"project": "asa-fixture", "profile": "production", "automaticUpdates": False})
        self.write("installed-release.json", RELEASE)
        self.reader = observe.Observer({"root": str(self.root), "project": "asa-fixture"})

    def write(self, name, value):
        path = self.state / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def tree(self):
        return {str(path.relative_to(self.root)): (path.stat().st_size, path.stat().st_mtime_ns,
                hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None) for path in self.root.rglob("*")}

    def containers(self, foreign=False, one=False):
        return [{"id": format(index, "064x"), "service": service, "project": "asa-fixture", "workingDir": "/other" if foreign else str(self.root),
                 "running": True, "health": "healthy", "mounts": [], "image": RELEASE["images"].get(service, "postgres:16")}
                for index, service in enumerate(("api",) if one else ("api", "web", "postgres", "minio", "scratch", "search"), 1)]

    def docker(self, rows):
        def probe(argv, **kwargs):
            if argv[:2] == ["docker", "ps"]:
                return {"status": "OK", "output": "\n".join(row["id"] for row in rows)}
            if argv[:2] == ["docker", "inspect"]:
                return {"status": "OK", "output": "\n".join(json.dumps(row) for row in rows)}
            if argv[:2] == ["docker", "exec"]:
                self.assertEqual(argv[3:6], ["sh", "-eu", "-c"])
                self.assertIn("default_transaction_read_only=on", argv[-1])
                return {"status": "OK", "output": "SET\n0304|1024"}
            return observe.unavailable("TOOL_OR_ACCESS")
        return probe

    def test_every_local_reader_leaves_tree_unchanged_even_when_tools_missing(self):
        before = self.tree()
        with patch.object(observe, "probe", return_value=observe.unavailable()), \
             patch.object(observe, "http_read", return_value=observe.unavailable()):
            for callback in (self.reader.status, lambda: self.reader.status(True), self.reader.services,
                             self.reader.disk, self.reader.disk_health, self.reader.backups,
                             lambda: self.reader.backups(True), self.reader.cloud, self.reader.history,
                             self.reader.logs, self.reader.configuration, self.reader.schedule):
                value = callback()
                self.assertIn("status", value)
                self.assertNotIn("NEVER_PRINT_THIS_SECRET", json.dumps(value))
            with self.assertRaises(Blocked):
                self.reader.backup_verify("20261104T010101Z-12345678")
        self.assertEqual(self.tree(), before)
        self.assertFalse((self.state / "operation.lock").exists())
        self.assertFalse((self.state / "setup-backups").exists())
        self.assertFalse((self.root / "backups").exists())

    def test_stale_accepted_receipt_cannot_make_unavailable_runtime_green(self):
        self.write("setup-last-successful.json", {"applicationAccepted": True, "observedAt": "2026-10-01T00:00:00+00:00", "operationId": "d" * 32})
        with patch.object(observe, "probe", return_value=observe.unavailable()):
            value = self.reader.status()
        self.assertEqual(value["status"], "UNAVAILABLE")
        self.assertEqual(value["database"]["status"], "UNAVAILABLE")

    def test_healthy_site_reporting_another_database_schema_is_not_green(self):
        with patch.object(self.reader, "services", return_value={"status": "OK"}), \
             patch.object(self.reader, "database", return_value={"status": "OK", "schema": 304}), \
             patch.object(self.reader, "site", return_value={"status": "OK", "revision": RELEASE["revision"], "reportedSchema": 305}), \
             patch.object(observe, "probe", return_value=observe.unavailable()):
            self.assertEqual(self.reader.status()["status"], "FAILED")

    def test_foreign_working_directory_or_one_healthy_container_is_not_healthy_installation(self):
        for rows in (self.containers(foreign=True), self.containers(one=True)):
            reader = observe.Observer({"root": str(self.root), "project": "asa-fixture"})
            with patch.object(observe, "probe", side_effect=self.docker(rows)):
                self.assertNotEqual(reader.services()["status"], "OK")

    def test_live_schema_and_image_pins_are_observed(self):
        with patch.object(observe, "probe", side_effect=self.docker(self.containers())):
            self.assertEqual(self.reader.containers()["status"], "OK")
            self.assertEqual(self.reader.database(), {"status": "OK", "schema": 304, "bytes": 1024})
        bad = self.containers()
        bad[0]["image"] = "ghcr.io/spikeal8-maker/asa-lab/api:stable"
        reader = observe.Observer({"root": str(self.root), "project": "asa-fixture"})
        with patch.object(observe, "probe", side_effect=self.docker(bad)):
            self.assertEqual(reader.containers()["status"], "FAILED")

    def test_backup_verifier_uses_existing_hash_validation_and_does_not_write(self):
        snapshot = "20261104T010101Z-12345678"
        folder = self.root / "backups" / snapshot
        folder.mkdir(parents=True)
        files = {}
        for name in ("database.dump", "globals.sql", "private.env"):
            content = ("private " + name).encode()
            (folder / name).write_bytes(content)
            files[name] = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        manifest = {"format": "asa-backup-v1", "complete": True, "snapshotId": snapshot,
                    "installationId": self.config["installationId"], "operationId": "d" * 32, "files": files}
        (folder / "manifest.json").write_text(json.dumps(manifest))
        receipt = {"format": "asa-backup-operation-v1", "snapshotId": snapshot, "installationId": self.config["installationId"],
                   "operationId": "d" * 32, "snapshotAt": "2026-11-04T01:01:01+00:00",
                   "local": {"status": "OK", "manifestSha256": hashlib.sha256((folder / "manifest.json").read_bytes()).hexdigest()}}
        self.write("setup-backups/" + snapshot + ".json", receipt)
        before = self.tree()
        value = self.reader.backup_verify(snapshot)
        self.assertEqual(value["status"], "OK")
        self.assertEqual(value["restore"], "UNVERIFIED")
        self.assertEqual(self.tree(), before)
        (folder / "database.dump").write_bytes(b"tampered")
        with self.assertRaises(Blocked):
            self.reader.backup_verify(snapshot)

    def test_attempt_and_last_successful_cloud_proof_are_separate(self):
        snapshot = "20261104T010101Z-12345678"
        proof = {"status": "OK", "verifiedAt": "2026-11-04T01:05:01+00:00"}
        self.write("setup-backups/" + snapshot + ".json", {"snapshotId": snapshot,
                   "installationId": self.config["installationId"], "snapshotAt": "2026-11-04T01:01:01+00:00",
                   "local": {"status": "OK"}, "cloud": {"status": "FAILED"}})
        self.write("setup-backups/last-attempt.json", {"snapshotId": snapshot})
        self.write("setup-backups/last-cloud-success.json", {"snapshotId": snapshot, "proof": proof})
        with patch.object(observe, "probe", return_value=observe.unavailable()):
            result = self.reader.backups()
        self.assertEqual(result["lastAttempt"]["cloud"]["status"], "FAILED")
        self.assertEqual(result["lastCloudSuccess"]["cloud"]["status"], "OK")
        self.assertEqual(result["lastCloudSuccess"]["cloud"]["evidenceScope"], "RECORDED_DELIVERY")

    def test_cloud_reader_never_constructs_mutating_transport(self):
        from deployment import backup_workflow
        with patch.object(backup_workflow, "CloudTransport", side_effect=AssertionError("writes forbidden")), \
             patch.object(observe, "probe", return_value=observe.unavailable()):
            value = self.reader.cloud()
        self.assertEqual(value["remote"]["status"], "UNAVAILABLE")

    def test_cloud_default_selects_existing_ciphertext_without_export_or_directories(self):
        before = self.tree()
        with self.assertRaises(Blocked):
            self.reader.delivery_snapshot()
        self.assertEqual(self.tree(), before)
        snapshot = "20261104T010101Z-12345678"
        target = self.root / "backups/encrypted" / ("asa-lab-" + snapshot + ".tar.age")
        target.parent.mkdir(parents=True)
        target.write_bytes(b"synthetic ciphertext")
        self.write("setup-backups/last-local-success.json", {"snapshotId": snapshot})
        self.write("setup-backups/" + snapshot + ".json", {"format": "asa-backup-operation-v1", "snapshotId": snapshot,
                   "installationId": self.config["installationId"], "local": {"status": "OK"},
                   "encryption": {"status": "OK", "path": str(target), "bytes": target.stat().st_size}})
        before = self.tree()
        self.assertEqual(self.reader.delivery_snapshot(), snapshot)
        self.assertEqual(self.tree(), before)
        target.unlink()
        with self.assertRaises(OSError):
            self.reader.delivery_snapshot()
        self.assertFalse(target.exists())

    def test_unavailable_smart_is_never_reported_ok(self):
        with patch.object(observe, "probe", return_value=observe.unavailable()):
            self.assertEqual(self.reader.disk_health()["status"], "UNAVAILABLE")

    def test_nonzero_smart_health_json_reports_disk_failure(self):
        measured = observe.probe([sys.executable, "-I", "-B", "-c",
            "import sys; print('{\"smart_status\":{\"passed\":false}}'); sys.exit(8)"], allow_nonzero=True)
        self.assertEqual(measured["returnCode"], 8)
        def probe(args, **kwargs):
            if args[0] == "lsblk":
                return {"status": "OK", "output": '{"blockdevices":[{"name":"sda","type":"disk"}]}'}
            self.assertTrue(kwargs["allow_nonzero"])
            return measured
        with patch.object(observe, "probe", side_effect=probe):
            result = self.reader.disk_health()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["devices"][0]["status"], "FAILED")

    def test_process_output_and_runtime_are_bounded_without_temporary_files(self):
        result = observe.probe([sys.executable, "-I", "-B", "-c", "print('X' * 100000)"], maximum=1024)
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertNotIn("output", result)
        result = observe.probe([sys.executable, "-I", "-B", "-c", "import time; time.sleep(2)"], timeout=.05)
        self.assertEqual(result["status"], "UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
