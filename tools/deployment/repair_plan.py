"""WIN-03A: read-only, fail-closed evidence before any interrupted update recovery.

This module NEVER starts/stops Docker, replays a migration, changes a receipt,
acks a failure, restores a dump, deletes a volume or rotates secrets. It does
not authorize an automatic resume; that requires a separate explicit feature.
"""
import json
import re
import stat
from pathlib import Path

from .contracts import Blocked, require


_REVISION = re.compile(r"^[0-9a-f]{40}$")
_PHASES = frozenset(("backup", "switch", "verify_entry"))
_MAX_MARKER_BYTES = 64 * 1024


def _marker(state: Path, name: str):
    path = state / name
    if not path.exists() and not path.is_symlink():
        return None
    attributes = path.lstat()
    require(
        path.is_file() and not path.is_symlink()
        and not (getattr(attributes, "st_file_attributes", 0)
                 & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
        "REPAIR_MARKER_PATH",
        "Maintenance record is a symlink, junction or non-regular file; refusing to inspect it.",
    )
    require(attributes.st_size <= _MAX_MARKER_BYTES, "REPAIR_MARKER_SIZE",
            "Maintenance record is too large for trusted recovery inspection.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise Blocked("REPAIR_MARKER_JSON", "Maintenance record is not valid JSON.", "Review the original file; do not delete or replace it.") from exc
    require(isinstance(data, dict), "REPAIR_MARKER_FORMAT",
            "Maintenance record must be a JSON object.")
    phase = data.get("phase")
    require(phase in _PHASES, "REPAIR_MARKER_PHASE",
            "Unknown maintenance phase; do not acknowledge or discard the record.")
    return data


def _revision(data, field: str):
    candidate = data.get(field)
    if candidate is None:
        return None
    require(isinstance(candidate, dict), "REPAIR_REVISION",
            "Malformed " + field + " runtime identity.")
    value = candidate.get("revision")
    require(isinstance(value, str) and _REVISION.fullmatch(value), "REPAIR_REVISION",
            "Unexpected " + field + " revision identity; refusing automatic recovery.")
    return value


def diagnose(install):
    """Print non-secret read-only state. Exit 2 while recovery is required."""
    state = Path(install.state)
    interrupted = _marker(state, "maintenance.json")
    failed = _marker(state, "failed-switch.json")
    if interrupted is None and failed is None:
        print("REPAIR_PLAN " + json.dumps({
            "status": "NO_PENDING",
            "mutated": False,
            "next": "No interrupted operation is recorded. Run normal doctor/check before update.",
        }, sort_keys=True))
        return 0

    # A failed marker may remain after interruption; if both are present their
    # identities must match before we can make any recommendation.
    if interrupted and failed:
        for field in ("previous", "selected", "backup"):
            require(interrupted.get(field) == failed.get(field),
                    "REPAIR_CONFLICT",
                    "Maintenance and failed-switch records disagree about " + field + ".")
    operation = interrupted or failed
    phase = operation["phase"]
    selected = _revision(operation, "selected")
    previous = _revision(operation, "previous")

    if phase == "backup":
        print("REPAIR_PLAN " + json.dumps({
            "status": "MANUAL_BACKUP_RECOVERY",
            "phase": phase,
            "maintenanceMarker": interrupted is not None,
            "failedSwitchMarker": failed is not None,
            "partialBackupRecorded": isinstance(operation.get("partial"), str),
            "mutated": False,
            "next": "Inspect partial backup and original service health. Never delete the partial, replay a dump or start a second updater automatically.",
        }, sort_keys=True))
        return 2

    require(selected is not None, "REPAIR_SELECTED",
            "Switch/verify_entry state lacks the selected immutable revision.")
    try:
        runtime = install.readiness()
    except (Blocked, OSError, ValueError, KeyError):
        print("REPAIR_PLAN " + json.dumps({
            "status": "RUNTIME_UNAVAILABLE",
            "phase": phase,
            "selectedRevision": selected,
            "previousRevision": previous,
            "mutated": False,
            "next": "Inspect container health, logs and verified backup; no automatic rollback or marker removal.",
        }, sort_keys=True))
        return 2
    require(isinstance(runtime, dict), "REPAIR_RUNTIME",
            "Runtime readiness is not a structured report.")
    running = runtime.get("revision")
    require(isinstance(running, str) and _REVISION.fullmatch(running), "REPAIR_RUNTIME",
            "Runtime readiness has no valid immutable revision.")
    if running == selected:
        status = "SELECTED_RUNNING_VERIFY_REQUIRED"
        next_action = ("Read-only evidence indicates selected revision is running. "
                       "Verify schema, exact images, served entry and backup; do not acknowledge until those checks pass.")
    elif previous is not None and running == previous:
        status = "PREVIOUS_RUNNING_MANUAL_REVIEW"
        next_action = ("Previous revision is running. Verify consistency and migration compatibility "
                       "before deciding on a repair; no database rollback is automatic.")
    else:
        status = "UNEXPECTED_RUNTIME_MANUAL_REVIEW"
        next_action = "Runtime is neither recorded selected nor previous revision; do not modify markers or data."

    print("REPAIR_PLAN " + json.dumps({
        "status": status,
        "phase": phase,
        "selectedRevision": selected,
        "previousRevision": previous,
        "runtimeRevision": running,
        "runtimeSchema": runtime.get("schema") if isinstance(runtime.get("schema"), int) else None,
        "maintenanceMarker": interrupted is not None,
        "failedSwitchMarker": failed is not None,
        "backupRecorded": bool(operation.get("backup")),
        "mutated": False,
        "next": next_action,
    }, sort_keys=True))
    return 2
