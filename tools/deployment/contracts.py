"""Pure validation shared by the operator CLI, release CI and tests."""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlsplit, unquote
from urllib.request import urlopen

REPOSITORY = "spikeal8-maker/asa-lab"
REGISTRY = f"ghcr.io/{REPOSITORY}"
SERVICES = ("api", "web", "scratch", "minio")
MOSCOW = dt.timezone(dt.timedelta(hours=3))
DEFAULT_WINDOW = {"weekday": 6, "start": "03:00", "end": "05:00", "utcOffsetMinutes": 180}


class Blocked(RuntimeError):
    def __init__(self, code, message, action):
        super().__init__(message)
        self.code, self.action = code, action


def require(condition, code, message, action="Inspect the installation; do not discard data."):
    if not condition:
        raise Blocked(code, message, action)


def exact_origin(value):
    require(isinstance(value, str), "ORIGIN", "Origin must be a string.")
    parsed = urlsplit(value)
    require(parsed.scheme in ("http", "https") and parsed.hostname
            and not parsed.username and not parsed.password
            and not parsed.path and not parsed.query and not parsed.fragment
            and re.fullmatch(r"https?://[A-Za-z0-9.\[\]:-]+", value),
            "ORIGIN", f"Not an exact HTTP(S) origin: {value}")
    try:
        parsed.port
    except ValueError as exc:
        raise Blocked("ORIGIN", "Invalid origin port.", "Correct the configured origin.") from exc
    return value


def attest_database_targets(config, postgres_env, api_env=None):
    """Never migrate an external/different database behind a local dump."""
    services = config["services"]
    expected = services["postgres"]["environment"]["POSTGRES_DB"]
    require(postgres_env.get("POSTGRES_DB") == expected, "DATABASE_TARGET", "PostgreSQL database configuration changed.")
    require(services["postgres"]["environment"].get("PGDATA", "/var/lib/postgresql/data") == postgres_env.get("PGDATA", "/var/lib/postgresql/data"),
            "DATABASE_TARGET", "PostgreSQL data directory changed inside the volume.",
            "Preserve PGDATA; changing the storage layout requires an explicit data migration.")
    def target(value):
        parsed = urlsplit(value or "")
        require(parsed.scheme in ("postgres", "postgresql") and not parsed.query and not parsed.fragment,
                "DATABASE_TARGET", "Unsupported database URL; an explicit backup adapter is required.")
        return parsed.hostname, parsed.port or 5432, unquote(parsed.path.removeprefix("/"))
    urls = [services["api"]["environment"].get("APP_DATABASE_URL"),
            services["migration"]["environment"].get("MIGRATION_DATABASE_URL")]
    if api_env is not None:
        urls.append(api_env.get("APP_DATABASE_URL"))
    for url in urls:
        require(target(url) == ("postgres", 5432, expected), "DATABASE_TARGET",
                "API, migration and local backup database must be the same target.",
                "Preserve the existing database or implement a matching external backup adapter.")
    migration = services["migration"]["environment"]
    require(migration.get("MIGRATION_EXPECT_DATABASE") == expected and migration.get("MIGRATION_CONFIRM") == f"APPLY:{expected}",
            "DATABASE_TARGET", "Migration target attestations differ from the backed-up database.")


def attest_editor_env(entry_origin, parent, runtime, profile):
    require(bool(entry_origin), 'EDITOR_ENTRY', 'ASA_UPDATE_ENTRY_ORIGIN is required for the owner portal URL.',
            'Set it in the existing private .env after confirming the address used by the owner; do not create a separate Scratch installation.')
    exact_origin(entry_origin)
    require(profile in ('base', 'dev', 'staging', 'production'), 'PROFILE', 'Unsupported profile.')
    if profile in ('staging', 'production') and not entry_origin.startswith('http://127.0.0.1:'):
        require(entry_origin.startswith('https://'), 'EDITOR_ENTRY', 'Non-loopback production and staging ASA entry origins must use HTTPS.')
    require(runtime == parent == entry_origin, 'EDITOR_ENTRY',
            'The saved editor origin does not match the single ASA application entry.',
            'Keep the running version. Back up the existing installation, then set both Blocks origins to the approved portal origin using the controlled configuration transition; do not create an editor domain.')


def attest_embedded_editor(config, entry_origin, profile):
    api = config['services']['api']['environment']
    parent = config['services']['scratch']['environment'].get('ASA_BLOCKS_PARENT_ORIGIN')
    origin = api.get('ASA_BLOCKS_RUNTIME_ORIGIN')
    attest_editor_env(entry_origin, parent, origin, profile)
    local_web_origin = f"http://127.0.0.1:{api.get('ASA_WEB_PORT', '4610')}"
    if profile in ('staging', 'production') and entry_origin != local_web_origin:
        public = {value.strip() for value in api.get('ASA_PUBLIC_WEB_ORIGINS', '').split(',') if value.strip()}
        require(entry_origin in public, 'EDITOR_ENTRY',
                'The public ASA entry must be HTTPS and listed in ASA_PUBLIC_WEB_ORIGINS.')


