"""Fault-injection recovery plans for ASA Lab PostgreSQL + MinIO cutover."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked
from deployment.cutover_safety import RECOVERABLE_PHASES, recovery_plan


class RecoveryPlanTests(unittest.TestCase):
    def facts(self, **changes):
        facts = dict(
            databases={"asalab"}, active_database="asalab",
            previous_database="asa_previous_20261029",
            failed_database="asa_failed_20261029",
            active_data_is_old=True, old_volume_equal=True,
            rollback_volume_verified=True, old_configuration_verified=True,
            configuration_equal=True, backup_verified=True
        )
        facts.update(changes)
        return facts

    def test_accepted_restore_must_never_be_rolled_back_automatically(self):
        with self.assertRaises(Blocked) as failure:
            recovery_plan("SUCCEEDED", **self.facts())
        self.assertEqual(failure.exception.code, "RESTORE_ALREADY_ACCEPTED")

    def test_already_completed_rollback_is_idempotent(self):
        self.assertEqual(recovery_plan("ROLLED_BACK", **self.facts())["actions"], [])

    def test_crash_before_switch_restores_service_without_changing_db_or_data(self):
        for phase in ("PREPARED", "ROLLBACK_VOLUME_CREATED", "WRITERS_STOPPED",
                      "LIVE_OBJECTS_FROZEN", "ROLLBACK_VOLUME_VERIFIED"):
            with self.subTest(phase=phase):
                plan = recovery_plan(phase, **self.facts(old_volume_equal=False,
                                                         rollback_volume_verified=False))
                self.assertEqual(plan["actions"],
                                 ["stop_writers", "start_previous_services", "verify_previous_state"])

    def test_crash_during_object_replacement_preserves_candidate_and_restores_old(self):
        for phase in ("OBJECT_COPY_STARTED", "OBJECTS_ACTIVATED"):
            with self.subTest(phase=phase):
                plan = recovery_plan(phase, **self.facts(old_volume_equal=False))
                self.assertEqual(plan["actions"], [
                    "stop_writers", "quarantine_candidate_objects",
                    "restore_previous_objects", "start_previous_services",
                    "verify_previous_state",
                ])

    def test_crash_with_both_databases_quarantines_new_before_renaming_old(self):
        plan = recovery_plan("ARCHIVE_STUDENT_KEYS_APPLIED", **self.facts(
            databases={"asalab", "asa_previous_20261029"},
            active_data_is_old=False, old_volume_equal=False,
            configuration_equal=False))
        self.assertEqual(plan["actions"], [
            "stop_writers", "quarantine_candidate_database",
            "restore_previous_database_name", "quarantine_candidate_objects",
            "restore_previous_objects", "restore_previous_configuration",
            "start_previous_services", "verify_previous_state"
        ])
        self.assertTrue(plan["preserveCandidateData"])
        self.assertFalse(plan["allowDestructiveDatabaseRestore"])
        self.assertFalse(plan["allowAutomaticCleanup"])

    def test_resuming_after_failed_objects_quarantine_reuses_verified_copy(self):
        plan = recovery_plan("ROLLBACK_CLOUD_OBJECTS_QUARANTINED", **self.facts(
            databases={"asalab", "asa_previous_20261029"},
            active_data_is_old=False, old_volume_equal=False,
            candidate_objects_quarantine_verified=True))
        self.assertNotIn("quarantine_candidate_objects", plan["actions"])
        self.assertIn("restore_previous_objects", plan["actions"])

    def test_crash_after_first_database_rename_restores_only_previous_name(self):
        plan = recovery_plan("PREVIOUS_DATABASE_RENAMED", **self.facts(
            databases={"asa_previous_20261029"},
            active_data_is_old=False))
        self.assertIn("restore_previous_database_name", plan["actions"])
        self.assertNotIn("quarantine_candidate_database", plan["actions"])

    def test_missing_backup_or_failed_volume_refuses_mutation(self):
        for changes, expected in (
            (dict(backup_verified=False), "RECOVERY_BACKUP"),
            (dict(old_configuration_verified=False), "RECOVERY_BACKUP"),
            (dict(old_volume_equal=False,rollback_volume_verified=False), "RECOVERY_OBJECTS"),
        ):
            with self.subTest(changes=changes), self.assertRaises(Blocked) as failure:
                recovery_plan("OBJECT_COPY_STARTED", **self.facts(**changes))
            self.assertEqual(failure.exception.code, expected)

    def test_ambiguous_or_missing_old_database_refuses_mutation(self):
        for changes, code in (
            (dict(databases=set()), "RECOVERY_DATABASE"),
            (dict(active_data_is_old=False), "RECOVERY_PREVIOUS_DATABASE_MISSING"),
            (dict(databases={"asalab","asa_previous_20261029"},
                  active_data_is_old=True), "RECOVERY_AMBIGUOUS_DATABASE"),
            (dict(databases={"asalab","asa_previous_20261029","asa_failed_20261029"},
                  active_data_is_old=False), "RECOVERY_FAILED_NAME"),
        ):
            with self.subTest(changes=changes), self.assertRaises(Blocked) as err:
                recovery_plan("CLOUD_DATABASE_ACTIVATED", **self.facts(**changes))
            self.assertEqual(err.exception.code, code)

    def test_unknown_or_missing_cutover_state_refuses_mutation(self):
        for state in ("", "INTERRUPTED_GUESS", "MIGRATING"):
            with self.subTest(state=state), self.assertRaises(Blocked):
                recovery_plan(state, **self.facts())

    def test_each_supported_interrupted_phase_has_a_recovery_plan(self):
        for phase in RECOVERABLE_PHASES:
            with self.subTest(phase=phase):
                result = recovery_plan(phase, **self.facts())
                self.assertEqual(result["status"], "READY_FOR_RECOVERY")
                self.assertEqual(result["actions"][-1], "verify_previous_state")


if __name__ == "__main__":
    unittest.main()
