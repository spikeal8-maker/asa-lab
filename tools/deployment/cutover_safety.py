"""Fail-closed recovery decisions for an interrupted ASA Lab cloud cutover.

This is deliberately a pure planner: the operator must first validate the
journal and the exact Docker/DB identities, then execute each planned action.
A finished cutover must never be rolled back automatically because user writes
may have occurred after it was accepted.
"""

from .contracts import Blocked, require


RECOVERABLE_PHASES = frozenset((
    "PREPARED", "ROLLBACK_VOLUME_CREATED", "WRITERS_STOPPED",
    "LIVE_OBJECTS_FROZEN", "ROLLBACK_VOLUME_VERIFIED",
    "OBJECT_COPY_STARTED", "OBJECTS_ACTIVATED",
    "PREVIOUS_DATABASE_RENAMED", "CLOUD_DATABASE_ACTIVATED",
    "ARCHIVE_STUDENT_KEYS_APPLIED", "ROLLBACK_START",
    "ROLLBACK_CLOUD_DB_QUARANTINED", "ROLLBACK_OLD_DB_RESTORED",
    "ROLLBACK_CLOUD_OBJECTS_QUARANTINED", "ROLLBACK_OLD_OBJECTS_RESTORED",
    "ROLLBACK_OLD_ENV_RESTORED", "ROLLBACK_REQUIRES_ATTENTION",
))


def recovery_plan(
    phase, *, databases, active_database, previous_database, failed_database,
    active_data_is_old, old_volume_equal, rollback_volume_verified,
    old_configuration_verified, configuration_equal, backup_verified,
    candidate_objects_quarantine_verified=False
):
    """Return safe recovery actions, or refuse an incomplete/ambiguous state.

    The caller provides independently attested facts, never journal guesses.
    Quarantine the failed candidate DB and object volume rather than deleting
    either. Restore existing data only from a verified rollback point.
    """
    if phase == "SUCCEEDED":
        raise Blocked("RESTORE_ALREADY_ACCEPTED",
                      "The new database was accepted and may contain new user writes.",
                      "Do not auto-rollback. Review both versions and prepare a separate migration.")
    if phase == "ROLLED_BACK":
        return {"status": "NO_CHANGE", "actions": []}
    require(phase in RECOVERABLE_PHASES, "RECOVERY_STATE",
            "Unknown or missing cutover journal phase.",
            "Do not guess which database or storage is active.")
    require(backup_verified and old_configuration_verified, "RECOVERY_BACKUP",
            "The complete prior backup or its private configuration is not verified.",
            "Preserve current resources. Verify the prior snapshot before attempting rollback.")
    require(active_database in databases or previous_database in databases, "RECOVERY_DATABASE",
            "Neither the target nor the previous named PostgreSQL database was found.")
    actions = ["stop_writers"]
    database_set = set(databases)
    if previous_database in database_set:
        if active_database in database_set:
            require(not active_data_is_old, "RECOVERY_AMBIGUOUS_DATABASE",
                    "Both databases exist, but the active database already matches the old data.")
            require(failed_database not in database_set, "RECOVERY_FAILED_NAME",
                    "The reserved failed-database name is occupied.")
            actions += ["quarantine_candidate_database", "restore_previous_database_name"]
        else:
            actions += ["restore_previous_database_name"]
    else:
        require(active_database in database_set and active_data_is_old,
                "RECOVERY_PREVIOUS_DATABASE_MISSING",
                "The previous database was not found and the active database is not proven old.",
                "Preserve both states; do not overwrite an unknown database.")

    possible_object_mutation = phase in (
        "OBJECT_COPY_STARTED", "OBJECTS_ACTIVATED", "PREVIOUS_DATABASE_RENAMED",
        "CLOUD_DATABASE_ACTIVATED", "ARCHIVE_STUDENT_KEYS_APPLIED",
        "ROLLBACK_START", "ROLLBACK_CLOUD_DB_QUARANTINED",
        "ROLLBACK_OLD_DB_RESTORED", "ROLLBACK_CLOUD_OBJECTS_QUARANTINED",
        "ROLLBACK_OLD_OBJECTS_RESTORED", "ROLLBACK_OLD_ENV_RESTORED",
        "ROLLBACK_REQUIRES_ATTENTION"
    )
    if possible_object_mutation and not old_volume_equal:
        require(rollback_volume_verified, "RECOVERY_OBJECTS",
                "Prior object-store volume is unavailable or fails its saved hashes.",
                "Keep the current volume and recover from the verified external backup.")
        if not candidate_objects_quarantine_verified:
            actions.append("quarantine_candidate_objects")
        actions.append("restore_previous_objects")
    if not configuration_equal:
        actions.append("restore_previous_configuration")
    actions += ["start_previous_services", "verify_previous_state"]
    return {
        "status": "READY_FOR_RECOVERY",
        "actions": actions,
        "preserveCandidateData": True,
        "allowDestructiveDatabaseRestore": False,
        "allowAutomaticCleanup": False,
    }