def verify_embedded_entry_http(entry_origin, revision, fetch_text=None):
    """Check the deployed ASA URL, not just loopback/container health. No login or writes."""
    exact_origin(entry_origin)

    def fetch(path):
        with urlopen(entry_origin + path, timeout=15) as response:
            actual = urlsplit(response.geturl())
            require(response.status == 200 and response.geturl() == entry_origin + path,
                    'EDITOR_ENTRY', f'The owner portal URL redirected or failed at {path}.')
            return response.read(1024 * 1024).decode('utf-8')

    read = fetch_text or fetch
    ready = json.loads(read('/health/ready'))
    metadata = json.loads(read('/build-metadata.json'))
    script = read('/runtime-config.js').strip()
    editor = read('/internal/blocks/')
    health = read('/internal/blocks/healthz')
    prefix = 'globalThis.__ASA_RUNTIME_CONFIG__='
    require(script.startswith(prefix), 'EDITOR_ENTRY', 'Portal runtime-config.js has an unexpected format.')
    runtime = json.loads(script[len(prefix):].removesuffix(';'))
    deployment = ready.get('deployment') or {}
    require(ready.get('status') == 'ready' and deployment.get('revision') == revision
            and deployment.get('synchronized') is True and metadata.get('revision') == revision
            and runtime.get('blocksRuntimeOrigin') == entry_origin
            and 'data-asa-scratch-host=' in editor and health.strip() == 'ok', 'EDITOR_ENTRY',
            'The owner portal URL does not serve the same ready ASA and embedded Scratch revision.')


def validate_window(window):
    require(set(window) == set(DEFAULT_WINDOW), "WINDOW", "Invalid maintenance window fields.")
    require(type(window["weekday"]) is int and 0 <= window["weekday"] <= 6,
            "WINDOW", "Weekday must be 0 (Monday)..6 (Sunday).")
    require(type(window["utcOffsetMinutes"]) is int and -720 <= window["utcOffsetMinutes"] <= 840,
            "WINDOW", "Invalid UTC offset.")
    for key in ("start", "end"):
        require(isinstance(window[key], str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", window[key]),
                "WINDOW", "Use HH:MM for the maintenance window.")
    require(window["start"] < window["end"], "WINDOW", "Window must finish later on the same day.")
    return window


def in_window(window, now=None, reserve_minutes=0):
    validate_window(window)
    now = now or dt.datetime.now(dt.timezone.utc)
    require(now.tzinfo is not None, "WINDOW", "A timezone-aware clock is required.")
    local = now.astimezone(dt.timezone(dt.timedelta(minutes=window["utcOffsetMinutes"])))
    start = dt.time.fromisoformat(window["start"])
    finish = dt.datetime.combine(local.date(), dt.time.fromisoformat(window["end"]), local.tzinfo)
    return local.weekday() == window["weekday"] and local.time().replace(tzinfo=None) >= start and (
        local + dt.timedelta(minutes=reserve_minutes) < finish)


def validate_release(payload):
    require(isinstance(payload, dict) and payload.get("format") == "asa-deployment-v1",
            "RELEASE", "Unsupported release manifest.")
    require(payload.get("repository") == REPOSITORY, "RELEASE", "Foreign release repository.")
    require(re.fullmatch(r"[a-f0-9]{40}", payload.get("revision", "")), "RELEASE", "Invalid release SHA.")
    require(type(payload.get("schema")) is int and payload["schema"] > 0,
            "RELEASE", "Invalid schema version.")
    require(payload.get("platform") == "linux/amd64", "RELEASE", "Unsupported image platform.")
    require(type(payload.get("publicationRunId")) is int and payload["publicationRunId"] > 0,
            "RELEASE", "Publication workflow ID is required.")
    require(set(payload.get("images", {})) == set(SERVICES), "RELEASE", "Incomplete image set.")
    for name in SERVICES:
        ref = payload["images"][name]
        require(isinstance(ref, str) and re.fullmatch(re.escape(f"{REGISTRY}/{name}@sha256:") + r"[a-f0-9]{64}", ref),
                "RELEASE", f"Unpinned or foreign {name} image.")
    return payload


def read_env(path):
    result = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        require(sep and re.fullmatch(r"[A-Z][A-Z0-9_]*", key), "ENV", "Unsupported .env syntax.")
        require(key not in result, "ENV", f"Duplicate .env key: {key}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        require("\x00" not in value, "ENV", f"Invalid .env value for {key}")
        result[key] = value
    return result


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def safe_member(root, relative):
    require(isinstance(relative, str), "BACKUP_PATH", "Invalid backup member.")
    value = PurePosixPath(relative)
    require(relative and not value.is_absolute() and ".." not in value.parts
            and "\\" not in relative and ":" not in relative and str(value) == relative,
            "BACKUP_PATH", "Backup member escapes its directory.")
    target = Path(root).joinpath(*value.parts)
    require(not any(part.is_symlink() for part in [target, *target.parents] if part != Path(root).parent),
            "BACKUP_PATH", "Backup symlinks are forbidden.")
    require(target.resolve().is_relative_to(Path(root).resolve()), "BACKUP_PATH", "Backup path escaped root.")
    return target


def inventory_files(root):
    result = {}
    for path in sorted(Path(root).rglob("*")):
        relative = path.relative_to(root).as_posix()
        require(not path.is_symlink(), "BACKUP_PATH", "Backup contains a symlink.")
        if path.is_file() and relative != "manifest.json":
            result[relative] = {"bytes": path.stat().st_size, "sha256": file_hash(path)}
    return result


def verify_backup(root):
    root = Path(root).resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("format") == "asa-backup-v1" and manifest.get("complete") is True,
            "BACKUP", "Backup is incomplete or has an unsupported format.")
    files = manifest.get("files", {})
    require(isinstance(files, dict) and {"database.dump", "globals.sql", "private.env"} <= set(files),
            "BACKUP", "Backup is missing required files.")
    for relative in files:
        safe_member(root, relative)
    require(inventory_files(root) == files, "BACKUP_HASH", "Backup files or checksums differ.",
            "Use an intact complete backup; do not restore this copy.")
    return manifest
