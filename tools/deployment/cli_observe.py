"""Read-only operator observations. Receipts are history, never live health.

No operation store, lock, temporary file, CloudTransport or writable manager
constructor is used here. Process output and public fields are bounded.
"""
from __future__ import annotations

import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import stat
import subprocess
import threading
import urllib.parse
import urllib.request

from .contracts import Blocked, require, validate_release, verify_backup

SAFE_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
SNAPSHOT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
ID = re.compile(r"[a-f0-9]{32}\Z")
TOKEN = re.compile(r"[A-Za-z0-9_.:+/-]{1,128}\Z")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def unavailable(reason="UNAVAILABLE"):
    return {"status": "UNAVAILABLE", "reasonCode": reason}


def safe_code(value, default="UNAVAILABLE"):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", value) else default


def plain(path):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "PATH", "Требуется абсолютный путь.")
    require(not any(item.is_symlink() for item in (path, *path.parents)), "PATH", "Ссылки в пути запрещены.")
    return path


def read_bytes(path, maximum=1024 * 1024):
    """No-follow descriptor walk, including operator-controlled parent dirs."""
    path = plain(path)
    if os.name == "posix":
        directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
        try:
            for component in path.parent.parts[1:]:
                following = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                os.close(directory)
                directory = following
            descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
    else:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0))
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum,
                "STATE_FILE", "Неподдерживаемый файл состояния.")
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require(len(data) <= maximum and (info.st_ino, info.st_size, info.st_mtime_ns)
                == (after.st_ino, after.st_size, after.st_mtime_ns), "STATE_CHANGED", "Файл изменился при чтении.")
        return data


def read_json(path):
    value = json.loads(read_bytes(path))
    require(isinstance(value, dict), "STATE_FORMAT", "Нужен JSON object состояния.")
    return value


def environment():
    if os.name == "posix":
        # Do not let sudo leftovers select a remote Docker host, config plugin,
        # user Python, preload library, proxy or alternate executable.
        return {"PATH": SAFE_PATH if os.geteuid() == 0 else os.environ.get("PATH", SAFE_PATH),
                "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "HOME": "/root" if os.geteuid() == 0 else os.environ.get("HOME", "/"),
                "PYTHONDONTWRITEBYTECODE": "1"}
    return {key: value for key, value in os.environ.items() if key in
            ("PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA")}


def probe(arguments, *, timeout=10, maximum=256 * 1024, allow_nonzero=False):
    """Capture only stdout in memory, with a hard byte and wall-clock budget."""
    process = None
    try:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=environment(), bufsize=0)
        output, overflow = bytearray(), threading.Event()
        def collect():
            try:
                while True:
                    chunk = process.stdout.read(4096)
                    if not chunk:
                        break
                    if len(output) + len(chunk) > maximum:
                        overflow.set()
                        process.kill()
                        break
                    output.extend(chunk)
            except (OSError, ValueError):
                overflow.set()
        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        code = process.wait(timeout=timeout)
        reader.join(timeout=1)
        if reader.is_alive() or overflow.is_set():
            return unavailable("OUTPUT_LIMIT")
        if code and not (allow_nonzero and code > 0):
            return unavailable("PROBE_FAILED")
        return {"status": "OK", "output": output.decode("utf-8", errors="replace").strip(), "returnCode": code}
    except (OSError, subprocess.SubprocessError):
        return unavailable("TOOL_OR_ACCESS")
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)
            if process.stdout:
                process.stdout.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise OSError("redirect")


def http_read(url, *, as_json=True):
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(
                urllib.request.Request(url, headers={"User-Agent": "ASA-CLI/1"}), timeout=5) as response:
            data = response.read(65537)
            require(len(data) <= 65536, "HTTP_SIZE", "Слишком большой ответ проверки.")
            return {"status": "OK", "value": json.loads(data) if as_json else response.status}
    except (OSError, ValueError, Blocked):
        return unavailable("HTTP_UNAVAILABLE")


def timestamp(value):
    try:
        date = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.isoformat() if date.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def age(value):
    stamp = timestamp(value)
    return round(max(0, (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(stamp)).total_seconds() / 3600), 2) if stamp else None


