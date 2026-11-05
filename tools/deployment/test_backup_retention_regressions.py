"""FIX-03: validate deletion plans and recover durable intents on synthetic files."""

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup_workflow as flow
from deployment.contracts import Blocked
from deployment.test_backup_workflow import ID, RECIPIENT, SNAP, MemoryCloud, fake_age, fake_install, receipt, snapshot


OLD = "20261027T000000Z-abcdef12"
MIDDLE = "20261028T000000Z-abcdef12"
LOCAL_POLICY = {"policy": "best-effort", "retention": {"localKeep": 1}}
BOTH_POLICY = {"policy": "best-effort", "ageRecipient": RECIPIENT, "cloud": {"enabled": True},
               "retention": {"localKeep": 1, "remoteKeep": 1}}


def copies(install, *, encrypted=False, provider=None, three=False):
    result = []
    identifiers = (OLD, MIDDLE, SNAP) if three else (OLD, SNAP)
    for index, identifier in enumerate(identifiers):
        at = "2026-10-" + identifier[6:8] + "T00:00:00+00:00"
        saved = receipt(install, identifier, str(index + 1) * 32, at, cloud=provider is not None)
        if encrypted or provider is not None:
            with patch.object(flow, "_command", side_effect=fake_age):
                target = flow.encrypt_snapshot(install, saved, RECIPIENT)
        if provider is not None:
            with patch.object(flow, "_command", return_value=b""):
                saved["cloud"] = provider.deliver(target, saved, install.state / "verify")
            flow._save(install, saved)
        result.append(saved)
    return result


def retention_journals(install):
    return [json.loads(flow.read_private(path)) for path in (flow._receipt_root(install) / "retention").glob("*.json")]


