"""Fault/contract tests on synthetic files; not Docker/cloud restore evidence."""

from contextlib import ExitStack
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup, backup_schedule as schedule, backup_workflow as flow
from deployment.contracts import Blocked, inventory_files, verify_backup
from deployment.paths import atomic_json


ID = "synthetic-installation"
OP = "a" * 32
SNAP = "20261029T000000Z-abcdef12"
RECIPIENT = "age1" + "a" * 58  # Invalid cryptographic checksum; AGE itself is mocked.


def fake_install(directory):
    root = Path(directory)
    state = root / ".asa"
    state.mkdir(mode=0o700)
    return SimpleNamespace(root=root, state=state, settings={}, profile="production", project="asa-synthetic")


def snapshot(install, snap=SNAP, operation=OP, at="2026-10-29T00:00:00+00:00"):
    parent = flow.private_directory(install.root / "backups")
    target = parent / snap
    target.mkdir(mode=0o700)
    (target / "objects").mkdir()
    for name, value in {"database.dump": b"synthetic-database", "globals.sql": b"synthetic-roles",
                        "private.env": b"SYNTHETIC_PRIVATE=test\n", "objects/file": b"synthetic-object"}.items():
        (target / name).write_bytes(value)
    manifest = {"format": "asa-backup-v1", "complete": True, "installationId": ID, "operationId": operation,
                "snapshotId": snap, "snapshotAt": at, "files": inventory_files(target)}
    atomic_json(target / "manifest.json", manifest)
    return target


def receipt(install, snap=SNAP, operation=OP, at="2026-10-29T00:00:00+00:00", cloud=False):
    target = snapshot(install, snap, operation, at)
    value = {"format": "asa-backup-operation-v1", "installationId": ID, "operationId": operation,
             "snapshotId": snap, "snapshotAt": at, "local": {"status": "OK", "path": str(target),
             "manifestSha256": flow.file_hash(target / "manifest.json")}, "encryption": {"status": "PENDING"},
             "cloud": {"status": "PENDING"}, "restore": {"status": "UNVERIFIED"}, "writers": {"held": False},
             "policy": "best-effort", "cloudConfigured": cloud, "errors": [], "outcome": "PENDING"}
    flow._save(install, value)
    return value


def fake_age(args, **kwargs):
    assert args[0] == "age"
    output = Path(args[args.index("--output") + 1])
    # This fixture is a process-boundary test, never evidence of AGE security.
    output.write_bytes(b"age-encryption.org/v1\n" + hashlib.sha256(Path(args[-1]).read_bytes()).digest())


class MemoryCloud(flow.CloudTransport):
    def __init__(self):
        self.deadline = None
        self.transport = SimpleNamespace(archive_name=lambda value: value)
        self.project = flow.cloud_project(ID)
        self.remote = "yandex:Server-Backups/" + self.project
        self.container = "synthetic-rclone"
        self.base = "/data/" + self.project
        self.objects = {}
        self.spool = {}
        self.commands = []

    def call(self, *args):
        self.commands.append(args)
        command = args[0]
        if command == "mkdir":
            return ""
        if command == "lsjson":
            return json.dumps([{"Name": key.rsplit("/", 1)[1]} for key in self.objects])
        if command == "copyto":
            source, target = args[1:3]
            data = self.spool[source] if source.startswith("/data/") else self.objects[source]
            destination = self.spool if target.startswith("/data/") else self.objects
            if target in destination and destination[target] != data:
                raise Blocked("CLOUD_IMMUTABLE", "conflict", "Inspect")
            destination[target] = data
            return ""
        if command == "moveto":
            source, target = args[1:3]
            if target in self.objects and self.objects[target] != self.objects[source]:
                raise Blocked("CLOUD_IMMUTABLE", "conflict", "Inspect")
            self.objects[target] = self.objects.pop(source)
            return ""
        if command == "deletefile":
            self.objects.pop(args[1])
            return ""
        raise AssertionError(args)

    def _exec(self, *args, source=None, output=None):
        if args[0] == "sh":
            self.spool[args[-1]] = source.read()
            return b""
        if args[0] == "sha256sum":
            return (hashlib.sha256(self.spool[args[1]]).hexdigest() + "  file\n").encode()
        if args[0] == "cat":
            output.write(self.spool[args[1]])
            return None
        raise AssertionError(args)


