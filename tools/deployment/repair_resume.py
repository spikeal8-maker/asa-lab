"""WIN-03B: explicit fail-closed finalization of an already healthy selected runtime.

This is NOT a generic rollback/restore mechanism. It makes no Docker or
database mutation and cannot repair a failed migration or broken service.
"""
import datetime as dt
import json
from pathlib import Path
import uuid

from .contracts import (
    atomic_json, require, validate_release, verify_backup,
    verify_embedded_entry_http,
)
from .repair_plan import _marker, _revision
from .releases import assert_ci, validate_resolved_images


def _verified_backup(install, operation, previous):
    if not previous:
        require(not operation.get("backup"), "RESUME_BACKUP",
                "Fresh installation must not claim an imported previous backup.")
        return
    require(isinstance(operation.get("backup"), str) and operation["backup"],
            "RESUME_BACKUP", "A previous installed version requires a complete backup before finalization.")
    backup = Path(operation["backup"])
    root = Path(install.settings.get("backupDirectory") or install.root / "backups").resolve()
    selected = backup.resolve()
    require(selected.parent == root and not backup.is_symlink() and selected.is_dir(),
            "RESUME_BACKUP_PATH",
            "Backup must be a real direct child of this installation's configured backup directory.")
    # Keep the complete backup directory's filesystem identity stable across
    # hash verification. A same-owner local concurrent replacement must not
    # become the evidence used to close a failed transaction.
    before = selected.lstat()
    manifest = verify_backup(selected)
    after = selected.lstat()
    require(not selected.is_symlink() and selected.is_dir()
            and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino),
            "RESUME_BACKUP_RACE",
            "Backup directory changed during verification; do not trust this evidence.")
    runtime = manifest.get("runtime")
    require(isinstance(runtime, dict) and
            runtime.get("revision") == previous["revision"] and
            runtime.get("schema") == previous["schema"],
            "RESUME_BACKUP_IDENTITY",
            "Full backup identifies a different previous runtime; do not resume.")


def finish_selected_switch(install, *, confirmed=False):
    """Only seal receipts when current runtime and full backup prove correctness.

    The caller must hold the exclusive Installation operation_lock.
    """
    require(confirmed, "RESUME_CONFIRM_REQUIRED",
            "Explicit --confirm-resume required; no automatic changes.")
    state = Path(install.state)
    maintenance = _marker(state, "maintenance.json")
    failed = _marker(state, "failed-switch.json")
    require(maintenance is not None or failed is not None,
            "RESUME_NOT_PENDING", "No interrupted update exists; nothing to resume.")

    if maintenance and failed:
        for field in ("previous", "selected", "backup"):
            require(maintenance.get(field) == failed.get(field), "RESUME_CONFLICT",
                    "Maintenance and failed-switch identities differ.")
    operation = maintenance or failed
    require(operation["phase"] in ("switch", "verify_entry"), "RESUME_PHASE",
            "Only a selected switch or entry-verification phase can be finalized.")
    selected = validate_release(operation.get("selected"))
    # A syntactically valid release manifest is not sufficient publisher
    # provenance. Re-attest the exact published source against the official
    # completed release and main-branch Governance CI before sealing receipts.
    assert_ci(selected)
    previous = operation.get("previous")
    if previous is not None:
        require(isinstance(previous, dict) and isinstance(previous.get("schema"), int)
                and _revision(operation, "previous") is not None,
                "RESUME_PREVIOUS", "Previous runtime identity is malformed.")
        require(previous["revision"] != selected["revision"], "RESUME_PREVIOUS",
                "Selected and previous runtime have the same revision; investigate markers.")
    _verified_backup(install, operation, previous)

    active_path = state / "installed-release.json"
    if active_path.exists() or active_path.is_symlink():
        require(active_path.is_file() and not active_path.is_symlink(), "RESUME_RECEIPT_PATH",
                "Installed-release record is not a regular file.")
        active = validate_release(json.loads(active_path.read_text(encoding="utf8")))
        expected = [selected]
        if previous is not None:
            expected.append({"revision": previous["revision"]})
        require(active == selected or (
            previous is not None and active["revision"] == previous["revision"]
            and active["schema"] == previous["schema"]),
            "RESUME_RECEIPT", "Stored installed release is neither selected nor previous.")
    else:
        require(previous is None, "RESUME_RECEIPT",
                "Previous installation must retain its installed-release receipt.")

    runtime = install.readiness()
    require(runtime.get("revision") == selected["revision"] and
            runtime.get("schema") == selected["schema"],
            "RESUME_RUNTIME",
            "Runtime SHA/schema do not match selected published release. No rollback is automatic.")

    records = install.identity()
    for service, image in selected["images"].items():
        record = records.get(service)
        require(record is not None and record.get("running") is True and
                record.get("image") == image, "RESUME_IMAGE",
                "Running service does not match the exact pinned release: " + service)
    # Both checks are read-only and include entry, database/proxy/Compose config.
    validate_resolved_images(install, selected)
    entry = install.env.get("ASA_UPDATE_ENTRY_ORIGIN")
    require(isinstance(entry, str) and entry, "RESUME_ENTRY",
            "No canonical owner portal origin.")
    verify_embedded_entry_http(entry, selected["revision"])

    # All gates passed. Save a verifiable receipt and archive original markers
    # instead of deleting them. If a crash happens mid-archive, another call
    # finds the remaining marker and safely verifies again.
    atomic_json(active_path, selected)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    install.receipt({
        "status": "resumed_verified",
        "phase": operation["phase"],
        "previousRevision": previous.get("revision") if previous else None,
        "revision": selected["revision"],
        "schema": selected["schema"],
        "automaticDatabaseRestore": False,
        "userFlow": "not_run",
    })
    for name, archive_prefix in (("maintenance.json", "reviewed-"),
                                 ("failed-switch.json", "acknowledged-")):
        path = state / name
        if path.exists():
            path.rename(state / (archive_prefix + stamp + "-" + name))
    print("RESUMED_VERIFIED " + json.dumps({
        "revision": selected["revision"], "schema": selected["schema"],
        "containersRestarted": False,
        "databaseRestore": False,
        "userFlow": "not_run",
    }, sort_keys=True))
    return 0
