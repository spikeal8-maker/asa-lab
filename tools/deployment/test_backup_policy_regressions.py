"""FIX-02: exercise policy at command boundaries with synthetic local snapshots."""

import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_setup
from deployment import backup_schedule, backup_workflow as flow
from deployment.contracts import Blocked
from deployment.setup_operation import Engine, Runtime, Store
from deployment.test_backup_workflow import ID, OP, RECIPIENT, SNAP, MemoryCloud, fake_age, fake_install, receipt, snapshot
from deployment.test_setup_operation import FakeRuntime


class BackupRuntime(FakeRuntime):
    """Keep real backup preflight/workflow; host, Docker and browser are fixtures."""

    backup_preflight = Runtime.backup_preflight

    def __init__(self, root):
        super().__init__(root)
        self.config["installationId"] = ID
        self.config["backup"].update(ageRecipient=RECIPIENT, cloud={"enabled": True})
        self.install = fake_install(root)
        self.install.process_env = {}

    def backup(self, journal, *, hold, snapshot_id=None):
        self.record("backup")
        return flow.run_backup(self.install, operation_id=journal["operationId"], installation_id=ID,
            policy=journal["backupPolicy"], hold_writers=hold, snapshot_id=snapshot_id)

    def resume_saved_backup(self, journal, snapshot_id=None):
        self.record("resume_saved_backup")
        return flow.run_backup(self.install, operation_id=journal["operationId"], installation_id=ID,
            policy=journal["backupPolicy"], snapshot_id=snapshot_id, allow_export=False)

    def recover_owned_backup(self, journal):
        return {"status": "NOT_NEEDED"}

    def browser(self, journal):
        return {"status": "passed", "instanceId": ID, "revision": journal["release"]["revision"]}


def export_fixture(install, **kwargs):
    return snapshot(install, kwargs["snapshot_id"], kwargs["operation_id"])


