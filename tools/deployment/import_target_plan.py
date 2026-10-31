"""WIN-04B1: read-only verification of a new, isolated transfer destination.

This planner never clones, installs, starts Docker, imports data or rewrites
secrets. A positive result is not a reservation or permission to apply.
"""
import json
from pathlib import Path
import stat

from .contracts import require
from .fresh_install import fresh_options, assert_clean_install_destination
from .import_preflight import validate_import_archive
from .system import run


def _check_unlinked_path(path):
    """Fail closed on Windows junctions and symlinked ancestors."""
    original = Path(path).absolute()
    require(".." not in original.parts, "IMPORT_TARGET_PATH",
            "Destination must be an explicit canonical path without parent traversal.")
    for component in (original, *original.parents):
        if not component.exists() and not component.is_symlink():
            continue
        attrs = component.lstat()
        require(
            not component.is_symlink()
            and not getattr(component, "is_junction", lambda: False)()
            and not (getattr(attrs, "st_file_attributes", 0)
                     & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
            "IMPORT_TARGET_REPARSE",
            "Transfer destination must not traverse any symbolic link or junction.",
        )
    return original.resolve()


def plan_transfer(source_archive, target_root, *, profile, project, web_port, blocks_port):
    """Validate source and target without touching services or disk contents."""
    require(profile in ("production", "staging"), "IMPORT_TARGET_PROFILE",
            "Full transfer requires an explicit production or staging target profile.")
    source_path = Path(source_archive).resolve()
    target = _check_unlinked_path(target_root)
    require(
        target != source_path
        and target not in source_path.parents
        and source_path not in target.parents,
        "IMPORT_TARGET_OVERLAP",
        "Target and source archive directories must not contain each other.",
    )
    evidence = validate_import_archive(source_archive)
    require(evidence.get("status") == "ARCHIVE_VERIFIED_NO_IMPORT"
            and evidence.get("writesPerformed") is False
            and evidence.get("targetProvisioned") is False,
            "IMPORT_SOURCE_UNVERIFIED", "Source preflight did not return read-only success.")
    manifest = json.loads((source_path / "manifest.json").read_text(encoding="utf-8"))
    require(manifest["profile"] == profile, "IMPORT_PROFILE_MISMATCH",
            "Source and target profiles must match; do not import a dev archive to production.")
    spec = fresh_options(project, web_port, blocks_port)
    require(manifest["project"] != spec["project"],
            "IMPORT_TARGET_PROJECT",
            "Target Docker Compose project must differ from the source project.")
    # Existing fresh-install guard performs bounded read-only Docker project,
    # volume, network and local-port checks; never removes foreign resources.
    assert_clean_install_destination(target, spec)
    # Existing unlabeled legacy resources can collide by Docker name even when
    # standard Compose project labels are absent. Never adopt either form.
    prefix_hyphen = spec["project"] + "-"
    prefix_underscore = spec["project"] + "_"
    containers = run(["docker", "ps", "-a", "--format", "{{.Names}}"], capture=True)
    require(not any(name.startswith((prefix_hyphen, prefix_underscore))
                    for name in containers.splitlines()), "IMPORT_TARGET_CONTAINER_EXISTS",
            "Unlabeled containers with the intended project prefix already exist.")
    networks = run(["docker", "network", "ls", "--format", "{{.Name}}"], capture=True)
    require(not any(name.startswith((prefix_hyphen, prefix_underscore))
                    for name in networks.splitlines()), "IMPORT_TARGET_NETWORK_EXISTS",
            "Unlabeled Docker networks with the intended project prefix already exist.")
    return {
        "status": "TARGET_PREFLIGHT_ONLY",
        "sourceRevision": evidence["sourceRevision"],
        "sourceSchema": evidence["sourceSchema"],
        "sourceProjectIsDifferent": True,
        "sourceProfile": manifest["profile"],
        "targetProfile": profile,
        "targetProject": spec["project"],
        "targetWebPort": spec["web"],
        "targetApiPort": spec["api"],
        "targetScratchPort": spec["blocks"],
        "targetOrigin": spec["origin"],
        "publisherSignatureVerified": False,
        "portsCheckedAtThisInstantOnly": True,
        "targetReserved": False,
        "targetProvisioned": False,
        "secretsImported": False,
        "postgresRestored": False,
        "minioRestored": False,
        "operatorCutoverApprovalRequired": True,
        "writesPerformed": False,
        "nextActions": [
            "Independently verify source provenance and signed publisher identity",
            "Perform isolated target Compose provisioning with new volumes only",
            "Stage original private environment and keyrings without rotation",
            "Restore PostgreSQL into a new candidate database, preserving ACL/RLS",
            "Restore MinIO into a new candidate volume, verify bucket and object bytes through S3",
            "Verify user identities, Scratch and 3D browser save/reopen",
            "Obtain explicit operator acceptance before any traffic cutover",
        ],
    }
