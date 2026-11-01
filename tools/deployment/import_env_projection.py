"""WIN-04B2A: read-only projection of original private keys into an isolated target.

No target .env is written. This is not permission to restore databases, volumes,
run Docker or cut over traffic. Source archive publisher signature remains out
of scope and is explicitly not asserted here.
"""
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .contracts import Blocked, read_env, require
from .fresh_install import fresh_options
from .import_preflight import (
    REQUIRED_PRIVATE, STUDENT_KEYS, validate_import_archive,
)

ORIGIN_KEYS = frozenset({
    "ASA_BLOCKS_PARENT_ORIGIN",
    "ASA_BLOCKS_RUNTIME_ORIGIN",
    "ASA_UPDATE_ENTRY_ORIGIN",
})
TRANSPORT_KEYS = ORIGIN_KEYS | frozenset({
    "COMPOSE_PROJECT_NAME", "ASA_WEB_PORT", "ASA_API_PORT", "ASA_BLOCKS_PORT",
})
PRESERVED_KEYS = REQUIRED_PRIVATE | STUDENT_KEYS | frozenset({
    "ASA_APP_DB_PASSWORD", "ASA_BLOCKS_RUNTIME_SIGNING_KEY",
    "ASA_SEARCH_SECRET", "MIGRATION_DATABASE_URL", "APP_DATABASE_URL",
})
PRIVATE_FIELDS = frozenset({
    "POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD",
    "ASA_OBJECT_STORAGE_ACCESS_KEY", "ASA_OBJECT_STORAGE_SECRET_KEY",
    "ASA_SETTINGS_ENCRYPTION_KEY", "CLASSROOM_CODE_SECRET",
    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
    "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
    "ASA_BLOCKS_RUNTIME_SIGNING_KEY", "ASA_SEARCH_SECRET",
    "ASA_SEED_TEACHER_PASSWORD", "MIGRATION_DATABASE_URL", "APP_DATABASE_URL",
})


def _local_database(url, username, password, database, key):
    require(isinstance(url, str) and bool(url), "IMPORT_SOURCE_DATABASE",
            "Archived " + key + " is missing.")
    parsed = urlsplit(url)
    require(parsed.scheme in ("postgres", "postgresql")
            and parsed.hostname == "postgres" and parsed.port == 5432
            and unquote(parsed.username or "") == username
            and unquote(parsed.password or "") == password
            and unquote(parsed.path.lstrip("/")) == database
            and not parsed.query and not parsed.fragment,
            "IMPORT_SOURCE_DATABASE",
            "Archived database URL differs from original project-local service credentials.")