class BackupPolicyRegressionTests(unittest.TestCase):
    def test_generic_preflight_failure_is_not_an_availability_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = BackupRuntime(directory)
            with patch.object(flow, "CloudTransport", side_effect=Blocked("BACKUP_COMMAND_FAILED", "unknown failure", "inspect")), \
                    self.assertRaises(Blocked) as caught:
                runtime.backup_preflight()
            self.assertEqual(caught.exception.code, "BACKUP_COMMAND_FAILED")

    def test_stopped_trusted_transport_is_optional_but_identity_and_spool_errors_are_fatal(self):
        payload = ("PROJECT = 'asa-cloud-storage'\nIMAGE = 'synthetic-pinned-image'\n"
                   "def remote_path(project):\n    return 'yandex:Server-Backups/' + project\n").encode()
        digest = hashlib.sha256(payload).hexdigest()
        cases = ((False, "synthetic-pinned-image", None, "CLOUD_UNAVAILABLE"),
                 (False, "foreign-image", None, "CLOUD_TRANSPORT_IDENTITY"),
                 (True, "synthetic-pinned-image", Blocked("BACKUP_COMMAND_FAILED", "unsafe spool", "inspect"), "CLOUD_SPOOL_IDENTITY"))
        for running, image, spool_error, expected in cases:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "transport.py"
                source.write_bytes(payload)
                inspected = json.dumps({"image": image, "user": "1000:1000", "running": running,
                                        "labels": {"asa.owner": "asa-cloud-storage"}}).encode()
                with patch.object(flow, "TRANSPORT_SHA256", digest), \
                        patch.object(flow, "_command", side_effect=[inspected, spool_error] if spool_error else [inspected]), \
                        self.assertRaises(Blocked) as caught:
                    flow.CloudTransport({"enabled": True, "transportPath": str(source), "transportSha256": digest}, ID)
                self.assertEqual(caught.exception.code, expected)

    def test_update_manual_and_scheduled_timeout_preserve_complete_local_backup(self):
        for command in ("update", "manual", "scheduled"):
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                runtime = BackupRuntime(directory)
                store = Store(runtime.root, ID)
                hold = {"deadlineEpoch": flow.time.time() + 900,
                        "deadlineMonotonic": flow.time.monotonic() + 900, "containers": {}}
                with patch.object(flow, "CloudTransport", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")), \
                        patch.object(flow, "_command", side_effect=fake_age), \
                        patch.object(flow, "export_backup", side_effect=export_fixture) as export, \
                        patch.object(flow, "consume_backup_hold", return_value=hold), \
                        patch.object(backup_schedule, "schedule_status", return_value={"configuration": {"enabled": False}}):
                    if command == "update":
                        answer = Engine(runtime, store).execute(store.create("update", runtime.config["project"]))
                        self.assertIn("switch", runtime.calls)
                    else:
                        arguments = ["backup", "--root", directory] + (["--scheduled"] if command == "scheduled" else [])
                        args = asa_setup.parser().parse_args(arguments)
                        if command == "scheduled":
                            with patch.object(backup_schedule, "ZoneInfo", return_value=dt.timezone.utc):
                                args.scheduled_operation_id = backup_schedule.scheduled_operation_id(ID,
                                    {"time": "03:00", "timezone": "Etc/UTC"}, dt.datetime(2026, 11, 4, 5, tzinfo=dt.timezone.utc))
                        answer = asa_setup._auxiliary(args, runtime.config, runtime, store, None)
                        if command == "scheduled":
                            repeated = asa_setup._auxiliary(args, runtime.config, runtime, store, None)
                            self.assertEqual(repeated["backup"]["snapshotId"], answer["backup"]["snapshotId"])
                    self.assertEqual(answer["backup"]["outcome"], "WARNING")
                    self.assertEqual(answer["backup"]["local"]["status"], "OK")
                    self.assertEqual(answer["backup"]["encryption"]["status"], "OK")
                    flow._verify_local(runtime.install, answer["backup"])
                    self.assertEqual(export.call_count, 1)

    def test_required_timeout_still_blocks_before_update_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = BackupRuntime(directory)
            runtime.config["backup"]["policy"] = "required"
            store = Store(runtime.root, ID)
            with patch.object(flow, "CloudTransport", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")), \
                    patch.object(flow, "export_backup") as export:
                answer = Engine(runtime, store).execute(store.create("update", runtime.config["project"]))
            self.assertNotEqual(answer["exitCode"], 0)
            self.assertNotIn("switch", runtime.calls)
            export.assert_not_called()

    def test_optional_remote_retention_outage_does_not_block_the_next_backup(self):
        from deployment.test_backup_retention_regressions import copies
        for scheduled in (False, True):
            with self.subTest(scheduled=scheduled), tempfile.TemporaryDirectory() as directory:
                runtime = BackupRuntime(directory)
                runtime.config["backup"]["retention"] = {"remoteKeep": 1}
                provider = MemoryCloud()
                older = copies(runtime.install, provider=provider)
                store = Store(runtime.root, ID)
                arguments = ["backup", "--root", directory] + (["--scheduled"] if scheduled else [])
                args = asa_setup.parser().parse_args(arguments)
                args.scheduled_operation_id = "d" * 32
                with patch.object(flow, "CloudTransport", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")), \
                        patch.object(flow, "_command", side_effect=fake_age), \
                        patch.object(flow, "export_backup", side_effect=export_fixture) as export, \
                        patch.object(backup_schedule, "schedule_status", return_value={"configuration": {"enabled": False}}):
                    first = asa_setup._auxiliary(args, runtime.config, runtime, store, None)
                    self.assertEqual(first["exitCode"], 0, first.get("reasonCode"))
                    self.assertEqual(first["retention"]["status"], "DEFERRED")
                    self.assertIsNone(store.pending())
                    args.scheduled_operation_id = "e" * 32
                    second = asa_setup._auxiliary(args, runtime.config, runtime, store, None)
                self.assertEqual(second["exitCode"], 0)
                self.assertNotEqual(first["backup"]["snapshotId"], second["backup"]["snapshotId"])
                self.assertEqual(export.call_count, 2)
                self.assertTrue(all(Path(saved["local"]["path"]).is_dir() for saved in older))

    def test_integrity_and_unknown_delivery_failures_never_become_warning(self):
        for code in ("CLOUD_TRANSPORT_PIN", "CLOUD_TRANSPORT_IDENTITY", "CLOUD_SPOOL_IDENTITY",
                     "CLOUD_SPOOL_HASH", "CLOUD_READBACK_HASH", "BACKUP_CIPHERTEXT_DRIFT", "CLOUD_UNKNOWN_FAILURE"):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                install = fake_install(directory)
                with patch.object(flow, "export_backup", side_effect=export_fixture), \
                        patch.object(flow, "_command", side_effect=fake_age), \
                        patch.object(flow, "_deliver", side_effect=Blocked(code, "unverified", "inspect")):
                    result = flow.run_backup(install, operation_id=OP, installation_id=ID, snapshot_id=SNAP,
                        policy={"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
                self.assertEqual(result["outcome"], "BLOCKED")
                self.assertFalse(result["protectionConfirmed"])
                self.assertEqual(result["errors"][-1]["code"], code)
                flow._verify_local(install, result)

    def test_retry_cloud_integrity_failure_is_fatal_without_export_or_reencryption(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install, cloud=True)
            with patch.object(flow, "_command", side_effect=fake_age):
                flow.encrypt_snapshot(install, saved, RECIPIENT)
            with patch.object(flow, "_deliver", side_effect=Blocked("CLOUD_READBACK_HASH", "changed", "inspect")), \
                    patch.object(flow, "export_backup") as export, patch.object(flow, "encrypt_snapshot") as encrypt:
                result = flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID,
                    policy={"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
            self.assertEqual(result["outcome"], "BLOCKED")
            export.assert_not_called()
            encrypt.assert_not_called()

    def test_retry_checks_ciphertext_before_an_unavailable_transport_can_hide_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install, cloud=True)
            with patch.object(flow, "_command", side_effect=fake_age):
                encrypted = flow.encrypt_snapshot(install, saved, RECIPIENT)
            encrypted.write_bytes(b"changed ciphertext")
            with patch.object(flow, "CloudTransport", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")) as transport:
                try:
                    result = flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID,
                        policy={"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
                except Blocked as error:
                    self.assertEqual(error.code, "BACKUP_CIPHERTEXT_DRIFT")
                else:
                    self.assertEqual(result["outcome"], "BLOCKED")
                    self.assertEqual(result["errors"][-1]["code"], "BACKUP_CIPHERTEXT_DRIFT")
                transport.assert_not_called()

    def test_retry_availability_failure_preserves_exact_existing_ciphertext(self):
        for policy_name in ("required", "best-effort"):
            for code in ("CLOUD_PROVIDER_GONE", "CLOUD_AUTHORIZATION", "CLOUD_TRANSFER_FAILED", "CLOUD_TIMEOUT", "CLOUD_NOT_CONNECTED"):
                with self.subTest(policy=policy_name, code=code), tempfile.TemporaryDirectory() as directory:
                    install = fake_install(directory)
                    saved = receipt(install, cloud=True)
                    saved["policy"] = policy_name
                    with patch.object(flow, "_command", side_effect=fake_age):
                        encrypted = flow.encrypt_snapshot(install, saved, RECIPIENT)
                    original = encrypted.read_bytes()
                    with patch.object(flow, "_deliver", side_effect=Blocked(code, "offline", "retry")), \
                            patch.object(flow, "export_backup") as export, patch.object(flow, "encrypt_snapshot") as encrypt:
                        result = flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID,
                            policy={"policy": policy_name, "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
                    self.assertEqual(result["outcome"], "WARNING" if policy_name == "best-effort" else "BLOCKED")
                    self.assertEqual(encrypted.read_bytes(), original)
                    self.assertEqual(result["snapshotId"], SNAP)
                    export.assert_not_called()
                    encrypt.assert_not_called()

    def test_cleanup_failure_does_not_replace_a_cloud_integrity_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                encrypted = flow.encrypt_snapshot(install, saved, RECIPIENT)
            provider = MemoryCloud()
            with patch.object(provider, "readback", side_effect=Blocked("CLOUD_READBACK_HASH", "changed", "inspect")), \
                    patch.object(flow, "_command", side_effect=Blocked("CLOUD_TIMEOUT", "cleanup unavailable", "retry")), \
                    self.assertRaises(Blocked) as caught:
                provider.deliver(encrypted, saved, install.state / "verify")
            self.assertEqual(caught.exception.code, "CLOUD_READBACK_HASH")

    def test_interrupted_upload_retries_the_same_pending_ciphertext_without_export(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            call = provider.call

            def interrupt_after_upload(*args):
                answer = call(*args)
                if args[0] == "copyto" and ".pending-" in args[2]:
                    raise Blocked("CLOUD_TRANSFER_FAILED", "connection interrupted after upload", "retry")
                return answer

            def command(args, **kwargs):
                return fake_age(args, **kwargs) if args[0] == "age" else b""

            policy = {"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}}
            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", side_effect=command), \
                    patch.object(flow, "export_backup", side_effect=export_fixture) as export:
                with patch.object(provider, "call", side_effect=interrupt_after_upload):
                    failed = flow.run_backup(install, operation_id=OP, installation_id=ID, snapshot_id=SNAP, policy=policy)
                self.assertEqual(failed["outcome"], "WARNING")
                original = Path(failed["encryption"]["path"]).read_bytes()
                with patch.object(flow, "encrypt_snapshot") as encrypt:
                    resumed = flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID, policy=policy)
                    encrypt.assert_not_called()
                self.assertEqual(export.call_count, 1)
            self.assertEqual(resumed["outcome"], "ACCEPTED")
            self.assertEqual(provider.objects[resumed["cloud"]["remote"]], original)
            self.assertEqual(Path(resumed["encryption"]["path"]).read_bytes(), original)

    def test_conflicting_pending_ciphertext_is_fatal_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install)
            with patch.object(flow, "_command", side_effect=fake_age):
                encrypted = flow.encrypt_snapshot(install, saved, RECIPIENT)
            provider = MemoryCloud()
            pending = provider.remote + "/" + encrypted.name + ".pending-" + OP + ".age"
            provider.objects[pending] = b"X" * encrypted.stat().st_size
            with patch.object(flow, "_command", return_value=b""), self.assertRaises(Blocked) as caught:
                provider.deliver(encrypted, saved, install.state / "verify")
            self.assertEqual(caught.exception.code, "CLOUD_READBACK_HASH")
            self.assertFalse(any(args[0] == "copyto" and args[2] == pending for args in provider.commands))
            self.assertFalse(any(args[0] == "moveto" for args in provider.commands))

    def test_integrity_failure_after_write_freeze_blocks_switch_and_recovers_writers(self):
        for code in ("CLOUD_TRANSPORT_IDENTITY", "CLOUD_READBACK_HASH"):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                runtime = BackupRuntime(directory)
                store = Store(runtime.root, ID)
                hold = {"deadlineEpoch": flow.time.time() + 900,
                        "deadlineMonotonic": flow.time.monotonic() + 900, "containers": {"api": "synthetic-api"}}

                def held_export(install, **kwargs):
                    target = export_fixture(install, **kwargs)
                    flow.atomic_json(install.state / "maintenance.json", {"operationId": kwargs["operation_id"]})
                    return target

                with patch.object(flow, "CloudTransport"), patch.object(flow, "_command", side_effect=fake_age), \
                        patch.object(flow, "export_backup", side_effect=held_export), \
                        patch.object(flow, "consume_backup_hold", return_value=hold), \
                        patch.object(flow, "_deliver", side_effect=Blocked(code, "unverified integrity", "inspect")), \
                        patch.object(flow, "resume_backup_writers", return_value={"status": "OK", "previousRuntimeVerified": True}) as resume:
                    answer = Engine(runtime, store).execute(store.create("update", runtime.config["project"]))
                self.assertEqual(answer["backup"]["outcome"], "BLOCKED")
                self.assertNotIn("switch", runtime.calls)
                self.assertEqual(resume.call_count, 1)
                self.assertFalse(answer["backup"]["writers"]["held"])
                flow._verify_local(runtime.install, answer["backup"])

    def test_invalid_age_envelope_stays_fatal_with_best_effort(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)

            def invalid_age(args, **kwargs):
                Path(args[args.index("--output") + 1]).write_bytes(b"plaintext is not an AGE envelope")

            with patch.object(flow, "_command", side_effect=invalid_age), \
                    patch.object(flow, "export_backup", side_effect=export_fixture), patch.object(flow, "CloudTransport") as transport:
                result = flow.run_backup(install, operation_id=OP, installation_id=ID, snapshot_id=SNAP,
                    policy={"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
            self.assertEqual(result["outcome"], "BLOCKED")
            self.assertEqual(result["errors"][-1]["code"], "AGE_ENVELOPE")
            transport.assert_not_called()
            flow._verify_local(install, result)

    def test_retry_cannot_weaken_the_saved_required_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install, cloud=True)
            saved["policy"] = "required"
            with patch.object(flow, "_command", side_effect=fake_age):
                flow.encrypt_snapshot(install, saved, RECIPIENT)
            with patch.object(flow, "_deliver") as deliver, self.assertRaises(Blocked) as caught:
                flow.retry_delivery(install, snapshot_id=SNAP, installation_id=ID,
                    policy={"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True}})
            self.assertEqual(caught.exception.code, "BACKUP_POLICY_CHANGED")
            deliver.assert_not_called()

    def test_legacy_optional_backup_without_recipient_still_resumes_without_reexport(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            saved = receipt(install)
            saved["encryption"] = {"status": "FAILED", "error": "AGE_RECIPIENT"}
            flow._save(install, saved)
            flow.atomic_json(flow._receipt_root(install) / ("operation-" + OP + ".json"),
                             {"installationId": ID, "snapshotId": SNAP, "operationId": OP})
            with patch.object(flow, "export_backup") as export:
                resumed = flow.run_backup(install, operation_id=OP, installation_id=ID, allow_export=False,
                    policy={"policy": "best-effort", "cloud": {"enabled": False}})
            self.assertEqual(resumed["outcome"], "WARNING")
            self.assertEqual(resumed["encryption"]["status"], "NOT_CONFIGURED")
            export.assert_not_called()


if __name__ == "__main__":
    unittest.main()
