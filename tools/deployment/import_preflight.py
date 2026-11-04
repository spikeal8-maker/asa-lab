"""WIN-04A: complete-archive identity, keys and MinIO preflight (read only).

This component deliberately does NOT import PostgreSQL or MinIO into a target.
It never generates replacement encryption or Student Code keys.
"""
import base64
import binascii
import hmac
import json
from pathlib import Path
import re
import stat

from .contracts import Blocked, read_env, require, validate_release, verify_backup

SHA40 = re.compile(r"[a-f0-9]{40}\Z")
REQUIRED_PRIVATE = frozenset({
    "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD",
    "ASA_OBJECT_STORAGE_ACCESS_KEY", "ASA_OBJECT_STORAGE_SECRET_KEY",
    "ASA_SETTINGS_ENCRYPTION_KEY", "CLASSROOM_CODE_SECRET",
})
STUDENT_KEYS = frozenset({
    "ASA_STUDENT_CODE_PROTECTION_MODE",
    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
    "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID",
    "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
    "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID",
})


def _regular(path: Path, error: str):
    require(path.is_file() and not path.is_symlink()
            and not (getattr(path.lstat(), "st_file_attributes", 0)
                     & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
            error, "Archive member must be a real, non-symlink file.")


def _keyring(env, name, active, *, exact_bytes=None, min_bytes=None):
    try:
        values = json.loads(env[name])
    except (ValueError, TypeError) as exc:
        raise Blocked("IMPORT_STUDENT_KEYS", "Invalid private Student Code keyring JSON.",
                      "Preserve the original archive and repair its source before importing.") from exc
    require(isinstance(values, dict) and values
            and all(isinstance(k, str)
                    and bool(re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", k))
                    and isinstance(v, str) and v for k, v in values.items())
            and env[active] in values,
            "IMPORT_STUDENT_KEYS",
            "Student Code keyring or selected key ID is incomplete.")
    decoded = {}
    for key_id, encoded in values.items():
        require(not any(character.isspace() for character in encoded),
                "IMPORT_STUDENT_KEYS", "Student Code key must contain canonical Base64 without whitespace.")
        try:
            # Node's credential-configuration.cjs also accepts unpadded Base64,
            # but rejects noncanonical padding bits after decoding.
            padded = encoded + ("=" * ((-len(encoded)) % 4))
            material = base64.b64decode(padded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise Blocked("IMPORT_STUDENT_KEYS", "Invalid Student Code key encoding.",
                          "Preserve original keys from a verified backup.") from exc
        canonical = base64.b64encode(material).decode("ascii").rstrip("=")
        require(bool(canonical) and canonical == encoded.rstrip("="),
                "IMPORT_STUDENT_KEYS", "Student Code key is not canonical Base64.")
        require((exact_bytes is None or len(material) == exact_bytes)
                and (min_bytes is None or len(material) >= min_bytes),
                "IMPORT_STUDENT_KEYS", "Student Code encryption/lookup key length is invalid.")
        decoded[key_id] = material
    return decoded


def validate_import_archive(location):
    """Attest all source components; return non-secret evidence, not an import."""
    source = Path(location)
    require(source.is_dir() and not source.is_symlink()
            and not source.name.endswith(".incomplete"), "IMPORT_SOURCE",
            "Select a complete real backup directory, never a partial or linked path.")
    root = source.resolve()
    require(not (getattr(source.lstat(), "st_file_attributes", 0)
                 & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
            "IMPORT_SOURCE", "Linked backup directory is not trusted.")

    manifest = verify_backup(root)
    runtime = manifest.get("runtime")
    require(isinstance(runtime, dict) and
            isinstance(runtime.get("revision"), str) and
            SHA40.fullmatch(runtime["revision"]) and
            isinstance(runtime.get("schema"), int) and runtime["schema"] > 0,
            "IMPORT_RUNTIME", "Invalid original database/runtime revision.")
    require(isinstance(manifest.get("project"), str)
            and bool(re.fullmatch(r"asa-lab-[a-z0-9_-]{2,56}", manifest["project"])),
            "IMPORT_PROJECT", "Backup does not identify a valid ASA Lab Compose project.")
    require(manifest.get("profile") in ("dev", "production", "staging", "base"),
            "IMPORT_PROFILE", "Backup has an unknown deployment profile; never infer source security mode.")

    for relative in ("private.env", "database.dump", "globals.sql",
                     "configuration/runtime-configuration.json",
                     "configuration/installed-release.json"):
        require(relative in manifest["files"], "IMPORT_COMPONENT_MISSING",
                "Complete transfer requires " + relative + ".")
        _regular(root / relative, "IMPORT_COMPONENT_PATH")
    env = read_env(root / "private.env")
    missing = sorted(name for name in REQUIRED_PRIVATE if not env.get(name))
    require(not missing, "IMPORT_PRIVATE_KEYS",
            "Source archive lacks original database/object/settings/classroom secrets: " +
            ", ".join(missing))
    if manifest.get("profile") in ("production", "staging"):
        require(len(env["CLASSROOM_CODE_SECRET"].encode("utf8")) >= 32,
                "IMPORT_PRIVATE_KEYS", "Classroom Code secret does not meet the production key-length contract.")
        missing_student = sorted(name for name in STUDENT_KEYS if not env.get(name))
        require(not missing_student, "IMPORT_STUDENT_KEYS",
                "Production archive lacks original Student Code keyrings or key IDs: " +
                ", ".join(missing_student))
        require(env["ASA_STUDENT_CODE_PROTECTION_MODE"] in ("compat", "enforced"),
                "IMPORT_STUDENT_KEYS", "Unsupported production Student Code protection mode.")
        encryption = _keyring(env, "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
                              "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID", exact_bytes=32)
        lookup = _keyring(env, "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                          "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID", min_bytes=32)
        require(all(not hmac.compare_digest(enc, look)
                    for enc in encryption.values() for look in lookup.values()),
                "IMPORT_STUDENT_KEYS",
                "Lookup keys and encryption keys must contain independent secret bytes.")

    require(env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "IMPORT_STORAGE", "Source was not backed by project-local MinIO.")
    require(env.get("ASA_OBJECT_STORAGE_BUCKET") == "asa-blocks",
            "IMPORT_STORAGE", "Unexpected source object bucket.")

    try:
        recovery = json.loads((root / "configuration/runtime-configuration.json").read_text(encoding="utf8"))
        installed = json.loads((root / "configuration/installed-release.json").read_text(encoding="utf8"))
    except (ValueError, UnicodeError) as exc:
        raise Blocked("IMPORT_CONFIGURATION", "Invalid archive deployment configuration JSON.",
                      "Preserve source archive; do not import.") from exc
    release = validate_release(installed)
    require(recovery.get("revision") == runtime["revision"]
            and release["revision"] == runtime["revision"]
            and release["schema"] == runtime["schema"]
            and recovery.get("installedRelease") == installed,
            "IMPORT_RELEASE_IDENTITY",
            "Backup runtime, recovery configuration, and pinned release do not identify the same state.")
    recovery_files = recovery.get("files")
    profile = manifest["profile"]
    required_compose = {"compose.yaml"}
    if profile != "base":
        required_compose.add("compose." + profile + ".yaml")
    permitted_compose = required_compose | {
        ".asa/docker-networks.yaml", "compose.frp.yaml",
    }
    require(isinstance(recovery_files, dict)
            and required_compose <= set(recovery_files)
            and set(recovery_files) <= permitted_compose,
            "IMPORT_CONFIGURATION",
            "Archive lacks the exact original Compose/profile overlay or contains unexpected configuration paths.")
    for relative, content in recovery_files.items():
        require(isinstance(content, str)
                and "configuration/" + relative in manifest["files"],
                "IMPORT_CONFIGURATION",
                "Recovery Compose file is absent from the complete backup inventory.")
        source_file = root / "configuration" / relative
        _regular(source_file, "IMPORT_CONFIGURATION")
        require("\r" not in content, "IMPORT_CONFIGURATION",
                "Recovery JSON must contain canonical LF line endings.")
        try:
            expected_bytes = content.encode("utf-8")
        except UnicodeError as exc:
            raise Blocked(
                "IMPORT_CONFIGURATION",
                "Recovery Compose configuration contains invalid Unicode.",
                "Preserve the original archive; do not import this copy.",
            ) from exc
        # Existing Windows backup writer serializes text files through
        # os.fdopen(..., "w"), producing CRLF even though recovery JSON
        # contains normalized LF. Accept exactly those two deterministic
        # byte representations, never arbitrary text-mode normalization.
        legacy_windows_bytes = expected_bytes.replace(b"\n", b"\r\n")
        raw = source_file.read_bytes()
        require(raw == expected_bytes or raw == legacy_windows_bytes,
                "IMPORT_CONFIGURATION",
                "Recovery Compose bytes differ from the two attested LF/Windows-CRLF formats.")
    object_files = [key for key in manifest["files"] if key.startswith("objects/")]
    require(object_files, "IMPORT_OBJECTS_MISSING",
            "Full source MinIO data is absent; archive is not a complete transfer.")
    bucket_files = [key for key in object_files if key.startswith("objects/asa-blocks/")]
    require(bucket_files, "IMPORT_BUCKET_MISSING",
            "The source ASA Lab user bucket contains no verified files.")
    require((root / "database.dump").stat().st_size > 0,
            "IMPORT_DATABASE_MISSING", "Source PostgreSQL dump is empty.")

    return {
        "status": "ARCHIVE_VERIFIED_NO_IMPORT",
        "sourceRevision": runtime["revision"],
        "sourceSchema": runtime["schema"],
        "archiveFileCount": len(manifest["files"]),
        "composeFileCount": len(recovery_files),
        "minioFileCount": len(object_files),
        "bucketFileCount": len(bucket_files),
        "databaseDumpBytes": (root / "database.dump").stat().st_size,
        "preservesDatabase": True,
        "preservesMinio": True,
        "preservesOriginalKeys": True,
        "writesPerformed": False,
        "targetProvisioned": False,
        # SHA256 inventory is internal consistency, not an external signed publisher attestation.
        "publisherSignatureVerified": False,
        "userFlow": "not_run",
    }
