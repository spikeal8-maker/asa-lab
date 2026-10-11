"""Durable ASA diagnostic collector. Standard library only; never changes app data."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import sys
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
SEGMENT_PATTERN = re.compile(r"seg-\d{16}-\d{16}\.jsonl(?:\.gz)?$")
RETIRE_SECONDS = 600  # Longer than five-minute resumable searches and exports.
SENSITIVE = re.compile(r"password|passwd|secret|cookie|authorization|credential|student.?code|token|api.?key|jwt|signing.?key", re.I)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_store_paths(root):
    for name in ('.asa', '.asa/diagnostics', '.asa/diagnostics/store', '.asa/diagnostics/private'):
        path = root / name
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError('Diagnostic paths must not be symlinks or junctions')


def clean(value):
    if isinstance(value, dict):
        return {k: "[redacted]" if SENSITIVE.search(k) else clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value[:100]]
    if not isinstance(value, str):
        return value
    value = re.sub(r'(/api/classroom-teacher-invitations/)[^\s/?"\\]+', r'\1[redacted]', value)
    value = re.sub(r"(?im)((?:set-)?cookie\s*:)\s*[^\r\n]+", r"\1 [redacted]", value)
    value = re.sub(r"(?i)(bearer\s+)[^\s\"',;]+", r"\1[redacted]", value)
    value = re.sub(r"(?i)(://[^\s:/]+:)[^\s@]+(@)", r"\1[redacted]\2", value)
    value = re.sub(r"(?i)((?:password|passwd|secret|cookie|authorization|student[_-]?code|(?:access[_-]?|refresh[_-]?|bot[_-]?)?token|api[_-]?key|signing[_-]?key)[\"']?\s*[=:]\s*[\"']?)[^\s\"',;&}]+", r"\1[redacted]", value)
    # Start only at a token boundary: retrying at every character of a long
    # identifier makes the usual email regex quadratic when there is no '@'.
    if "@" in value:
        value = re.sub(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", value)
    return value


def timestamp(value: str, fallback: str) -> str:
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            # File sources without offsets use the host's own timezone.
            stamp = stamp.astimezone()
        return stamp.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, TypeError):
        return fallback


def file_timestamp(raw: str, fallback: str) -> tuple[str, str]:
    """Only file adapters infer time; container/DB/Windows timestamps stay authoritative."""
    match = re.match(r"(?:\[)?(\d{4}[-/]\d\d[-/]\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:\d\d)?)", raw)
    value = match[1].replace("/", "-").replace(",", ".") if match else None
    if value is None:
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                value = next((payload[k] for k in ("time", "timestamp", "ts") if k in payload), None)
        except ValueError:
            pass
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            # Unix seconds and milliseconds are explicit, bounded formats.
            value = datetime.fromtimestamp(value / 1000 if value >= 1e12 else value, UTC).isoformat()
        except (ValueError, OverflowError, OSError):
            value = None
    parsed = timestamp(value, "") if isinstance(value, str) else ""
    if parsed and datetime.fromisoformat(parsed.replace("Z", "+00:00")) > datetime.now(UTC) + timedelta(minutes=5): parsed = ""
    return (parsed, "event") if parsed else (timestamp(fallback, fallback), "file_mtime")


def log_level(payload, raw: str) -> str:
    if isinstance(payload, dict):
        if payload.get('kind') == 'http_response' and type(payload.get('status', payload.get('statusCode'))) is int:
            code = payload.get('status', payload.get('statusCode'))
            return 'error' if code >= 500 else 'warn' if code >= 400 else 'info'
        value = payload.get("level", payload.get("severity"))
        if isinstance(value, str):
            levels = {"fatal": "error", "critical": "error", "panic": "error", "error": "error", "err": "error", "warn": "warn", "warning": "warn", "info": "info", "information": "info", "debug": "info", "trace": "info"}
            if value.lower() in levels: return levels[value.lower()]
        if type(value) is int and value in (10, 20, 30, 40, 50, 60):
            return "error" if value >= 50 else "warn" if value == 40 else "info"
        code = payload.get("status", payload.get("statusCode"))
        if type(code) is int:
            return "error" if code >= 500 else "warn" if code >= 400 else "info"
        # Search human text, not keys, route names or exception-counter fields.
        raw = str(payload.get("msg", payload.get("message", "")))
    if re.search(r"\b(error|fatal|panic|exception|failed|failure|blocked)\b|\[E\]", raw, re.I): return "error"
    if re.search(r"\b(warn|warning)\b|\[W\]", raw, re.I): return "warn"
    return "info"


def unpack_payload(value) -> str:
    return gzip.decompress(value).decode("utf-8") if isinstance(value, bytes) else value


def subsystem(source: str, payload=None, origin="") -> str:
    if source == 'api' and isinstance(payload, dict) and payload.get('kind') == 'client_diagnostic':
        module = payload.get('module')
        if module in ('portal', 'scratch', 'electronics', 'auth'):
            return {'portal': 'web', 'auth': 'access'}.get(module, module)
    if source == 'web' and isinstance(payload, dict) and str(payload.get('path', '')).startswith('/internal/blocks/'): return 'scratch'
    if source == "api":
        route = str(payload.get("path", "")).split("?")[0].split("/") if isinstance(payload, dict) else []
        route = route[2] if len(route) > 2 else ""
        for pattern, name in ((r"^(auth|class-join|account|identity|max|student)", "access"), (r"^classroom", "classrooms"), (r"^(blocks|scratch)", "scratch"), (r"^(files|uploads|storage)", "storage"), (r"^admin", "administration")):
            if re.search(pattern, route): return name
        if route == 'assignments': return 'learning'
        if route in ('session', 'workspaces', 'capabilities', 'schools'): return 'access'
        return route if route in ("projects", "learning", "courses", "analytics", "diagnostics", "electronics", "chess", "checkers", "three-d") else "api"
    if source.startswith(("windows:", "linux:")) or source in ("docker-desktop", "docker-lifecycle"): return "host"
    if source in ("postgres", "migration"): return "database"
    if source.startswith("minio"): return "storage"
    if source == "tunnel": return "network"
    if origin in ("product_analytics_events", "classroom_activity_events", "grade_change_events"):
        return {"product_analytics_events": "analytics", "classroom_activity_events": "classrooms", "grade_change_events": "learning"}[origin]
    if source == "auth": return "access"
    return source if source in ("web", "scratch", "electronics", "chess", "checkers", "three-d", "audit", "updates", "backup", "metrics") else "audit"


def event_subsystem(event):
    if event.get("subsystem"): return event["subsystem"]
    try: payload = json.loads(event["message"]) if event["source"] in ("api", "web") else None
    except (ValueError, TypeError): payload = None
    return subsystem(event["source"], payload, event.get("origin", ""))


def normalize(source: str, raw: str, at: str, identity: str, origin: str = "") -> dict:
    payload = None
    try:
        payload = json.loads(raw)
    except ValueError:
        pass
    level = log_level(payload, raw)
    module = "scratch" if source == "scratch" else "auth" if source == "auth" else "system"
    request_id = revision = None
    if isinstance(payload, dict):
        route = str(payload.get("path", ""))
        module = "electronics" if "electronics" in route else "scratch" if "blocks" in route or "scratch" in route else "auth" if "/auth/" in route or "class-join" in route else "portal" if source == "api" else module
        if payload.get("module") in ("scratch", "electronics", "auth", "portal", "system"):
            module = payload["module"]
        if payload.get("kind") == "client_diagnostic" and payload.get("level") not in ("info", "warn", "error"):
            level = "error"
        request_id = payload.get("requestId") if isinstance(payload.get("requestId"), str) and re.fullmatch(r"[a-fA-F0-9-]{36}", payload["requestId"]) else None
        revision = payload.get("revision") if isinstance(payload.get("revision"), str) and re.fullmatch(r"[a-f0-9]{7,64}", payload["revision"]) else None
        # Audit/project payloads are deliberately not forwarded.
        payload = {k: v for k, v in payload.items() if k not in ("payload_json", "snapshot", "metadata_json")}
        if "requestId" in payload: payload["requestId"] = request_id
        if "revision" in payload: payload["revision"] = revision
        message = json.dumps(clean(payload), ensure_ascii=False, separators=(",", ":"))
    else:
        message = clean(raw)
    truncated = len(message) > 16384
    return dict(id=hashlib.sha256((source + "\0" + identity).encode()).hexdigest(), time=at, source=source, subsystem=subsystem(source, payload, origin), module=module, level=level, message=message[:16384], requestId=request_id, revision=revision, origin=clean(origin), truncated=truncated, normalizationVersion=2)


def linux_resources(proc=Path('/proc'), previous=None):
    memory = {}
    for line in (proc / 'meminfo').read_text()[:65536].splitlines():
        match = re.fullmatch(r'([A-Za-z_()]+):\s+(\d+)\s+kB', line.strip())
        if match: memory[match[1]] = int(match[2]) * 1024
    if not memory.get('MemTotal') or 'MemAvailable' not in memory:
        raise ValueError('Linux memory sample is missing MemTotal/MemAvailable')
    host = dict(memoryTotalBytes=memory['MemTotal'], memoryAvailableBytes=memory['MemAvailable'],
                swapTotalBytes=memory.get('SwapTotal'), swapFreeBytes=memory.get('SwapFree'))
    if 'CommitLimit' in memory and 'Committed_AS' in memory:
        host.update(commitLimitBytes=memory['CommitLimit'], memoryCommittedBytes=memory['Committed_AS'],
                    commitAvailableBytes=max(0, memory['CommitLimit'] - memory['Committed_AS']))
    try: host['commitPolicy'] = int((proc / 'sys/vm/overcommit_memory').read_text().strip())
    except (OSError, ValueError): host['commitPolicy'] = None
    line = (proc / 'stat').read_text()[:65536].splitlines()[0].split()
    if not line or line[0] != 'cpu' or len(line) < 5: raise ValueError('Invalid Linux CPU sample')
    values = [int(v) for v in line[1:9]]
    counters = [values[3] + (values[4] if len(values) > 4 else 0), sum(values)]
    if previous and counters[1] > previous[1] and counters[0] >= previous[0]:
        host['cpuPercent'] = round(max(0, min(100, 100 * (1 - (counters[0]-previous[0])/(counters[1]-previous[1])))), 2)
    return host, counters


def resource_warnings(host):
    warnings = []
    if host.get('diskFreeBytes', 2**63) < 1024**3: warnings.append('host_disk_low')
    if host.get('memoryAvailableBytes', 2**63) < max(512 * 1024**2, host.get('memoryTotalBytes', 0) // 20): warnings.append('host_memory_low')
    if host.get('commitLimitBytes', 0) > 0 and host.get('commitPolicy') != 1 and host.get('commitAvailableBytes', 2**63) <= host['commitLimitBytes'] // 10:
        warnings.append('host_commit_pressure')
    return warnings


class Collector:
    def __init__(self, root: Path, config: dict):
        self.root = root.resolve()
        safe_store_paths(self.root)
        self.config = config
        self.reader_format = 1
        self.reader_formats = {}
        self.base = self.root / ".asa" / "diagnostics"
        self.store = self.base / "store"
        self.private = self.base / "private"
        self.store.mkdir(parents=True, exist_ok=True)
        self.private.mkdir(exist_ok=True)
        if os.name != "nt":
            os.chmod(self.store, 0o2750)
            os.chmod(self.private, 0o700)
        self.db = sqlite3.connect(self.private / "index.sqlite", timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,time TEXT,source TEXT,payload TEXT,published INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS sources(name TEXT PRIMARY KEY,payload TEXT);""")
        # Published JSONL is the durable payload. Keep only a binary digest and
        # sequence in its duplicate index, rather than a second copy of every log.
        try:
            self.upgrade_index()
            self.finish_compaction()
        except Exception:
            self.db.close()
            raise

    def upgrade_index(self):
        if self.state("index:version") == 2: return
        # Verify the actual immutable payload before discarding its private copy.
        # A filename range alone is not proof that a record survived publication.
        self.db.execute("CREATE TEMP TABLE verified_payloads(id BLOB PRIMARY KEY) WITHOUT ROWID")
        for file in self.store.glob("seg-*.jsonl*"):
            if not SEGMENT_PATTERN.fullmatch(file.name): continue
            try:
                opener = gzip.open if file.name.endswith(".gz") else open
                with opener(file, "rb") as stream:
                    raw = stream.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024 or not raw.endswith(b"\n"): raise ValueError("Invalid segment size or termination")
                events = [json.loads(line) for line in raw.splitlines()]
                if not events or any(not isinstance(e, dict) or not re.fullmatch(r"[a-f0-9]{64}", str(e.get("id", ""))) for e in events): raise ValueError("Invalid segment identity")
                self.db.executemany("INSERT OR IGNORE INTO verified_payloads VALUES(?)", [(bytes.fromhex(e["id"]),) for e in events])
            except (ValueError, OSError, EOFError) as exc:
                self.db.rollback()
                raise RuntimeError("Diagnostic segment verification failed; private payloads were preserved") from exc
        self.db.commit()
        old_sequence = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone()
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute("CREATE TABLE events_upgrade(seq INTEGER PRIMARY KEY AUTOINCREMENT,id BLOB UNIQUE,time TEXT,source TEXT,payload BLOB,published INTEGER DEFAULT 0)")
        after = 0
        while True:
            rows = self.db.execute("SELECT seq,id,time,source,payload,published FROM events WHERE seq>? ORDER BY seq LIMIT 1000", (after,)).fetchall()
            if not rows: break
            changes = []
            for seq, identity, at, source, payload, published in rows:
                digest = bytes.fromhex(identity) if isinstance(identity, str) else identity
                covered = self.db.execute("SELECT 1 FROM verified_payloads WHERE id=?", (digest,)).fetchone()
                if published and covered:
                    changes.append((seq, digest, None, None, None, 1))
                else:
                    if payload is None: raise RuntimeError("Diagnostic index references a missing payload; restore its diagnostic snapshot")
                    changes.append((seq, digest, at, source, gzip.compress(payload.encode(), compresslevel=1, mtime=0) if isinstance(payload, str) else payload, 0))
            self.db.executemany("INSERT INTO events_upgrade VALUES(?,?,?,?,?,?)", changes)
            after = rows[-1][0]
        # Swap the complete compact index atomically, keeping the old payload
        # table intact if conversion is interrupted. Avoid rewriting its large
        # payload pages and secondary indexes one record at a time.
        self.db.execute("DROP TABLE events")
        self.db.execute("ALTER TABLE events_upgrade RENAME TO events")
        if old_sequence:
            new_sequence = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone()
            self.db.execute("DELETE FROM sqlite_sequence WHERE name='events'")
            self.db.execute("INSERT INTO sqlite_sequence(name,seq) VALUES('events',?)", (max(old_sequence[0], new_sequence[0] if new_sequence else 0),))
        self.db.execute("CREATE INDEX event_unpublished ON events(seq) WHERE published=0")
        self.db.execute("DROP TABLE verified_payloads")
        self.set_state("index:version", 2)
        self.db.commit()
        self.db.execute("VACUUM")

    def state(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key: str, value):
        self.db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", (key, json.dumps(value)))

    def status(self, source: str, state: str, detail="", collected_through=None):
        previous = self.db.execute("SELECT payload FROM sources WHERE name=?", (source,)).fetchone()
        prior = json.loads(previous[0]) if previous else {}
        value = dict(source=source, state=state, checkedAt=now(), lastCollectedAt=now() if state == "ok" else prior.get("lastCollectedAt"), collectedThrough=collected_through or prior.get("collectedThrough"), detail=clean(str(detail))[:500])
        value['applicable'] = not (source.startswith('windows') and os.name != 'nt' or source.startswith('linux:') and not sys.platform.startswith('linux'))
        if source == 'docker-lifecycle':
            value['possibleCoverageGap'] = bool(self.state('docker:lifecycle:coverage', []))
        if source == 'linux:journal':
            value['possibleCoverageGap'] = bool(self.state('linux:journal:gap', False))
        self.db.execute("INSERT OR REPLACE INTO sources VALUES(?,?)", (source, json.dumps(value)))

    def add(self, event):
        cutoff = (datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if event["time"] < cutoff: return
        encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.db.execute("INSERT OR IGNORE INTO events(id,time,source,payload) VALUES(?,?,?,?)", (bytes.fromhex(event["id"]), event["time"], event["source"], gzip.compress(encoded, compresslevel=1, mtime=0)))

    def command(self, args, *, sql=None, timeout=60, merge_errors=False):
        # Spool subprocess output instead of buffering an unbounded pipe in RAM.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            result = subprocess.run(args, input=sql.encode() if sql else None, stdout=output, stderr=output if merge_errors else errors, timeout=timeout, creationflags=0x08000000 if os.name == "nt" else 0)
            size = output.tell() + errors.tell()
            if size > 64 * 1024 * 1024:
                raise RuntimeError("Collection batch exceeds 64 MiB; cursor was not advanced")
            if result.returncode:
                errors.seek(0)
                raise RuntimeError(errors.read(1000).decode(errors="replace") or f"exit {result.returncode}")
            output.seek(0)
            return output.read()

    def docker(self):
        project = self.config.get("project", "asa-lab-dev")
        try:
            ids = self.command(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}"]).decode().split()
            if not ids:
                raise RuntimeError("No containers for the configured installation")
            template = '{"Id":{{json .Id}},"Created":{{json .Created}},"RestartCount":{{json .RestartCount}},"State":{{json .State}},"Config":{"Labels":{{json .Config.Labels}}}}'
            inspected = [json.loads(line) for line in self.command(["docker", "inspect", "--format", template, *ids]).decode().splitlines()]
            canonical = next((c for c in inspected if c["Config"]["Labels"].get("com.docker.compose.service") == "postgres"), None)
            if not canonical:
                raise RuntimeError("Canonical PostgreSQL container is absent")
            actual = canonical["Config"]["Labels"].get("com.docker.compose.project.working_dir", "")
            if os.path.normcase(os.path.abspath(actual)) != os.path.normcase(str(self.root)):
                raise RuntimeError("Collector root differs from the canonical installation")
            self.postgres = canonical["Id"]
            self.containers = {}
            for container in inspected:
                labels = container["Config"].get("Labels") or {}
                if labels.get("com.docker.compose.project.working_dir") != actual:
                    raise RuntimeError("Mixed installation roots; collection stopped")
                service = labels.get("com.docker.compose.service", "unknown")
                cid = container["Id"]
                self.containers = getattr(self, "containers", {})
                state = container.get("State", {})
                if state.get("Running", True): self.containers[cid] = service
                observed = {k: state[k] for k in ("Status", "ExitCode", "OOMKilled", "StartedAt", "FinishedAt") if k in state}
                if isinstance(state.get("Health"), dict): observed["health"] = state["Health"].get("Status")
                if "RestartCount" in container: observed["restartCount"] = container["RestartCount"]
                state_key = "docker:state:" + cid
                if observed and observed != self.state(state_key):
                    level = "error" if observed.get("OOMKilled") or observed.get("health") == "unhealthy" or observed.get("ExitCode", 0) != 0 else "warn" if observed.get("Status") == "restarting" else "info"
                    measured = now()
                    self.add(normalize(service, json.dumps(dict(kind="container_state", module="system", level=level, service=service, **observed)), measured, cid+":"+measured+":state"))
                    self.set_state(state_key, observed)
                if service == "api":
                    if cid not in self.reader_formats:
                        try:
                            result = self.command(["docker", "exec", cid, "node", "-e", "process.stdout.write(String(require('/app/dist/admin-logs.worker.js').LOG_STORE_FORMAT || 1))"])
                            self.reader_formats[cid] = int(result.decode().strip())
                        except Exception:
                            self.reader_formats[cid] = 1
                    self.reader_format = self.reader_formats[cid]
                created = datetime.fromisoformat(container["Created"].replace("Z", "+00:00"))
                for recent in (True, False):
                    key = "docker:" + cid + (":recent" if recent else "")
                    status_source = service + (":recent" if recent else "")
                    default = datetime.now(UTC) - (timedelta(minutes=5) if recent else timedelta(days=7))
                    saved = self.state(key, default.isoformat())
                    start = max(created, datetime.fromisoformat(saved.replace("Z", "+00:00")))
                    if recent: start = max(start, datetime.now(UTC) - timedelta(minutes=5))
                    span = self.state(key + ":span", 300 if recent else 6 * 3600)
                    until = min(datetime.now(UTC) - timedelta(seconds=2), start + timedelta(seconds=span))
                    if until <= start: continue
                    try:
                        result = self.command(["docker", "logs", "--timestamps", "--since", start.isoformat(), "--until", until.isoformat(), cid], timeout=90, merge_errors=True)
                    except Exception as exc:
                        self.set_state(key + ":span", max(1, span // 2))
                        self.status(status_source, "error", str(exc))
                        continue
                    for line in result.decode(errors="replace").splitlines():
                        token, _, raw = line.partition(" ")
                        self.add(normalize(service, raw, timestamp(token, until.isoformat()), cid + ":" + line))
                    self.set_state(key, until.isoformat())
                    self.status(status_source, "ok", "Fresh events" if recent else "History starts at container creation; removed containers cannot be recovered", until.isoformat())
            self.status("docker", "ok")
        except Exception as exc:
            self.status("docker", "error", str(exc))

    def database(self):
        if time.time() - self.state("database:last", 0) < 120: return
        if not getattr(self, "postgres", None):
            self.status("database-events", "unavailable", "Canonical PostgreSQL was not identified")
            return
        tables = {"audit_events": "created_at", "administrative_audit_events": "occurred_at", "classroom_activity_events": "occurred_at", "account_external_identity_events": "occurred_at", "grade_change_events": "created_at", "checkers_reaction_events": "created_at", "chess_live_events": "created_at_ms", "max_webhook_events": "received_at", "product_analytics_events": "occurred_at"}
        failures = 0
        for table, column in tables.items():
            key = "db:" + table
            cutoff = datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))
            since = self.state(key, cutoff.isoformat())
            span = self.state(key + ":span", 6 * 3600)
            until = min(datetime.now(UTC), datetime.fromisoformat(since.replace("Z", "+00:00")) + timedelta(seconds=span)).isoformat()
            if column.endswith("_ms"):
                start_ms = int(datetime.fromisoformat(since).timestamp() * 1000)
                end_ms = int(datetime.fromisoformat(until).timestamp() * 1000)
                condition = f'"{column}" BETWEEN {start_ms} AND {end_ms}'
                recent_ms = int((datetime.now(UTC) - timedelta(minutes=30)).timestamp() * 1000)
                condition += f' OR "{column}" BETWEEN {recent_ms} AND {int(datetime.now(UTC).timestamp() * 1000)}'
            else:
                condition = f'"{column}" BETWEEN TIMESTAMPTZ \'{since}\' AND TIMESTAMPTZ \'{until}\''
                condition += f' OR "{column}" BETWEEN NOW() - INTERVAL \'30 minutes\' AND NOW()'
            sql = f'''BEGIN READ ONLY; SET LOCAL statement_timeout='15s';
                COPY (SELECT row_to_json(t)::text FROM (SELECT * FROM public."{table}" WHERE {condition} ORDER BY "{column}") t) TO STDOUT WITH CSV; ROLLBACK;'''
            try:
                data = self.command(["docker", "exec", "-i", self.postgres, "sh", "-c", 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql=sql)
                for row in csv.reader(io.StringIO(data.decode())):
                    value = json.loads(row[0])
                    stamp = datetime.fromtimestamp(value[column] / 1000, UTC).isoformat() if column.endswith("_ms") else value[column]
                    raw = json.dumps(value, ensure_ascii=False, sort_keys=True)
                    source = "auth" if table == "product_analytics_events" else "audit"
                    self.add(normalize(source, raw, timestamp(stamp, until), table + ":" + raw, table))
                self.set_state(key, until)
                self.status("database-events:" + table, "ok", "Fresh database events", until)
            except Exception as exc:
                failures += 1
                self.set_state(key + ":span", max(1, span // 2))
                self.status("database-events:" + table, "error", str(exc))
            # Historical reconciliation has its own cursor and schedule. The
            # fresh cursor is necessarily older than the 120-second throttle.
            # Never use its age to decide whether history should be revisited.
            history_key = "db:history:" + table
            if time.time() - self.state(history_key + ":completed", 0) < 6 * 3600:
                continue
            history_since = max(cutoff, datetime.fromisoformat(self.state(history_key, cutoff.isoformat()).replace("Z", "+00:00")))
            history_span = self.state(history_key + ":span", self.config.get("retentionDays", 30) * 86400)
            history_until = min(datetime.now(UTC), history_since + timedelta(seconds=history_span))
            if column.endswith("_ms"):
                historical_condition = f'"{column}" BETWEEN {int(history_since.timestamp()*1000)} AND {int(history_until.timestamp()*1000)}'
            else:
                historical_condition = f'"{column}" BETWEEN TIMESTAMPTZ \'{history_since.isoformat()}\' AND TIMESTAMPTZ \'{history_until.isoformat()}\''
            historical_sql = f'''BEGIN READ ONLY; SET LOCAL statement_timeout='15s';
                COPY (SELECT row_to_json(t)::text FROM (SELECT * FROM public."{table}" WHERE {historical_condition} ORDER BY "{column}") t) TO STDOUT WITH CSV; ROLLBACK;'''
            try:
                data = self.command(["docker", "exec", "-i", self.postgres, "sh", "-c", 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql=historical_sql)
                for row in csv.reader(io.StringIO(data.decode("utf-8"))):
                    value = json.loads(row[0])
                    stamp = datetime.fromtimestamp(value[column] / 1000, UTC).isoformat() if column.endswith("_ms") else value[column]
                    raw = json.dumps(value, ensure_ascii=False, sort_keys=True)
                    self.add(normalize("auth" if table == "product_analytics_events" else "audit", raw, timestamp(stamp, history_until.isoformat()), table + ":" + raw, table))
                complete = history_until >= datetime.now(UTC) - timedelta(seconds=30)
                self.set_state(history_key, cutoff.isoformat() if complete else history_until.isoformat())
                if complete: self.set_state(history_key + ":completed", time.time())
                self.status("database-history:" + table, "ok" if complete else "pending", "Historical reconciliation complete" if complete else "History collection is queued", history_until.isoformat())
            except Exception as exc:
                failures += 1
                self.set_state(history_key + ":span", max(1, history_span // 2))
                self.status("database-history:" + table, "error", str(exc))
        self.set_state("database:last", time.time())
        self.status("database-events", "error" if failures else "ok", f"{failures} table sources require attention" if failures else "")

    def files(self):
        configured = [{"source": "updates", "path": str(self.root / ".asa" / "logs")}, *self.config.get("fileSources", [])]
        if os.name == "nt" and self.config.get("includeDockerDesktop", True):
            configured.append({"source": "docker-desktop", "path": str(Path(os.environ.get("LOCALAPPDATA", "")) / "Docker" / "log")})
        cutoff = time.time() - self.config.get("retentionDays", 30) * 86400
        for item in configured:
            source, path = item["source"], Path(item["path"])
            try:
                if not path.exists(): raise RuntimeError("Configured log directory is absent")
                for file in sorted(path.rglob("*"), key=lambda p: (not p.name.endswith((".log", ".out")), str(p))) if path.is_dir() else [path]:
                    if not file.is_file() or not re.search(r"\.log(?:\.|$)|\.out\.", file.name, re.I): continue
                    stat = file.stat()
                    if stat.st_mtime < cutoff: continue
                    # File IDs survive rename rotation on Windows and Linux. Copies
                    # are shared only after verifying a rotation prefix. Equal
                    # adjacent lines remain distinct occurrences.
                    identity = f"{stat.st_dev}:{stat.st_ino}" if stat.st_ino else str(file.resolve())
                    key = "file:v2:" + source + ":" + identity
                    legacy = self.state("file:" + str(file.resolve()))
                    previous = self.state(key, legacy or {"offset": 0, "head": "", "generation": uuid.uuid4().hex})
                    rotation = re.fullmatch(r"(.*?)(?:\.\d{8}-[^.]+)?(\.log|\.out)(?:\.\d.*)?", file.name, re.I)
                    family = rotation[1] + rotation[2] if rotation else None
                    rotation_key = "file:rotation:" + source + ":" + str(file.parent.resolve()) + ":" + str(family)
                    with file.open("rb") as stream:
                        prefix = stream.read(min(128, stat.st_size))
                        head = hashlib.sha256(prefix).hexdigest()
                        # Compare the prior prefix length so both append and an
                        # in-place rewrite of a short file are recognized.
                        unchanged = previous["head"] == hashlib.sha256(prefix[:previous.get("headSize", 128)]).hexdigest()
                        resumed = previous["offset"] <= stat.st_size and unchanged
                        offset = previous["offset"] if resumed else 0
                        generation = previous.get("generation", uuid.uuid4().hex) if resumed else uuid.uuid4().hex
                        stream.seek(offset)
                        data = stream.read(8 * 1024 * 1024)
                    consumed = data.rfind(b"\n") + 1
                    if not consumed and data:
                        # Preserve a complete non-newline file when the writer is idle.
                        consumed = len(data) if stat.st_mtime < time.time() - 10 and len(data) < 8 * 1024 * 1024 else 0
                    if not consumed and len(data) == 8 * 1024 * 1024:
                        raise RuntimeError(f"Oversized unterminated line in {file.name}; cursor preserved")
                    at = datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()
                    copied_generation = previous.get("copiedGeneration") if resumed else None
                    copied_through = previous.get("copiedThrough", 0) if resumed else 0
                    if offset == 0 and family and file.name != family:
                        candidates = self.state(rotation_key, [])
                        if isinstance(candidates, dict): candidates = [candidates]
                        # Deduplicate only bytes proven equal to the collected
                        # active file, within a bounded 8 MiB prefix. The rest
                        # remains independent; equal text alone is never proof.
                        for active in candidates:
                            through = active.get("through", 0)
                            if through and through <= consumed and hashlib.sha256(data[:through]).hexdigest() == active.get("sha256"):
                                copied_generation, copied_through = active["generation"], through
                                break
                    transcript = previous.get("transcriptTime") if resumed else None
                    byte_offset = offset
                    for raw_line in data[:consumed].splitlines(keepends=True):
                        line = raw_line.decode("utf-8-sig", errors="replace").rstrip("\r\n")
                        event_at, basis = file_timestamp(line, at)
                        boundary = re.search(r"(?:Start time|End time|Время начала|Время окончания)\s*:\s*(\d{14})", line, re.I)
                        if boundary:
                            try:
                                parsed = datetime.strptime(boundary[1], "%Y%m%d%H%M%S").astimezone().astimezone(UTC)
                                if parsed <= datetime.now(UTC) + timedelta(minutes=5): transcript = parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
                            except ValueError: pass
                        if basis == "file_mtime" and transcript: event_at, basis = transcript, "transcript"
                        occurrence = copied_generation if byte_offset + len(raw_line) <= copied_through else generation
                        entry = normalize(source, line, event_at, occurrence + ":" + str(byte_offset), file.name)
                        entry["timeBasis"] = basis
                        self.add(entry)
                        byte_offset += len(raw_line)
                    self.set_state(key, {"offset": offset + consumed, "head": head, "headSize": min(128, stat.st_size), "generation": generation, "copiedGeneration": copied_generation, "copiedThrough": copied_through, "transcriptTime": transcript})
                    if family and file.name == family and offset + consumed > 0:
                        through = min(offset + consumed, 8*1024*1024)
                        with file.open("rb") as stream: digest = hashlib.sha256(stream.read(through)).hexdigest()
                        candidates = self.state(rotation_key, [])
                        if isinstance(candidates, dict): candidates = [candidates]
                        current = dict(through=through, sha256=digest, generation=generation)
                        self.set_state(rotation_key, [current, *(c for c in candidates if c != current)][:4])
                self.status(source, "ok")
            except Exception as exc:
                self.status(source, "error", str(exc))

    def windows(self):
        if os.name != "nt":
            self.status("windows", "unavailable", "Windows Event Log is not available on this host")
            return
        if time.time() - self.state("windows:last", 0) < 120: return
        since = (datetime.now(UTC) - timedelta(days=7)).isoformat()
        until = datetime.now(UTC).isoformat()
        script = Path(__file__).with_name("collect-windows-logs.ps1")
        try:
            cursor_file = self.private / "windows-cursors.json"
            cursor_file.write_text(json.dumps(self.state("windows:cursors", {})), encoding="utf-8")
            data = self.command(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Since", since, "-Until", until, "-CursorFile", str(cursor_file)], timeout=180)
            value = json.loads(data.decode("utf-8-sig"))
            for event in value.get("events", []):
                source = "windows:" + event["channel"]
                entry = normalize(source, event["message"], event["time"], str(event["recordId"]) + ":" + event["time"], event.get("provider", ""))
                entry["level"] = "error" if event["level"] in (1, 2) else "warn" if event["level"] == 3 else "info"
                entry["truncated"] = entry["truncated"] or event.get("truncated", False)
                entry["windowsRecordId"] = str(event["recordId"])
                if type(event.get("eventId")) is int: entry["windowsEventId"] = event["eventId"]
                self.add(entry)
            for status in value.get("sources", []): self.status("windows:" + status["channel"], status["state"], status.get("detail", ""), status.get("collectedThrough"))
            self.set_state("windows:cursors", value.get("cursors", {}))
            self.set_state("windows:last", time.time())
            self.status("windows", "ok", "Per-channel coverage and access limitations are listed separately")
        except Exception as exc:
            self.status("windows", "error", str(exc))

    def journal_batch(self, args, *, limit=500, byte_limit=2 * 1024**2):
        """Read a bounded chronological batch; advance only to consumed cursors."""
        import select
        environment = dict(os.environ, LC_ALL='C')
        with tempfile.TemporaryFile() as errors:
            child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, env=environment)
            rows, pending, size, limited = [], b'', 0, False
            deadline = time.monotonic() + 15
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0: raise TimeoutError('Journal batch exceeded 15 seconds; cursor retained')
                    readable, _, _ = select.select([child.stdout], [], [], remaining)
                    if not readable: continue
                    block = os.read(child.stdout.fileno(), min(65536, byte_limit - size + 1))
                    if not block: break
                    size += len(block); pending += block
                    if size > byte_limit:
                        limited = True; break
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        if line: rows.append(json.loads(line))
                        if len(rows) >= limit: limited = True; break
                    if limited: break
                if limited: child.terminate()
                child.wait(timeout=3)
                errors.seek(0); detail = errors.read(4096).decode(errors='replace')
                if 'not seeing messages from other users' in detail.lower() or 'insufficient permissions' in detail.lower():
                    raise PermissionError('Host system journal is not readable by the collector operator')
                if child.returncode and not limited: raise RuntimeError(detail or 'Journal query failed')
                if limited and not rows: raise RuntimeError('Journal record exceeds the bounded batch; cursor retained')
                return rows, limited
            finally:
                if child.poll() is None: child.kill(); child.wait(timeout=3)
                child.stdout.close()

    def linux(self):
        if not sys.platform.startswith('linux'):
            self.status('linux:journal', 'unavailable', 'Linux journal is not available on this host')
            return
        if time.time() - self.state('linux:journal:last', 0) < 60: return
        self.set_state('linux:journal:last', time.time())
        if not shutil.which('journalctl'):
            self.status('linux:journal', 'unavailable', 'journalctl is not installed; Docker/application sources remain separate')
            return
        cursor = self.state('linux:journal:cursor')
        start = self.state('linux:journal:through', (datetime.now(UTC) - timedelta(days=7)).isoformat())
        until = now()
        args = ['journalctl', '--no-pager', '--output=json', '--all', '--priority=warning', '--until', until]
        try:
            try:
                rows, limited = self.journal_batch(args + (['--after-cursor', cursor] if cursor else ['--since', start]))
            except RuntimeError as exc:
                if not cursor or not re.search(r'cursor|seek', str(exc), re.I): raise
                self.set_state('linux:journal:gap', True)
                rows, limited = self.journal_batch(args + ['--since', start])
            for row in rows:
                identity = row.get('__CURSOR')
                micros = row.get('__REALTIME_TIMESTAMP')
                if not isinstance(identity, str) or len(identity) > 4096 or not str(micros).isdecimal():
                    raise ValueError('Invalid journal identity; cursor retained')
                stamp = datetime.fromtimestamp(int(micros) / 1000000, UTC).isoformat()
                raw = row.get('MESSAGE', '')
                if not isinstance(raw, str): raw = '[non-text journal message]'
                unit = row.get('_SYSTEMD_UNIT', '')
                if not isinstance(unit, str) or not re.fullmatch(r'[A-Za-z0-9@_.:-]{1,200}', unit): unit = None
                kernel_oom = row.get('_TRANSPORT') == 'kernel' and bool(re.search(r'out of memory|oom.kill|killed process', raw, re.I))
                kind = 'kernel_oom' if kernel_oom else 'system_service_failure' if unit and re.search(r'failed|failure', raw, re.I) else 'system_journal'
                priority = int(row.get('PRIORITY', 4))
                payload = dict(kind=kind, module='system', level='error' if priority <= 3 else 'warn', message=raw[:16384], unit=unit)
                origin = unit or ('kernel' if row.get('_TRANSPORT') == 'kernel' else 'system')
                self.add(normalize('linux:journal', json.dumps(payload), timestamp(stamp, until), identity, origin))
                self.set_state('linux:journal:cursor', identity)
                self.set_state('linux:journal:through', stamp)
            if not limited: self.set_state('linux:journal:through', until)
            detail = 'Warning/error system journal, bounded to 500 records/2 MiB per cycle'
            if self.state('linux:journal:gap'): detail += '; journal cursor was lost/vacuumed: historical coverage has a gap'
            self.status('linux:journal', 'pending' if limited else 'ok', detail, self.state('linux:journal:through', start))
        except (PermissionError, FileNotFoundError) as exc:
            self.status('linux:journal', 'unavailable', str(exc))
        except Exception as exc:
            self.status('linux:journal', 'error', str(exc))

    def lifecycle(self):
        if not getattr(self, 'postgres', None):
            self.status('docker-lifecycle', 'unavailable', 'Canonical installation was not identified')
            return
        until = now()
        start = self.state('docker:lifecycle:through', (datetime.now(UTC) - timedelta(minutes=5)).isoformat())
        try:
            output = self.command(['docker', 'events', '--since', start, '--until', until,
                                   '--filter', 'type=container', '--filter', 'label=com.docker.compose.project=' + self.config.get('project', 'asa-lab-dev'),
                                   '--format', '{{json .}}'], timeout=15)
            rows = output.decode().splitlines()
            if len(rows) > 500: raise RuntimeError('Docker lifecycle batch exceeds 500; cursor retained')
            for line in rows:
                event = json.loads(line); actor = event.get('Actor', {}); attrs = actor.get('Attributes', {})
                if attrs.get('com.docker.compose.project') != self.config.get('project', 'asa-lab-dev'): continue
                root = attrs.get('com.docker.compose.project.working_dir', '')
                if not root or os.path.normcase(os.path.abspath(root)) != os.path.normcase(str(self.root)): continue
                action = event.get('Action', event.get('status', ''))
                if action not in ('oom', 'die', 'restart', 'start', 'stop', 'kill', 'destroy', 'health_status: unhealthy', 'health_status: healthy'): continue
                nanos = event.get('timeNano')
                if type(nanos) is not int or nanos <= 0: raise ValueError('Invalid Docker lifecycle timestamp')
                stamp = datetime.fromtimestamp(nanos / 1e9, UTC).isoformat()
                payload = dict(kind='container_lifecycle', module='system', action=action,
                               level='error' if action in ('oom', 'health_status: unhealthy') or action == 'die' and attrs.get('exitCode', '0') != '0' else 'info',
                               service=attrs.get('com.docker.compose.service', 'unknown'), exitCode=attrs.get('exitCode'))
                if action in ('die', 'destroy'):
                    cid = str(actor.get('ID', ''))
                    cursors = [self.state('docker:' + cid + suffix) for suffix in ('', ':recent')]
                    stamps = [timestamp(value, '') for value in cursors if isinstance(value, str)]
                    through = max((value for value in stamps if value), default=None)
                    event_at = timestamp(stamp, until)
                    if through is None or through < event_at:
                        payload.update(possibleUncollectedFrom=through, possibleUncollectedTo=event_at,
                                       coverage='removed_container_possible_stdout_tail_gap' if action == 'destroy' else 'stopped_container_pending_stdout_reconciliation')
                        if action == 'destroy':
                            windows = self.state('docker:lifecycle:coverage', [])
                            window = dict(container=cid[:12], **{k: payload[k] for k in ('possibleUncollectedFrom', 'possibleUncollectedTo')})
                            if window not in windows: self.set_state('docker:lifecycle:coverage', [*windows, window][-20:])
                self.add(normalize('docker-lifecycle', json.dumps(payload), timestamp(stamp, until), str(actor.get('ID')) + ':' + action + ':' + str(nanos)))
            self.set_state('docker:lifecycle:through', until)
            detail = 'Installation-scoped events; Docker retains only its last 256 events, earlier/lost daemon history is not recoverable'
            if self.state('docker:lifecycle:coverage', []): detail += '; removed containers have possible uncollected stdout-tail windows (not a proven lost count)'
            self.status('docker-lifecycle', 'ok', detail, until)
        except Exception as exc: self.status('docker-lifecycle', 'error', str(exc))

    @staticmethod
    def host_segment(meta):
        return all(s in ("docker-desktop", "metrics", "docker-lifecycle") or s.startswith(("windows:", "linux:")) for s in meta["sources"])

    @staticmethod
    def source_ranges(events, key="source"):
        result = {}
        for event in events:
            span = result.setdefault(event.get(key, ""), {"first": event["time"], "last": event["time"]})
            span["first"] = min(span["first"], event["time"])
            span["last"] = max(span["last"], event["time"])
        return result

    def write_segment(self, name, events):
        raw = ("\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in events) + "\n").encode("utf-8")
        compressed = self.reader_format >= 2
        file = name + (".gz" if compressed else "")
        data = gzip.compress(raw, compresslevel=6, mtime=0) if compressed else raw
        temp = self.store / (file + ".tmp")
        temp.write_bytes(data)
        if os.name != "nt": os.chmod(temp, 0o640)
        os.replace(temp, self.store / file)
        return dict(file=file, schema=2, sha256=hashlib.sha256(raw).hexdigest(), bytes=len(data), rawBytes=len(raw), count=len(events), first=min(e["time"] for e in events), last=max(e["time"] for e in events), sources=sorted({e["source"] for e in events}), subsystems=sorted({event_subsystem(e) for e in events}), sourceRanges=self.source_ranges(events), originRanges=self.source_ranges(events, "origin"), modules=sorted({e["module"] for e in events}), levels=sorted({e["level"] for e in events}))

    def finish_compaction(self):
        """Complete a durable compaction intent before accepting new events.

        Files named by the old catalog survive the normal reader grace period.
        Stable event IDs never change; only the private sequence is reassigned.
        Reserving the sequence and intent together prevents reuse after a crash.
        """
        intent = self.state("compaction:pending")
        if not intent: return
        events = []
        for meta in intent["originals"]:
            data = (self.store / meta["file"]).read_bytes()
            raw = gzip.decompress(data) if meta["file"].endswith(".gz") else data
            if len(raw) != meta["rawBytes"] or hashlib.sha256(raw).hexdigest() != meta["sha256"]:
                raise RuntimeError("Compaction original failed verification; originals preserved")
            events.extend(json.loads(line) for line in raw.splitlines())
        if len(events) != intent["count"] or len({e["id"] for e in events}) != len(events):
            raise RuntimeError("Compaction identities failed verification; originals preserved")
        for event in events:
            row = self.db.execute("SELECT seq,published FROM events WHERE id=?", (bytes.fromhex(event["id"]),)).fetchone()
            if not row or row[1] != 1 or not any(int(m["file"].split("-")[1]) <= row[0] <= int(m["file"].split("-")[2].split(".")[0]) for m in intent["originals"]):
                raise RuntimeError("Compaction index differs from originals; originals preserved")
        old_format = self.reader_format
        self.reader_format = 2
        try:
            meta = self.write_segment(f'seg-{intent["first"]:016d}-{intent["first"]+len(events)-1:016d}.jsonl', events)
        finally: self.reader_format = old_format
        segments = self.state("segments", {})
        retired = self.state("retired:segments", {})
        for offset, event in enumerate(events):
            self.db.execute("UPDATE events SET seq=? WHERE id=?", (intent["first"]+offset, bytes.fromhex(event["id"])))
        for original in intent["originals"]:
            segments.pop(original["file"], None)
            retired[original["file"]] = None
        segments[meta["file"]] = meta
        self.set_state("segments", segments)
        self.set_state("retired:segments", retired)
        self.db.execute("DELETE FROM state WHERE key='compaction:pending'")
        self.db.commit()

    def compact(self, segments, retired):
        if self.reader_format < 2 or len(segments) < 256: return segments, retired
        # Compact at most 32 small files per cycle, keeping host telemetry apart
        # from application events so eviction retains its source priority.
        for host in (False, True):
            selected, size = [], 0
            for meta in sorted(segments, key=lambda s: s["last"]):
                if meta.get("schema") != 2 or not meta.get("sha256") or self.host_segment(meta) != host or meta.get("rawBytes", 0) > 256*1024: continue
                if size + meta["rawBytes"] > 3*1024*1024: break
                selected.append(meta); size += meta["rawBytes"]
                if len(selected) == 32: break
            if len(selected) < 4: continue
            first = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone()[0] + 1
            count = sum(m["count"] for m in selected)
            self.set_state("segments", {m["file"]: m for m in segments})
            self.set_state("retired:segments", retired)
            self.set_state("compaction:pending", dict(originals=selected, first=first, count=count))
            self.db.execute("UPDATE sqlite_sequence SET seq=? WHERE name='events'", (first+count-1,))
            self.db.commit()
            self.finish_compaction()
            return list(self.state("segments").values()), self.state("retired:segments", {})
        return segments, retired

    def upgrade_file_event(self, entry):
        if entry.get("normalizationVersion") == 2: return entry
        file_sources = {"updates", "docker-desktop", *(s["source"] for s in self.config.get("fileSources", []))}
        if entry["source"] in file_sources:
            entry["time"], entry["timeBasis"] = file_timestamp(entry["message"], entry["time"])
        if not entry["source"].startswith("windows:") and not entry.get("truncated"):
            try: payload = json.loads(entry["message"])
            except ValueError: payload = None
            entry["level"] = "error" if isinstance(payload, dict) and payload.get("kind") == "client_diagnostic" else log_level(payload, entry["message"])
        entry["normalizationVersion"] = 2
        return entry

    def import_history(self, path: Path):
        """Operator-only recovery from an existing, normalized ASA diagnostic ZIP."""
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""): digest.update(block)
        receipt = "history-import:" + digest.hexdigest()
        if self.state(receipt): return self.state(receipt)
        count = 0
        with zipfile.ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > 64 * 1024 ** 3: raise RuntimeError("Diagnostic archive exceeds import limit")
            if archive.getinfo("manifest.json").file_size > 16 * 1024 ** 2: raise RuntimeError("Diagnostic archive manifest is too large")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("normalized") is not True: raise RuntimeError("Only normalized ASA diagnostic archives can be imported")
            self.db.execute("SAVEPOINT history_import")
            try:
                for info in archive.infolist():
                    if not re.fullmatch(r"records/part-\d{5}\.jsonl", info.filename): continue
                    with archive.open(info) as stream:
                        while True:
                            line = stream.readline(256 * 1024 + 1)
                            if not line: break
                            if len(line) > 256 * 1024: raise RuntimeError("Diagnostic archive record is too large")
                            entry = json.loads(line)
                            if (not isinstance(entry, dict) or not re.fullmatch(r"[a-f0-9]{64}", str(entry.get("id", ""))) or
                                entry.get("module") not in ("system", "portal", "scratch", "electronics", "auth") or entry.get("level") not in ("info", "warn", "error") or
                                not isinstance(entry.get("source"), str) or not 1 <= len(entry["source"]) <= 200 or
                                not isinstance(entry.get("message"), str) or len(entry["message"]) > 16384 or not timestamp(entry.get("time"), "")):
                                raise RuntimeError("Diagnostic archive contains an invalid record")
                            entry = {k: v for k, v in entry.items() if k in ("id", "time", "source", "module", "level", "message", "requestId", "revision", "origin", "truncated", "timeBasis", "windowsRecordId", "windowsEventId", "normalizationVersion")}
                            entry["time"] = timestamp(entry["time"], "")
                            entry["message"] = clean(entry["message"])
                            entry["origin"] = clean(str(entry.get("origin", "")))[:500]
                            entry["requestId"] = entry.get("requestId") if isinstance(entry.get("requestId"), str) and re.fullmatch(r"[a-fA-F0-9-]{36}", entry["requestId"]) else None
                            entry["revision"] = entry.get("revision") if isinstance(entry.get("revision"), str) and re.fullmatch(r"[a-f0-9]{7,64}", entry["revision"]) else None
                            entry["truncated"] = entry.get("truncated") is True
                            if entry.get("timeBasis") not in ("event", "file_mtime", "transcript"): entry.pop("timeBasis", None)
                            if re.fullmatch(r"\d{1,20}", str(entry.get("windowsRecordId", ""))): entry["windowsRecordId"] = str(entry["windowsRecordId"])
                            else: entry.pop("windowsRecordId", None)
                            if type(entry.get("windowsEventId")) is not int or not 0 <= entry["windowsEventId"] <= 65535: entry.pop("windowsEventId", None)
                            if type(entry.get("normalizationVersion")) is not int or entry["normalizationVersion"] != 2: entry.pop("normalizationVersion", None)
                            self.add(self.upgrade_file_event(entry))
                            count += 1
                if count != manifest.get("count"): raise RuntimeError("Diagnostic archive count does not match its manifest")
                result = dict(count=count, importedAt=now(), archive=path.name)
                self.set_state(receipt, result)
                self.db.execute("RELEASE history_import"); self.db.commit()
            except Exception:
                self.db.execute("ROLLBACK TO history_import"); self.db.execute("RELEASE history_import")
                raise
        self.status("history-import", "ok", f"Восстановлена история из сохранённого архива: {count} записей")
        return result

    def publish(self):
        self.finish_compaction()
        self.db.commit()
        retired = self.state("retired:segments", {})
        catalog_path = self.store / "catalog.json"
        # A previous crash may have committed retirement before replacing the
        # catalog. Never remove a file still named by the published snapshot.
        protected = {s["file"] for s in json.loads(catalog_path.read_text(encoding="utf-8"))["segments"]} if catalog_path.exists() else set()
        for name, at in list(retired.items()):
            if name in protected:
                # A committed retirement is not proof that catalog replacement
                # completed. Start the grace clock only after exclusion is observed.
                retired[name] = None
            elif at is None:
                retired[name] = time.time()
            elif SEGMENT_PATTERN.fullmatch(name) and time.time() - at >= RETIRE_SECONDS:
                (self.store / name).unlink(missing_ok=True)
                retired.pop(name)
        previous = self.state("segments", {})
        while True:
            fetched = self.db.execute("SELECT seq,payload FROM events WHERE published=0 ORDER BY seq LIMIT 1000").fetchall()
            rows, events, byte_count = [], [], 0
            for row in fetched:
                text = unpack_payload(row[1])
                event = json.loads(text)
                size = len(text.encode("utf-8")) + 1
                # Keep application logs separate from verbose host telemetry so
                # physical-budget eviction cannot discard both in one segment.
                if rows and (byte_count + size > 1024 * 1024 or self.host_segment({"sources": [events[0]["source"]]}) != self.host_segment({"sources": [event["source"]]})): break
                rows.append(row); events.append(event); byte_count += size
            if not rows: break
            name = f"seg-{rows[0][0]:016d}-{rows[-1][0]:016d}.jsonl"
            written = self.write_segment(name, events)
            previous[written["file"]] = written
            self.db.executemany("UPDATE events SET published=1,payload=NULL,time=NULL,source=NULL WHERE seq=?", [(r[0],) for r in rows])
            self.db.commit()
        cutoff = (datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        segments = []
        files = {p.name: p for p in self.store.glob("seg-*.jsonl*") if SEGMENT_PATTERN.fullmatch(p.name) and p.name not in retired}
        for name, file in sorted(files.items()):
            if not name.endswith(".gz") and name + ".gz" in files:
                retired.setdefault(name, None)
                continue
            meta = previous.get(name)
            if self.reader_format >= 2 and not name.endswith(".gz"):
                events = [self.upgrade_file_event(json.loads(line)) for line in file.read_text(encoding="utf-8").splitlines()]
                meta = self.write_segment(name, events)
                retired.setdefault(name, None)
            elif not meta or "sourceRanges" not in meta or (not meta.get("originRanges") and any(s in ("audit", "auth") for s in meta["sources"])):
                raw = file.read_bytes()
                if name.endswith(".gz"): raw = gzip.decompress(raw)
                events = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
                meta = dict(file=name, bytes=file.stat().st_size, rawBytes=len(raw), count=len(events), first=min(e["time"] for e in events), last=max(e["time"] for e in events), sources=sorted({e["source"] for e in events}), sourceRanges=self.source_ranges(events), originRanges=self.source_ranges(events, "origin"), modules=sorted({e["module"] for e in events}), levels=sorted({e["level"] for e in events}))
                if all(e.get("normalizationVersion") == 2 for e in events):
                    meta.update(schema=2, sha256=hashlib.sha256(raw).hexdigest())
            segments.append(meta)
        # A crash after immutable file publication, before SQLite commit, can
        # leave an older prefix of a subsequently replayed batch. Keep the
        # superset only after verifying that all of the prefix IDs are present.
        canonical = []
        def bounds(meta): return tuple(map(int, meta["file"].split(".")[0].split("-")[1:]))
        def identities(meta):
            content = (self.store / meta["file"]).read_bytes()
            if meta["file"].endswith(".gz"): content = gzip.decompress(content)
            return {json.loads(line)["id"] for line in content.decode("utf-8").splitlines()}
        for segment in sorted(segments, key=lambda s: (bounds(s)[0], -bounds(s)[1])):
            if canonical and bounds(segment)[0] <= bounds(canonical[-1])[1]:
                if bounds(segment)[1] > bounds(canonical[-1])[1] or not identities(segment).issubset(identities(canonical[-1])):
                    raise RuntimeError("Overlapping diagnostic segments; originals were preserved")
                retired.setdefault(segment["file"], None)
            else: canonical.append(segment)
        canonical, retired = self.compact(canonical, retired)
        segments = []
        for meta in canonical:
            if meta["last"] < cutoff:
                retired.setdefault(meta["file"], None)
                self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", bounds(meta))
            else: segments.append(meta)
        total = sum(s["bytes"] for s in segments)
        limit = self.config.get("maxBytes", 1024 * 1024 * 1024)
        trimmed = False
        evicted = self.state("evicted:sources", {})
        def evict():
            nonlocal total, trimmed
            oldest = min(segments, key=lambda s: (0 if self.host_segment(s) else 1, s["last"]))
            retired.setdefault(oldest["file"], None)
            segments.remove(oldest); total -= oldest["bytes"]
            first, last = map(int, oldest["file"].split(".")[0].split("-")[1:])
            self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", (first, last))
            for source in oldest["sources"]: evicted[source] = True
            trimmed = True
        while total > max(1024 * 1024, limit * 3 // 4) and segments: evict()
        self.db.commit()
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if trimmed or self.state("vacuum:day") != datetime.now(UTC).date().isoformat():
            self.db.execute("VACUUM")
            self.set_state("vacuum:day", datetime.now(UTC).date().isoformat()); self.db.commit()
        def active_bytes():
            # Retired immutable files protect in-flight 120-second readers;
            # their temporary 180-second overlap is reported separately.
            return sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file() and p.name not in retired)
        while active_bytes() > limit and segments:
            target = total * 0.9
            while segments and total > target: evict()
            self.db.commit(); self.db.execute("VACUUM"); self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        sources = [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM sources ORDER BY name")]
        for source in sources:
            event_source = source["source"].removesuffix(":recent")
            origin = event_source.split(":", 1)[1] if event_source.startswith(("database-events:", "database-history:")) else None
            ranges = [s.get("originRanges", {}).get(origin) if origin else s["sourceRanges"].get(event_source) for s in segments]
            ranges = [r for r in ranges if r]
            source["retainedFrom"] = min((r["first"] for r in ranges), default=None)
            source["retainedTo"] = max((r["last"] for r in ranges), default=None)
            source["trimmed"] = bool(evicted.get("auth" if origin == "product_analytics_events" else "audit" if origin else event_source))
        self.set_state("segments", {s["file"]: s for s in segments})
        self.set_state("retired:segments", retired)
        self.set_state("evicted:sources", evicted)
        if trimmed: self.set_state("trimmedAt", now())
        self.db.commit(); self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        storage_bytes = sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file())
        catalog = dict(version=1, readerFormat=self.reader_format, collectedAt=now(), retentionDays=self.config.get("retentionDays", 30), maxBytes=limit, bytes=total, rawBytes=sum(s.get("rawBytes", s["bytes"]) for s in segments), storageBytes=storage_bytes, activeStorageBytes=active_bytes(), retiredBytes=storage_bytes-active_bytes(), trimmed=bool(self.state("trimmedAt")), sources=sources, segments=segments)
        temp = self.store / "catalog.tmp"
        temp.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
        if os.name != "nt": os.chmod(temp, 0o640)
        os.replace(temp, self.store / "catalog.json")

    def cycle(self):
        self.finish_compaction()
        self.docker()
        self.files()
        self.database()
        self.windows()
        self.linux()
        self.lifecycle()
        self.telemetry()
        self.publish()

    def telemetry(self):
        if time.time() - self.state("metrics:last", 0) < 60: return
        measured = now()
        metrics = dict(kind="runtime_metrics", module="system", sampledAt=measured, host=dict(diskFreeBytes=shutil.disk_usage(self.root).free))
        try:
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes
                class Memory(ctypes.Structure):
                    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD), *[(n, ctypes.c_ulonglong) for n in ("total", "available", "pageTotal", "pageAvailable", "virtualTotal", "virtualAvailable", "extended")]]
                memory = Memory(); memory.length = ctypes.sizeof(memory)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
                    metrics["host"].update(memoryTotalBytes=memory.total, memoryAvailableBytes=memory.available,
                        commitLimitBytes=memory.pageTotal, commitAvailableBytes=memory.pageAvailable)
                idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
                if ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                    value = lambda v: v.dwHighDateTime*2**32+v.dwLowDateTime
                    counters = [value(idle), value(kernel)+value(user)]
                    previous = self.state("metrics:cpu")
                    if previous and counters[1] > previous[1]: metrics["host"]["cpuPercent"] = round(100*(1-(counters[0]-previous[0])/(counters[1]-previous[1])), 2)
                    self.set_state("metrics:cpu", counters)
            elif sys.platform.startswith('linux'):
                try:
                    sample, counters = linux_resources(previous=self.state('metrics:cpu-linux'))
                    metrics['host'].update(sample); self.set_state('metrics:cpu-linux', counters)
                except Exception:
                    metrics.setdefault('failedComponents', []).append('host')
                metrics["host"]["loadAverage"] = list(os.getloadavg())
            else:
                metrics.setdefault('failedComponents', []).append('host')
            warnings = resource_warnings(metrics['host'])
            if warnings: metrics.update(resourceWarnings=warnings, level='warn')
            ids = list(getattr(self, "containers", {}))
            if ids:
                try:
                    output = self.command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids], timeout=15)
                    metrics["containers"] = [{k: v for k, v in json.loads(line).items() if k in ("Name", "CPUPerc", "MemUsage", "MemPerc", "PIDs")} for line in output.decode("utf-8").splitlines()]
                except Exception:
                    metrics.setdefault("failedComponents", []).append("containers")
            if getattr(self, "postgres", None):
                sql = '''BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; COPY (SELECT json_build_object('connections',(SELECT numbackends FROM pg_stat_database WHERE datname=current_database()),'waits',(SELECT json_agg(t) FROM (SELECT state,wait_event_type,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type) t))) TO STDOUT WITH CSV; ROLLBACK;'''
                output = self.command(["docker", "exec", "-i", self.postgres, "sh", "-c", 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql=sql, timeout=10)
                rows = list(csv.reader(io.StringIO(output.decode("utf-8"))))
                if len(rows) != 1 or len(rows[0]) != 1: raise ValueError("Invalid database metric envelope")
                sample = json.loads(rows[0][0])
                if not isinstance(sample, dict) or type(sample.get("connections")) is not int or not isinstance(sample.get("waits"), (list, type(None))): raise ValueError("Invalid database metric sample")
                metrics["database"] = sample
            if metrics.get("failedComponents"): raise RuntimeError("Some resource metrics are unavailable; available samples retained")
            self.add(normalize("metrics", json.dumps(metrics), measured, measured))
            self.status("metrics", "ok", "Runtime resource sample", measured)
        except Exception as exc:
            metrics["incomplete"] = True
            metrics["level"] = "error"
            self.add(normalize("metrics", json.dumps(metrics), measured, measured))
            self.status("metrics", "error", str(exc))
        self.set_state("metrics:last", time.time())


def write_collector_health(root, state, last_success=None, detail="", duration=None, sources=None):
    safe_store_paths(root)
    store = root / ".asa" / "diagnostics" / "store"
    store.mkdir(parents=True, exist_ok=True)
    target = store / "collector-health.json"
    if last_success is None and target.exists():
        try: last_success = json.loads(target.read_text(encoding="utf-8")).get("lastSuccessAt")
        except (OSError, ValueError): pass
    value = dict(version=1, state=state, checkedAt=now(), lastSuccessAt=last_success, detail=clean(str(detail))[:500], durationMs=duration)
    if sources is not None:
        applicable = [s for s in sources if s.get('applicable', True)]
        value['excludedNotApplicable'] = len(sources) - len(applicable)
        value['sourceStates'] = {state: sum(s.get('state') == state for s in applicable) for state in ('ok', 'pending', 'unavailable', 'error')}
        value['coverageComplete'] = bool(applicable) and not any(s.get('state') != 'ok' or s.get('possibleCoverageGap') for s in applicable)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    if os.name != "nt": os.chmod(temporary, 0o640)
    os.replace(temporary, target)


def process_identity(root, project):
    from deployment.collector import digest
    revision = None
    try:
        revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, timeout=5,
                                  creationflags=0x08000000 if os.name == 'nt' else 0).stdout.strip()
    except (OSError, subprocess.SubprocessError): pass
    if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision): revision = None
    return dict(version=1, root=str(root.resolve()), project=project, pid=os.getpid(), nonce=uuid.uuid4().hex,
                startedAt=now(), revision=revision, scriptDigest=digest(root))


def write_process_health(root, identity):
    safe_store_paths(root)
    target = root / '.asa/diagnostics/store/collector-process.json'
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps({**identity, 'checkedAt': now()}), encoding='utf-8')
    if os.name != 'nt': os.chmod(temp, 0o640)
    os.replace(temp, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--import-history", type=Path, help="Recover retained history from an existing normalized ASA log ZIP")
    args = parser.parse_args()
    args.root = args.root.resolve()
    try:
        config_path = args.root / ".asa" / "log-collector.json"
        config = json.loads(config_path.read_text(encoding="utf-8-sig")) if config_path.exists() else {}
        installation = json.loads((args.root / ".asa" / "installation.json").read_text(encoding="utf-8-sig"))
        config.setdefault("project", installation["project"])
        if config['project'] != installation['project']: raise ValueError('Collector project differs from installation metadata')
        from deployment.collector import validate_config, safe_paths
        from types import SimpleNamespace
        if not isinstance(installation.get('project'), str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', installation['project']):
            raise ValueError('Invalid installation project')
        # The running collector needs public installation identity, not .env
        # credentials. Canonical Docker labels are checked on every cycle.
        install = SimpleNamespace(root=args.root, state=args.root / '.asa', project=installation['project'])
        safe_paths(install)
        validate_config(install)
        for key, lower, upper in (("retentionDays", 1, 365), ("maxBytes", 16 * 1024 * 1024, 10 * 1024 * 1024 * 1024), ("intervalSeconds", 10, 300)):
            if key in config and (type(config[key]) is not int or not lower <= config[key] <= upper):
                raise ValueError(f"Invalid collector setting: {key}")
    except Exception as exc:
        try: write_collector_health(args.root, "error", detail=exc)
        except (OSError, ValueError): pass
        raise
    script_version = Path(__file__).stat().st_mtime_ns
    # Only one collector may publish the installation's catalog at a time.
    private = args.root / ".asa" / "diagnostics" / "private"
    private.mkdir(parents=True, exist_ok=True)
    lock = private / "collector.lock"
    stream = lock.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            stream.seek(0); stream.write(b"0"); stream.flush(); stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit("Another log collector is already running")
    (args.root / '.asa/diagnostics/store').mkdir(parents=True, exist_ok=True)
    identity = process_identity(args.root, config['project'])
    write_process_health(args.root, identity)
    stop_heartbeat = threading.Event()
    def heartbeat():
        while not stop_heartbeat.wait(20):
            try: write_process_health(args.root, identity)
            except OSError: pass  # A failed write becomes observably stale.
    threading.Thread(target=heartbeat, name='asa-collector-heartbeat', daemon=True).start()
    try:
        collector = Collector(args.root, config)
    except Exception as exc:
        stop_heartbeat.set()
        write_collector_health(args.root, "error", detail=exc)
        raise
    if args.import_history:
        try: collector.import_history(args.import_history)
        except Exception as exc:
            write_collector_health(args.root, "error", detail=exc)
            raise
    while True:
        cycle_start = time.monotonic()
        try:
            collector.cycle()
            sources = [json.loads(row[0]) for row in collector.db.execute('SELECT payload FROM sources')]
            write_collector_health(args.root, "ok", now(), duration=round((time.monotonic()-cycle_start)*1000), sources=sources)
        except Exception as exc:
            collector.db.rollback()
            write_collector_health(args.root, "error", detail=exc)
            if sys.stderr: print(clean(f"Collector cycle failed: {exc}"), file=sys.stderr, flush=True)
            if args.once: raise
        if args.once: break
        if Path(__file__).stat().st_mtime_ns != script_version: break
        time.sleep(max(10, config.get("intervalSeconds", 20)))
    stop_heartbeat.set()
    collector.db.close()
    stream.close()


if __name__ == "__main__":
    main()