class BackupWorkflowTests(unittest.TestCase):
    def test_policy_never_uses_legacy_shared_archive_namespace(self):
        policy = flow.validate_policy({"policy": "required", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}}, ID)
        self.assertEqual(policy["cloud"]["project"], "asa-" + ID)
        for bad in ("asa-lab", "../target", "yandex:ASA-Backups"):
            with self.assertRaises(Blocked):
                flow.validate_policy({"policy": "best-effort", "cloud": {"project": bad}}, ID)
        for keep in (0, -1, True, "1"):
            with self.assertRaises(Blocked):
                flow.validate_policy({"policy": "required", "retention": {"localKeep": keep}}, ID)

    def test_saved_ciphertext_is_immutable_and_retry_does_not_reencrypt(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age) as encrypt:
                target = flow.encrypt_snapshot(install, value, RECIPIENT)
                first = target.read_bytes()
                flow.encrypt_snapshot(install, value, RECIPIENT)
                self.assertEqual(encrypt.call_count, 1)
            self.assertEqual(target.read_bytes(), first)
            if os.name != "nt":
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with patch.object(flow, "_deliver") as deliver, patch.object(flow, "export_backup") as export, patch.object(flow, "encrypt_snapshot") as encrypt:
                flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID,
                                    policy={"policy": "best-effort", "cloud": {"enabled": False}})
                deliver.assert_called_once()
                export.assert_not_called()
                encrypt.assert_not_called()
            corrupted = first[:-1] + bytes([first[-1] ^ 1])
            self.assertNotEqual(corrupted, first)
            self.assertEqual(len(corrupted), len(first))
            target.write_bytes(corrupted)
            with self.assertRaisesRegex(Blocked, "ciphertext"):
                flow.encrypt_snapshot(install, value, RECIPIENT)

    def test_real_file_integrity_is_checked_before_encryption(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            (Path(value["local"]["path"]) / "objects/file").write_bytes(b"changed")
            with patch.object(flow, "_command") as command, self.assertRaises(Blocked) as problem:
                flow.encrypt_snapshot(install, value, RECIPIENT)
            self.assertEqual(problem.exception.code, "BACKUP_HASH")
            command.assert_not_called()

    def test_read_only_receipt_refresh_observes_delivery_without_new_backup_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install, cloud=True)
            with patch.object(flow, "_command", side_effect=fake_age):
                flow.encrypt_snapshot(install, value, RECIPIENT)
            value["cloud"] = {"status": "FAILED", "error": "SYNTHETIC_NETWORK_FAILURE"}
            flow._save(install, value)
            before = flow.verify_receipt(install, snapshot_id=SNAP, installation_id=ID)
            self.assertEqual(before["cloud"]["status"], "FAILED")
            value["cloud"] = {"status": "OK", "namespace": flow.cloud_project(ID),
                "remote": "yandex:Server-Backups/" + flow.cloud_project(ID) + "/asa-lab-" + SNAP + ".tar.age",
                "sha256": value["encryption"]["sha256"], "bytes": value["encryption"]["bytes"],
                "verification": "independent-ciphertext-readback-sha256", "verifiedAt": flow.now()}
            flow._save(install, value)
            with patch.object(flow, "_command") as command, patch.object(flow, "export_backup") as export, \
                    patch.object(flow, "CloudTransport") as transport:
                refreshed = flow.verify_receipt(install, snapshot_id=SNAP, installation_id=ID)
                self.assertEqual(refreshed["cloud"]["status"], "OK")
                command.assert_not_called()
                export.assert_not_called()
                transport.assert_not_called()
            value["cloud"]["namespace"] = "asa-another-installation"
            flow._save(install, value)
            with self.assertRaises(Blocked) as caught:
                flow.verify_receipt(install, snapshot_id=SNAP, installation_id=ID)
            self.assertEqual(caught.exception.code, "BACKUP_CLOUD_PROOF")

    def test_read_only_receipt_rejects_same_length_ciphertext_and_local_snapshot_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                target = flow.encrypt_snapshot(install, value, RECIPIENT)
            original = target.read_bytes()
            target.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with self.assertRaises(Blocked) as caught:
                flow.verify_receipt(install, snapshot_id=SNAP, installation_id=ID)
            self.assertEqual(caught.exception.code, "BACKUP_CIPHERTEXT_DRIFT")
            target.write_bytes(original)
            (Path(value["local"]["path"]) / "objects/file").write_bytes(b"tampered object")
            with self.assertRaises(Blocked) as caught:
                flow.verify_receipt(install, snapshot_id=SNAP, installation_id=ID)
            self.assertEqual(caught.exception.code, "BACKUP_HASH")

    def test_resume_promoted_snapshot_checks_durability_and_never_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            value["local"] = {"status": "PENDING"}
            flow._save(install, value)
            flow.atomic_json(flow._receipt_root(install) / ("operation-" + OP + ".json"),
                             {"installationId": ID, "operationId": OP, "snapshotId": SNAP})
            policy = {"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": False}}
            with patch.object(flow, "ensure_backup_durable", side_effect=OSError(errno.EIO, "synthetic sync failure")), \
                    patch.object(flow, "export_backup") as export, patch.object(flow, "_command") as command:
                failed = flow.run_backup(install, operation_id=OP, installation_id=ID, policy=policy, allow_export=False)
                self.assertEqual(failed["local"]["status"], "FAILED")
                self.assertEqual(failed["outcome"], "BLOCKED")
                export.assert_not_called()
                command.assert_not_called()
            with patch.object(flow, "export_backup") as export, patch.object(flow, "_command", side_effect=fake_age):
                resumed = flow.run_backup(install, operation_id=OP, installation_id=ID, policy=policy, allow_export=False)
                self.assertEqual(resumed["snapshotId"], SNAP)
                self.assertEqual(resumed["local"]["status"], "OK")
                self.assertEqual(resumed["encryption"]["status"], "OK")
                self.assertEqual(resumed["outcome"], "WARNING")
                export.assert_not_called()

    def test_saved_backup_resume_cannot_create_a_binding_or_replace_a_missing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            policy = {"policy": "best-effort", "cloud": {"enabled": False}}
            with patch.object(flow, "export_backup") as export, self.assertRaises(Blocked) as caught:
                flow.run_backup(install, operation_id=OP, installation_id=ID, policy=policy, allow_export=False)
            self.assertEqual(caught.exception.code, "BACKUP_RESUME_IDENTITY")
            export.assert_not_called()
            value = receipt(install)
            value["local"] = {"status": "PENDING"}
            flow._save(install, value)
            flow.atomic_json(flow._receipt_root(install) / ("operation-" + OP + ".json"),
                             {"installationId": ID, "operationId": OP, "snapshotId": SNAP})
            Path(install.root / "backups" / SNAP).rename(install.root / "backups" / (SNAP + ".incomplete"))
            with patch.object(flow, "export_backup") as export:
                refused = flow.run_backup(install, operation_id=OP, installation_id=ID, policy=policy, allow_export=False)
            self.assertEqual(refused["outcome"], "BLOCKED")
            self.assertEqual(refused["local"]["error"], "BACKUP_RESUME_SNAPSHOT_MISSING")
            export.assert_not_called()

    def test_remote_same_name_and_size_different_ciphertext_is_not_success(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                target = flow.encrypt_snapshot(install, value, RECIPIENT)
            provider = MemoryCloud()
            remote = provider.remote + "/" + target.name
            provider.objects[remote] = b"X" * target.stat().st_size
            with patch.object(flow, "_command", return_value=b""), self.assertRaises(Blocked) as problem:
                provider.deliver(target, value, install.state / "verify")
            self.assertEqual(problem.exception.code, "CLOUD_READBACK_HASH")
            self.assertFalse(any(call[0] in ("moveto", "deletefile") for call in provider.commands))
            self.assertEqual(provider.objects[remote], b"X" * target.stat().st_size)

    def test_cloud_upload_promotes_only_after_readback_and_retries_same_object(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                target = flow.encrypt_snapshot(install, value, RECIPIENT)
            provider = MemoryCloud()
            with patch.object(flow, "_command", return_value=b""):
                proof = provider.deliver(target, value, install.state / "verify")
                first = list(provider.commands)
                again = provider.deliver(target, value, install.state / "verify")
            self.assertEqual(proof["sha256"], value["encryption"]["sha256"])
            self.assertEqual(proof["verification"], "independent-ciphertext-readback-sha256")
            move = next(i for i, call in enumerate(first) if call[0] == "moveto")
            self.assertTrue(any(call[0] == "copyto" and call[1].endswith(".age") and call[2].startswith("/data/") for call in first[:move]))
            self.assertFalse(any(call[0] == "moveto" for call in provider.commands[len(first):]))
            self.assertEqual(again["remote"], proof["remote"])
            self.assertEqual(len(provider.objects), 1)

    def test_required_failure_resumes_old_writers_best_effort_keeps_hold(self):
        for policy_name in ("required", "best-effort"):
            with self.subTest(policy=policy_name), tempfile.TemporaryDirectory() as directory:
                install = fake_install(directory)
                value = receipt(install)
                value["policy"] = policy_name
                flow._save(install, value)
                atomic_json(flow._receipt_root(install) / ("operation-" + OP + ".json"),
                            {"installationId": ID, "snapshotId": SNAP, "operationId": OP})
                atomic_json(install.state / "maintenance.json", {"operationId": OP})
                hold = {"deadlineEpoch": flow.time.time() + 900, "deadlineMonotonic": flow.time.monotonic() + 900, "containers": {"api": "api-id"}}
                with patch.object(flow, "consume_backup_hold", return_value=hold), patch.object(flow, "_command", side_effect=fake_age), \
                        patch.object(flow, "_deliver", side_effect=Blocked("CLOUD_AUTHORIZATION", "failed", "Retry")), \
                        patch.object(flow, "resume_backup_writers", return_value={"status": "OK", "previousRuntimeVerified": True}) as resume:
                    result = flow.run_backup(install, operation_id=OP, installation_id=ID, hold_writers=True,
                                             policy={"policy": policy_name, "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
                self.assertEqual(result["outcome"], "BLOCKED" if policy_name == "required" else "WARNING")
                self.assertEqual(resume.call_count, 1 if policy_name == "required" else 0)
                self.assertTrue(Path(result["local"]["path"]).is_dir())
                self.assertEqual(result["restore"]["status"], "UNVERIFIED")

    def test_resume_failure_never_claims_the_previous_site_works(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            value["policy"] = "required"
            flow._save(install, value)
            atomic_json(install.state / "maintenance.json", {"operationId": OP})
            with patch.object(flow, "consume_backup_hold", return_value={"deadlineEpoch": flow.time.time() + 900, "deadlineMonotonic": flow.time.monotonic() + 900, "containers": {}}), \
                    patch.object(flow, "_command", side_effect=fake_age), \
                    patch.object(flow, "_deliver", side_effect=Blocked("CLOUD_AUTHORIZATION", "failed", "Retry")), \
                    patch.object(flow, "resume_backup_writers", side_effect=Blocked("HEALTH", "failed", "Inspect")):
                result = flow.run_backup(install, operation_id=OP, installation_id=ID, snapshot_id=SNAP, hold_writers=True,
                                         policy={"policy": "required", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
            self.assertEqual(result["outcome"], "ERROR")
            self.assertEqual(result["writers"]["held"], "UNKNOWN")
            self.assertNotIn("previousRuntimeVerified", result["writers"])

    def test_old_retry_does_not_replace_newest_success_and_retention_protects_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            oldest = receipt(install, "20261027T000000Z-abcdef12", "b" * 32, "2026-10-27T00:00:00+00:00")
            pending = receipt(install, "20261028T000000Z-abcdef12", "c" * 32, "2026-10-28T00:00:00+00:00", cloud=True)
            latest = receipt(install)
            flow._save(install, oldest)
            pointer = json.loads(flow.read_private(flow._receipt_root(install) / "last-local-success.json"))
            self.assertEqual(pointer["snapshotId"], SNAP)
            unknown = install.root / "backups/foreign"
            unknown.mkdir()
            (unknown / "owner-data").write_text("keep")
            result = flow.apply_retention(install, installation_id=ID,
                                          policy={"policy": "best-effort", "retention": {"localKeep": 1}})
            self.assertEqual(result["deleted"]["local"], [oldest["snapshotId"]])
            self.assertTrue(Path(pending["local"]["path"]).exists())
            self.assertTrue(Path(latest["local"]["path"]).exists())
            self.assertTrue((unknown / "owner-data").exists())

    def test_symlinked_receipt_cannot_redirect_a_private_write(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            outside = install.root / "outside"
            outside.write_text("preserved")
            store = flow._receipt_root(install)
            (store / (SNAP + ".json")).symlink_to(outside)
            with self.assertRaises(ValueError):
                flow.load_receipt(install, SNAP, ID)
            self.assertEqual(outside.read_text(), "preserved")

    def test_prior_success_cannot_hide_current_local_integrity_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                flow.encrypt_snapshot(install, value, RECIPIENT)
            value["cloud"] = {"status": "OK", "verifiedAt": "2026-10-29T00:01:00+00:00", "sha256": value["encryption"]["sha256"]}
            flow._save(install, value)
            (Path(value["local"]["path"]) / "objects/file").write_bytes(b"corruption")
            result = flow.run_backup(install, operation_id=OP, installation_id=ID, snapshot_id=SNAP,
                                     policy={"policy": "best-effort", "ageRecipient": RECIPIENT})
            self.assertEqual(result["outcome"], "BLOCKED")
            self.assertEqual(result["local"]["status"], "FAILED")
            self.assertFalse(result["protectionConfirmed"])
            self.assertEqual(result["lastSuccessfulCloud"]["status"], "OK")

    def test_required_missing_cloud_is_rejected_before_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            with patch.object(flow, "export_backup") as export, self.assertRaises(Blocked) as problem:
                flow.run_backup(install, operation_id=OP, installation_id=ID,
                                policy={"policy": "required", "ageRecipient": RECIPIENT, "cloud": {"enabled": False}})
            self.assertEqual(problem.exception.code, "CLOUD_NOT_CONFIGURED")
            export.assert_not_called()

    def test_interrupted_ciphertext_publication_reconciles_only_exact_inode_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            encrypted_root = flow.private_directory(install.root / "backups/encrypted")
            stage = flow.private_directory(encrypted_root / ".staging/known")
            prepared = stage / "snapshot.age"
            prepared.write_bytes(b"age-encryption.org/v1\nsynthetic")
            target = flow.private_directory(install.root / "backups/encrypted") / ("asa-lab-" + SNAP + ".tar.age")
            os.link(prepared, target)
            value["encryption"] = {"status": "PREPARED", "preparedPath": str(prepared), "path": str(target),
                                   "sha256": flow.file_hash(target), "manifestSha256": value["local"]["manifestSha256"]}
            flow._save(install, value)
            flow._complete_encryption_receipt(install, value)
            self.assertEqual(value["encryption"]["status"], "OK")
            self.assertEqual(target.stat().st_nlink, 1)
            self.assertFalse(prepared.exists())

    def test_ciphertext_publication_uses_backup_filesystem_and_preserves_prepared_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            value = receipt(install)
            def separate_filesystem_link(source, target, *args, **kwargs):
                # Model .asa and the backup disk as different filesystems.
                if not Path(source).is_relative_to(Path(target).parent):
                    raise OSError(errno.EXDEV, "cross-device publication")
                raise OSError(errno.EIO, "one transient publication failure")

            with patch.object(flow, "_command", side_effect=fake_age), \
                    patch.object(flow.os, "link", side_effect=separate_filesystem_link), self.assertRaises(OSError):
                flow.encrypt_snapshot(install, value, RECIPIENT)
            saved = flow.load_receipt(install, SNAP, ID)
            prepared = Path(saved["encryption"]["preparedPath"])
            self.assertTrue(prepared.is_file())
            self.assertTrue(prepared.is_relative_to(install.root / "backups/encrypted/.staging"))
            original = prepared.read_bytes()
            with patch.object(flow, "_command") as no_new_age:
                flow._complete_encryption_receipt(install, saved)
                no_new_age.assert_not_called()
            self.assertEqual(saved["encryption"]["status"], "OK")
            self.assertEqual(Path(saved["encryption"]["path"]).read_bytes(), original)
            self.assertFalse(prepared.exists())

    def test_completed_operation_does_not_permanently_exempt_snapshot_from_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old = receipt(install)
            new = receipt(install, "20261030T000000Z-abcdef34", "b" * 32, "2026-10-30T00:00:00+00:00")
            operations = flow.private_directory(install.state / "setup-operations")
            flow.atomic_json(operations / (OP + ".json"), {
                "format": "asa-setup-operation-v1", "installationId": ID,
                "state": "TERMINAL", "mode": "backup",
                "result": {"outcome": "WARNING", "backup": {"snapshotId": old["snapshotId"]}},
            })
            outcome = flow.apply_retention(install, installation_id=ID,
                policy={"policy": "best-effort", "cloud": {"enabled": False}, "retention": {"localKeep": 1}})
            self.assertEqual(outcome["deleted"]["local"], [old["snapshotId"]])
            self.assertFalse(Path(old["local"]["path"]).exists())
            self.assertTrue(Path(new["local"]["path"]).exists())


class ScheduleTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "systemd unit paths belong to the Linux host boundary")
    def test_one_timer_independent_of_auto_update_with_bounded_retry(self):
        settings = {"enabled": True, "time": "03:00", "timezone": "Europe/Moscow", "maxAgeHours": 26}
        units = schedule.render_units("/srv/asa-lab", ID, "operator", settings, "/opt/asa-setup/pinned/tools/asa_setup.py")
        self.assertEqual(len(units), 2)
        service = units[schedule.unit_name(ID) + ".service"]
        timer = units[schedule.unit_name(ID) + ".timer"]
        self.assertIn('"backup"', service)
        self.assertIn("User=operator", service)
        self.assertIn("StartLimitBurst=3", service)
        self.assertIn("ExecCondition=", service)
        self.assertIn('"--schedule-budget-check"', service)
        self.assertNotIn("update", service)
        self.assertIn("Persistent=true", timer)
        self.assertIn("03:00:00 Europe/Moscow", timer)

    @patch.object(schedule, "ZoneInfo", return_value=dt.timezone(dt.timedelta(hours=3)))
    def test_schedule_retry_preserves_daily_operation_id_across_midnight(self, _zone):
        settings = {"time": "03:00", "timezone": "Europe/Moscow"}
        first = dt.datetime(2026, 10, 28, 0, 1, tzinfo=dt.timezone.utc)
        late = dt.datetime(2026, 10, 28, 22, 0, tzinfo=dt.timezone.utc)
        next_day = dt.datetime(2026, 10, 29, 0, 1, tzinfo=dt.timezone.utc)
        self.assertEqual(schedule.scheduled_operation_id(ID, settings, first), schedule.scheduled_operation_id(ID, settings, late))
        self.assertNotEqual(schedule.scheduled_operation_id(ID, settings, first), schedule.scheduled_operation_id(ID, settings, next_day))

    @patch.object(schedule, "ZoneInfo", return_value=dt.timezone(dt.timedelta(hours=3)))
    def test_slow_failures_cannot_restart_more_than_three_times_in_daily_slot(self, _zone):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            settings = {"time": "03:00", "timezone": "Europe/Moscow"}
            first = dt.datetime(2026, 10, 28, 0, 1, tzinfo=dt.timezone.utc)
            slot = schedule.scheduled_attempt(install.root, ID, settings, consume=False, instant=first)
            self.assertFalse((install.state / "setup-schedule-attempts").exists())
            for hour in (0, 4, 8):
                when = first + dt.timedelta(hours=hour)
                self.assertEqual(schedule.scheduled_attempt(install.root, ID, settings, consume=False, instant=when), slot)
                self.assertEqual(schedule.scheduled_attempt(install.root, ID, settings, instant=when), slot)
            for consume in (False, True):
                with self.assertRaises(Blocked) as problem:
                    schedule.scheduled_attempt(install.root, ID, settings, consume=consume, instant=first + dt.timedelta(hours=12))
                self.assertEqual(problem.exception.code, "SCHEDULE_RETRY_EXHAUSTED")
            next_slot = schedule.scheduled_attempt(install.root, ID, settings, instant=first + dt.timedelta(days=1))
            self.assertNotEqual(next_slot, slot)

    @patch.object(schedule, "ZoneInfo", return_value=dt.timezone.utc)
    def test_interrupted_attempt_claim_is_spent_and_never_replaced(self, _zone):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            settings = {"time": "03:00", "timezone": "UTC"}
            instant = dt.datetime(2026, 10, 28, 5, tzinfo=dt.timezone.utc)
            slot = schedule.scheduled_operation_id(ID, settings, instant)
            parent = flow.private_directory(install.state / "setup-schedule-attempts")
            target = flow.private_directory(parent / slot)
            claim = target / "1.json"
            with os.fdopen(os.open(claim, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"):
                pass
            schedule.scheduled_attempt(install.root, ID, settings, instant=instant)
            self.assertEqual(claim.read_bytes(), b"")
            self.assertTrue((target / "2.json").is_file())

    @unittest.skipUnless(os.name == "posix", "Unix permissions and symlinks")
    @patch.object(schedule, "ZoneInfo", return_value=dt.timezone.utc)
    def test_attempt_budget_rejects_substituted_claim_without_following_it(self, _zone):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            settings = {"time": "03:00", "timezone": "UTC"}
            instant = dt.datetime(2026, 10, 28, 5, tzinfo=dt.timezone.utc)
            slot = schedule.scheduled_operation_id(ID, settings, instant)
            parent = flow.private_directory(install.state / "setup-schedule-attempts")
            target = flow.private_directory(parent / slot)
            other = install.root / "foreign"
            other.write_text("preserved")
            (target / "1.json").symlink_to(other)
            for consume in (False, True):
                with self.assertRaises((Blocked, ValueError)):
                    schedule.scheduled_attempt(install.root, ID, settings, consume=consume, instant=instant)
            self.assertEqual(other.read_text(), "preserved")

    @patch.object(schedule, "ZoneInfo", return_value=dt.timezone(dt.timedelta(hours=3)))
    def test_unavailable_systemd_does_not_claim_installed_timer(self, _zone):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(schedule, "_systemctl", side_effect=Blocked("BACKUP_SYSTEMD_UNAVAILABLE", "missing", "Check")):
                result = schedule.schedule_status(directory, ID, {"enabled": True})
            self.assertFalse(result["running"])
            self.assertFalse(result["installed"])
            self.assertEqual(result["error"], "BACKUP_SYSTEMD_UNAVAILABLE")

    def test_untrusted_schedule_fields_rejected(self):
        for settings in ({"time": "03:00\nExecStart=/bin/sh"}, {"timezone": "../Europe/Moscow"},
                         {"timezone": "Europe/Moscow\n"}, {"maxAgeHours": True}, {"enabled": "true"}):
            with self.subTest(settings=settings), self.assertRaises(Blocked):
                schedule.validate_schedule(settings)


class ScheduleStateCaptureTests(unittest.TestCase):
    @staticmethod
    def settings():
        return {"enabled": True, "time": "03:00", "timezone": "Etc/UTC", "maxAgeHours": 26}

    @staticmethod
    def zone(name):
        if name != "Etc/UTC":
            raise schedule.ZoneInfoNotFoundError(name)
        return dt.timezone.utc

    @staticmethod
    def install_tail(root, settings):
        # Execute the real post-enable statements, with privileged setup outside this seam.
        import ast
        import copy
        source = Path(schedule.__file__).read_text(encoding="utf-8")
        module = ast.parse(source)
        function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "install_schedule")
        indexes = [index for index, node in enumerate(function.body)
                   if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                   and ast.get_source_segment(source, node.value.func) == "_systemctl"
                   and '"enable" if settings["enabled"] else "disable"' in ast.get_source_segment(source, node)]
        assert len(indexes) == 1
        target = ast.FunctionDef(name="guard_tail",
            args=ast.arguments(posonlyargs=[], args=[ast.arg(arg=key) for key in ("root", "installation_id", "settings")],
                               kwonlyargs=[], kw_defaults=[], defaults=[]),
            body=copy.deepcopy(function.body[indexes[0] + 1:]), decorator_list=[])
        namespace = dict(vars(schedule))
        exec(compile(ast.fix_missing_locations(ast.Module(body=[target], type_ignores=[])), "<actual-schedule-guard>", "exec"), namespace)
        return namespace["guard_tail"](root, ID, settings)

    def run_status(self, timer="LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n",
                   *, timer_error=None, service_error=None, capture=True, guard=False):
        import subprocess
        calls, errors = [], []
        observation = {}
        actual_require = schedule.require

        def require(*args):
            try:
                return actual_require(*args)
            except Blocked as error:
                errors.append(error)
                raise

        def run(argv, **kwargs):
            self.assertEqual(argv[0:2], ["systemctl", "show"])
            self.assertEqual(kwargs, {"capture_output": True, "text": True, "timeout": 40, "check": False})
            is_timer = argv[2].endswith(".timer")
            self.assertEqual(argv[2], schedule.unit_name(ID) + (".timer" if is_timer else ".service"))
            self.assertEqual(argv[3], "--property=" + (
                "LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec" if is_timer else
                "Result,ExecMainStatus,ExecMainExitTimestamp,NRestarts"))
            calls.append("TIMER" if is_timer else "SERVICE")
            error = timer_error if is_timer else service_error
            if error == "timeout":
                raise subprocess.TimeoutExpired(argv, 40)
            return subprocess.CompletedProcess(argv, error or 0, timer if is_timer else "Result=success\nExecMainStatus=0\nNRestarts=0\n",
                                               "PRIVATE_STDERR_SENTINEL" if error else "")

        with tempfile.TemporaryDirectory() as temporary, patch.object(schedule, "ZoneInfo", side_effect=self.zone), \
                patch.object(schedule, "now", return_value="FIXED"), patch.object(schedule, "require", side_effect=require), \
                patch.object(schedule.subprocess, "run", side_effect=run):
            if guard:
                try:
                    result = self.install_tail(Path(temporary), self.settings())
                except Blocked as error:
                    self.assertIs(error, errors[-1])
                    return None, getattr(error, "schedule_observation", None), calls, error
                return result, None, calls, None
            result = schedule.schedule_status(Path(temporary), ID, self.settings(), **({"_observation": observation} if capture else {}))
        return result, observation, calls, None

    def test_actual_guard_preserves_same_blocked_and_distinguishes_failed_predicates(self):
        observations = []
        for active, enabled in (("activating", "enabled"), ("inactive", "enabled"), ("failed", "enabled"),
                                ("active", "disabled"), ("active", "enabled-runtime")):
            with self.subTest(active=active, enabled=enabled):
                _, value, calls, error = self.run_status(f"LoadState=loaded\nActiveState={active}\nUnitFileState={enabled}\n", guard=True)
                self.assertEqual(error.code, "BACKUP_SCHEDULE_INACTIVE")
                self.assertEqual(str(error), "Настройка сохранена, но timer не запущен.")
                self.assertEqual(calls, ["TIMER", "SERVICE"])
                self.assertEqual((value["activeState"], value["unitFileState"]), (active, enabled))
                self.assertEqual(value["queryError"], {"source": "NONE", "code": None})
                self.assertFalse(value["running"])
                observations.append(json.dumps(value, sort_keys=True))
        self.assertEqual(len(set(observations)), 5)

    def test_default_status_shape_and_healthy_guard_command_count_are_unchanged(self):
        timer = "UnitFileState=enabled\r\nActiveState=active\r\nLoadState=loaded\r\n"
        default, _, original_calls, _ = self.run_status(timer, capture=False)
        captured, value, calls, _ = self.run_status(timer)
        accepted, _, guard_calls, error = self.run_status(timer, guard=True)
        self.assertEqual(default, captured)
        self.assertEqual(default, accepted)
        self.assertEqual(set(default), {"format", "installationId", "configuration", "installed", "running", "observedAt",
                                      "nextRun", "lastRun", "lastLocalSuccess", "lastCloudSuccess", "lastServiceResult"})
        self.assertEqual(original_calls, calls)
        self.assertEqual(calls, guard_calls)
        self.assertEqual(calls, ["TIMER", "SERVICE"])
        self.assertIsNone(error)
        self.assertTrue(value["running"])

    def test_timer_query_failures_are_unavailable_with_the_original_query_source(self):
        for failure, code in ((1, "BACKUP_SYSTEMD"), ("timeout", "BACKUP_SYSTEMD_UNAVAILABLE")):
            with self.subTest(failure=failure):
                _, value, calls, error = self.run_status(timer_error=failure, guard=True)
                self.assertEqual(error.code, "BACKUP_SCHEDULE_INACTIVE")
                self.assertEqual(calls, ["TIMER"])
                self.assertEqual(value["timerQuery"], "UNAVAILABLE")
                self.assertEqual(value["queryError"], {"source": "TIMER", "code": code})
                self.assertTrue(all(value[key] == "UNAVAILABLE" for key in schedule.SCHEDULE_STATE_VALUES))
                self.assertFalse(value["installed"])
                self.assertFalse(value["running"])
                self.assertNotIn("PRIVATE_STDERR_SENTINEL", json.dumps(value))

    def test_service_query_failure_preserves_timer_fields_and_does_not_invent_startup_failure(self):
        for active in ("active", "inactive"):
            with self.subTest(active=active):
                timer = f"LoadState=loaded\nActiveState={active}\nUnitFileState=enabled\n"
                result, value, calls, error = self.run_status(timer, service_error=1, guard=active == "inactive")
                self.assertEqual(calls, ["TIMER", "SERVICE"])
                self.assertEqual(value["queryError"], {"source": "SERVICE", "code": "BACKUP_SYSTEMD"})
                self.assertEqual(value["timerQuery"], "OBSERVED")
                self.assertEqual(value["activeState"], active)
                if active == "active":
                    self.assertIsNone(error)
                    self.assertTrue(result["running"])
                    self.assertEqual(result["error"], "BACKUP_SYSTEMD")
                else:
                    self.assertEqual(error.code, "BACKUP_SCHEDULE_INACTIVE")

    def test_missing_unknown_and_unicode_properties_are_not_substituted_as_inactive(self):
        samples = [
            ("LoadState=loaded\nUnitFileState=enabled\n", "MISSING"),
            ("LoadState=loaded\nActiveState=\nUnitFileState=enabled\n", "UNRECOGNIZED"),
            ("LoadState=loaded\nActiveState=аctive\nUnitFileState=enabled\n", "UNRECOGNIZED"),
            ("LoadState=loaded\nActiveState=PRIVATE_STATE_SENTINEL\nUnitFileState=enabled\n", "UNRECOGNIZED"),
        ]
        for timer, expected in samples:
            with self.subTest(expected=expected):
                _, value, _, error = self.run_status(timer, guard=True)
                self.assertEqual(error.code, "BACKUP_SCHEDULE_INACTIVE")
                self.assertEqual(value["activeState"], expected)
                self.assertNotEqual(value["activeState"], "inactive")
                self.assertNotIn("PRIVATE_STATE_SENTINEL", json.dumps(value))

    def test_closed_projection_rejects_types_unknown_keys_and_inconsistent_query_error(self):
        import copy
        _, valid, _, _ = self.run_status()
        changes = [
            lambda v: v.update(installed=1), lambda v: v.update(running=0),
            lambda v: v.update(activeState=True), lambda v: v.update(timerQuery=None),
            lambda v: v.update(loadState=["loaded"]), lambda v: v.update(private="SECRET"),
            lambda v: v.update(queryError={"source": "NONE", "code": "BACKUP_SYSTEMD"}),
            lambda v: v.update(queryError={"source": "TIMER", "code": "BACKUP_SYSTEMD"}),
            lambda v: v.update(queryError={"source": "SERVICE", "code": None}),
            lambda v: v.update(queryError={"source": "SERVICE", "code": "BACKUP_SYSTEMＤ"}),
            lambda v: v.update(queryError={"source": None, "code": None}),
            lambda v: v.update(queryError={"source": "NONE", "code": None, "message": "SECRET"}),
            lambda v: v.update(timerQuery="UNAVAILABLE"), lambda v: v.update(installed=False),
            lambda v: v.update(activeState="active"), lambda v: v.update(format="UNKNOWN"),
        ]
        for change in changes:
            value = copy.deepcopy(valid)
            change(value)
            with self.subTest(case=changes.index(change)):
                self.assertEqual(schedule.schedule_observation(value),
                                 {"format": "asa-backup-schedule-observation-v1", "status": "UNAVAILABLE"})
        self.assertEqual(schedule.schedule_observation(valid), valid)

    def test_unknown_query_code_and_diagnostic_exception_do_not_replace_original_guard_failure(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(schedule, "ZoneInfo", side_effect=self.zone), \
                patch.object(schedule, "_systemctl", side_effect=Blocked("PRIVATE_UNKNOWN", "PRIVATE_MESSAGE", "PRIVATE_ACTION")):
            with self.assertRaises(Blocked) as caught:
                self.install_tail(Path(temporary), self.settings())
        self.assertEqual(caught.exception.code, "BACKUP_SCHEDULE_INACTIVE")
        self.assertEqual(caught.exception.schedule_observation,
                         {"format": "asa-backup-schedule-observation-v1", "status": "UNAVAILABLE"})
        with patch.object(schedule, "schedule_observation", side_effect=RuntimeError("PRIVATE_MESSAGE")):
            _, value, _, error = self.run_status(guard=True)
        self.assertEqual(error.code, "BACKUP_SCHEDULE_INACTIVE")
        self.assertEqual(value, {"format": "asa-backup-schedule-observation-v1", "status": "UNAVAILABLE"})
        self.assertNotIn("PRIVATE", json.dumps(value))

    def test_capture_before_the_guard_does_not_swallow_interruption(self):
        with patch.object(schedule, "schedule_observation", side_effect=KeyboardInterrupt) as projection:
            default, _, _, _ = self.run_status(capture=False)
            self.assertFalse(default["running"])
            projection.assert_not_called()
            with self.assertRaises(KeyboardInterrupt):
                self.run_status(guard=True)

    def root_action(self, error):
        import contextlib
        import io
        import asa_setup
        import asa_setup_launcher
        owner = {"uid": 1001, "gid": 1001, "name": "fixture-owner"}
        config = {"operatorUid": 1001, "installationId": "a" * 32, "project": "fixture",
                  "backup": {"schedule": self.settings()}}
        with tempfile.TemporaryDirectory() as temporary:
            args = asa_setup.parser().parse_args(["--root-action", "schedule", "--root", temporary, "--schedule-enabled", "true"])
            with patch.object(asa_setup.os, "geteuid", return_value=0, create=True), \
                    patch.object(asa_setup_launcher, "verify_bundle"), patch.object(asa_setup.setup_host, "check_owner", return_value=owner), \
                    patch.object(asa_setup, "load_config", return_value=config), \
                    patch.object(asa_setup, "operation_lock", return_value=contextlib.nullcontext(42)), \
                    patch.object(asa_setup.setup_discovery, "docker_inventory", return_value={}), \
                    patch.object(asa_setup.setup_discovery, "classify_installation", return_value={"state": "MANAGED"}), \
                    patch.object(schedule, "install_schedule", side_effect=error), patch.object(schedule, "ZoneInfo", side_effect=self.zone), \
                    patch.object(asa_setup_launcher, "_write_owner_json") as saved, patch.object(asa_setup, "_root_receipt") as receipt, \
                    patch("sys.stdout", new_callable=io.StringIO) as output:
                code = asa_setup.root_action(args)
            saved.assert_not_called()
            self.assertEqual(json.loads(output.getvalue()), receipt.call_args.args[2])
            return code, json.loads(output.getvalue())

    def test_actual_root_action_retains_failed_exit_and_closed_guard_snapshot(self):
        _, captured, _, error = self.run_status(guard=True)
        code, receipt = self.root_action(error)
        self.assertEqual((code, receipt["status"], receipt["reasonCode"]), (2, "FAILED", "BACKUP_SCHEDULE_INACTIVE"))
        self.assertEqual(receipt["scheduleObservation"], captured)
        self.assertNotIn("installationId", captured)
        self.assertNotIn("operationId", captured)
        self.assertNotIn("observedAt", captured)

    def test_actual_root_action_early_failure_and_bad_snapshot_keep_original_reason(self):
        early = Blocked("BACKUP_SCHEDULE_CALENDAR", "PRIVATE", "PRIVATE")
        code, receipt = self.root_action(early)
        self.assertEqual((code, receipt["reasonCode"]), (2, "BACKUP_SCHEDULE_CALENDAR"))
        self.assertNotIn("scheduleObservation", receipt)
        for value in (None, {"private": "PRIVATE"}, {"queryError": {"source": "NONE", "code": "PRIVATE"}}):
            error = Blocked("BACKUP_SCHEDULE_INACTIVE", "PRIVATE", "PRIVATE")
            error.schedule_observation = value
            with self.subTest(value=value):
                code, receipt = self.root_action(error)
                self.assertEqual((code, receipt["status"], receipt["reasonCode"]), (2, "FAILED", error.code))
                self.assertEqual(receipt["scheduleObservation"],
                                 {"format": "asa-backup-schedule-observation-v1", "status": "UNAVAILABLE"})
                self.assertNotIn("PRIVATE", json.dumps(receipt))
        error = Blocked("BACKUP_SCHEDULE_INACTIVE", "PRIVATE", "PRIVATE")
        with patch.object(schedule, "schedule_observation", side_effect=RuntimeError("PRIVATE")):
            code, receipt = self.root_action(error)
        self.assertEqual((code, receipt["reasonCode"]), (2, error.code))
        self.assertEqual(receipt["scheduleObservation"]["status"], "UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