def filesystem(path):
    try:
        path = plain(path)
        usage = shutil.disk_usage(path)
        fs = os.statvfs(path) if hasattr(os, "statvfs") else None
        return {"status": "OK", "path": str(path), "totalBytes": usage.total, "freeBytes": usage.free,
                "usedBytes": usage.used, "freeInodes": fs.f_favail if fs else None,
                "totalInodes": fs.f_files if fs else None}
    except (OSError, Blocked, ValueError):
        return unavailable("FILESYSTEM_OR_ACCESS")


class Observer:
    def __init__(self, record):
        self.record = record
        self.root = plain(Path(record["root"])) if record.get("root") else None
        self.errors = []
        self.config = self.document("setup.json") if self.root else {}
        self.settings = self.document("installation.json") if self.root else {}
        self.project = record.get("project") or self.settings.get("project") or self.config.get("project")
        if not isinstance(self.project, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,127}", self.project):
            self.project = None
        if self.project and any(item.get("project", self.project) != self.project for item in (self.config, self.settings)):
            self.project = None
            self.errors.append("INSTALLATION_IDENTITY")
        self._containers = None

    def document(self, name):
        if self.root is None:
            return {}
        try:
            return read_json(self.root / ".asa" / name)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError, Blocked, RecursionError):
            self.errors.append("STATE_OR_ACCESS")
            return {}

    def installed(self):
        value = self.document("installed-release.json")
        try:
            release = validate_release(value)
            return {"status": "RECORDED", "revision": release["revision"], "schema": release["schema"], "images": release["images"]}
        except (Blocked, KeyError, TypeError):
            return unavailable("INSTALLED_RELEASE_UNAVAILABLE")

    def containers(self):
        if self._containers is not None:
            return self._containers
        self._containers = unavailable("INSTALLATION_IDENTITY")
        if not self.project:
            return self._containers
        found = probe(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + self.project])
        if found["status"] != "OK":
            self._containers = found
            return found
        ids = found["output"].split()
        if not ids:
            self._containers = {"status": "FAILED", "reasonCode": "NO_CONTAINERS", "items": []}
            return self._containers
        if len(ids) > 64 or not all(re.fullmatch(r"[a-f0-9]{12,64}", item) for item in ids):
            return self._containers
        template = ('{"id":{{json .Id}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                    '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                    '"workingDir":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
                    '"image":{{json .Config.Image}},"running":{{json .State.Running}},'
                    '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"mounts":{{json .Mounts}}}')
        response = probe(["docker", "inspect", "--format", template, *ids])
        try:
            rows = [json.loads(line) for line in response.get("output", "").splitlines()]
            require(response["status"] == "OK" and len(rows) == len(ids) and all(isinstance(item, dict)
                    and item.get("project") == self.project and isinstance(item.get("service"), str)
                    and item.get("workingDir") == str(self.root)
                    and re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", item["service"])
                    and re.fullmatch(r"[a-f0-9]{64}", item.get("id", ""))
                    and type(item.get("running")) is bool and item.get("health") in (None, "starting", "healthy", "unhealthy")
                    and isinstance(item.get("mounts"), list) for item in rows), "DOCKER_IDENTITY", "Не подтверждены контейнеры установки.")
            required = {"api", "web", "postgres", "minio", "scratch"}
            if "search" in self.installed().get("images", {}):
                required.add("search")
            active = [item for item in rows if item["service"] in required]
            expected_images = self.installed().get("images", {})
            state = "OK" if len(active) == len(required) and {x["service"] for x in active} == required \
                and all(x["running"] and x["health"] == "healthy" and
                        (x["service"] not in expected_images or x.get("image") == expected_images[x["service"]]) for x in active) else "FAILED"
            self._containers = {"status": state, "items": rows}
        except (ValueError, TypeError, Blocked):
            self._containers = unavailable("DOCKER_IDENTITY")
        return self._containers

    def services(self):
        value = self.containers()
        version = probe(["docker", "version", "--format", "{{.Server.Version}}"])
        compose = probe(["docker", "compose", "version", "--short"])
        def version_value(item):
            return {"status": "OK", "version": item["output"]} if item["status"] == "OK" and re.fullmatch(r"[0-9][0-9A-Za-z.+_-]{0,63}", item["output"]) else unavailable("TOOL_OR_ACCESS")
        return {"status": value["status"], "docker": version_value(version), "compose": version_value(compose),
                "containers": [{key: row.get(key) for key in ("service", "running", "health")}
                               for row in value.get("items", [])], "reasonCode": value.get("reasonCode")}

    def database(self):
        rows = [item for item in self.containers().get("items", []) if item["service"] == "postgres" and item["running"]]
        if len(rows) != 1:
            return unavailable("POSTGRES_UNAVAILABLE")
        # SET forces server-side read-only semantics; psql history is disabled.
        script = ('exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                  '-c "SET default_transaction_read_only=on; SELECT max(version)::text, pg_database_size(current_database()) FROM schema_migrations"')
        value = probe(["docker", "exec", rows[0]["id"], "sh", "-eu", "-c", script])
        match = re.fullmatch(r"(?:SET\s+)?([0-9]{1,8})\|([0-9]+)", value.get("output", ""))
        return {"status": "OK", "schema": int(match[1]), "bytes": int(match[2])} if match else unavailable("POSTGRES_QUERY_UNAVAILABLE")

    def site(self):
        origin = self.config.get("entryOrigin")
        try:
            parsed = urllib.parse.urlsplit(origin)
            valid = isinstance(origin, str) and parsed.scheme in ("http", "https") and parsed.hostname \
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
        except (ValueError, TypeError):
            valid = False
        if not valid:
            return unavailable("ENTRY_ORIGIN_UNAVAILABLE")
        origin = origin.rstrip("/")
        ready = http_read(origin + "/health/ready")
        web = http_read(origin + "/build-metadata.json")
        deployment = ready.get("value", {}).get("deployment", {}) if isinstance(ready.get("value"), dict) else {}
        revision = deployment.get("revision")
        agrees = isinstance(revision, str) and SHA.fullmatch(revision) and isinstance(web.get("value"), dict) \
            and web["value"].get("revision") == revision and ready["value"].get("status") == "ready" \
            and deployment.get("synchronized") is True and type(deployment.get("schemaVersion")) is int \
            and deployment.get("schemaVersion") == deployment.get("expectedSchemaVersion")
        editor = http_read(origin + "/internal/blocks/", as_json=False)
        return {"status": "OK" if agrees and editor["status"] == "OK" else "UNAVAILABLE" if ready["status"] != "OK" or editor["status"] != "OK" else "FAILED",
                "origin": origin, "https": "OK" if parsed.scheme == "https" and ready["status"] == "OK" else "UNAVAILABLE",
                "revision": revision if isinstance(revision, str) and SHA.fullmatch(revision) else None,
                "reportedSchema": deployment.get("schemaVersion") if type(deployment.get("schemaVersion")) is int else None,
                "editorEndpoint": {"status": editor["status"]},
                "browserAcceptance": {"status": "NOT_RUN", "reasonCode": "READ_ONLY", "historical": self.acceptance()}}

    def acceptance(self):
        value = self.document("setup-last-successful.json")
        return {"status": "RECORDED" if value else "UNAVAILABLE", "at": timestamp(value.get("observedAt")),
                "applicationAccepted": value.get("applicationAccepted") is True,
                "operationId": value.get("operationId") if isinstance(value.get("operationId"), str) and ID.fullmatch(value["operationId"]) else None}

    def host(self):
        memory = None
        try:
            if hasattr(os, "sysconf"):
                memory = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError):
            pass
        info = platform.freedesktop_os_release() if hasattr(platform, "freedesktop_os_release") and Path("/etc/os-release").exists() else {}
        return {"status": "OK", "os": platform.system(), "distribution": info.get("ID"), "version": info.get("VERSION_ID"),
                "architecture": platform.machine(), "cpuCount": os.cpu_count(), "memoryBytes": memory,
                "supportedSetupHost": info.get("ID") == "ubuntu" and info.get("VERSION_ID") == "24.04" and platform.machine() in ("x86_64", "AMD64")}

    def disk(self, health=False):
        if health:
            return self.disk_health()
        volumes = {"application": filesystem(self.root) if self.root else unavailable("ROOT_REQUIRED")}
        backup = self.config.get("backupDirectory") or self.settings.get("backupDirectory") or (str(self.root / "backups") if self.root else None)
        volumes["backups"] = filesystem(backup) if isinstance(backup, str) else unavailable("BACKUP_PATH")
        docker = probe(["docker", "info", "--format", "{{.DockerRootDir}}"])
        volumes["docker"] = filesystem(docker["output"]) if docker.get("output", "").startswith("/") else unavailable("DOCKER_DATA_ROOT")
        for service in ("postgres", "minio"):
            rows = [item for item in self.containers().get("items", []) if item["service"] == service]
            mounts = [m for row in rows for m in row["mounts"] if isinstance(m, dict) and m.get("Destination", "").startswith("/var/lib/postgresql/data" if service == "postgres" else "/data")]
            volumes[service] = filesystem(mounts[0]["Source"]) if len(mounts) == 1 and isinstance(mounts[0].get("Source"), str) else unavailable("STORAGE_MOUNT")
        return {"status": "OK" if all(v["status"] == "OK" for v in volumes.values()) else "UNAVAILABLE", "filesystems": volumes,
                "database": self.database(), "physicalHealth": unavailable("USE_DISK_HEALTH")}

    def disk_health(self):
        devices = probe(["lsblk", "--json", "--nodeps", "--output", "NAME,TYPE"])
        results = []
        try:
            rows = json.loads(devices.get("output", "{}")) .get("blockdevices", [])
            require(isinstance(rows, list) and len(rows) <= 32, "DISK_INVENTORY", "Слишком много физических устройств.")
            for row in rows:
                name = row.get("name", "")
                if row.get("type") != "disk" or not re.fullmatch(r"(?:sd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|vd[a-z]+|xvd[a-z]+)", name):
                    continue
                check = probe(["smartctl", "--json", "--health", "/dev/" + name], timeout=8, allow_nonzero=True)
                value = json.loads(check.get("output", "{}"))
                passed = value.get("smart_status", {}).get("passed")
                code = check.get("returnCode", 0)
                if passed is None and name.startswith("nvme"):
                    nvme = probe(["nvme", "smart-log", "/dev/" + name, "-o", "json"], timeout=8)
                    nvme_value = json.loads(nvme.get("output", "{}"))
                    warning = nvme_value.get("critical_warning")
                    if type(warning) is int:
                        passed = warning == 0
                        code = 0
                health = "FAILED" if passed is False or code & 24 else "WARNING" if passed is True and code & 224 else "OK" if passed is True and not code & 7 else "UNAVAILABLE"
                results.append({"device": "/dev/" + name, "status": health})
        except (ValueError, TypeError, AttributeError, Blocked):
            return unavailable("SMART_UNAVAILABLE")
        return {"status": "FAILED" if any(x["status"] == "FAILED" for x in results) else "WARNING" if any(x["status"] == "WARNING" for x in results) else "OK" if results and all(x["status"] == "OK" for x in results) else "UNAVAILABLE",
                "devices": results, "reasonCode": None if results else "NO_PHYSICAL_SENSOR"}

    def schedule(self):
        installation_id = self.config.get("installationId")
        settings = self.config.get("backup", {}).get("schedule", {})
        if not isinstance(installation_id, str) or not ID.fullmatch(installation_id):
            return unavailable("SETUP_CONFIGURATION")
        from .backup_schedule import unit_name, validate_schedule
        try:
            settings = validate_schedule(settings)
        except (Blocked, TypeError):
            return unavailable("SCHEDULE_CONFIGURATION")
        timer = unit_name(installation_id) + ".timer"
        check = probe(["systemctl", "show", timer, "--property=LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec"])
        fields = dict(line.split("=", 1) for line in check.get("output", "").splitlines() if "=" in line)
        loaded = fields.get("LoadState") == "loaded"
        return {"status": "OK" if check["status"] == "OK" and (loaded or not settings["enabled"]) else "UNAVAILABLE",
                "configured": settings, "installed": loaded if check["status"] == "OK" else None,
                "active": fields.get("ActiveState") == "active" if loaded else None,
                "enabled": fields.get("UnitFileState") == "enabled" if loaded else None,
                "nextRun": self.safe_systemd_time(fields.get("NextElapseUSecRealtime")),
                "lastRun": self.safe_systemd_time(fields.get("LastTriggerUSec"))}

    @staticmethod
    def safe_systemd_time(value):
        return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9 :+.\-/]{1,80}", value) else None

    def backup_item(self, value):
        snapshot = value.get("snapshotId")
        if not isinstance(snapshot, str) or not SNAPSHOT.fullmatch(snapshot) or value.get("installationId") != self.config.get("installationId"):
            return unavailable("BACKUP_IDENTITY")
        local, cloud, encryption = (value.get(part, {}) for part in ("local", "cloud", "encryption"))
        size, present = None, None
        try:
            base = self.config.get("backupDirectory") or self.settings.get("backupDirectory") or str(self.root / "backups")
            target = plain(Path(base) / snapshot)
            present = target.is_dir()
            if present:
                manifest = read_json(target / "manifest.json")
                files = manifest.get("files", {})
                if isinstance(files, dict) and len(files) <= 10000 and all(isinstance(row, dict) and type(row.get("bytes")) is int and row["bytes"] >= 0 for row in files.values()):
                    size = sum(row["bytes"] for row in files.values())
        except (OSError, ValueError, Blocked, TypeError):
            present = None
        return {"status": "RECORDED", "snapshotId": snapshot, "snapshotAt": timestamp(value.get("snapshotAt")),
                "ageHours": age(value.get("snapshotAt")), "local": {"status": safe_code(local.get("status")), "deleted": bool(local.get("deletedAt")),
                    "bytes": size, "present": present, "evidenceScope": "RECORDED_VERIFICATION"},
                "encryption": {"status": safe_code(encryption.get("status")), "bytes": encryption.get("bytes") if type(encryption.get("bytes")) is int else None},
                "cloud": {"status": safe_code(cloud.get("status")), "verifiedAt": timestamp(cloud.get("verifiedAt")),
                    "evidenceScope": "RECORDED_DELIVERY", "deleted": bool(cloud.get("deletedAt"))}}

    def backups(self, listing=False):
        pointers = {}
        for label, file in (("lastAttempt", "last-attempt.json"), ("lastLocalSuccess", "last-local-success.json"), ("lastCloudSuccess", "last-cloud-success.json")):
            pointer = self.document("setup-backups/" + file)
            snapshot = pointer.get("snapshotId")
            value = self.document("setup-backups/" + snapshot + ".json") if isinstance(snapshot, str) and SNAPSHOT.fullmatch(snapshot) else {}
            if label == "lastCloudSuccess" and value and isinstance(pointer.get("proof"), dict):
                # A newer failed retry cannot erase the prior successful
                # delivery recorded in this pointer. It is historical proof.
                value = {**value, "cloud": pointer["proof"]}
            pointers[label] = self.backup_item(value) if value else unavailable("BACKUP_EVIDENCE_MISSING")
        result = {"status": "RECORDED" if pointers["lastLocalSuccess"]["status"] == "RECORDED" else "UNAVAILABLE", **pointers}
        if listing:
            rows = []
            try:
                directory = plain(self.root / ".asa/setup-backups")
                paths = sorted(directory.glob("*.json"), reverse=True)
                require(len(paths) <= 10000, "BACKUP_LIST_LIMIT", "Каталог backup превышает бюджет чтения.")
                for path in paths:
                    if SNAPSHOT.fullmatch(path.stem):
                        rows.append(self.backup_item(read_json(path)))
                    if len(rows) == 100:
                        break
                result.update(items=rows, limit=100, truncated=len(paths) > 103)
            except (OSError, Blocked, ValueError, TypeError):
                result.update(status="UNAVAILABLE", items=[])
        else:
            result["schedule"] = self.schedule()
        return result

    def backup_verify(self, snapshot=None):
        snapshot = snapshot or self.document("setup-backups/last-local-success.json").get("snapshotId")
        require(isinstance(snapshot, str) and SNAPSHOT.fullmatch(snapshot), "SNAPSHOT_REQUIRED", "Укажите существующий --snapshot-id.")
        receipt = self.document("setup-backups/" + snapshot + ".json")
        require(self.backup_item(receipt)["status"] == "RECORDED", "BACKUP_IDENTITY", "Копия не принадлежит этой установке.")
        base = self.config.get("backupDirectory") or self.settings.get("backupDirectory") or str(self.root / "backups")
        target = plain(Path(base) / snapshot)
        read_json(target / "manifest.json")  # regular bounded file before the existing verifier
        manifest = verify_backup(target)
        require(manifest.get("snapshotId") == snapshot and manifest.get("installationId") == self.config.get("installationId")
                and manifest.get("operationId") == receipt.get("operationId"), "BACKUP_IDENTITY", "Идентичность манифеста копии не совпала.")
        digest = hashlib.sha256(read_bytes(target / "manifest.json")).hexdigest()
        require(digest == receipt.get("local", {}).get("manifestSha256"), "BACKUP_HASH", "Манифест изменился после резервирования.")
        return {"status": "OK", "snapshotId": snapshot, "local": "VERIFIED", "files": len(manifest["files"]),
                "bytes": sum(item["bytes"] for item in manifest["files"].values()), "restore": "UNVERIFIED",
                "cloud": self.backup_item(receipt)["cloud"]}

    def delivery_snapshot(self):
        """Select existing ciphertext only; retry-cloud rechecks bytes under lock."""
        snapshot = self.document("setup-backups/last-local-success.json").get("snapshotId")
        require(isinstance(snapshot, str) and SNAPSHOT.fullmatch(snapshot), "SNAPSHOT_REQUIRED",
                "Нет последней успешной копии; укажите существующий --snapshot-id.")
        receipt = self.document("setup-backups/" + snapshot + ".json")
        require(receipt.get("format") == "asa-backup-operation-v1"
                and receipt.get("snapshotId") == snapshot and receipt.get("installationId") == self.config.get("installationId"),
                "BACKUP_IDENTITY", "Снимок не принадлежит этой установке.")
        local, encryption = receipt.get("local", {}), receipt.get("encryption", {})
        require(local.get("status") == encryption.get("status") == "OK"
                and not local.get("deletedAt") and not encryption.get("deletedAt"),
                "BACKUP_CIPHERTEXT_MISSING", "Для выбранной копии нет готового ciphertext; новый backup не запускается.")
        base = self.config.get("backupDirectory") or self.settings.get("backupDirectory") or str(self.root / "backups")
        path = plain(Path(base) / "encrypted" / ("asa-lab-" + snapshot + ".tar.age"))
        info = path.stat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and encryption.get("path") == str(path)
                and type(encryption.get("bytes")) is int and info.st_size == encryption["bytes"] > 0,
                "BACKUP_CIPHERTEXT_MISSING", "Подготовленный ciphertext недоступен или изменён.")
        return snapshot

    def cloud(self):
        policy = self.config.get("backup", {})
        cloud = policy.get("cloud", {})
        transport = unavailable("CLOUD_NOT_CONFIGURED")
        if cloud.get("enabled") is True:
            try:
                from .backup_workflow import TRANSPORT_SHA256
                data = read_bytes(Path(cloud.get("transportPath", "")))
                require(hashlib.sha256(data).hexdigest() == TRANSPORT_SHA256 == cloud.get("transportSha256"),
                        "CLOUD_TRANSPORT_PIN", "Не подтверждён transport pin.")
                constants = {}
                for node in ast.parse(data).body:
                    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("PROJECT", "IMAGE"):
                        constants[node.targets[0].id] = ast.literal_eval(node.value)
                project, image = constants["PROJECT"], constants["IMAGE"]
                require(isinstance(project, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", project), "CLOUD_TRANSPORT_PIN", "Некорректный transport project.")
                template = '{"image":{{json .Config.Image}},"user":{{json .Config.User}},"owner":{{json (index .Config.Labels "asa.owner")}},"running":{{json .State.Running}}}'
                output = probe(["docker", "inspect", "--format", template, project + "-rclone-1"])
                value = json.loads(output.get("output", "{}"))
                require(value.get("image") == image and value.get("user") == "1000:1000" and value.get("owner") == project,
                        "CLOUD_TRANSPORT_IDENTITY", "Не подтверждён контейнер транспорта.")
                transport = {"status": "OK" if value.get("running") is True else "FAILED"}
            except (OSError, ValueError, KeyError, TypeError, Blocked):
                transport = unavailable("CLOUD_TRANSPORT_UNAVAILABLE")
        return {"status": "UNAVAILABLE", "configured": cloud.get("enabled") is True,
                "policy": policy.get("policy") if policy.get("policy") in ("required", "best-effort") else None,
                "transport": transport, "remote": unavailable("NO_READ_ONLY_PROVIDER_PROBE"),
                "lastDelivery": self.backups()["lastCloudSuccess"],
                "note": "Квитанция доставки относится к указанной дате; связь и удалённые байты сейчас не подтверждены."}

    def history(self, kind=None):
        rows = []
        try:
            paths = sorted(plain(self.root / ".asa/setup-operations").glob("*.json"))
            require(len(paths) <= 10000, "HISTORY_LIMIT", "История превышает бюджет чтения.")
            for path in paths:
                if not ID.fullmatch(path.stem):
                    continue
                value = read_json(path)
                mode = value.get("mode")
                if kind and mode not in (("install", "update") if kind == "update" else ("backup", "retry-cloud")):
                    continue
                if value.get("installationId") != self.config.get("installationId") or value.get("root") != str(self.root):
                    continue
                rows.append({"operationId": path.stem, "mode": mode if mode in ("install", "update", "backup", "retry-cloud", "configure", "schedule", "repair-collector") else "unknown",
                             "startedAt": timestamp(value.get("startedAt")), "updatedAt": timestamp(value.get("updatedAt")),
                             "state": safe_code(value.get("state")), "outcome": safe_code(value.get("result", {}).get("outcome")),
                             "reasonCode": safe_code(value.get("result", {}).get("reasonCode"), "NONE")})
            rows.sort(key=lambda item: item["startedAt"] or "", reverse=True)
            return {"status": "OK" if rows else "UNAVAILABLE", "items": rows[:100], "truncated": len(rows) > 100}
        except (OSError, Blocked, ValueError, TypeError):
            return unavailable("HISTORY_OR_ACCESS")

    def logs(self, kind=None, operation_id=None):
        history = self.history(kind)
        rows = [item for item in history.get("items", []) if not operation_id or item["operationId"] == operation_id][:10]
        results = []
        for item in rows:
            value = self.document("setup-operations/" + item["operationId"] + ".json")
            events = []
            for event in value.get("events", [])[-100:]:
                if isinstance(event, dict):
                    events.append({"at": timestamp(event.get("at")), **{key: field for key, field in event.items() if key in ("stage", "status", "phase")
                                   and isinstance(field, str) and re.fullmatch(r"[a-z_]{1,64}", field)}})
            # Raw logs can contain arbitrary secrets. Expose only typed journal
            # events, never heuristic redaction of full subprocess messages.
            results.append({**item, "events": events})
        return {"status": "OK" if results else "UNAVAILABLE", "scope": "SANITIZED_OPERATION_EVENTS", "items": results}

    def configuration(self):
        if not self.config:
            return unavailable("SETUP_CONFIGURATION")
        backup = self.config.get("backup", {})
        ports = self.config.get("ports", {})
        return {"status": "OK", "format": "asa-setup-config-v1", "root": str(self.root), "project": self.project,
                "profile": self.config.get("profile") if self.config.get("profile") in ("production", "staging", "dev", "base") else None,
                "ports": {key: value for key, value in ports.items() if key in ("web", "api", "blocks") and type(value) is int and 1 <= value <= 65535},
                "backupPolicy": backup.get("policy") if backup.get("policy") in ("required", "best-effort") else None,
                "cloudEnabled": backup.get("cloud", {}).get("enabled") is True,
                "automaticUpdates": self.settings.get("automaticUpdates") is True,
                "schedule": self.schedule().get("configured"), "secrets": "OMITTED"}

    def status(self, extended=False, compact=False):
        services, database, site = self.services(), self.database(), self.site()
        installed = self.installed()
        same = installed.get("revision") == site.get("revision") and installed.get("schema") == database.get("schema") == site.get("reportedSchema")
        value = {"status": "OK" if same and all(x["status"] == "OK" for x in (services, database, site)) else "UNAVAILABLE" if any(x["status"] == "UNAVAILABLE" for x in (services, database, site)) else "FAILED",
                 "observedAt": now(), "root": str(self.root) if self.root else None, "installed": installed,
                 "services": services, "database": database, "site": site, "backup": self.backups(),
                 "updates": {"status": "UNAVAILABLE", "checkedAt": None, "reasonCode": "USE_UPDATE_CHECK"},
                 "history": self.history() if not compact else {"status": "NOT_REQUESTED"}, "access": "LIMITED" if self.errors else "OBSERVED"}
        if extended:
            checks = {"host": self.host(), "disk": self.disk(), "diskHealth": self.disk_health(), "cloud": self.cloud()}
            value.update(checks)
            # Include current transport health, not historical delivery receipts.
            # Optional sensors/provider probes can be unavailable without masking
            # a failure or warning that was actually observed elsewhere.
            checks.update({"cloud." + key: value["cloud"].get(key, unavailable()) for key in ("transport", "remote")})
            states = {value["status"], *(check.get("status") for check in checks.values())}
            if "FAILED" in states:
                value["status"] = "FAILED"
            elif "WARNING" in states:
                value["status"] = "WARNING"
            value["optionalUnavailableChecks"] = [name for name, check in checks.items() if check.get("status") == "UNAVAILABLE"]
        return value

    def update_plan(self, selection):
        installed, database = self.installed(), self.database()
        target = selection["release"]
        backups, cloud = self.backups(), self.cloud()
        blockers = []
        if installed["status"] != "RECORDED":
            blockers.append("INSTALLED_RELEASE_UNAVAILABLE")
        if database["status"] != "OK":
            blockers.append("CURRENT_SCHEMA_UNAVAILABLE")
        if database.get("schema", 0) > target["schema"]:
            blockers.append("SCHEMA_DOWNGRADE")
        if self.config.get("backup", {}).get("policy") not in ("required", "best-effort"):
            blockers.append("BACKUP_POLICY_UNAVAILABLE")
        if cloud["policy"] == "required" and cloud["transport"]["status"] != "OK":
            blockers.append("REQUIRED_CLOUD_TRANSPORT_UNAVAILABLE")
        space = self.backup_space(database)
        if space.get("reasonCode") == "SPACE":
            blockers.append("BACKUP_SPACE")
        return {"status": "BLOCKED" if blockers else "PLANNED", "checkedAt": selection["checkedAt"],
                "current": installed, "currentDatabase": database,
                "target": {"revision": target["revision"], "schema": target["schema"], "images": target["images"],
                           "deploymentDigest": selection["deploymentDigest"], "manifestDigest": selection["manifestDigest"], "ci": selection["ci"]},
                "available": target["revision"] != installed.get("revision") if installed.get("revision") else None,
                "migrations": {"status": "SCHEMA_RANGE_ONLY" if database["status"] == "OK" else "UNAVAILABLE",
                               "fromSchema": database.get("schema"), "toSchema": target["schema"], "exactList": None,
                               "reasonCode": "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"},
                "requiredSpaceBytes": None, "estimatedDowntimeSeconds": None,
                "backupSpaceEstimate": space, "downtimeReasonCode": "NO_MEASURED_DURATION",
                "spaceReasonCode": "NEW_IMAGE_UNPACKED_BYTES_UNKNOWN", "disk": self.disk(), "backup": backups,
                "cloud": cloud, "blockers": blockers, "applyRechecksUnderLock": True,
                "apply": "sudo asa update" + (" --root " + shlex.quote(str(self.root)) if self.root else "")
                         + " --deployment-digest " + selection["deploymentDigest"]}

    def backup_space(self, database):
        """Use the manager's pure budget formula with fresh storage readings.

        This is a backup reservation, not a claim about new unpacked images or
        downtime. A large/inaccessible store stays unknown after the timeout.
        """
        rows = [item for item in self.containers().get("items", []) if item["service"] == "minio" and item["running"]]
        if database.get("status") != "OK" or len(rows) != 1 or os.name != "posix":
            return unavailable("STORAGE_MEASUREMENT_UNAVAILABLE")
        size = probe(["docker", "exec", rows[0]["id"], "du", "-sk", "/data"], timeout=15)
        count = probe(["docker", "exec", rows[0]["id"], "sh", "-eu", "-c",
                       'set -o pipefail; find /data -xdev -print0 | tr -cd "\\000" | wc -c'], timeout=15)
        size_match = re.fullmatch(r"([0-9]+)\s+/data", size.get("output", ""))
        if not size_match or not re.fullmatch(r"[0-9]+", count.get("output", "")):
            return unavailable("STORAGE_MEASUREMENT_UNAVAILABLE")
        try:
            from .setup_host import disk_budget
            private_size = plain(self.root / ".env").stat().st_size
            total = database["bytes"] + int(size_match[1]) * 1024 + private_size
            path = self.config.get("backupDirectory") or self.settings.get("backupDirectory") or str(self.root / "backups")
            plain(path)
            budget = disk_budget(path, snapshot_bytes=total, snapshot_entries=int(count["output"]) + 32)
            return {"status": "MEASURED_BACKUP_BUDGET", "scope": "LOCAL_SNAPSHOT_TAR_CIPHERTEXT_READBACK_RESERVE",
                    "observedSnapshotBytes": total, "imageBytes": None, **budget}
        except (OSError, ValueError, Blocked) as exc:
            return unavailable(safe_code(getattr(exc, "code", None), "SPACE_MEASUREMENT_UNAVAILABLE"))
