"""Fault-injection contracts for atomic Windows/production release updates.

All tests use fake installation + temporary paths. None creates live Docker
resources, alters working PostgreSQL, or downloads/publishes images.
"""

import contextlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.atomic_update import (
    AtomicSession, _bucket, _safe_identifier, atomic_status, atomic_recover,
)
from deployment import atomic_update as txn
from deployment.contracts import Blocked, atomic_json
import asa_manager

OLD_SHA = "a" * 40
NEW_SHA = "b" * 40
OLD = {"revision": OLD_SHA, "schema": 240, "images": {"api": "prior-api"}}
NEW = {"revision": NEW_SHA, "schema": 279, "images": {"api": "target-api"}}
PROJ = "asa-atomic-test"
OBJECT_VOLUME = PROJ + "_blocks-object-data"


class FakeInstallation:
    def __init__(self, root):
        self.root = Path(root)
        self.state = self.root / ".asa"
        self.state.mkdir(exist_ok=True)
        self.project = PROJ
        self.profile = "production"
        self.settings = {}
        self.env = {
            "POSTGRES_DB": "asalab",
            "POSTGRES_USER": "asalab_admin",
            "APP_DATABASE_URL": "postgres://asalab_app:private@postgres:5432/asalab",
            "MIGRATION_DATABASE_URL": "postgres://asalab_admin:private@postgres:5432/asalab",
            "MIGRATION_EXPECT_DATABASE": "asalab",
            "MIGRATION_CONFIRM": "APPLY:asalab",
            "ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4620",
            "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
            "ASA_SEED_DEV": "false",
            "ASA_ATOMIC_WRITE_FENCE": "isolated-test",
            "ASA_SEARCH_SECRET": "fixture-not-secret",
        }
        self.process_env = {}
        self.calls = []

    def compose(self, *args, **kwargs):
        self.calls.append(("compose", args))
        if "asa-s3-probe" in args:
            return "1991"
        return ""

    def identity(self, **kwargs):
        return {
            "minio": {"image": "old-minio", "id": "minio", "running": True,
                      "mounts": [{"Destination": "/data", "Name": OBJECT_VOLUME,
                                  "Type": "volume"}]},
            "postgres": {"image": "postgres:17.7-bookworm", "id": "postgres",
                         "running": True},
            "api": {"image": "prior-api", "id": "api", "running": True},
            "web": {"image": "prior-web", "id": "web", "running": True},
            "scratch": {"image": "prior-scratch", "id": "scratch", "running": True},
        }

    def receipt(self, value):
        self.calls.append(("receipt", value))


