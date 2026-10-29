"""Crash/hold/identity acceptance boundaries without a live Docker daemon."""

import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, REGISTRY, SERVICES
from deployment.setup_config import private_json, read_installed_release, replace_legacy_manager_state, save_installed_release, save_private, validate_config, prepare_onboarding
from deployment.setup_operation import Engine, Runtime, Store, bootstrap_observation, bootstrap_record, onboard_owner
from deployment.contracts import read_env
from deployment.setup_result import finalize, render, result
from deployment.system import Installation, operation_lock
import asa_setup


IDENTITY = "c" * 32
UID = getattr(os, "geteuid", lambda: 0)()
REVISION = "a" * 40
RELEASE = {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab", "revision": REVISION,
           "schema": 275, "platform": "linux/amd64", "publicationRunId": 123,
           "images": {name: f"{REGISTRY}/{name}@sha256:" + "e" * 64 for name in SERVICES}}


def configuration(root):
    return {"format": "asa-setup-config-v1", "installationId": IDENTITY, "root": str(root),
            "operatorUid": UID, "profile": "production", "project": "asa-test",
            "entryOrigin": "https://asa.example.invalid", "backup": {"policy": "best-effort", "cloud": {"enabled": False},
            "schedule": {"enabled": False}, "retention": {"localKeep": None, "remoteKeep": None}}}


def receipt(outcome="ACCEPTED"):
    return {"outcome": outcome, "snapshotId": "20261029T000000Z-aabbccdd", "local": {"status": "OK"},
            "encryption": {"status": "OK"}, "cloud": {"status": "FAILED" if outcome in ("BLOCKED", "WARNING") else "OK"},
            "restore": {"status": "UNVERIFIED"}, "writers": {"held": outcome != "BLOCKED"}}


