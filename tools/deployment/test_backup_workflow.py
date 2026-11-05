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
            target.write_bytes(first[:-1] + b"x")
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


if __name__ == "__main__":
    unittest.main()