class AtomicStatusTests(unittest.TestCase):
    def test_no_journal_means_no_incomplete_update(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertIsNone(atomic_status(td))

    def test_marker_tamper_and_unsupported_phase_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            marker = root / ".asa" / "atomic-active.json"
            marker.parent.mkdir()
            for record in (
                {"format": "untrusted", "nonce": "e"*12, "root": str(root), "phase": "INITIALIZED"},
                {"format": "asa-atomic-update-v1", "nonce": "e"*12, "root": str(root),
                 "phase": "UNKNOWN"},
                {"format": "asa-atomic-update-v1", "nonce": "../", "root": str(root),
                 "phase": "INITIALIZED"},
            ):
                atomic_json(marker, record)
                with self.assertRaises(Blocked):
                    atomic_status(root)

    def test_tampered_database_or_volume_name_is_rejected_before_docker(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td).resolve()
            inst=FakeInstallation(root)
            for field,foreign in (
                ("stageDb","asa_foreign_test"),
                ("previousDb","asa_important_previous"),
                ("rollbackVolume","foreign-production-volume"),
            ):
                with self.subTest(field=field):
                    nonce="d"*12
                    state={
                        "format":"asa-atomic-update-v1",
                        "nonce":nonce,"root":str(root),"project":PROJ,
                        "profile":"production","phase":"NEW_DB_PROMOTED",
                        "oldDb":"asalab",
                        "stageDb":f"asa_txn_{nonce}_test",
                        "previousDb":f"asa_previous_{nonce}",
                        "failedDb":f"asa_failed_{nonce}",
                        "rollbackVolume":PROJ+"_asa_rollback_"+nonce,
                        "candidateVolume":PROJ+"_asa_candidate_"+nonce,
                    }
                    state[field]=foreign
                    atomic_json(inst.state/"atomic-active.json",state)
                    with patch.object(txn,"Installation",return_value=inst):
                        with self.assertRaises(Blocked) as error:
                            atomic_recover(root)
                    self.assertEqual(error.exception.code,"ATOMIC_JOURNAL")
                    self.assertEqual(inst.calls,[])

    def test_malformed_journal_types_fail_with_a_defined_error(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            state_dir = root / ".asa"
            state_dir.mkdir()
            marker = state_dir / "atomic-active.json"
            malformed = (
                [],
                None,
                {"format": "asa-atomic-update-v1", "root": str(root),
                 "phase": ["INITIALIZED"], "nonce": "e" * 12},
                {"format": "asa-atomic-update-v1", "root": str(root),
                 "phase": "INITIALIZED", "nonce": ["e" * 12]},
            )
            for value in malformed:
                with self.subTest(value=type(value).__name__):
                    atomic_json(marker, value)
                    with self.assertRaises(Blocked) as result:
                        atomic_status(root)
                    self.assertEqual(result.exception.code, "ATOMIC_JOURNAL")

    def test_completed_recovery_cannot_run_automatically(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            marker = root / ".asa" / "atomic-active.json"
            marker.parent.mkdir()
            atomic_json(marker, {"format": "asa-atomic-update-v1", "nonce": "d"*12,
                "root": str(root), "phase": "SUCCEEDED"})
            with self.assertRaises(Blocked) as failure:
                atomic_recover(root)
            self.assertEqual(failure.exception.code, "ATOMIC_ACCEPTED")


class AtomicRecoveryEvidenceTests(unittest.TestCase):
    def test_late_recovery_requires_scoped_complete_backup_and_hash_inventory(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            nonce = "e" * 12
            data = root / ".asa" / "atomic" / nonce
            good_backup = data / "backup" / "snapshot-1"
            foreign_backup = root / "other-project" / "snapshot-1"
            state = {"phase": "NEW_DB_PROMOTED", "nonce": nonce,
                     "backup": None}
            with self.assertRaises(Blocked) as missing:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(missing.exception.code, "ATOMIC_BACKUP")

            foreign_backup.mkdir(parents=True)
            (foreign_backup / "manifest.json").write_text("{}")
            state["backup"] = str(foreign_backup)
            with self.assertRaises(Blocked) as wrong_root:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(wrong_root.exception.code, "ATOMIC_BACKUP")

            good_backup.mkdir(parents=True)
            (good_backup / "manifest.json").write_text("{}")
            state["backup"] = str(good_backup)
            with self.assertRaises(Blocked) as no_hashes:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(no_hashes.exception.code, "ATOMIC_OBJECTS")

            (data / "old-object-hashes.private.json").write_text('{"asa-blocks/p":"a"}')
            self.assertEqual(txn._recovery_evidence_preflight(state, root),
                             "NEW_DB_PROMOTED")

            state["phase"] = "ROLLBACK_STARTED"
            with self.assertRaises(Blocked) as no_origin:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(no_origin.exception.code, "ATOMIC_JOURNAL")
            state["rollbackFromPhase"] = "NEW_DB_PROMOTED"
            self.assertEqual(txn._recovery_evidence_preflight(state, root),
                             "NEW_DB_PROMOTED")
            state["rollbackFromPhase"] = "RECOVERY_REQUIRED"
            with self.assertRaises(Blocked):
                txn._recovery_evidence_preflight(state, root)

    def test_early_phase_can_recover_without_backup_because_old_db_unchanged(self):
        with tempfile.TemporaryDirectory() as td:
            for phase in ("INITIALIZED", "FREEZE_STARTED", "WRITERS_STOPPED"):
                with self.subTest(phase=phase):
                    state = {"phase": phase, "nonce": "e" * 12}
                    self.assertEqual(txn._recovery_evidence_preflight(
                        state, Path(td)), phase)

    def test_rolled_back_phase_retains_its_original_evidence_requirements(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            data = root / ".asa" / "atomic" / ("e" * 12)
            snapshot = data / "backup" / "snapshot"
            state = {"phase": "ROLLED_BACK", "rollbackFromPhase": "NEW_DB_PROMOTED",
                     "nonce": "e" * 12, "backup": str(snapshot)}
            with self.assertRaises(Blocked) as missing:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(missing.exception.code, "ATOMIC_BACKUP")
            snapshot.mkdir(parents=True)
            (snapshot / "manifest.json").write_text("{}")
            with self.assertRaises(Blocked) as missing_hash:
                txn._recovery_evidence_preflight(state, root)
            self.assertEqual(missing_hash.exception.code, "ATOMIC_OBJECTS")
            (data / "old-object-hashes.private.json").write_text("{}")
            self.assertEqual(txn._recovery_evidence_preflight(state, root),
                             "NEW_DB_PROMOTED")

    def test_completed_rollback_finalization_only_removes_its_own_marker(self):
        import hashlib
        with tempfile.TemporaryDirectory() as td:
            install = FakeInstallation(td)
            (install.root / ".env").write_bytes(b"ASA_TEST_ENV=OLD\n")
            session = AtomicSession(install, NEW, OLD, nonce="e" * 12)
            session.directory.mkdir(parents=True)
            session.data.update(oldSchema=240,
                                oldCounts={"accounts": 3, "classrooms": 2,
                                           "seats": 30, "projects": 4},
                                oldS3Objects=1, oldVolume=OBJECT_VOLUME,
                                envSha256=hashlib.sha256((install.root / ".env").read_bytes()).hexdigest())
            session.phase("ROLLED_BACK", rollbackFromPhase="NEW_DB_PROMOTED")
            atomic_json(install.state / "installed-release.json", OLD)
            atomic_json(session.directory / "old-object-hashes.private.json",
                        {"asa-blocks/entry":"same", ".minio.sys/a":"before"})
            session.postgres_image="postgres:17.7-bookworm"
            install.readiness=Mock(return_value={"revision": OLD_SHA, "schema":240})
            with patch.object(txn, "run", return_value=OLD_SHA), \
                 patch.object(txn, "_db_schema", return_value=240), \
                 patch.object(txn, "_db_counts", return_value=session.data["oldCounts"]), \
                 patch.object(txn, "_s3_count", return_value=1), \
                 patch.object(txn, "_volume_hashes", return_value={
                     "asa-blocks/entry":"same", ".minio.sys/a":"changed"}), \
                 patch.object(txn, "_sql") as sql, \
                 patch.object(txn, "_copy_volume") as overwrite:
                result=txn._finalize_verified_rollback(session, install, OLD)
            self.assertEqual(result, "ROLLED_BACK_CONFIRMED")
            sql.assert_not_called()
            overwrite.assert_not_called()
            self.assertFalse(session.marker.exists())
            self.assertTrue((session.directory / "receipt.json").exists())

    def test_completed_rollback_finalization_refuses_changed_user_objects(self):
        import hashlib
        with tempfile.TemporaryDirectory() as td:
            install=FakeInstallation(td)
            (install.root / ".env").write_bytes(b"PREVIOUS_ENV=1\n")
            session=AtomicSession(install, NEW, OLD, nonce="e"*12)
            session.directory.mkdir(parents=True)
            session.data.update(oldSchema=240,
                                oldCounts={"accounts":2},
                                oldS3Objects=1, oldVolume=OBJECT_VOLUME,
                                envSha256=hashlib.sha256((install.root/".env").read_bytes()).hexdigest())
            session.phase("ROLLED_BACK",rollbackFromPhase="NEW_DB_PROMOTED")
            session.postgres_image="postgres:17.7-bookworm"
            atomic_json(install.state/"installed-release.json",OLD)
            atomic_json(session.directory/"old-object-hashes.private.json",
                        {"asa-blocks/entry":"old"})
            with patch.object(txn,"run",return_value=OLD_SHA), \
                 patch.object(txn,"_db_schema",return_value=240), \
                 patch.object(txn,"_db_counts",return_value=session.data["oldCounts"]), \
                 patch.object(txn,"_s3_count",return_value=1), \
                 patch.object(txn,"_volume_hashes",return_value={"asa-blocks/entry":"changed"}):
                with self.assertRaises(Blocked) as failure:
                    txn._finalize_verified_rollback(session,install,OLD)
            self.assertEqual(failure.exception.code,"ATOMIC_OBJECTS")
            self.assertTrue(session.marker.exists())
            self.assertFalse((session.directory/"receipt.json").exists())

    def test_missing_backup_stops_recover_before_docker_identity_or_writes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            nonce = "e" * 12
            state = {"format": "asa-atomic-update-v1", "nonce": nonce,
                     "project": "asa-atomic-test",
                     "stageDb": f"asa_txn_{nonce}_test",
                     "previousDb": f"asa_previous_{nonce}",
                     "failedDb": f"asa_failed_{nonce}",
                     "rollbackVolume": "asa-atomic-test_asa_rollback_" + nonce,
                     "candidateVolume": "asa-atomic-test_asa_candidate_" + nonce,
                     "root": str(root), "profile": "production",
                     "phase": "NEW_DB_PROMOTED", "backup": None}
            state_dir = root / ".asa"
            state_dir.mkdir()
            atomic_json(state_dir / "atomic-active.json", state)
            with patch.object(txn, "Installation") as install:
                with self.assertRaises(Blocked) as issue:
                    atomic_recover(root)
            self.assertEqual(issue.exception.code, "ATOMIC_BACKUP")
            install.assert_not_called()
            self.assertTrue((state_dir / "atomic-active.json").exists())


class AtomicSuccessFinalizationTests(unittest.TestCase):
    def fixture(self, td):
        # Mirror Installation.root: Windows GitHub runners may return a temp
        # directory with a different path casing than Path.resolve().
        install = FakeInstallation(Path(td).resolve())
        session = AtomicSession(install, NEW, OLD, nonce="e" * 12)
        session.directory.mkdir(parents=True)
        session.data.update(
            oldVolume=OBJECT_VOLUME,
            oldSchema=240, s3ObjectCount=1,
            appRole="asalab_app",
            previousDb=f"asa_previous_{session.nonce}",
        )
        session.phase("SUCCEEDED")
        atomic_json(install.state / "installed-release.json", NEW)
        install.readiness = Mock(return_value={"revision": NEW_SHA, "schema":279})
        rec=install.identity()
        rec["api"]["image"]="target-api"
        install.identity = Mock(return_value=rec)
        return install, session

    def test_completed_success_finalization_is_nondestructive_after_user_writes(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            names={session.data["oldDb"],session.data["previousDb"]}
            with patch.object(txn,"run",return_value=NEW_SHA), \
                 patch.object(txn,"_db_names",return_value=names), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(txn,"_volume",return_value=OBJECT_VOLUME), \
                 patch.object(txn,"_s3_count",return_value=12) as s3, \
                 patch.object(txn,"_db_counts") as counts, \
                 patch.object(txn,"_copy_volume") as copy, \
                 patch.object(txn,"_sql") as sql, \
                 patch.object(txn,"verify_embedded_entry_http") as entry, \
                 patch.object(session,"app_role_readonly",return_value=False):
                result=txn._finalize_verified_success(session,install,NEW)
            self.assertEqual(result,"ACCEPTED_CONFIRMED")
            counts.assert_not_called()
            copy.assert_not_called()
            sql.assert_not_called()
            s3.assert_called_once_with(install)
            entry.assert_called_once_with("http://127.0.0.1:4620",NEW_SHA)
            self.assertFalse(session.marker.exists())
            self.assertEqual(json.loads((session.directory/"receipt.json").read_text())["phase"],
                             "SUCCEEDED")
            receipt=[x[1] for x in install.calls if x[0]=="receipt"]
            self.assertEqual(len(receipt),1)
            self.assertEqual(receipt[0]["status"],"success")

    def test_successful_finalization_rejects_unpinned_runtime_image_without_cleanup(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            rec = install.identity()
            rec["api"]["image"] = "untrusted-api-image"
            install.identity = Mock(return_value=rec)
            with patch.object(txn,"run",return_value=NEW_SHA), \
                 patch.object(txn,"_db_names",return_value={
                     session.data["oldDb"],session.data["previousDb"]}), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(session,"app_role_readonly",return_value=False), \
                 patch.object(txn,"_copy_volume") as copy:
                with self.assertRaises(Blocked) as failure:
                    txn._finalize_verified_success(session, install, NEW)
            self.assertEqual(failure.exception.code,"ATOMIC_IMAGE_DRIFT")
            self.assertTrue(session.marker.exists())
            self.assertFalse((session.directory/"receipt.json").exists())
            copy.assert_not_called()

    def test_accepted_but_still_readonly_cannot_be_finalized(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            with patch.object(txn,"run",return_value=NEW_SHA), \
                 patch.object(txn,"_db_names",return_value={
                     session.data["oldDb"],session.data["previousDb"]}), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(session,"app_role_readonly",return_value=True):
                with self.assertRaises(Blocked) as error:
                    txn._finalize_verified_success(session,install,NEW)
            self.assertEqual(error.exception.code,"ATOMIC_WRITE_GATE")
            self.assertTrue(session.marker.exists())
            self.assertFalse((session.directory/"receipt.json").exists())

    def test_unexpected_existing_receipt_for_same_release_remains_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            receipt_path=install.state/"last-operation.json"
            atomic_json(receipt_path,{"status":"failed_switch","phase":"atomic",
                                      "selected":NEW})
            original=receipt_path.read_bytes()
            with patch.object(txn,"run",return_value=NEW_SHA), \
                 patch.object(txn,"_db_names",return_value={
                     session.data["oldDb"],session.data["previousDb"]}), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(txn,"_volume",return_value=OBJECT_VOLUME), \
                 patch.object(txn,"_s3_count",return_value=2), \
                 patch.object(txn,"verify_embedded_entry_http"), \
                 patch.object(session,"app_role_readonly",return_value=False):
                with self.assertRaises(Blocked) as error:
                    txn._finalize_verified_success(session,install,NEW)
            self.assertEqual(error.exception.code,"ATOMIC_RECEIPT")
            self.assertTrue(session.marker.exists())
            self.assertEqual(receipt_path.read_bytes(),original)

    def test_atomic_finalize_rejects_absent_or_not_successful_marker(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td).resolve()
            with self.assertRaises(Blocked) as absent:
                txn.atomic_finalize(root)
            self.assertEqual(absent.exception.code,"ATOMIC_NO_FINALIZE")
            path=root/".asa"/"atomic-active.json"
            path.parent.mkdir()
            atomic_json(path,{"format":"asa-atomic-update-v1",
                              "root":str(root),"nonce":"e"*12,
                              "phase":"NEW_DB_PROMOTED"})
            with patch.object(txn,"Installation") as make:
                with self.assertRaises(Blocked) as other:
                    txn.atomic_finalize(root)
            self.assertEqual(other.exception.code,"ATOMIC_NOT_ACCEPTED")
            make.assert_not_called()

    def test_successful_finalization_outer_wrapper_verifies_backup_identity(self):
        import hashlib
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            (install.root/".env").write_bytes(b"EXISTING_CONF=old\n")
            saved=session.directory/"old.private.env"
            saved.write_bytes((install.root/".env").read_bytes())
            atomic_json(session.directory/"installed-release.json",OLD)
            snapshot=session.directory/"backup"/"snapshot"
            snapshot.mkdir(parents=True)
            (snapshot/"manifest.json").write_text("{}")
            (session.directory/"old-object-hashes.private.json").write_text("{}")
            session.data.update(
                backup=str(snapshot),
                postgresImage="postgres:17.7-bookworm",
                envSha256=hashlib.sha256(saved.read_bytes()).hexdigest(),
            )
            session.phase("SUCCEEDED")
            with patch.object(txn,"Installation",return_value=install), \
                 patch("deployment.releases.apply_release_environment"), \
                 patch("deployment.releases.validate_resolved_images"), \
                 patch.object(txn,"_volume",return_value=OBJECT_VOLUME), \
                 patch.object(txn,"_db_names",return_value={
                     session.data["oldDb"],session.data["previousDb"]}), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(txn,"_s3_count",return_value=5), \
                 patch.object(txn,"run",return_value=NEW_SHA), \
                 patch.object(txn,"verify_embedded_entry_http"), \
                 patch.object(txn,"verify_backup",return_value={
                     "project":PROJ,"profile":"production",
                     "runtime":{"revision":OLD_SHA,"schema":240}}), \
                 patch.object(AtomicSession,"app_role_readonly",return_value=False):
                result=txn.atomic_finalize(install.root)
            self.assertEqual(result,"ACCEPTED_CONFIRMED")
            self.assertFalse(session.marker.exists())
            self.assertTrue((session.directory/"receipt.json").exists())


class AtomicPreflightTests(unittest.TestCase):
    def test_isolated_test_flag_never_authorizes_real_school_project(self):
        for actual_project in ("asa-lab-clean4620-20261024", "asa-lab-dev",
                               "asa-atomic-production", "other-app"):
            with self.subTest(project=actual_project), tempfile.TemporaryDirectory() as temp:
                inst = FakeInstallation(temp)
                inst.project = actual_project
                atomic_json(inst.state / "installed-release.json", OLD)
                with patch.object(asa_manager, "doctor"), \
                     patch.object(asa_manager, "clean_checkout") as checkout, \
                     patch.object(asa_manager, "discover_release") as discovery, \
                     patch.object(asa_manager, "fetch_images") as images:
                    with self.assertRaises(Blocked) as exception:
                        asa_manager.update(inst, atomic=True)
                self.assertEqual(exception.exception.code, "ATOMIC_QA_ONLY")
                checkout.assert_not_called()
                discovery.assert_not_called()
                images.assert_not_called()
                self.assertFalse((inst.state / "atomic-active.json").exists())

    def test_historical_collector_missing_known_file_degrades_without_mutations(self):
        with tempfile.TemporaryDirectory() as td:
            install=FakeInstallation(td)
            atomic_json(install.state/"installed-release.json",OLD)
            install.git=Mock(return_value=OLD_SHA)
            missing=install.root/"tools"/"memory_sampling.py"
            failure=FileNotFoundError(2,"Missing old diagnostic",str(missing))
            with patch.object(asa_manager,"collector_status",side_effect=failure):
                result=asa_manager.historical_collector_status(install)
            self.assertEqual(result["state"],"degraded")
            self.assertFalse(missing.exists())

    def test_historical_collector_rejects_missing_unrelated_or_current_file(self):
        with tempfile.TemporaryDirectory() as td:
            install=FakeInstallation(td)
            install.git=Mock(return_value=OLD_SHA)
            errors=[
                (OLD,"collector_runner.py","FileNotFoundError"),
                ({"revision":OLD_SHA,"schema":279},"memory_sampling.py","Blocked"),
                ({"revision":"c"*40,"schema":240},"memory_sampling.py","Blocked"),
            ]
            for receipt,filename,kind in errors:
                with self.subTest(case=kind+filename):
                    atomic_json(install.state/"installed-release.json",receipt)
                    failure=FileNotFoundError(2,"Missing",str(install.root/"tools"/filename))
                    with patch.object(asa_manager,"collector_status",side_effect=failure):
                        with self.assertRaises(FileNotFoundError if kind=="FileNotFoundError" else Blocked):
                            asa_manager.historical_collector_status(install)

    def test_nochange_ci_cache_requires_exact_accepted_release_and_still_attests_images(self):
        for case in ("accepted", "missing_receipt", "failed_receipt",
                     "wrong_manifest", "missing_s3_evidence"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as td:
                install=FakeInstallation(td)
                atomic_json(install.state/"installed-release.json",NEW)
                receipt={"status":"success","phase":"atomic","selected":NEW,
                         "userFlow":"not_run","s3Objects":1}
                if case=="failed_receipt":
                    receipt["status"]="failed_switch"
                elif case=="wrong_manifest":
                    receipt["selected"]={**NEW,"revision":"c"*40}
                elif case=="missing_s3_evidence":
                    receipt.pop("s3Objects")
                if case!="missing_receipt":
                    atomic_json(install.state/"last-operation.json",receipt)
                install.readiness=Mock(return_value={"revision":NEW_SHA,"schema":279})
                install.identity=Mock(return_value={"api":{"image":"target-api"}})
                unavailable=Blocked("CI_UNAVAILABLE","Synthetic network outage","Do not deploy")
                with patch.object(asa_manager,"doctor"), \
                     patch.object(asa_manager,"clean_checkout"), \
                     patch.object(asa_manager,"backup_directory"), \
                     patch.object(asa_manager,"attest_editor_env"), \
                     patch.object(asa_manager,"discover_release",return_value=NEW), \
                     patch.object(asa_manager,"assert_ci",side_effect=unavailable) as ci, \
                     patch.object(asa_manager,"verify_embedded_entry_http") as entry, \
                     patch.object(asa_manager,"prepare_collector") as collector, \
                     patch.object(asa_manager,"fetch_images") as images:
                    if case=="accepted":
                        asa_manager.update(install,atomic=True)
                        ci.assert_not_called()
                        entry.assert_called_once()
                    else:
                        with self.assertRaises(Blocked) as error:
                            asa_manager.update(install,atomic=True)
                        self.assertEqual(error.exception.code,"CI_UNAVAILABLE")
                        ci.assert_called_once_with(NEW)
                    collector.assert_not_called()
                    images.assert_not_called()

    def test_verified_atomic_nochange_never_runs_optional_collector_or_mutates(self):
        with tempfile.TemporaryDirectory() as td:
            install = FakeInstallation(td)
            atomic_json(install.state/"installed-release.json",NEW)
            install.readiness = Mock(return_value={"revision":NEW_SHA,"schema":279})
            install.identity = Mock(return_value={"api":{"image":"target-api"}})
            with patch.object(asa_manager,"doctor"), \
                 patch.object(asa_manager,"clean_checkout"), \
                 patch.object(asa_manager,"backup_directory"), \
                 patch.object(asa_manager,"attest_editor_env"), \
                 patch.object(asa_manager,"discover_release",return_value=NEW), \
                 patch.object(asa_manager,"assert_ci") as ci, \
                 patch.object(asa_manager,"verify_embedded_entry_http") as entry, \
                 patch.object(asa_manager,"prepare_collector") as collector, \
                 patch.object(asa_manager,"reconcile_collector") as reconcile, \
                 patch.object(asa_manager,"fetch_images") as images, \
                 patch.object(asa_manager,"selected_source") as switch, \
                 patch.object(asa_manager,"export_backup") as backup:
                asa_manager.update(install,atomic=True)
            ci.assert_called_once_with(NEW)
            entry.assert_called_once_with("http://127.0.0.1:4620",NEW_SHA)
            collector.assert_not_called()
            reconcile.assert_not_called()
            images.assert_not_called()
            switch.assert_not_called()
            backup.assert_not_called()
            self.assertFalse((install.state/"atomic-active.json").exists())

    def test_unsafe_update_is_rejected_before_git_switch_and_image_fetch(self):
        with tempfile.TemporaryDirectory() as td:
            install = FakeInstallation(td)
            install.env.pop("ASA_ATOMIC_WRITE_FENCE")
            with patch.object(asa_manager, "doctor"), \
                 patch.object(asa_manager, "clean_checkout") as checkout, \
                 patch.object(asa_manager, "discover_release") as fetch, \
                 patch.object(asa_manager, "fetch_images") as images:
                with self.assertRaises(Blocked) as failure:
                    asa_manager.update(install, atomic=True)
            self.assertEqual(failure.exception.code, "ATOMIC_FENCE")
            checkout.assert_not_called()
            fetch.assert_not_called()
            images.assert_not_called()

    def fixture(self, td):
        i = FakeInstallation(td)
        (i.root / ".env").write_text("ASA_TEST_ENV=private\n",encoding="utf-8")
        atomic_json(i.state / "installed-release.json", OLD)
        return i, AtomicSession(i, NEW, {"revision": OLD_SHA, "schema": 240},nonce="e"*12)

    def test_direct_session_cannot_bypass_disposable_qa_project_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            install, session = self.fixture(temp)
            install.project = "asa-lab-clean4620-20261024"
            with self.assertRaises(Blocked) as exception:
                session.begin()
            self.assertEqual(exception.exception.code, "ATOMIC_QA_ONLY")
            self.assertFalse(session.marker.exists())

    def test_dev_install_cannot_begin_or_touch_state(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            install.profile = "dev"
            with self.assertRaises(Blocked) as failure:
                session.begin()
            self.assertEqual(failure.exception.code, "ATOMIC_PROFILE")
            self.assertFalse(session.marker.exists())

    def test_public_ingress_is_blocked_before_any_writer_stop(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            install.env["ASA_UPDATE_ENTRY_ORIGIN"] = "https://school.example.test"
            with self.assertRaises(Blocked) as failure:
                session.begin()
            self.assertEqual(failure.exception.code, "ATOMIC_INGRESS")
            self.assertFalse(session.marker.exists())

    def test_loopback_without_external_ingress_attestation_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            install.env.pop("ASA_ATOMIC_WRITE_FENCE")
            with self.assertRaises(Blocked) as failure:
                session.begin()
            self.assertEqual(failure.exception.code, "ATOMIC_FENCE")
            self.assertFalse(session.marker.exists())

    def test_verified_private_baseline_creates_durable_journal_only(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            with patch.object(txn, "_volume", return_value=OBJECT_VOLUME),                  patch.object(txn, "_db_names", return_value=set()),                  patch.object(txn, "_db_schema", return_value=240),                  patch.object(txn, "_s3_count", return_value=1991),                  patch.object(txn, "_db_counts", return_value={"accounts":91, "classrooms":32,
                                                               "seats":419,"projects":1416}),                  patch.object(txn.subprocess, "run", return_value=SimpleNamespace(returncode=1)):
                session.begin()
            self.assertTrue(session.marker.is_file())
            self.assertTrue((session.directory/"old.private.env").is_file())
            self.assertTrue((session.directory/"installed-release.json").is_file())
            self.assertEqual(session.data["oldVolume"], OBJECT_VOLUME)
            journal=session.marker.read_text(encoding="utf-8")
            self.assertNotIn("ASA_TEST_ENV=private", journal)
            self.assertEqual(session.data["phase"], "INITIALIZED")

    def test_second_active_transaction_blocks_new_attempt(self):
        with tempfile.TemporaryDirectory() as td:
            _, session = self.fixture(td)
            session.marker.write_text("{}")
            with self.assertRaises(Blocked) as failure:
                session.begin()
            self.assertEqual(failure.exception.code, "ATOMIC_PENDING")

    def test_source_release_mismatch_aborts_before_mutations(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            atomic_json(install.state / "installed-release.json",
                        {"revision": "c"*40, "schema": 240})
            with self.assertRaises(Blocked) as failure:
                session.begin()
            self.assertEqual(failure.exception.code, "ATOMIC_RELEASE")
            self.assertFalse(session.marker.exists())

    def test_db_identifier_rejects_sql_injection_and_weird_unicode(self):
        for value in ("old'; DROP DATABASE asalab;", "Àsa", "a-b", " ", "a"*70):
            with self.subTest(value=value), self.assertRaises(Blocked):
                _safe_identifier(value)
        self.assertEqual(_safe_identifier("asa_txn_123456789012_test"),
                         "asa_txn_123456789012_test")


class AtomicFlowTests(unittest.TestCase):
    def fixture(self, td):
        install = FakeInstallation(td)
        session = AtomicSession(install, NEW,
                                {"revision": OLD_SHA, "schema": 240}, nonce="d"*12)
        session.directory.mkdir(parents=True,exist_ok=True)
        session.data["oldVolume"] = OBJECT_VOLUME
        session.data["oldImageIds"] = {n: n for n in ("postgres","web","api","scratch","minio")}
        session.data["postgresImage"] = "postgres:17.7-bookworm"
        session.postgres_image = "postgres:17.7-bookworm"
        session.data["oldSchema"] = 240
        session.data["oldCounts"] = {"accounts": 90, "classrooms":31, "seats":418,"projects":1414}
        session.data["appRole"] = "asalab_app"
        session.data["oldS3Objects"] = 1991
        return install,session

    def test_freeze_stops_every_persistent_writer_before_snapshot(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            with patch.object(txn, "_conn_count", return_value=0), \
                 patch.object(txn, "_db_schema", return_value=240), \
                 patch.object(txn, "_db_counts", return_value=session.data["oldCounts"]):
                session.freeze()
            self.assertEqual(session.data["phase"],"WRITERS_STOPPED")
            self.assertEqual(install.calls[0],("compose",
                ("stop","web","api","scratch","minio")))
            self.assertTrue(session.marker.is_file())

    def test_freeze_failclosed_when_other_session_remains(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            with patch.object(txn, "_conn_count", return_value=1):
                with self.assertRaises(Blocked) as failure:
                    session.freeze()
            self.assertEqual(failure.exception.code,"ATOMIC_WRITERS")
            self.assertEqual(session.data["phase"],"WRITERS_STOPPED")

    def test_shadow_restore_only_runs_migrations_against_generated_name(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            session.data["backup"]=str(Path(td)/"backup")
            target=FakeInstallation(td)
            with patch.object(txn, "restore_check") as restore, \
                 patch.object(txn, "_db_counts", return_value=session.data["oldCounts"]), \
                 patch.object(txn, "_db_schema", return_value=279), \
                 patch.object(txn, "_sql", return_value=""):
                session.stage_db(target)
            restore.assert_called_once_with(install,Path(td)/"backup",session.data["stageDb"])
            self.assertEqual(target.process_env["MIGRATION_EXPECT_DATABASE"],
                             session.data["stageDb"])
            self.assertEqual(target.process_env["MIGRATION_CONFIRM"],
                             "APPLY:"+session.data["stageDb"])
            self.assertTrue(target.process_env["MIGRATION_DATABASE_URL"].endswith(
                "/"+session.data["stageDb"]))
            migrations=[args for name,args in target.calls if "tools/migrate.mjs" in args]
            self.assertEqual(len(migrations),3)
            self.assertEqual([args[-1] for args in migrations],
                             ["--plan","--apply","--plan"])
            self.assertEqual(session.data["phase"],"MIGRATED")

    def test_no_db_rename_if_active_connection(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            with patch.object(txn, "_db_names", return_value={
                session.data["oldDb"], session.data["stageDb"]}), \
                 patch.object(txn,"_conn_count",return_value=2), \
                 patch.object(txn,"_sql") as sql:
                with self.assertRaises(Blocked) as failure:
                    session.promote(FakeInstallation(td))
            self.assertEqual(failure.exception.code,"ATOMIC_WRITERS")
            sql.assert_not_called()

    def test_stable_minio_bucket_ignores_volatile_internal_metadata(self):
        expected={"asa-blocks/data/one":"abc",".minio.sys/cache":"old"}
        actual={"asa-blocks/data/one":"abc",".minio.sys/cache":"new",
                ".minio.sys/log":"new"}
        self.assertEqual(_bucket(expected,"asa-blocks"),_bucket(actual,"asa-blocks"))
        actual["asa-blocks/data/one"]="mismatch"
        self.assertNotEqual(_bucket(expected,"asa-blocks"),_bucket(actual,"asa-blocks"))

    def test_candidate_health_checks_bucket_and_s3_without_public_web(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            old_hashes={"asa-blocks/sample":"abc",".minio.sys/a":"old"}
            new_hashes={"asa-blocks/sample":"abc",".minio.sys/a":"changed"}
            target=FakeInstallation(td)
            with patch.object(session,"app_role_readonly",return_value=True), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(txn,"_volume_hashes",side_effect=[new_hashes,old_hashes]), \
                 patch.object(txn,"_s3_count",return_value=1991):
                session.verify_candidate_without_ingress(target)
            self.assertEqual(session.data["phase"],"CANDIDATE_STARTED")
            self.assertEqual(session.data["s3ObjectCount"],1991)
            self.assertEqual(target.process_env["MIGRATION_EXPECT_DATABASE"],"asalab")
            self.assertEqual(target.process_env["MIGRATION_CONFIRM"],"APPLY:asalab")
            self.assertTrue(target.process_env["MIGRATION_DATABASE_URL"].endswith("/asalab"))
            self.assertFalse(any("web" in call[1] for call in install.calls if call[0]=="compose"))

    def test_candidate_s3_drift_blocks_before_public_web(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            hashes={"asa-blocks/sample":"abc"}
            with patch.object(session,"app_role_readonly",return_value=True), \
                 patch.object(txn,"_db_schema",return_value=279), \
                 patch.object(txn,"_volume_hashes",return_value=hashes), \
                 patch.object(txn,"_s3_count",return_value=1990):
                with self.assertRaises(Blocked) as problem:
                    session.verify_candidate_without_ingress(FakeInstallation(td))
            self.assertEqual(problem.exception.code,"ATOMIC_S3")

    def test_candidate_web_must_remain_gated_and_auth_still_not_claimed(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            with patch.object(session,"app_role_readonly",return_value=False):
                with self.assertRaises(Blocked) as error:
                    session.expose_and_accept(FakeInstallation(td))
            self.assertEqual(error.exception.code,"ATOMIC_WRITE_GATE")
            self.assertFalse(any("up" in c[1] for c in install.calls if c[0]=="compose"))

    def test_foreign_pending_marker_never_triggers_a_new_attempt_rollback(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            previous = {"format": "asa-atomic-update-v1", "nonce": "f" * 12,
                        "root": str(Path(td)), "phase": "NEW_DB_PROMOTED"}
            atomic_json(session.marker, previous)
            initial_bytes = session.marker.read_bytes()
            with patch.object(session, "rollback_before_ingress") as rollback, \
                 patch.object(install, "compose") as compose:
                with self.assertRaises(Blocked) as issue:
                    session.run(FakeInstallation(td))
            self.assertEqual(issue.exception.code, "ATOMIC_PENDING")
            rollback.assert_not_called()
            compose.assert_not_called()
            self.assertFalse(session._started_this_run)
            self.assertEqual(session.marker.read_bytes(), initial_bytes)

    def test_auto_rollback_for_every_preexposure_failure(self):
        methods=("freeze","frozen_backup","stage_db","stage_objects",
                 "promote","verify_candidate_without_ingress")
        for failed_method in methods:
            with self.subTest(phase=failed_method), tempfile.TemporaryDirectory() as td:
                install,session=self.fixture(td)
                failure=Blocked("INJECTED","Synthetic stage failure","Only test")
                events=[]
                def start(*a):
                    session.phase("INITIALIZED")
                    session._started_this_run = True
                    events.append("begin")
                with contextlib.ExitStack() as stack:
                    stack.enter_context(patch.object(session,"begin",side_effect=start))
                    for name in methods:
                        def stage(*a, _name=name):
                            events.append(_name)
                            if _name==failed_method:
                                raise failure
                        stack.enter_context(patch.object(session,name,side_effect=stage))
                    rollback=stack.enter_context(patch.object(session,"rollback_before_ingress",
                                                                side_effect=lambda: events.append("rollback")))
                    expose=stack.enter_context(patch.object(session,"expose_and_accept"))
                    with self.assertRaises(Blocked):
                        session.run(FakeInstallation(td))
                rollback.assert_called_once()
                expose.assert_not_called()
                self.assertEqual(events[-1],"rollback")

    def test_accepted_stage_failed_restart_requires_manual_recovery(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            def begin(*_):
                session.phase("ACCEPTED_READ_ONLY")
                session._started_this_run = True
            with patch.object(session,"begin",side_effect=begin),\
                 patch.object(session,"freeze",side_effect=RuntimeError("failed")):
                with self.assertRaises(Blocked) as failure:
                    session.run(FakeInstallation(td))
            self.assertEqual(failure.exception.code,"ATOMIC_RECOVERY_REQUIRED")
            self.assertEqual(session.data["phase"],"RECOVERY_REQUIRED")
            self.assertTrue(session.data["possibleNewWrites"])
            self.assertTrue(session.marker.exists())

    def test_preacceptance_failure_restores_database_objects_env_and_source(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            session.phase("NEW_DB_PROMOTED")
            session.data["backup"] = str(Path(td)/"backup")
            old_env = session.directory/"old.private.env"
            old_env.write_bytes(b"PREVIOUS_ENV=true\n")
            (install.root/".env").write_bytes(b"NEW_ENV=true\n")
            import hashlib
            session.data["envSha256"] = hashlib.sha256(old_env.read_bytes()).hexdigest()
            atomic_json(session.directory/"installed-release.json", OLD)
            atomic_json(install.state/"installed-release.json", OLD)
            # Resume a real-world interrupted rollback whose private config
            # temp file and legacy guard were already durably written.
            (install.root/".env.asa-atomic-recover.tmp").write_bytes(old_env.read_bytes())
            atomic_json(install.state/"failed-switch.json",{
                "phase":"atomic_rollback","nonce":session.nonce,
                "previous":session.previous,"selected":session.release})
            frozen_hash = {"asa-blocks/sample":"old-sha"}
            current_hash = {"asa-blocks/sample":"new-sha"}
            atomic_json(session.directory/"old-object-hashes.private.json", frozen_hash)
            session.data["rollbackVolume"] = "owned-rollback"
            database_names = {session.data["oldDb"], session.data["previousDb"]}
            active_hash = {"value":current_hash}
            sql_calls = []

            def sql_side_effect(inst, query, **kwargs):
                sql_calls.append(query)
                words = query.split()
                if words[:2] == ["ALTER","DATABASE"]:
                    source, target = words[2], words[-1]
                    self.assertIn(source,database_names)
                    self.assertNotIn(target,database_names)
                    database_names.remove(source)
                    database_names.add(target)
                return ""

            def volume_side_effect(volume, *_):
                return frozen_hash if volume=="owned-rollback" else active_hash["value"]

            def copy_side_effect(source, destination, *_a, **_k):
                self.assertEqual(source,"owned-rollback")
                self.assertEqual(destination,OBJECT_VOLUME)
                active_hash["value"]=dict(frozen_hash)

            previous=FakeInstallation(td)
            previous.wait_ready=Mock(return_value=None)
            # Staged user files are never thrown away; the new active DB is
            # quarantined under an explicit failed name.
            with patch.object(txn,"_db_names",side_effect=lambda *_:set(database_names)), \
                 patch.object(txn,"_sql",side_effect=sql_side_effect), \
                 patch.object(txn,"_db_schema",return_value=240), \
                 patch.object(txn,"_db_counts",return_value=session.data["oldCounts"]), \
                 patch.object(txn,"_volume_hashes",side_effect=volume_side_effect), \
                 patch.object(txn,"_copy_volume",side_effect=copy_side_effect), \
                 patch.object(txn,"run",return_value=""), \
                 patch.object(txn,"Installation",return_value=previous):
                session.rollback_before_ingress()
            self.assertEqual(session.data["phase"],"ROLLED_BACK")
            self.assertEqual(install.root.joinpath(".env").read_bytes(),old_env.read_bytes())
            self.assertEqual(database_names,{session.data["oldDb"],session.data["failedDb"]})
            self.assertEqual(active_hash["value"],frozen_hash)
            self.assertFalse(session.marker.exists())
            self.assertFalse((install.state/"failed-switch.json").exists())
            self.assertFalse((install.root/".env.asa-atomic-recover.tmp").exists())
            self.assertTrue((session.directory/"receipt.json").exists())
            self.assertTrue(any("RENAME TO " + session.data["failedDb"] in s for s in sql_calls))

    def test_exposed_web_without_readonly_role_never_auto_restores_database(self):
        with tempfile.TemporaryDirectory() as td:
            install, session = self.fixture(td)
            session.phase("VERIFYING")
            with patch.object(session,"app_role_readonly",return_value=False):
                with self.assertRaises(Blocked) as failure:
                    session.rollback_before_ingress()
            self.assertEqual(failure.exception.code,"ATOMIC_RECOVERY_REQUIRED")
            self.assertEqual(session.data["phase"],"VERIFYING")

    def test_archived_success_does_not_leave_an_active_operation_marker(self):
        with tempfile.TemporaryDirectory() as td:
            install,session=self.fixture(td)
            session.phase("SUCCEEDED")
            session.archive_finished()
            self.assertFalse(session.marker.exists())
            self.assertEqual(json.loads((session.directory/"receipt.json").read_text())["phase"],"SUCCEEDED")


if __name__=="__main__":
    unittest.main()