class FakeRuntime:
    def __init__(self, root):
        self.root = Path(root)
        self.config = configuration(root)
        self.install = SimpleNamespace(process_env={})
        self.calls = []
        self.old_revision = "b" * 40
        self.backup_outcome = "ACCEPTED"
        self.browser_status = "passed"
        self.technical_status = "passed"
        self.fail_at = None

    def record(self, name):
        self.calls.append(name)
        if self.fail_at == name:
            raise KeyboardInterrupt()

    def progress(self, text):
        pass

    def preflight(self, **kwargs):
        self.record("preflight")
        return {"status": "OK"}

    def select(self):
        self.record("select")
        return copy.deepcopy(RELEASE)

    def identity(self):
        self.record("identity")
        return {name: {"running": True, "mounts": [{"Type": "volume", "Name": name + "-data",
                "Source": "/var/lib/docker/volumes/" + name + "-data/_data", "Destination": target, "Driver": "local"}]}
                for name, target in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data"))}

    def current(self):
        self.record("current")
        return {"revision": self.old_revision, "schema": 274}

    def source(self, *args, **kwargs):
        self.record("source")
        return {"revision": REVISION}

    def handoff(self, *args):
        self.record("handoff")

    def verify_source(self, release):
        self.record("verify_source")

    def environment(self):
        self.record("environment")

    def settings(self):
        self.record("settings")

    def images(self, release):
        self.record("images")

    def estimate(self, **kwargs):
        self.record("space")
        return {"sufficient": True}

    def plan(self, *args, **kwargs):
        self.record("plan")
        return {"status": "OK"}

    def backup_preflight(self):
        self.record("backup_preflight")
        return {"status": "OK"}

    def backup(self, journal, **kwargs):
        self.record("backup")
        return {**receipt(self.backup_outcome), "snapshotId": kwargs.get("snapshot_id") or receipt()["snapshotId"]}

    def backup_receipt(self, journal, snapshot_id):
        self.record("backup_receipt")
        return {**receipt(self.backup_outcome), "snapshotId": snapshot_id}

    def resume_saved_backup(self, journal, snapshot_id=None):
        self.record("resume_saved_backup")
        return {**receipt(self.backup_outcome), "snapshotId": snapshot_id or receipt()["snapshotId"]}

    def consume_hold(self, journal):
        self.record("consume_hold")
        return {"deadlineEpoch": 9999999999}

    def switch(self, journal, hold):
        self.record("switch")

    def technical(self, journal):
        self.record("technical")
        return {"status": self.technical_status}

    def browser(self, journal):
        self.record("browser")
        return {"status": self.browser_status, "instanceId": IDENTITY, "revision": journal["release"]["revision"]}

    def commit_runtime(self, journal):
        self.record("commit")

    def diagnostics(self, journal):
        self.record("diagnostics")
        return {"status": "passed"}

    def rescue(self, journal):
        self.record("rescue")
        return {"previousRuntimeVerified": True}

    def recover_acceptance_backup(self, journal):
        self.record("recover_acceptance_backup")

    def stopped_restore(self, journal):
        self.record("stopped_restore")

    def owner(self, journal, store):
        self.record("owner")
        return {"status": "READY"}


class StateMachineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.store = Store(self.root, IDENTITY)
        self.runtime = FakeRuntime(self.root)
        self.engine = Engine(self.runtime, self.store)
        self.schedule = patch("deployment.setup_operation.backup_schedule.schedule_status", return_value={"configuration": {"enabled": False}})
        self.schedule.start()

    def tearDown(self):
        self.schedule.stop()
        self.directory.cleanup()

    def journal(self, mode="update"):
        return self.store.create(mode, self.runtime.config["project"])

    def test_required_cloud_failure_never_switches_and_verifies_rescue(self):
        journal = self.journal()
        self.runtime.backup_outcome = "BLOCKED"
        answer = self.engine.execute(journal)
        self.assertEqual((answer["outcome"], answer["exitCode"]), ("BLOCKED", 2))
        self.assertNotIn("switch", self.runtime.calls)
        self.assertIn("rescue", self.runtime.calls)
        self.assertTrue(answer["previousRuntime"]["previousRuntimeVerified"])
        self.assertFalse(answer["applicationAccepted"])

    def test_best_effort_cloud_failure_can_accept_application_with_warning(self):
        self.runtime.backup_outcome = "WARNING"
        answer = self.engine.execute(self.journal())
        self.assertEqual((answer["outcome"], answer["exitCode"]), ("WARNING", 0))
        self.assertTrue(answer["applicationAccepted"])
        self.assertFalse(answer["dataProtectionConfirmed"])
        self.assertLess(self.runtime.calls.index("backup"), self.runtime.calls.index("consume_hold"))
        self.assertLess(self.runtime.calls.index("consume_hold"), self.runtime.calls.index("switch"))

    def test_no_change_never_fetches_source_or_backups_or_repairs(self):
        self.runtime.old_revision = REVISION
        answer = self.engine.execute(self.journal())
        self.assertEqual(answer["outcome"], "NO_CHANGE")
        for name in ("source", "settings", "images", "plan", "backup", "backup_preflight", "switch", "browser"):
            self.assertNotIn(name, self.runtime.calls)
        self.assertFalse(answer["applicationAccepted"])
        self.assertEqual(answer["exitCode"], 2)

    def test_no_change_with_exact_historical_acceptance_is_zero_but_never_current_browser_pass(self):
        self.engine.execute(self.journal())
        self.runtime.old_revision = REVISION
        self.runtime.calls.clear()
        answer = self.engine.execute(self.journal())
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(answer["site"]["browser"]["status"], "historical_passed")
        self.assertNotIn("browser", self.runtime.calls)

    def test_explicit_no_change_acceptance_never_migrates_or_creates_backup(self):
        self.runtime.old_revision = REVISION
        journal = self.journal()
        first = self.engine.execute(journal)
        self.assertEqual(first["exitCode"], 2)
        self.runtime.calls.clear()
        answer = self.engine.execute(self.store.read(journal["operationId"]), acceptance_only=True)
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(answer["mode"], "acceptance")
        self.assertTrue(answer["applicationAccepted"])
        for action in ("switch", "plan", "source", "backup", "select"):
            self.assertNotIn(action, self.runtime.calls)

    def test_failed_pre_switch_rescue_retains_known_recovery_and_resume_only_rescues(self):
        journal = self.journal()
        self.runtime.backup_outcome = "BLOCKED"
        with patch.object(self.runtime, "rescue", side_effect=Blocked("RECOVERY_FAILED", "stopped", "inspect")):
            self.engine.execute(journal)
        pending = self.store.pending()
        self.assertEqual(pending["state"], "RECOVERY_REQUIRED")
        self.runtime.calls.clear()
        answer = self.engine.execute(pending, resume=True)
        self.assertEqual(answer["reasonCode"], "RECOVERY_RESOLVED")
        self.assertEqual(self.runtime.calls, ["rescue"])

    def test_matching_revision_without_runtime_proof_is_not_no_change(self):
        self.runtime.old_revision = REVISION
        self.runtime.technical_status = "failed"
        answer = self.engine.execute(self.journal())
        self.assertEqual(answer["reasonCode"], "NO_CHANGE_UNVERIFIED")
        self.assertNotIn("switch", self.runtime.calls)

    def test_switch_intent_survives_interrupt_and_resume_is_observe_only(self):
        journal = self.journal()
        self.runtime.fail_at = "switch"
        answer = self.engine.execute(journal)
        self.assertEqual(answer["exitCode"], 130)
        disk = self.store.read(journal["operationId"])
        self.assertEqual(disk["stages"]["switch"]["status"], "intent")
        self.assertEqual(disk["state"], "VERIFY_ONLY")
        self.assertNotIn("rescue", self.runtime.calls)
        self.runtime.calls.clear()
        self.runtime.fail_at = None
        answer = self.engine.execute(disk, resume=True)
        self.assertEqual(answer["exitCode"], 0)
        for name in ("select", "source", "images", "plan", "backup", "switch", "rescue"):
            self.assertNotIn(name, self.runtime.calls)
        self.assertIn("technical", self.runtime.calls)

    def test_unverified_switch_cannot_repeat_migration_or_auto_rollback(self):
        journal = self.journal()
        journal["release"] = copy.deepcopy(RELEASE)
        self.store.event(journal, "switch", "intent")
        self.runtime.technical_status = "failed"
        answer = self.engine.execute(journal, resume=True)
        self.assertEqual(answer["reasonCode"], "SWITCH_UNVERIFIED")
        self.assertEqual(self.runtime.calls, ["technical"])
        self.assertFalse(answer["automaticRollback"])

    def test_release_is_selected_once_across_pre_switch_resume(self):
        journal = self.journal()
        self.runtime.fail_at = "source"
        self.engine.execute(journal)
        disk = self.store.read(journal["operationId"])
        self.runtime.calls.clear()
        self.runtime.fail_at = None
        answer = self.engine.execute(disk, resume=True)
        self.assertEqual(answer["exitCode"], 0)
        self.assertNotIn("select", self.runtime.calls)
        self.assertEqual(disk["release"]["revision"], REVISION)

    def test_pending_browser_is_not_accepted_even_when_every_container_is_ready(self):
        self.runtime.browser_status = "incomplete"
        answer = self.engine.execute(self.journal())
        self.assertEqual((answer["outcome"], answer["exitCode"]), ("INCOMPLETE", 2))
        self.assertFalse(answer["applicationAccepted"])

    def test_fresh_owner_precedes_first_backup_and_no_preinstall_backup(self):
        answer = self.engine.execute(self.journal("install"))
        self.assertEqual(answer["exitCode"], 0)
        self.assertLess(self.runtime.calls.index("switch"), self.runtime.calls.index("owner"))
        self.assertLess(self.runtime.calls.index("owner"), self.runtime.calls.index("backup"))
        self.assertEqual(self.runtime.calls.count("backup"), 1)

    def test_failed_attempt_never_replaces_last_successful(self):
        first = self.engine.execute(self.journal())
        self.runtime.technical_status = "failed"
        second = self.engine.execute(self.journal())
        self.assertEqual(private_json(self.root / ".asa/setup-last-successful.json")["operationId"], first["operationId"])
        self.assertEqual(private_json(self.root / ".asa/setup-last-attempt.json")["operationId"], second["operationId"])

    def test_first_backup_delivery_retry_refreshes_same_snapshot_without_export(self):
        journal = self.journal("install")
        self.runtime.backup_outcome = "BLOCKED"
        first = self.engine.execute(journal)
        self.assertEqual(first["outcome"], "BLOCKED")
        snapshot = first["backup"]["snapshotId"]
        self.runtime.backup_outcome = "ACCEPTED"  # independent verified delivery receipt
        self.runtime.calls.clear()
        resumed = self.engine.execute(self.store.read(journal["operationId"]), resume=True)
        self.assertEqual(resumed["exitCode"], 0)
        self.assertEqual(resumed["backup"]["snapshotId"], snapshot)
        self.assertIn("backup_receipt", self.runtime.calls)
        self.assertNotIn("backup", self.runtime.calls)
        self.assertNotIn("switch", self.runtime.calls)

    def test_done_first_backup_error_recovers_its_hold_before_technical_verification(self):
        journal = self.journal("install")
        self.runtime.backup_outcome = "ERROR"
        first = self.engine.execute(journal)
        saved = self.store.read(journal["operationId"])
        self.assertEqual(first["outcome"], "ERROR")
        self.assertEqual(saved["stages"]["first_backup"]["status"], "done")
        self.runtime.calls.clear()
        self.runtime.technical_status = "failed"
        def recover(operation):
            self.runtime.calls.append("recover_acceptance_backup")
            self.runtime.technical_status = "passed"
            return {"status": "OK", "previousRuntimeVerified": True}
        with patch.object(self.runtime, "recover_acceptance_backup", side_effect=recover):
            resumed = self.engine.execute(saved, resume=True)
        self.assertEqual(self.runtime.calls[:2], ["recover_acceptance_backup", "technical"])
        self.assertEqual(resumed["site"]["technical"]["status"], "passed")
        self.assertIn("backup_receipt", self.runtime.calls)
        self.assertNotIn("backup", self.runtime.calls)
        self.assertNotIn("switch", self.runtime.calls)

    def test_promoted_first_snapshot_pending_receipt_continues_without_export_or_migration(self):
        journal = self.journal("install")
        self.runtime.backup_outcome = "ERROR"
        first = self.engine.execute(journal)
        snapshot = first["backup"]["snapshotId"]
        pending = {**receipt("ERROR"), "snapshotId": snapshot, "local": {"status": "PENDING"}, "encryption": {"status": "PENDING"}, "cloud": {"status": "PENDING"}}
        self.runtime.calls.clear()
        def continuation(operation, snapshot_id=None):
            self.runtime.calls.append("resume_saved_backup")
            self.assertEqual(snapshot_id, snapshot)
            self.assertEqual(operation["operationId"], journal["operationId"])
            return {**receipt("ACCEPTED"), "snapshotId": snapshot}
        with patch.object(self.runtime, "backup_receipt", return_value=pending), \
             patch.object(self.runtime, "resume_saved_backup", side_effect=continuation):
            answer = self.engine.execute(self.store.read(journal["operationId"]), resume=True)
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(answer["backup"]["snapshotId"], snapshot)
        self.assertIn("resume_saved_backup", self.runtime.calls)
        self.assertNotIn("backup", self.runtime.calls)
        self.assertNotIn("switch", self.runtime.calls)
        self.assertEqual(self.store.read(journal["operationId"])["stages"]["backup_continuation"]["status"], "done")

    def test_missing_hold_blocks_switch_and_recovers_previous_runtime(self):
        with patch.object(self.runtime, "consume_hold", side_effect=Blocked("BACKUP_WRITERS_RESUMED", "writers resumed", "new snapshot required")):
            answer = self.engine.execute(self.journal())
        self.assertEqual(answer["reasonCode"], "BACKUP_WRITERS_RESUMED")
        self.assertNotIn("switch", self.runtime.calls)
        self.assertIn("rescue", self.runtime.calls)

    def test_preparation_handoff_retains_same_open_journal(self):
        journal = self.journal("install")
        with patch.object(self.runtime, "preflight", side_effect=Blocked("DEPENDENCIES", "missing age", "prepare")):
            answer = self.engine.execute(journal)
        self.assertEqual(answer["outcome"], "PREPARATION_REQUIRED")
        self.assertEqual(self.store.pending()["operationId"], journal["operationId"])
        self.assertNotIn("switch", self.runtime.calls)


class ProcessKilled(BaseException):
    """An unhandled process death, without KeyboardInterrupt cleanup."""


class AuxiliaryRuntime(FakeRuntime):
    def __init__(self, root):
        super().__init__(root)
        self.install = SimpleNamespace(root=self.root, state=self.root / ".asa", settings={}, project=self.config["project"], process_env={})
        self.receipts = {}

    def current(self):
        self.record("current")
        if (self.install.state / "maintenance.json").exists():
            raise Blocked("HEALTH", "writers stopped", "recover exact hold")
        return {"revision": REVISION, "schema": RELEASE["schema"]}

    def recover_owned_backup(self, journal):
        self.record("recover_owned_backup")
        return Runtime.recover_owned_backup(self, journal)

    def known_backup_snapshot(self, journal):
        return next(value["snapshotId"] for value in self.receipts.values() if value["operationId"] == journal["operationId"])

    def backup(self, journal, *, hold, snapshot_id=None):
        self.record("backup")
        saved = {**receipt(self.backup_outcome), "format": "asa-backup-operation-v1", "installationId": IDENTITY,
                 "operationId": journal["operationId"], "snapshotId": snapshot_id or journal.get("snapshotId")}
        self.receipts[saved["snapshotId"]] = saved
        return copy.deepcopy(saved)

    def backup_receipt(self, journal, snapshot_id):
        self.record("backup_receipt")
        saved = self.receipts[snapshot_id]
        if saved["operationId"] != journal["operationId"]:
            raise Blocked("BACKUP_IDENTITY", "wrong operation", "inspect")
        return copy.deepcopy(saved)

    def resume_saved_backup(self, journal, snapshot_id=None):
        self.record("resume_saved_backup")
        return self.backup_receipt(journal, snapshot_id or self.known_backup_snapshot(journal))

    def incomplete_first_backup(self, journal, backup_journal):
        self.record("incomplete_first_backup")
        snapshot = backup_journal.get("snapshotId") or self.known_backup_snapshot(backup_journal)
        if self.receipts[snapshot]["local"]["status"] == "OK":
            raise Blocked("FIRST_BACKUP_ALREADY_SAVED", "already saved", "resume")
        return snapshot

    def verified_child_backup(self, parent, child):
        self.record("verified_child_backup")
        return self.backup_receipt(child, child["snapshotId"])


class AuxiliaryRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = Store(self.root, IDENTITY)
        self.runtime = AuxiliaryRuntime(self.root)
        self.original_snapshot = "20261029T000000Z-aabbccdd"

    def arguments(self, command, *extra):
        return asa_setup.parser().parse_args([command, "--root", str(self.root), *extra])

    def parent(self, *, incomplete=False):
        parent = self.store.create("install", self.runtime.config["project"])
        saved = {**receipt("BLOCKED"), "format": "asa-backup-operation-v1", "installationId": IDENTITY,
                 "operationId": parent["operationId"], "snapshotId": self.original_snapshot}
        if incomplete:
            saved.update(local={"status": "FAILED", "error": "BACKUP_INCOMPLETE"}, encryption={"status": "PENDING"}, cloud={"status": "PENDING"})
        self.runtime.receipts[self.original_snapshot] = saved
        save_private(self.root / ".asa/setup-backups" / ("operation-" + parent["operationId"] + ".json"),
                     {"operationId": parent["operationId"], "installationId": IDENTITY, "snapshotId": self.original_snapshot})
        parent.update(state="VERIFY_ONLY", release=copy.deepcopy(RELEASE), backupPolicy=copy.deepcopy(self.runtime.config["backup"]),
            stages={"switch": {"status": "done"}, "owner_grant": {"status": "done"},
                    "first_backup": {"status": "done", "evidence": copy.deepcopy(saved)}},
            result=result(parent["operationId"], IDENTITY, "install", outcome="BLOCKED", backup=copy.deepcopy(saved)))
        self.store.save(parent)
        return parent

    def verify_receipt(self, install, *, snapshot_id, installation_id):
        self.assertEqual(installation_id, IDENTITY)
        return copy.deepcopy(self.runtime.receipts[snapshot_id])

    def deliver(self, install, *, snapshot_id, installation_id, policy):
        self.runtime.receipts[snapshot_id].update(outcome="ACCEPTED", cloud={"status": "OK"})
        return copy.deepcopy(self.runtime.receipts[snapshot_id])

    def invoke(self, args):
        return asa_setup._auxiliary(args, self.runtime.config, self.runtime, self.store, self.store.pending())

    def test_standalone_backup_recovers_exact_hold_before_readiness_without_export(self):
        journal = self.store.create("backup", self.runtime.config["project"])
        journal.update(backupRuntime={"revision": REVISION, "schema": RELEASE["schema"]}, snapshotId=self.original_snapshot)
        self.store.event(journal, "backup", "intent", snapshotId=self.original_snapshot)
        self.runtime.receipts[self.original_snapshot] = {**receipt("BLOCKED"), "operationId": journal["operationId"],
            "local": {"status": "FAILED", "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}}
        marker = {"format": "asa-backup-hold-v1", "operationId": journal["operationId"], "installationId": IDENTITY,
                  "canonicalRoot": str(self.root), "composeProject": self.runtime.config["project"],
                  "snapshotId": self.original_snapshot, "runtime": journal["backupRuntime"], "containers": {"web": "exact-container"}}
        save_private(self.root / ".asa/maintenance.json", marker)
        def rescue(install, operation_id):
            self.assertEqual(operation_id, journal["operationId"])
            self.runtime.calls.append("exact_rescue")
            (self.root / ".asa/maintenance.json").unlink()
            return {"status": "OK", "previousRuntimeVerified": True}
        args = self.arguments("resume", "--operation-id", journal["operationId"])
        asa_setup._route_auxiliary_resume(args, self.store, self.store.pending())
        with patch("deployment.setup_operation.resume_backup_writers", side_effect=rescue):
            answer = self.invoke(args)
        self.assertEqual(answer["outcome"], "BLOCKED")
        self.assertLess(self.runtime.calls.index("exact_rescue"), self.runtime.calls.index("current"))
        self.assertIn("resume_saved_backup", self.runtime.calls)
        self.assertNotIn("backup", self.runtime.calls)
        self.assertNotIn("switch", self.runtime.calls)
        self.assertIsNone(self.store.pending())

    def test_hold_of_wrong_runtime_never_starts_writers(self):
        journal = self.store.create("backup", self.runtime.config["project"])
        journal.update(backupRuntime={"revision": REVISION, "schema": RELEASE["schema"]}, snapshotId=self.original_snapshot)
        self.store.event(journal, "backup", "intent")
        save_private(self.root / ".asa/maintenance.json", {"format": "asa-backup-hold-v1", "operationId": journal["operationId"],
            "installationId": IDENTITY, "canonicalRoot": str(self.root), "composeProject": self.runtime.config["project"],
            "snapshotId": self.original_snapshot, "runtime": {"revision": "b" * 40, "schema": RELEASE["schema"]}})
        with patch("deployment.setup_operation.resume_backup_writers") as resume:
            answer = self.invoke(self.arguments("backup", "--operation-id", journal["operationId"]))
        self.assertEqual(answer["reasonCode"], "BACKUP_RECOVERY_IDENTITY")
        self.assertEqual(self.store.pending()["state"], "RECOVERY_REQUIRED")
        self.assertNotIn("current", self.runtime.calls)
        resume.assert_not_called()

    def test_killed_dependent_cloud_delivery_reuses_child_and_keeps_one_pending_parent(self):
        parent = self.parent()
        args = self.arguments("retry-cloud", "--snapshot-id", self.original_snapshot)
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                self.invoke(args)
        children = self.store.children(parent)
        self.assertEqual(len(children), 1)
        child = children[0]
        self.assertEqual(child["stages"]["cloud_delivery"]["snapshotId"], self.original_snapshot)
        self.assertEqual(self.store.pending()["operationId"], parent["operationId"])
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=self.deliver):
            answer = self.invoke(args)
        self.assertEqual(answer["operationId"], child["operationId"])
        self.assertEqual(answer["parentOperationId"], parent["operationId"])
        self.assertEqual(len(self.store.children(parent)), 1)
        self.assertEqual(self.store.pending()["operationId"], parent["operationId"])

    def test_retried_terminal_child_is_durably_active_again_before_provider(self):
        parent = self.parent()
        args = self.arguments("retry-cloud", "--snapshot-id", self.original_snapshot)
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=self.deliver):
            first = self.invoke(args)
        self.assertEqual(self.store.read(first["operationId"])["state"], "TERMINAL")
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                self.invoke(args)
        self.assertEqual(self.store.children(parent, active=True)[0]["operationId"], first["operationId"])
        self.assertEqual(self.store.pending()["operationId"], parent["operationId"])

    def test_singleton_cloud_resume_uses_stage_snapshot_pin_and_rejects_conflict_before_provider(self):
        self.runtime.receipts[self.original_snapshot] = {**receipt("BLOCKED"), "operationId": "d" * 32}
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=KeyboardInterrupt):
            first = self.invoke(self.arguments("retry-cloud", "--snapshot-id", self.original_snapshot))
        journal = self.store.read(first["operationId"])
        self.assertEqual(first["exitCode"], 130)
        # Compatibility with the already durable pre-pin cloud_delivery stage.
        journal.pop("snapshotId")
        self.store.save(journal)
        conflict = self.arguments("resume", "--operation-id", journal["operationId"], "--snapshot-id", "20261029T000001Z-deadbeef")
        asa_setup._route_auxiliary_resume(conflict, self.store, self.store.pending())
        with patch("asa_setup.backup_workflow.verify_receipt") as provider_read, patch("asa_setup.backup_workflow.retry_delivery") as provider:
            blocked = self.invoke(conflict)
        self.assertEqual(blocked["reasonCode"], "BACKUP_IDENTITY")
        provider_read.assert_not_called()
        provider.assert_not_called()
        args = self.arguments("resume", "--operation-id", journal["operationId"])
        asa_setup._route_auxiliary_resume(args, self.store, self.store.pending())
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=self.deliver) as provider:
            answer = self.invoke(args)
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(provider.call_args.kwargs["snapshot_id"], self.original_snapshot)

    def test_incomplete_first_backup_child_cloud_retry_and_parent_acceptance_keep_all_ids(self):
        parent = self.parent(incomplete=True)
        original = copy.deepcopy(self.runtime.receipts[self.original_snapshot])
        self.runtime.backup_outcome = "BLOCKED"
        first = self.invoke(self.arguments("backup", "--operation-id", parent["operationId"]))
        child = self.store.read(first["operationId"])
        snapshot = first["backup"]["snapshotId"]
        self.assertNotEqual(snapshot, self.original_snapshot)
        self.assertNotEqual(child["operationId"], parent["operationId"])
        self.assertEqual(first["backup"]["operationId"], child["operationId"])
        saved_parent = self.store.read(parent["operationId"])
        self.assertEqual(saved_parent["stages"]["first_backup"]["backupOperationId"], child["operationId"])
        self.assertEqual(saved_parent["firstBackupHistory"][0]["evidence"]["snapshotId"], self.original_snapshot)
        self.assertEqual(self.runtime.receipts[self.original_snapshot], original)
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                self.invoke(self.arguments("retry-cloud", "--snapshot-id", snapshot))
        delivery = self.store.children(parent, active=True)[0]
        args = self.arguments("resume", "--operation-id", delivery["operationId"])
        asa_setup._route_auxiliary_resume(args, self.store, self.store.pending())
        with patch("asa_setup.backup_workflow.verify_receipt", side_effect=self.verify_receipt), \
             patch("asa_setup.backup_workflow.retry_delivery", side_effect=self.deliver):
            delivered = self.invoke(args)
        self.assertEqual(delivered["backup"]["operationId"], child["operationId"])
        self.runtime.calls.clear()
        answer = Engine(self.runtime, self.store).execute(self.store.read(parent["operationId"]), resume=True)
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(answer["backup"]["snapshotId"], snapshot)
        self.assertEqual(answer["backup"]["operationId"], child["operationId"])
        for forbidden in ("backup", "switch", "plan", "source", "select"):
            self.assertNotIn(forbidden, self.runtime.calls)
        self.assertEqual(self.runtime.receipts[self.original_snapshot], original)
        self.assertIsNone(self.store.pending())

    def test_kill_before_child_export_reuses_durable_binding_without_second_export(self):
        parent = self.parent(incomplete=True)
        with patch.object(self.runtime, "backup", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                self.invoke(self.arguments("backup", "--operation-id", parent["operationId"]))
        child = self.store.children(parent, active=True)[0]
        self.assertEqual(child["stages"]["backup"]["snapshotId"], child["snapshotId"])
        failed = {**receipt("BLOCKED"), "operationId": child["operationId"], "snapshotId": child["snapshotId"],
                  "local": {"status": "FAILED", "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}}
        args = self.arguments("resume", "--operation-id", child["operationId"])
        asa_setup._route_auxiliary_resume(args, self.store, self.store.pending())
        with patch.object(self.runtime, "resume_saved_backup", return_value=failed) as continuation, \
             patch.object(self.runtime, "backup", side_effect=AssertionError("second export")):
            answer = self.invoke(args)
        self.assertEqual(answer["operationId"], child["operationId"])
        self.assertEqual(answer["outcome"], "BLOCKED")
        self.assertEqual(continuation.call_args.args[1], child["snapshotId"])
        self.assertEqual(self.store.pending()["operationId"], parent["operationId"])

    def test_kill_before_original_backend_entry_preserves_first_pin_and_allows_new_child(self):
        parent = self.store.create("install", self.runtime.config["project"])
        with patch.object(self.runtime, "backup", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                Engine(self.runtime, self.store).execute(parent)
        interrupted = self.store.read(parent["operationId"])
        original = interrupted["stages"]["first_backup"]["snapshotId"]
        self.assertEqual(interrupted["stages"]["first_backup"]["status"], "intent")
        self.assertFalse((self.root / ".asa/setup-backups" / ("operation-" + parent["operationId"] + ".json")).exists())
        with patch.object(self.runtime, "incomplete_first_backup", side_effect=lambda operation, context:
                          Runtime.incomplete_first_backup(self.runtime, operation, context)):
            answer = self.invoke(self.arguments("backup", "--operation-id", parent["operationId"]))
        self.assertEqual(answer["exitCode"], 0)
        self.assertNotEqual(answer["backup"]["snapshotId"], original)
        updated = self.store.read(parent["operationId"])
        self.assertEqual(updated["firstBackupHistory"][0]["snapshotId"], original)
        self.runtime.calls.clear()
        accepted = Engine(self.runtime, self.store).execute(updated, resume=True)
        self.assertEqual(accepted["exitCode"], 0)
        self.assertEqual(accepted["backup"]["operationId"], answer["operationId"])
        self.assertNotIn("backup", self.runtime.calls)
        self.assertNotIn("switch", self.runtime.calls)

    def test_unfinished_child_blocks_parent_acceptance_before_runtime_mutation(self):
        parent = self.parent()
        child = self.store.create_child(parent, "retry-cloud", snapshot_id=self.original_snapshot, source_operation_id=parent["operationId"])
        with self.assertRaises(Blocked) as error:
            Engine(self.runtime, self.store).execute(parent, resume=True)
        self.assertEqual(error.exception.code, "DEPENDENT_PENDING")
        self.assertIn(child["operationId"], error.exception.action)
        self.assertEqual(self.runtime.calls, [])

    def test_child_receipt_adoption_requires_exact_manifest_runtime_operation_and_instance(self):
        parent = self.parent(incomplete=True)
        child = self.store.create_child(parent, "backup", snapshot_id="20261029T000001Z-deadbeef", replaces_snapshot_id=self.original_snapshot)
        saved = {**receipt(), "operationId": child["operationId"], "installationId": IDENTITY, "snapshotId": child["snapshotId"]}
        self.runtime.receipts[child["snapshotId"]] = saved
        manifest = {"operationId": child["operationId"], "installationId": IDENTITY, "snapshotId": child["snapshotId"],
                    "runtime": {"revision": REVISION, "schema": RELEASE["schema"]}}
        for change in ({"operationId": parent["operationId"]}, {"installationId": "f" * 32}, {"snapshotId": self.original_snapshot},
                       {"runtime": {"revision": "b" * 40, "schema": RELEASE["schema"]}},
                       {"runtime": {"revision": REVISION, "schema": 274}}):
            with self.subTest(change=change), patch("deployment.setup_operation.backup_workflow._verify_local", return_value=(None, {**manifest, **change})):
                with self.assertRaises(Blocked) as error:
                    Runtime.verified_child_backup(self.runtime, parent, child)
                self.assertEqual(error.exception.code, "FIRST_BACKUP_RUNTIME")
        with patch("deployment.setup_operation.backup_workflow._verify_local", return_value=(None, manifest)):
            self.assertEqual(Runtime.verified_child_backup(self.runtime, parent, child), saved)

    def test_failed_local_receipt_with_existing_final_must_continue_same_snapshot(self):
        parent = self.parent(incomplete=True)
        (self.root / "backups" / self.original_snapshot).mkdir(parents=True)
        with self.assertRaises(Blocked) as error:
            Runtime.incomplete_first_backup(self.runtime, parent, parent)
        self.assertEqual(error.exception.code, "FIRST_BACKUP_ALREADY_SAVED")

    def test_unknown_foreign_parent_or_two_active_siblings_fail_closed(self):
        parent = self.parent()
        child = self.store.create_child(parent, "retry-cloud", snapshot_id=self.original_snapshot, source_operation_id=parent["operationId"])
        original = copy.deepcopy(child)
        for fields in ({"parentOperationId": "e" * 32}, {"mode": "update"}, {"root": str(self.root / "other")}, {"installationId": "f" * 32}):
            with self.subTest(fields=fields):
                changed = {**copy.deepcopy(original), **fields}
                self.store.save(changed)
                with self.assertRaises(Blocked):
                    self.store.pending()
                self.store.save(copy.deepcopy(original))
        other = copy.deepcopy(original)
        other["operationId"] = "f" * 32
        self.store.save(other)
        with self.assertRaises(Blocked) as error:
            self.store.pending()
        self.assertEqual(error.exception.code, "DEPENDENTS_AMBIGUOUS")


class LockAndPrivateStateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    @unittest.skipIf(os.name == "nt", "POSIX legacy directory permission bits")
    def test_common_lock_accepts_owned_legacy_0755_without_changing_directory_permissions(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o755)
        state.chmod(0o755)
        with operation_lock(self.root) as descriptor:
            self.assertEqual(os.fstat(descriptor).st_mode & 0o777, 0o600)
            self.assertEqual(os.fstat(descriptor).st_uid, UID)
        self.assertEqual(state.stat().st_mode & 0o777, 0o755)

    @unittest.skipIf(os.name == "nt", "POSIX group-write directory permission bits")
    def test_common_lock_rejects_group_writable_0775_before_creating_lock(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        state.chmod(0o775)
        with self.assertRaises(Blocked) as caught:
            with operation_lock(self.root):
                self.fail("unsafe lock directory accepted")
        self.assertEqual(caught.exception.code, "LOCK_OWNER")
        self.assertFalse((state / "operation.lock").exists())

    @unittest.skipIf(os.name == "nt", "POSIX handoff")
    def test_lock_is_common_and_inherited_descriptor_keeps_exclusion(self):
        script = "import sys;sys.path.insert(0,sys.argv[1]);from deployment.system import operation_lock;from deployment.contracts import Blocked\ntry:\n with operation_lock(sys.argv[2]): print('acquired')\nexcept Blocked as e: print(e.code)"
        tools = str(Path(__file__).resolve().parents[1])
        with operation_lock(self.root) as descriptor:
            self.assertFalse(os.get_inheritable(descriptor))
            with operation_lock(self.root, inherited_fd=descriptor) as inherited:
                self.assertEqual(os.fstat(inherited).st_ino, os.fstat(descriptor).st_ino)
                child = subprocess.run([sys.executable, "-I", "-c", script, tools, str(self.root)], capture_output=True, text=True, check=True)
                self.assertEqual(child.stdout.strip(), "LOCKED")
        with operation_lock(self.root):
            pass

    def test_foreign_fd_cannot_handoff_an_unlocked_other_file(self):
        other = self.root / "other"
        other.write_text("x")
        with other.open("rb") as stream, operation_lock(self.root):
            with self.assertRaises(Blocked):
                with operation_lock(self.root, inherited_fd=stream.fileno()):
                    self.fail("foreign descriptor accepted")

    def test_symlink_journal_and_hardlink_private_file_rejected(self):
        safe = self.root / "safe.json"
        save_private(safe, {"token": "private"})
        linked = self.root / "linked.json"
        os.link(safe, linked)
        with self.assertRaises((Blocked, ValueError)):
            private_json(linked)
        linked.unlink()
        if os.name != "nt":  # Windows symlink creation requires a separate privilege.
            linked.symlink_to(safe)
            with self.assertRaises((Blocked, ValueError)):
                save_private(linked, {})
        self.assertEqual(json.loads(safe.read_text()), {"token": "private"})

    def test_unknown_config_keys_cannot_inject_a_command(self):
        value = configuration(self.root)
        value["command"] = "echo injected"
        with self.assertRaises(Blocked):
            validate_config(value, self.root, UID)

    def test_unknown_config_owner_and_root_rejected(self):
        value = configuration(self.root)
        value["operatorUid"] += 1
        with self.assertRaises(Blocked):
            validate_config(value, self.root, UID)

    def test_legacy_public_release_0644_is_read_and_atomically_replaced_without_weakening_secret_reads(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        path = state / "installed-release.json"
        path.write_text(json.dumps(RELEASE))
        path.chmod(0o644)
        self.assertEqual(read_installed_release(self.root), RELEASE)
        if os.name != "nt":
            with self.assertRaises(Blocked) as caught:
                private_json(path)
            self.assertEqual(caught.exception.code, "PRIVATE_PERMISSIONS")
        revised = {**RELEASE, "schema": RELEASE["schema"] + 1}
        save_installed_release(self.root, revised)
        self.assertEqual(read_installed_release(self.root), revised)
        if os.name != "nt":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipIf(os.name == "nt", "POSIX group-write permission bits")
    def test_group_writable_public_release_0664_is_never_read_or_replaced(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        path = state / "installed-release.json"
        original = json.dumps(RELEASE)
        path.write_text(original)
        path.chmod(0o664)
        for action in (lambda: read_installed_release(self.root), lambda: save_installed_release(self.root, RELEASE)):
            with self.assertRaises(Blocked) as caught:
                action()
            self.assertEqual(caught.exception.code, "RELEASE_PERMISSIONS")
        self.assertEqual(path.read_text(), original)

    def test_only_fixed_legacy_manager_records_can_be_validated_and_replaced_privately(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        installation = {"format": "asa-installation-v1", "profile": "production", "project": "asa-test", "automaticUpdates": True}
        runtime = {"revision": REVISION, "files": {"compose.yaml": "services: {}\n", "compose.frp.yaml": "private-overlay-fixture"}, "installedRelease": RELEASE}
        for name, record in (("installation.json", installation), ("runtime-configuration.json", runtime)):
            path = state / name
            path.write_text(json.dumps(record))
            path.chmod(0o644)
            replace_legacy_manager_state(self.root, name, record)
            self.assertEqual(private_json(path), record)
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(Blocked) as caught:
            replace_legacy_manager_state(self.root, "setup.json", {})
        self.assertEqual(caught.exception.code, "LEGACY_STATE_PATH")
        self.assertFalse((state / "setup.json").exists())

    @unittest.skipIf(os.name == "nt", "POSIX legacy metadata permission bits")
    def test_writable_legacy_runtime_configuration_is_not_replaced(self):
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        record = {"revision": REVISION, "files": {"compose.yaml": "services: {}\n"}, "installedRelease": RELEASE}
        path = state / "runtime-configuration.json"
        original = json.dumps(record)
        path.write_text(original)
        path.chmod(0o664)
        with self.assertRaises(Blocked) as caught:
            replace_legacy_manager_state(self.root, path.name, record)
        self.assertEqual(caught.exception.code, "LEGACY_STATE_PERMISSIONS")
        self.assertEqual(path.read_text(), original)


class FreezeDeadlineTests(unittest.TestCase):
    def test_old_runtime_recovery_wait_uses_one_budget_for_each_readiness_probe(self):
        install = Installation.__new__(Installation)
        clock = [100.0]
        deadlines = []
        def pending(revision, schema, *, deadline):
            deadlines.append(deadline)
            clock[0] = deadline + 1
            raise Blocked("HEALTH_TIMEOUT", "expired", "inspect")
        install.readiness = pending
        with patch("deployment.system.time.monotonic", side_effect=lambda: clock[0]), \
             patch("deployment.system.time.sleep") as sleep:
            with self.assertRaises(Blocked) as error:
                install.wait_ready(REVISION, RELEASE["schema"])
        self.assertEqual(error.exception.code, "HEALTH")
        self.assertEqual(deadlines, [400.0])
        sleep.assert_called_once_with(0)

    def test_compose_and_readiness_share_original_monotonic_deadline_despite_wallclock_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Runtime.__new__(Runtime)
            runtime.root = Path(temporary)
            runtime.config = configuration(runtime.root)
            clock = [100.0]
            timeouts = []
            def compose(*args, **kwargs):
                timeouts.append(kwargs["timeout"])
                clock[0] += 9.5
            def not_ready(*args, **kwargs):
                raise Blocked("HEALTH", "pending", "inspect")
            runtime.install = SimpleNamespace(state=runtime.root / ".asa", process_env={}, compose=compose, readiness=not_ready)
            journal = {"operationId": "e" * 32, "release": RELEASE}
            with patch("deployment.setup_operation.time.monotonic", side_effect=lambda: clock[0]), \
                 patch("deployment.setup_operation.time.time", return_value=-99999999), \
                 patch("deployment.setup_operation.time.sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)):
                with self.assertRaises(Blocked) as caught:
                    runtime.switch(journal, {"deadlineEpoch": 1, "deadlineMonotonic": 110.0, "bootId": "fixture"})
            self.assertEqual(caught.exception.code, "SWITCH_TIMEOUT")
            self.assertEqual(timeouts, [10.0])
            self.assertEqual(clock[0], 110.0)

    def test_readiness_returning_success_after_deadline_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Runtime.__new__(Runtime)
            runtime.root = Path(temporary)
            runtime.config = configuration(runtime.root)
            clock = [100.0]
            def compose(*args, **kwargs):
                clock[0] += 0.5
            def late_ready(*args, **kwargs):
                self.assertEqual(kwargs["deadline"], 101.0)
                clock[0] += 100
                return {"revision": REVISION, "schema": RELEASE["schema"]}
            runtime.install = SimpleNamespace(state=runtime.root / ".asa", process_env={}, compose=compose, readiness=late_ready)
            with patch("deployment.setup_operation.time.monotonic", side_effect=lambda: clock[0]), \
                 patch("deployment.setup_operation.time.sleep"):
                with self.assertRaises(Blocked) as caught:
                    runtime.switch({"operationId": "e" * 32, "release": RELEASE}, {"deadlineMonotonic": 101.0, "deadlineEpoch": 0, "bootId": "fixture"})
            self.assertEqual(caught.exception.code, "SWITCH_TIMEOUT")

    def test_every_readiness_http_and_compose_probe_receives_remaining_original_budget(self):
        install = Installation.__new__(Installation)
        install.env = {"ASA_WEB_PORT": "4610", "ASA_BLOCKS_PORT": "4613"}
        install.process_env = {"ASA_SEARCH_IMAGE": "pinned"}
        clock = [100.0]
        budgets = []
        ready = {"status": "ready", "deployment": {"revision": REVISION, "schemaVersion": 275, "expectedSchemaVersion": 275, "synchronized": True}}
        def response(url, *, timeout):
            budgets.append((timeout, 120 - clock[0]))
            clock[0] += 2
            payload = ready if url.endswith("health/ready") else {"revision": REVISION}
            stream = io.BytesIO(json.dumps(payload).encode())
            stream.status = 200
            return stream
        def compose(*args, **kwargs):
            budgets.append((kwargs["timeout"], 120 - clock[0]))
            clock[0] += 2
            return REVISION if "wget" in args or "cat" in args else ""
        install.compose = compose
        with patch("deployment.system.time.monotonic", side_effect=lambda: clock[0]), \
             patch("deployment.system.urllib.request.urlopen", side_effect=response):
            value = install.readiness(REVISION, 275, deadline=120)
        self.assertEqual(value["revision"], REVISION)
        self.assertEqual(len(budgets), 6)
        self.assertTrue(all(0 < timeout <= available for timeout, available in budgets))
        self.assertGreater(budgets[2][0], budgets[3][0])

    def test_expired_monotonic_hold_does_not_call_compose(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Runtime.__new__(Runtime)
            runtime.root = Path(temporary)
            runtime.config = configuration(runtime.root)
            runtime.install = SimpleNamespace(process_env={})
            with patch("deployment.setup_operation.time.monotonic", return_value=101):
                with self.assertRaises(Blocked) as caught:
                    runtime.switch({"release": RELEASE}, {"deadlineEpoch": 99999999, "deadlineMonotonic": 100})
            self.assertEqual(caught.exception.code, "BACKUP_FREEZE_TIMEOUT")

    def test_restoring_originally_stopped_stack_never_claims_old_site_is_running(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Runtime.__new__(Runtime)
            runtime.root = Path(temporary)
            runtime.install = SimpleNamespace(state=runtime.root / ".asa")
            journal = {"operationId": "a" * 32, "temporarilyStarted": ["old"]}
            save_private(runtime.install.state / "maintenance.json", {"format": "asa-backup-hold-v1", "operationId": journal["operationId"]})
            with patch("deployment.setup_operation.resume_backup_writers", return_value={"previousRuntimeVerified": True}), \
                 patch.object(runtime, "stopped_restore", return_value={"previousRuntimeVerified": False, "previousStateRestored": True, "previousState": "STOPPED"}):
                proof = runtime.rescue(journal)
            self.assertFalse(proof["previousRuntimeVerified"])
            self.assertEqual(proof["previousState"], "STOPPED")

    def test_actual_minio_entry_count_is_included_before_backup_freeze(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env").write_text("FIXTURE=private\n")
            runtime = Runtime.__new__(Runtime)
            runtime.root, runtime.config = root, configuration(root)
            commands = []
            def compose(*args, **kwargs):
                commands.append(args)
                return "100000" if "sh" in args else "1024 /data"
            runtime.install = SimpleNamespace(compose=compose)
            with patch("deployment.setup_operation.db_command", return_value="2048"), \
                 patch("deployment.setup_operation.setup_host.disk_budget", side_effect=lambda path, **values: values):
                proof = runtime.estimate()
            self.assertEqual(proof["snapshot_entries"], 100032)
            self.assertIn("pipefail", commands[-1][-1])
            self.assertIn("-print0", commands[-1][-1])


class ReportAndRoutesTests(unittest.TestCase):
    def test_schedule_budget_check_is_read_only_and_exec_start_claims_before_inventory_or_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration(root)
            for check in (True, False):
                args = asa_setup.parser().parse_args(["backup", "--root", str(root), "--scheduled"] + (["--schedule-budget-check"] if check else []))
                with self.subTest(check=check), patch("asa_setup.os.geteuid", return_value=1001, create=True), \
                     patch("asa_setup.setup_host.check_owner", return_value={"uid": 1001}), \
                     patch("asa_setup.load_config", return_value=config), \
                     patch("asa_setup.backup_schedule.scheduled_attempt", return_value="d" * 32) as attempt, \
                     patch("asa_setup.setup_discovery.docker_inventory", side_effect=ProcessKilled) as inventory, \
                     patch("asa_setup.operation_lock", side_effect=AssertionError("unexpected mutation lock")):
                    if check:
                        self.assertEqual(asa_setup.execute(args), 0)
                        inventory.assert_not_called()
                    else:
                        with self.assertRaises(ProcessKilled):
                            asa_setup.execute(args)
                        self.assertEqual(args.scheduled_operation_id, "d" * 32)
                    attempt.assert_called_once_with(root, IDENTITY, config["backup"]["schedule"], consume=not check)
            self.assertEqual(list(root.iterdir()), [])

    def test_human_report_has_six_sections_and_no_json_or_color_when_piped(self):
        stream = io.StringIO()
        render(result("a" * 32, IDENTITY, "auto", outcome="BLOCKED"), stream=stream)
        text = stream.getvalue()
        self.assertNotIn('"format"', text)
        self.assertNotIn("\033", text)
        for number in range(1, 7):
            self.assertIn(str(number) + ". ", text)
        self.assertIn("Следующее действие:", text)
        self.assertEqual(text.count(". [!]"), 6)

    def test_json_is_a_single_parseable_machine_envelope(self):
        stream = io.StringIO()
        render(result("a" * 32, IDENTITY, "status"), as_json=True, stream=stream)
        self.assertEqual(json.loads(stream.getvalue())["format"], "asa-setup-result-v1")

    def test_required_daily_schedule_cannot_be_reported_fully_accepted_before_install(self):
        value = result("a" * 32, IDENTITY, "install", site={"technical": {"status": "passed"}, "browser": {"status": "passed"}},
                       backup={**receipt(), "schedule": {"configuration": {"enabled": True}, "installed": False, "running": False}},
                       diagnostics={"status": "passed"})
        self.assertEqual(finalize(value)["exitCode"], 2)
        value["backup"]["schedule"].update(installed=True, running=True)
        self.assertEqual(finalize(value)["exitCode"], 0)

    def test_routes_and_aliases_are_real_parser_commands(self):
        for command in ("auto", "check", "status", "resume", "backup", "retry-cloud", "cloud-retry", "configure",
                        "cloud-configure", "schedule", "doctor", "diagnose", "repair-collector", "restore-plan", "acceptance"):
            args = asa_setup.parser().parse_args([command, "--root", "/tmp/example", "--config", "/tmp/example-config.json"])
            self.assertEqual(args.command, command)
            self.assertEqual(args.config_file, Path("/tmp/example-config.json"))

    def test_read_only_status_on_empty_target_creates_no_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory = {"complete": True, "containers": [], "volumes": [], "images": [], "daemon": {"id": "fixture"}}
            args = asa_setup.parser().parse_args(["status", "--root", str(root), "--json"])
            with patch("asa_setup.os.geteuid", return_value=1001, create=True), \
                 patch("asa_setup.setup_host.check_owner", return_value={"uid": 1001}), \
                 patch("asa_setup.setup_host.system_state", return_value={}), \
                 patch("asa_setup.setup_host.inspect_dependencies", return_value={}), \
                 patch("asa_setup.setup_discovery.docker_inventory", return_value=inventory), \
                 patch("asa_setup.operation_lock", side_effect=AssertionError("read-only acquired mutation lock")), \
                 patch("sys.stdout", new_callable=io.StringIO) as output:
                code = asa_setup.execute(args)
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output.getvalue())["discovery"]["state"], "FRESH")
            self.assertEqual(list(root.iterdir()), [])


class BootstrapAndSecretsTests(unittest.TestCase):
    def test_complete_initial_intent_can_recover_before_config_without_guessing_empty_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration(root)
            inventory = {"complete": True, "containers": [], "volumes": [], "images": [], "daemon": {"id": "fixture"}}
            store = Store(root, IDENTITY)
            journal = store.create("install", config["project"], bootstrap={"config": config, "inventory": inventory})
            observed = bootstrap_record(root, UID)
            self.assertEqual(observed["operationId"], journal["operationId"])
            self.assertEqual(bootstrap_observation(root, inventory, observed)["state"], "INTERRUPTED")
            self.assertFalse((root / ".asa/setup.json").exists())
            changed = copy.deepcopy(inventory)
            changed["volumes"] = [{"name": "unexpected"}]
            with self.assertRaises(Blocked):
                bootstrap_observation(root, changed, observed)
            (root / ".env").write_text("do-not-replace\n")
            with self.assertRaises(Blocked):
                bootstrap_observation(root, inventory, observed)

    def test_config_selected_foreign_project_is_rejected_under_the_common_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration(root)
            config["project"] = "foreign-stack"
            inventory = {"complete": True, "volumes": [], "images": [], "daemon": {"id": "fixture"}, "containers": [
                {"id": "d" * 64, "name": "foreign", "image": "postgres:17", "running": True,
                 "labels": {"project": "foreign-stack", "root": str(root / "other"), "service": "postgres"}, "mounts": []}]}
            with operation_lock(root):
                with self.assertRaises(Blocked) as caught:
                    asa_setup.validate_fresh_selection(root, config, inventory)
            self.assertEqual(caught.exception.code, "ROOT_DRIFT")
            self.assertFalse((root / ".env").exists())
            self.assertFalse((root / ".asa/setup.json").exists())

    def test_fresh_environment_secrets_are_generated_once_and_incomplete_file_is_never_reset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = Runtime(root, configuration(root))
            runtime.environment()
            original = (root / ".env").read_bytes()
            values = read_env(root / ".env")
            self.assertEqual(values["ASA_SEED_DEV"], "false")
            self.assertEqual(values["ASA_BLOCKS_RUNTIME_ORIGIN"], runtime.config["entryOrigin"])
            runtime.environment()
            self.assertEqual((root / ".env").read_bytes(), original)
            self.assertEqual(read_env(root / ".env")["POSTGRES_PASSWORD"], values["POSTGRES_PASSWORD"])
            (root / ".env").write_text("POSTGRES_PASSWORD=do-not-reset\n")
            with self.assertRaises(Blocked) as caught:
                runtime.environment()
            self.assertEqual(caught.exception.code, "ENV_INCOMPLETE")
            self.assertEqual((root / ".env").read_text(), "POSTGRES_PASSWORD=do-not-reset\n")

    def test_incomplete_noninteractive_owner_input_is_rejected_before_setup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration(root)
            config["onboardingFile"] = str(root / ".asa/onboarding.json")
            save_private(Path(config["onboardingFile"]), {"format": "asa-owner-onboarding-v1", "installationId": IDENTITY, "email": "owner@example.invalid"})
            with self.assertRaises(Blocked) as caught:
                prepare_onboarding(config, non_interactive=True)
            self.assertEqual(caught.exception.code, "OWNER_INPUT_REQUIRED")


class OwnerOnboardingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = configuration(self.root)
        self.config["onboardingFile"] = str(self.root / ".asa/onboarding.json")
        self.value = {"format": "asa-owner-onboarding-v1", "installationId": IDENTITY, "status": "NEW",
            "email": "owner@example.invalid", "username": "fixture-owner", "displayName": "Fixture", "birthDate": "1990-01-01",
            "country": "RU", "password": "private-fixture-password"}
        self.account_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        save_private(Path(self.config["onboardingFile"]), self.value)
        self.store = Store(self.root, IDENTITY)
        self.journal = self.store.create("install", self.config["project"])
        self.install = SimpleNamespace(root=self.root, state=self.root / ".asa")

    def tearDown(self):
        self.temporary.cleanup()

    def test_new_registration_exact_uuid_grant_and_repeat_verification_do_not_reset_credentials(self):
        calls = []
        def admin(install, private, mode):
            calls.append(mode)
            self.assertEqual(private["accountId"], self.account_id)
            return {"accountId": self.account_id, "platformAdmin": True}
        session = {"authenticated": True, "account": {"id": self.account_id, "email": self.value["email"]}}
        with patch("deployment.setup_operation.db_command", return_value="0"), \
             patch("deployment.setup_operation._bot_proof", return_value={"counter": 1}), \
             patch("deployment.setup_operation._owner_request", return_value=session) as request, \
             patch("deployment.setup_operation._owner_admin", side_effect=admin):
            first = onboard_owner(self.install, self.config, self.journal, self.store)
            second = onboard_owner(self.install, self.config, self.journal, self.store)
        self.assertEqual(first, second)
        self.assertEqual(calls, ["plan", "grant", "verify", "verify"])
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[2], "/api/auth/register")
        self.assertNotIn("password", json.dumps(first))
        self.assertEqual(private_json(Path(self.config["onboardingFile"]))["password"], self.value["password"])

    def test_ambiguous_registration_uses_login_proof_without_creating_second_account(self):
        self.value.update(status="REGISTER_INTENT", initiallyEmpty=True, operationId=self.journal["operationId"])
        save_private(Path(self.config["onboardingFile"]), self.value)
        session = {"authenticated": True, "account": {"id": self.account_id, "email": self.value["email"]}}
        with patch("deployment.setup_operation._bot_proof", return_value={}), \
             patch("deployment.setup_operation._owner_request", return_value=session) as request, \
             patch("deployment.setup_operation._owner_admin", return_value={"accountId": self.account_id, "platformAdmin": True}):
            onboard_owner(self.install, self.config, self.journal, self.store)
        self.assertEqual(request.call_args.args[2], "/api/auth/login")

    def test_preexisting_accounts_block_initial_grant_and_registration(self):
        with patch("deployment.setup_operation.db_command", return_value="1"), \
             patch("deployment.setup_operation._owner_request") as request, \
             patch("deployment.setup_operation._owner_admin") as admin:
            with self.assertRaises(Blocked) as caught:
                onboard_owner(self.install, self.config, self.journal, self.store)
        self.assertEqual(caught.exception.code, "OWNER_EXISTING_ACCOUNTS")
        request.assert_not_called()
        admin.assert_not_called()


class SourcePinTests(unittest.TestCase):
    def test_source_verification_rejects_modified_code_and_forbidden_private_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True).stdout.strip()
            git("init", "--quiet", "-b", "main")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("remote", "add", "origin", "https://github.com/spikeal8-maker/asa-lab.git")
            (root / "compose.yaml").write_text("services: {}\n")
            (root / ".gitignore").write_text(".asa/\n.env\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "fixture")
            revision = git("rev-parse", "HEAD")
            git("update-ref", "refs/remotes/origin/main", revision)
            runtime = Runtime(root, configuration(root))
            original_git = runtime.install.git
            runtime.install.git = lambda *args: "" if args[0] == "fetch" else original_git(*args)
            selected = {**RELEASE, "revision": revision}
            runtime.source(selected, fresh=True)
            runtime.verify_source(selected)
            (root / "compose.yaml").write_text("services: {foreign: {image: foreign}}\n")
            with self.assertRaises(Blocked) as caught:
                runtime.verify_source(selected)
            self.assertEqual(caught.exception.code, "SOURCE_CHANGED")
            (root / "compose.yaml").write_text("services: {}\n")
            (root / ".env").write_text("FIXTURE=private\n")
            git("add", "-f", ".env")
            git("commit", "--quiet", "-m", "invalid private tracked file")
            revision = git("rev-parse", "HEAD")
            git("update-ref", "refs/remotes/origin/main", revision)
            with self.assertRaises(Blocked) as caught:
                runtime.source({**RELEASE, "revision": revision}, fresh=True)
            self.assertEqual(caught.exception.code, "SOURCE_PRIVATE_PATH")


@unittest.skipUnless(os.name == "posix", "POSIX user bus/UID and descriptor inheritance")
class CollectorOwnerBoundaryTests(unittest.TestCase):
    def test_user_service_uses_its_verified_bus_and_same_lock_descriptor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / str(UID)
            runtime.mkdir(mode=0o700)
            (runtime / "bus").write_bytes(b"fixture")
            with patch("asa_setup.stat.S_ISSOCK", return_value=True):
                import pwd
                account = pwd.getpwuid(UID)
                owner = {"uid": UID, "gid": account.pw_gid, "name": account.pw_name, "home": account.pw_dir, "root": str(root)}
                operation = "f" * 32
                proof = {"format": "asa-setup-acceptance-v1", "kind": "collector", "operationId": operation, "status": "passed"}
                real_path = Path
                with patch("asa_setup.Path", side_effect=lambda value: root if str(value) == "/run/user" else real_path(value)), \
                     patch("asa_setup.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(proof))) as execute, \
                     patch.dict(os.environ, {"DBUS_SESSION_BUS_ADDRESS": "tcp:untrusted"}):
                    answer = asa_setup.user_collector_child(root, owner, 42, operation)
                self.assertEqual(answer["status"], "passed")
                self.assertEqual(execute.call_args.kwargs["user"], UID)
                self.assertEqual(execute.call_args.kwargs["pass_fds"], (42,))
                self.assertEqual(execute.call_args.kwargs["env"]["DBUS_SESSION_BUS_ADDRESS"], "unix:path=" + str(runtime / "bus"))


if __name__ == "__main__":
    unittest.main()
