"""Synthetic runtime fault tests; does not touch Docker or user data."""

from contextlib import ExitStack
import errno
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup
from deployment.contracts import Blocked, verify_backup


class ManagedBackupHoldTests(unittest.TestCase):
    def fixture(self, directory, *, foreign=False, unknown=False, extra_writer=True, active=0, dump_failure=False,
                other_database_idle_admin=False):
        # Match Installation.root, including Windows temporary 8.3 aliases.
        root = Path(directory).resolve()
        (root / ".asa").mkdir(mode=0o700)
        (root / ".env").write_text("SYNTHETIC_SECRET=test\n")
        calls = []
        labels = {"com.docker.compose.project": "asa-test", "com.docker.compose.project.working_dir": str(root),
                  "com.docker.compose.project.config_files": ""}
        records = {}
        for name in ("postgres", "minio", "web", "api", "scratch", "search"):
            mounts = [{"Type": "volume", "Name": "synthetic-" + name,
                       "Destination": "/data" if name == "minio" else "/var/lib/postgresql/data"}] if name in ("postgres", "minio") else []
            records[name] = {"id": name + "-id", "labels": {**labels, "com.docker.compose.service": name},
                             "running": True, "image": "synthetic-" + name, "mounts": mounts}
        all_records = dict(records)
        if extra_writer:
            all_records["worker"] = {"id": "worker-id", "labels": {**labels, "com.docker.compose.service": "worker"},
                                      "running": True, "image": "synthetic-worker", "mounts": []}
        if foreign:
            all_records["foreign"] = {"id": "foreign-id", "labels": None, "running": True,
                                       "mounts": records["postgres"]["mounts"]}
        config = {"services": {name: {} for name in all_records if name != "foreign" and not (name == "worker" and unknown)}}
        runtime = {"revision": "a" * 40, "schema": 275}

        def compose(*args, **kwargs):
            calls.append(("compose", *args))
            if args[:3] == ("config", "--format", "json"):
                return json.dumps(config)
            if args[:1] == ("stop",):
                for name in args[1:]:
                    all_records[name]["running"] = False
            return ""

        def ready(*args):
            calls.append(("ready", *args))
            return runtime

        def run(args, **kwargs):
            calls.append(tuple(args))
            if args[:3] == ["docker", "ps", "-aq"]:
                return " ".join(record["id"] for record in all_records.values())
            if args[:2] == ["docker", "inspect"]:
                if args[3] == "{{.Image}}":
                    return "sha256:" + "d" * 64
                if args[3] == "{{.Id}} {{.State.Running}}":
                    return "\n".join(record["id"] + " " + str(record["running"]).lower()
                                     for record in all_records.values() if record["id"] in args[4:])
                if ".State.Health" in args[3]:
                    return "\n".join(json.dumps({"id": record["id"], "running": record["running"],
                                                 "health": record.get("health", "none")})
                                     for record in all_records.values() if record["id"] in args[4:])
                return "\n".join(json.dumps(record) for record in all_records.values())
            if args[:2] == ["docker", "cp"]:
                (Path(args[-1]) / "object").write_bytes(b"synthetic object")
                return ""
            if args[:2] == ["docker", "start"]:
                for record in all_records.values():
                    if record["id"] in args[2:]:
                        record["running"] = True
                return ""
            raise AssertionError(args)

        def db_command(install, command, **kwargs):
            if "pg_stat_activity" in command:
                # The previous current-database filter hid an idle privileged
                # session in postgres that can still mutate global roles.
                hidden = other_database_idle_admin and "datname=current_database()" not in command
                return str(active + int(hidden))
            if dump_failure:
                raise Blocked("TEST_DUMP_FAILURE", "Synthetic failure", "Inspect")
            kwargs["output"].write(b"synthetic dump or private role hashes")
            calls.append(("database", command))
            return ""

        def public_entry(origin, revision):
            calls.append(("public-entry", origin, revision))

        install = SimpleNamespace(root=root, state=root / ".asa",
                                  env={"ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
                                       "ASA_UPDATE_ENTRY_ORIGIN": "https://synthetic.invalid"},
                                  files=[], settings={}, project="asa-test", profile="production", identity=lambda: records,
                                  readiness=lambda: runtime, wait_ready=ready, compose=compose)
        patches = ExitStack()
        patches.enter_context(patch.object(backup, "run", side_effect=run))
        patches.enter_context(patch.object(backup, "db_command", side_effect=db_command))
        patches.enter_context(patch.object(backup, "privileges", return_value=[{"table": "synthetic", "rls": True}]))
        patches.enter_context(patch.object(backup, "verify_embedded_entry_http", side_effect=public_entry))
        # Kernel boot identity is an injected host boundary. The state-machine
        # tests run on Windows too and do not claim to observe a Linux kernel.
        patches.enter_context(patch.object(backup, "freeze_boot_id", return_value="synthetic-boot-id"))
        return install, all_records, calls, patches

    def export(self, install, hold=True):
        return backup.export_backup(install, snapshot_id="20261029T000000Z-abcdef12",
                                    installation_id="synthetic-installation", operation_id="a" * 32,
                                    hold_writers=hold, freeze_timeout_seconds=60)

    def test_snapshot_holds_every_running_writer_and_resumes_exact_containers(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            with patches:
                target = self.export(install)
                manifest = verify_backup(target)
                self.assertEqual(manifest["installationId"], "synthetic-installation")
                self.assertTrue(manifest["roleCredentialsIncluded"])
                self.assertEqual(manifest["dataIdentity"]["postgres"][0]["name"], "synthetic-postgres")
                hold = backup.consume_backup_hold(install, "a" * 32)
                self.assertIn("worker", hold["containers"])
                self.assertIn("search", hold["containers"])
                self.assertNotIn("postgres", hold["containers"])
                self.assertFalse(records["worker"]["running"])
                self.assertFalse(any(call[:2] == ("docker", "start") for call in calls))
                result = backup.resume_backup_writers(install, "a" * 32)
                self.assertTrue(result["previousRuntimeVerified"])
                self.assertTrue(result["publicEntryVerified"])
                self.assertIn(("public-entry", "https://synthetic.invalid", "a" * 40), calls)
                self.assertTrue(records["worker"]["running"])
                self.assertFalse((install.state / "maintenance.json").exists())
                self.assertFalse(any("--no-role-passwords" in call[-1] for call in calls if call[0] == "database"))

    def test_crashed_or_unhealthy_additional_writer_preserves_rescue_journal(self):
        for state, code in (({"running": False}, "BACKUP_RESUME_WRITERS"),
                            ({"health": "unhealthy"}, "BACKUP_RESUME_HEALTH")):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as directory:
                install, records, calls, patches = self.fixture(directory)
                with patches:
                    self.export(install)
                    real_ready = install.wait_ready

                    def ready(*args):
                        result = real_ready(*args)
                        records["worker"].update(state)
                        return result

                    with patch.object(install, "wait_ready", side_effect=ready), self.assertRaises(Blocked) as problem:
                        backup.resume_backup_writers(install, "a" * 32)
                    self.assertEqual(problem.exception.code, code)
                    self.assertTrue((install.state / "maintenance.json").is_file())
                    self.assertFalse(any(call[0] == "public-entry" for call in calls))
                    self.assertFalse(any(call[:2] == ("compose", "up") for call in calls))

    def test_starting_writer_gets_bounded_wait_without_recreation(self):
        for becomes_healthy in (True, False):
            with self.subTest(healthy=becomes_healthy), tempfile.TemporaryDirectory() as directory:
                install, records, calls, patches = self.fixture(directory)
                with patches:
                    self.export(install)
                    records["worker"]["health"] = "starting"
                    clock = {"now": 1000.0}

                    def sleep(seconds):
                        self.assertLessEqual(seconds, 1)
                        clock["now"] += seconds if becomes_healthy else 90
                        if becomes_healthy:
                            records["worker"]["health"] = "healthy"

                    with patch.object(backup.time, "monotonic", side_effect=lambda: clock["now"]), \
                            patch.object(backup.time, "sleep", side_effect=sleep):
                        if becomes_healthy:
                            result = backup.resume_backup_writers(install, "a" * 32)
                            self.assertTrue(result["previousRuntimeVerified"])
                        else:
                            with self.assertRaises(Blocked) as problem:
                                backup.resume_backup_writers(install, "a" * 32)
                            self.assertEqual(problem.exception.code, "BACKUP_RESUME_TIMEOUT")
                    self.assertEqual((install.state / "maintenance.json").exists(), not becomes_healthy)
                    self.assertEqual(sum(call[:2] == ("docker", "start") for call in calls), 1)

    def test_public_entry_failure_preserves_journal_until_verified_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            with patches:
                self.export(install)
                with patch.object(backup, "verify_embedded_entry_http",
                                  side_effect=Blocked("EDITOR_ENTRY_HTTP", "Synthetic public entry failure", "Inspect")), \
                        self.assertRaises(Blocked) as problem:
                    backup.resume_backup_writers(install, "a" * 32)
                self.assertEqual(problem.exception.code, "EDITOR_ENTRY_HTTP")
                self.assertTrue((install.state / "maintenance.json").is_file())
                self.assertTrue(all(record["running"] for record in records.values()))
                result = backup.resume_backup_writers(install, "a" * 32)
                self.assertTrue(result["publicEntryVerified"])
                self.assertFalse((install.state / "maintenance.json").exists())

    def test_missing_public_origin_does_not_claim_public_availability(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            del install.env["ASA_UPDATE_ENTRY_ORIGIN"]
            with patches:
                self.export(install)
                result = backup.resume_backup_writers(install, "a" * 32)
            self.assertTrue(result["previousRuntimeVerified"])
            self.assertFalse(result["publicEntryVerified"])
            self.assertFalse(any(call[0] == "public-entry" for call in calls))

    def test_dump_failure_restores_previous_services_and_preserves_incomplete_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory, dump_failure=True)
            with patches, self.assertRaises(Blocked) as problem:
                self.export(install)
            self.assertEqual(problem.exception.code, "TEST_DUMP_FAILURE")
            self.assertTrue(records["worker"]["running"])
            self.assertTrue((install.root / "backups/20261029T000000Z-abcdef12.incomplete").exists())
            self.assertFalse((install.state / "maintenance.json").exists())

    @unittest.skipIf(os.name == "nt", "Directory fsync is a POSIX durability boundary")
    def test_hold_parent_is_durable_before_stop_and_unlink_is_durable_after_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            real_fsync = os.fsync
            state_info = install.state.stat()

            def fsync(descriptor):
                info = os.fstat(descriptor)
                real_fsync(descriptor)
                if (info.st_dev, info.st_ino) == (state_info.st_dev, state_info.st_ino):
                    marker = install.state / "maintenance.json"
                    phase = json.loads(marker.read_text())["phase"] if marker.exists() else "unlinked"
                    calls.append(("durable-hold-parent", phase))

            with patches, patch.object(backup.os, "fsync", side_effect=fsync):
                self.export(install)
                first_stop = next(index for index, call in enumerate(calls) if call[:2] == ("compose", "stop"))
                self.assertLess(calls.index(("durable-hold-parent", "backup")), first_stop)
                self.assertIn(("durable-hold-parent", "backup-held"), calls)
                backup.resume_backup_writers(install, "a" * 32)
                ready = next(index for index, call in enumerate(calls) if call[0] == "ready")
                self.assertGreater(calls.index(("durable-hold-parent", "unlinked")), ready)

    def test_snapshot_fsync_eio_preserves_partial_and_restores_exact_writers(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            partial = install.root / "backups/20261029T000000Z-abcdef12.incomplete"
            final = partial.with_name("20261029T000000Z-abcdef12")
            real_fsync = os.fsync
            failed = False

            def fsync(descriptor):
                nonlocal failed
                dump = partial / "database.dump"
                if dump.exists() and not failed:
                    info, expected = os.fstat(descriptor), dump.stat()
                    if (info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino):
                        failed = True
                        raise OSError(errno.EIO, "Synthetic snapshot flush failure")
                real_fsync(descriptor)

            with patches, patch.object(backup.os, "fsync", side_effect=fsync), self.assertRaises(OSError) as problem:
                self.export(install)
            self.assertEqual(problem.exception.errno, errno.EIO)
            self.assertTrue(failed)
            self.assertFalse(final.exists())
            self.assertTrue((partial / "database.dump").is_file())
            self.assertTrue(all(record["running"] for record in records.values()))
            started = next(call[2:] for call in calls if call[:2] == ("docker", "start"))
            self.assertEqual(set(started), {record["id"] for name, record in records.items() if name != "postgres"})
            self.assertFalse((install.state / "maintenance.json").exists())

    def test_publication_or_final_hold_sync_failure_unpublishes_and_resumes(self):
        for failed_stage in ("snapshot-parent", "held-marker"):
            with self.subTest(stage=failed_stage), tempfile.TemporaryDirectory() as directory:
                install, records, calls, patches = self.fixture(directory)
                parent = install.root / "backups"
                final = parent / "20261029T000000Z-abcdef12"
                real_sync_directory = backup._sync_directory
                failed = False

                def sync_directory(path, deadline=None):
                    nonlocal failed
                    marker = install.state / "maintenance.json"
                    held = marker.exists() and json.loads(marker.read_text())["phase"] == "backup-held"
                    selected = (failed_stage == "snapshot-parent" and Path(path) == parent
                                or failed_stage == "held-marker" and Path(path) == install.state and held)
                    if final.exists() and selected and not failed:
                        failed = True
                        raise OSError(errno.EIO, "Synthetic publication flush failure")
                    return real_sync_directory(path, deadline)

                with patches, patch.object(backup, "_sync_directory", side_effect=sync_directory), self.assertRaises(OSError) as problem:
                    self.export(install)
                self.assertEqual(problem.exception.errno, errno.EIO)
                self.assertTrue(failed)
                self.assertFalse(final.exists())
                self.assertTrue(final.with_name(final.name + ".incomplete").is_dir())
                self.assertTrue(all(record["running"] for record in records.values()))
                self.assertFalse((install.state / "maintenance.json").exists())

    def test_snapshot_flush_uses_original_deadline_and_resumes_after_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            partial = install.root / "backups/20261029T000000Z-abcdef12.incomplete"
            real_fsync = os.fsync
            clock = {"now": 1000.0}

            def fsync(descriptor):
                real_fsync(descriptor)
                dump = partial / "database.dump"
                if dump.exists():
                    info, expected = os.fstat(descriptor), dump.stat()
                    if (info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino):
                        clock["now"] += 61

            with patches, patch.object(backup.time, "monotonic", side_effect=lambda: clock["now"]), \
                    patch.object(backup.os, "fsync", side_effect=fsync), self.assertRaises(Blocked) as problem:
                self.export(install)
            self.assertEqual(problem.exception.code, "BACKUP_FREEZE_TIMEOUT")
            self.assertFalse(partial.with_name("20261029T000000Z-abcdef12").exists())
            self.assertTrue(partial.is_dir())
            self.assertTrue(all(record["running"] for record in records.values()))
            self.assertFalse((install.state / "maintenance.json").exists())

    def test_shared_unlabelled_container_and_unknown_writer_block_before_stop(self):
        for flags, code in (({"foreign": True}, "BACKUP_SHARED_VOLUME"), ({"unknown": True}, "BACKUP_UNKNOWN_WRITER")):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as directory:
                install, records, calls, patches = self.fixture(directory, **flags)
                with patches, self.assertRaises(Blocked) as problem:
                    self.export(install)
                self.assertEqual(problem.exception.code, code)
                self.assertFalse(any(call[:2] == ("compose", "stop") for call in calls))
                self.assertTrue(records["api"]["running"])

    def test_external_database_sessions_block_snapshot_and_restore_services(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory, active=1)
            with patches, self.assertRaises(Blocked) as problem:
                self.export(install)
            self.assertEqual(problem.exception.code, "BACKUP_EXTERNAL_WRITERS")
            self.assertFalse(any(call[0] == "database" for call in calls))
            self.assertTrue(records["api"]["running"])

    def test_idle_admin_in_other_database_blocks_global_role_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory, other_database_idle_admin=True)
            with patches, self.assertRaises(Blocked) as problem:
                self.export(install)
            self.assertEqual(problem.exception.code, "BACKUP_EXTERNAL_WRITERS")
            self.assertFalse(any(call[0] == "database" for call in calls))
            self.assertTrue(records["api"]["running"])
            self.assertTrue(records["worker"]["running"])

    def test_resumed_writer_or_expired_deadline_cannot_be_consumed_for_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            with patches:
                self.export(install)
                records["worker"]["running"] = True
                with self.assertRaises(Blocked) as problem:
                    backup.consume_backup_hold(install, "a" * 32)
                self.assertEqual(problem.exception.code, "BACKUP_WRITERS_RESUMED")
                records["worker"]["running"] = False
                marker = install.state / "maintenance.json"
                value = json.loads(marker.read_text())
                value["deadlineEpoch"] = 0
                marker.write_text(json.dumps(value))
                with self.assertRaises(Blocked) as problem:
                    backup.consume_backup_hold(install, "a" * 32)
                self.assertEqual(problem.exception.code, "BACKUP_FREEZE_TIMEOUT")
                backup.resume_backup_writers(install, "a" * 32)

    def test_reboot_or_monotonic_expiry_invalidates_hold_even_with_future_wall_clock(self):
        with tempfile.TemporaryDirectory() as directory:
            install, records, calls, patches = self.fixture(directory)
            with patches:
                self.export(install)
                with patch.object(backup, "freeze_boot_id", return_value="a-different-boot"), self.assertRaises(Blocked) as problem:
                    backup.consume_backup_hold(install, "a" * 32)
                self.assertEqual(problem.exception.code, "BACKUP_FREEZE_INTERRUPTED")
                marker = install.state / "maintenance.json"
                value = json.loads(marker.read_text())
                value["deadlineMonotonic"] = 0
                marker.write_text(json.dumps(value))
                with self.assertRaises(Blocked) as problem:
                    backup.consume_backup_hold(install, "a" * 32)
                self.assertEqual(problem.exception.code, "BACKUP_FREEZE_TIMEOUT")
                backup.resume_backup_writers(install, "a" * 32)


if __name__ == "__main__":
    unittest.main()