class RetentionRegressionTests(unittest.TestCase):
    def test_tampered_ciphertext_is_detected_before_local_snapshot_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, encrypted=True)
            Path(old["encryption"]["path"]).write_bytes(b"tampered ciphertext")
            with self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertTrue(Path(old["local"]["path"]).is_dir())
            self.assertTrue(Path(new["local"]["path"]).is_dir())
            self.assertNotIn("deletedAt", flow.load_receipt(install, OLD, ID)["local"])

    def test_every_candidate_is_validated_before_the_first_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            oldest, middle, new = copies(install, encrypted=True, three=True)
            Path(oldest["encryption"]["path"]).write_bytes(b"tampered oldest ciphertext")
            with self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            for saved in (oldest, middle, new):
                self.assertTrue(Path(saved["local"]["path"]).is_dir())
                self.assertTrue(Path(saved["encryption"]["path"]).is_file())

    def test_local_validation_precedes_remote_deletion_too(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            old, new = copies(install, provider=provider)
            Path(old["encryption"]["path"]).write_bytes(b"tampered ciphertext")
            provider.commands.clear()
            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", return_value=b""), self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
            self.assertFalse(any(command[0] == "deletefile" for command in provider.commands))
            self.assertIn(old["cloud"]["remote"], provider.objects)
            self.assertTrue(Path(old["local"]["path"]).is_dir())

    def test_last_remaining_local_copy_must_be_reverified_before_deleting_older_one(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install)
            (Path(new["local"]["path"]) / "database.dump").write_bytes(b"damaged last copy")
            with self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertTrue(Path(old["local"]["path"]).is_dir())

    def test_last_remaining_cloud_copy_must_be_reverified_before_deleting_older_one(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            old, new = copies(install, provider=provider)
            provider.objects[new["cloud"]["remote"]] = b"damaged newest remote"
            provider.commands.clear()
            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", return_value=b""), self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
            self.assertFalse(any(command[0] == "deletefile" for command in provider.commands))
            self.assertIn(old["cloud"]["remote"], provider.objects)

    def test_foreign_receipt_blocks_the_whole_plan_before_a_valid_copy_is_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            oldest, middle, new = copies(install, three=True)
            foreign = install.root / "owner-archive"
            foreign.mkdir()
            (foreign / "keep").write_bytes(b"owner data")
            oldest["local"]["path"] = str(foreign)
            flow._save(install, oldest)
            with self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertTrue(Path(middle["local"]["path"]).is_dir())
            self.assertEqual((foreign / "keep").read_bytes(), b"owner data")

    def test_partial_snapshot_deletion_resumes_from_durable_intent(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, encrypted=True)
            original_unlink = os.unlink
            interrupted = False

            def interrupt_after_unlink(path, *args, **kwargs):
                nonlocal interrupted
                answer = original_unlink(path, *args, **kwargs)
                if Path(path).name == "database.dump" and not interrupted:
                    interrupted = True
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow.os, "unlink", side_effect=interrupt_after_unlink), self.assertRaises(KeyboardInterrupt):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            journals = retention_journals(install)
            self.assertEqual(len(journals), 1)
            self.assertEqual(journals[0]["state"], "RUNNING")
            self.assertTrue((Path(old["local"]["path"]) / "manifest.json").is_file())
            resumed = flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertEqual(resumed["deleted"]["local"], [OLD])
            self.assertFalse(Path(old["local"]["path"]).exists())
            self.assertFalse(Path(old["encryption"]["path"]).exists())
            self.assertTrue(Path(new["local"]["path"]).is_dir())
            self.assertIn("deletedAt", flow.load_receipt(install, OLD, ID)["local"])
            self.assertEqual(retention_journals(install)[0]["state"], "DONE")
            self.assertEqual(flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)["deleted"], {"local": [], "remote": []})

    def test_missing_ciphertext_after_interruption_reconciles_without_repeating_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, encrypted=True)
            original_unlink = os.unlink
            encrypted = Path(old["encryption"]["path"])

            def interrupt_after_ciphertext(path, *args, **kwargs):
                answer = original_unlink(path, *args, **kwargs)
                if Path(path) == encrypted:
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow.os, "unlink", side_effect=interrupt_after_ciphertext), self.assertRaises(KeyboardInterrupt):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            resumed = flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertEqual(resumed["deleted"]["local"], [OLD])
            self.assertFalse(encrypted.exists())
            saved = flow.load_receipt(install, OLD, ID)
            self.assertIn("deletedAt", saved["local"])
            self.assertIn("deletedAt", saved["encryption"])

    def test_remote_delete_before_result_save_reconciles_with_verified_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            old, new = copies(install, provider=provider)
            original_call = provider.call
            deletions = []

            def interrupt_after_remote_delete(*args):
                answer = original_call(*args)
                if args[0] == "deletefile":
                    deletions.append(args[1])
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", return_value=b""):
                with patch.object(provider, "call", side_effect=interrupt_after_remote_delete), self.assertRaises(KeyboardInterrupt):
                    flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
                provider.commands.clear()
                resumed = flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
            self.assertEqual(deletions, [old["cloud"]["remote"]])
            self.assertFalse(any(command[0] == "deletefile" for command in provider.commands))
            self.assertEqual(resumed["deleted"], {"local": [OLD], "remote": [OLD]})
            self.assertIn("deletedAt", flow.load_receipt(install, OLD, ID)["cloud"])
            self.assertIn(new["cloud"]["remote"], provider.objects)

    def test_failed_intent_fsync_never_starts_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, encrypted=True)
            original_sync = flow._sync_directory

            def fail_intent_sync(path):
                if Path(path) == flow._receipt_root(install) / "retention":
                    journals = retention_journals(install)
                    if any(entry.get("snapshot", {}).get("status") == "INTENT"
                           for journal in journals for entry in journal["entries"]):
                        raise OSError("synthetic intent directory fsync failure")
                return original_sync(path)

            with patch.object(flow, "_sync_directory", side_effect=fail_intent_sync), self.assertRaises(OSError):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            flow._verify_local(install, old)
            self.assertTrue(Path(old["encryption"]["path"]).is_file())
            self.assertEqual(flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)["deleted"]["local"], [OLD])

    def test_result_receipt_write_failure_resumes_without_touching_deleted_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, encrypted=True)
            save = flow.atomic_json

            def fail_receipt(path, value):
                if Path(path).name == OLD + ".json" and value["local"].get("deletedAt"):
                    raise OSError("synthetic receipt persistence failure")
                return save(path, value)

            with patch.object(flow, "atomic_json", side_effect=fail_receipt), self.assertRaises(OSError):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertFalse(Path(old["local"]["path"]).exists())
            self.assertFalse(Path(old["encryption"]["path"]).exists())
            resumed = flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertEqual(resumed["deleted"]["local"], [OLD])
            self.assertIn("deletedAt", flow.load_receipt(install, OLD, ID)["local"])

    def test_new_files_in_a_partial_tree_are_not_treated_as_owned_garbage(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install)
            unlink = os.unlink

            def stop(path, *args, **kwargs):
                answer = unlink(path, *args, **kwargs)
                if Path(path).name == "database.dump":
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow.os, "unlink", side_effect=stop), self.assertRaises(KeyboardInterrupt):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            foreign = Path(old["local"]["path"]) / "owner-archive.age"
            foreign.write_bytes(b"unrelated owner archive")
            with self.assertRaises(Blocked):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertEqual(foreign.read_bytes(), b"unrelated owner archive")
            self.assertTrue(Path(new["local"]["path"]).is_dir())

    def test_a_replaced_snapshot_directory_is_not_deleted_by_an_old_intent(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install)
            unlink = os.unlink

            def stop(path, *args, **kwargs):
                answer = unlink(path, *args, **kwargs)
                if Path(path).name == "database.dump":
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow.os, "unlink", side_effect=stop), self.assertRaises(KeyboardInterrupt):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            original = Path(old["local"]["path"])
            original.rename(original.with_name("preserved-original-partial"))
            replacement = snapshot(install, OLD, old["operationId"], old["snapshotAt"])
            with self.assertRaises(Blocked) as caught:
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            self.assertEqual(caught.exception.code, "RETENTION_IDENTITY")
            self.assertTrue((replacement / "database.dump").is_file())

    def test_unavailable_remote_listing_never_counts_as_a_completed_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            old, new = copies(install, provider=provider)
            call = provider.call

            def interrupted(*args):
                answer = call(*args)
                if args[0] == "deletefile":
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", return_value=b""):
                with patch.object(provider, "call", side_effect=interrupted), self.assertRaises(KeyboardInterrupt):
                    flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
                with patch.object(provider, "call", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")):
                    deferred = flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
                self.assertEqual(deferred["status"], "DEFERRED")
                self.assertEqual(deferred["reasonCode"], "CLOUD_TIMEOUT")
                self.assertNotIn("deletedAt", flow.load_receipt(install, OLD, ID)["cloud"])
                self.assertTrue(Path(old["local"]["path"]).exists())
                self.assertEqual(flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)["deleted"]["remote"], [OLD])

    def test_changed_policy_cannot_resume_an_older_deletion_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install)
            unlink = os.unlink

            def stop(path, *args, **kwargs):
                answer = unlink(path, *args, **kwargs)
                if Path(path).name == "database.dump":
                    raise KeyboardInterrupt()
                return answer

            with patch.object(flow.os, "unlink", side_effect=stop), self.assertRaises(KeyboardInterrupt):
                flow.apply_retention(install, installation_id=ID, policy=LOCAL_POLICY)
            with self.assertRaises(Blocked) as caught:
                flow.apply_retention(install, installation_id=ID, policy={"policy": "best-effort", "retention": {"localKeep": None}})
            self.assertEqual(caught.exception.code, "RETENTION_POLICY_CHANGED")
            self.assertTrue(Path(old["local"]["path"]).is_dir())

    def test_foreign_cloud_namespace_is_rejected_before_any_archive_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            provider = MemoryCloud()
            oldest, middle, new = copies(install, provider=provider, three=True)
            oldest["cloud"]["remote"] = "yandex:Server-Backups/another-installation/owner.tar.age"
            flow._save(install, oldest)
            provider.commands.clear()
            with patch.object(flow, "CloudTransport", return_value=provider), patch.object(flow, "_command", return_value=b""), self.assertRaises(Blocked) as caught:
                flow.apply_retention(install, installation_id=ID, policy=BOTH_POLICY)
            self.assertEqual(caught.exception.code, "RETENTION_NAMESPACE")
            self.assertFalse(any(args[0] == "deletefile" for args in provider.commands))
            self.assertTrue(Path(middle["local"]["path"]).is_dir())

    def test_required_retention_outage_remains_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            install = fake_install(directory)
            old, new = copies(install, provider=MemoryCloud())
            with patch.object(flow, "CloudTransport", side_effect=Blocked("CLOUD_TIMEOUT", "offline", "retry")), self.assertRaises(Blocked) as caught:
                flow.apply_retention(install, installation_id=ID, policy={**BOTH_POLICY, "policy": "required"})
            self.assertEqual(caught.exception.code, "CLOUD_TIMEOUT")
            self.assertTrue(Path(old["local"]["path"]).is_dir())


if __name__ == "__main__":
    unittest.main()