def project_private_environment(archive, *, project, web_port, blocks_port):
    """Return (private env in memory, nonsecret evidence). Never serialize env."""
    evidence = validate_import_archive(archive)
    require(evidence["status"] == "ARCHIVE_VERIFIED_NO_IMPORT"
            and evidence["writesPerformed"] is False,
            "IMPORT_UNVERIFIED", "Full private archive verification is required.")
    root = Path(archive).resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    envpath = root / "private.env"
    raw = envpath.read_bytes()
    try:
        env = read_env(envpath)
    except Blocked as exc:
        raise Blocked("IMPORT_ENV_FORMAT",
                      "Archived private environment has malformed or duplicate fields.",
                      "Preserve the original backup and fix only a new verified source archive.") from exc
    require(raw == envpath.read_bytes()
            and hashlib.sha256(raw).hexdigest() ==
            manifest["files"]["private.env"]["sha256"]
            and len(raw) == manifest["files"]["private.env"]["bytes"],
            "IMPORT_ENV_RACE", "Original private environment changed during verification.")
    try:
        source_lines = [
            line for line in raw.decode("utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
    except UnicodeError as exc:
        raise Blocked("IMPORT_ENV_FORMAT",
                      "Original private environment is not valid UTF-8.",
                      "Preserve the original archive; do not import.") from exc
    names = [line.split("=", 1)[0].strip() for line in source_lines]
    require(all("=" in line and name and "\x00" not in line
                for name, line in zip(names, source_lines))
            and len(names) == len(set(names)),
            "IMPORT_ENV_FORMAT",
            "Original private environment has duplicate or malformed keys.")
    require(manifest["profile"] in ("production", "staging")
            and env.get("ASA_SEED_DEV") == "false",
            "IMPORT_ENV_PROFILE", "Private archive must be production/staging with development seed disabled.")
    require(env.get("COMPOSE_PROJECT_NAME") == manifest["project"],
            "IMPORT_ENV_PROJECT", "Original private environment and backup identify different Docker projects.")
    missing = sorted(key for key in PRESERVED_KEYS if not env.get(key))
    require(not missing, "IMPORT_ORIGINAL_KEYS",
            "Original archive omits required secrets or database credentials: " + ", ".join(missing))
    require(env.get("MIGRATION_EXPECT_DATABASE") == env["POSTGRES_DB"]
            and env.get("MIGRATION_CONFIRM") == "APPLY:" + env["POSTGRES_DB"],
            "IMPORT_SOURCE_DATABASE",
            "Migration target and original database confirmation do not match.")
    _local_database(env.get("MIGRATION_DATABASE_URL"),
                    env["POSTGRES_USER"], env["POSTGRES_PASSWORD"],
                    env["POSTGRES_DB"], "MIGRATION_DATABASE_URL")
    _local_database(env.get("APP_DATABASE_URL"),
                    "asalab_app", env["ASA_APP_DB_PASSWORD"],
                    env["POSTGRES_DB"], "APP_DATABASE_URL")
    try:
        old_web = int(env["ASA_WEB_PORT"])
        old_api = int(env["ASA_API_PORT"])
        old_blocks = int(env["ASA_BLOCKS_PORT"])
    except (KeyError, ValueError, TypeError) as exc:
        raise Blocked("IMPORT_ENV_PORTS",
                      "Archived local Web/API/Scratch port tuple is invalid.",
                      "Do not replace original port values by guessing.") from exc
    require(1024 <= old_web <= 65532 and old_api == old_web + 1
            and 1024 <= old_blocks <= 65535
            and old_blocks not in (old_web, old_api),
            "IMPORT_ENV_PORTS", "Archived local port tuple is inconsistent.")
    old_origin = f"http://127.0.0.1:{old_web}"
    require(all(env.get(name) == old_origin for name in ORIGIN_KEYS),
            "IMPORT_ENV_ORIGINS",
            "Archived Scratch/portal origins were not all local and identical.")
    require(not any(old_origin in value
                    for key, value in env.items() if key not in ORIGIN_KEYS),
            "IMPORT_ENV_REFERENCE",
            "A non-transport original setting still refers to the old portal; manual review required.")
    target = fresh_options(project, web_port, blocks_port)
    require(target["project"] != manifest["project"],
            "IMPORT_ENV_PROJECT", "Destination and source Docker projects must be distinct.")
    output = dict(env)
    replacements = {
        "COMPOSE_PROJECT_NAME": target["project"],
        "ASA_WEB_PORT": str(target["web"]),
        "ASA_API_PORT": str(target["api"]),
        "ASA_BLOCKS_PORT": str(target["blocks"]),
        **{name: target["origin"] for name in ORIGIN_KEYS},
    }
    output.update(replacements)
    immutable_private = PRESERVED_KEYS | (PRIVATE_FIELDS & set(env))
    require(all(output[name] == env[name] for name in immutable_private),
            "IMPORT_ORIGINAL_KEYS", "Private secrets or original DB connections changed during relocation.")
    require({name for name in output if output[name] != env.get(name)} <= TRANSPORT_KEYS,
            "IMPORT_ENV_UNEXPECTED_CHANGE", "A nontransport private configuration was changed.")
    # Only an in-memory dict is returned. Never print, log or write it here.
    return output, {
        "status": "PRIVATE_ENV_PROJECTION_ONLY",
        "sourceRevision": evidence["sourceRevision"],
        "sourceProjectDistinct": True,
        "targetProject": target["project"],
        "targetWebPort": target["web"],
        "targetApiPort": target["api"],
        "targetBlocksPort": target["blocks"],
        "preservedSecretFieldCount": len(PRIVATE_FIELDS & set(env)),
        "preservedRequiredFieldCount": len(PRESERVED_KEYS & set(env)),
        "changedTransportFields": sorted(
            name for name in replacements if output[name] != env.get(name)),
        "preservesOriginalKeys": True,
        "secretsWritten": False,
        "targetProvisioned": False,
        "databaseRestored": False,
        "minioRestored": False,
        "publisherSignatureVerified": False,
        "writesPerformed": False,
    }
