"""Durable ASA diagnostic collector. Standard library only; never changes app data."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import hmac
import io
import json
import bisect
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
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from deployment.paths import atomic_bytes
from resource_sampling import ResourceSampler
from memory_sampling import CAPTURE_SECONDS, capture_memory

UTC = timezone.utc
SEGMENT_PATTERN = re.compile(r"seg-\d{16}-\d{16}\.jsonl(?:\.gz)?$")
RETIRE_SECONDS = 600  # Longer than five-minute resumable searches and exports.
HISTORY_AUDIT_SEGMENTS = 2048
HISTORY_AUDIT_BYTES = 128 * 1024 * 1024
HISTORY_AUDIT_SECONDS = 5
SENSITIVE = re.compile(r"password|passwd|secret|cookie|authorization|credential|student.?code|token|api.?key|jwt|signing.?key", re.I)
DATABASE_DIAGNOSTICS = json.loads((Path(__file__).resolve().parent.parent /
    'apps/api/src/database-diagnostic-contract.json').read_text(encoding='utf-8'))
# Actual primary keys of the nine supported tables. Never infer a key from the
# public diagnostic projection (two different rows can have identical messages).
DATABASE_NATIVE_KEYS = {table: ('event_hash',) if table == 'max_webhook_events' else ('id',)
                        for table in DATABASE_DIAGNOSTICS['sources']}
DATABASE_IDENTITY_LIMIT = 256
DATABASE_BATCH_ROWS = 128
DATABASE_BATCH_BYTES = 4 * 1024 * 1024
DATABASE_METRICS_SQL = """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
COPY (SELECT json_build_object(
 'connections',(SELECT numbackends FROM pg_stat_database WHERE datname=current_database()),
 'waits',(SELECT json_agg(t) FROM (SELECT state,wait_event_type,wait_event,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type,wait_event) t),
 'blockedSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0),
 'longestActiveMs',(SELECT COALESCE(max(GREATEST(0,EXTRACT(epoch FROM clock_timestamp()-query_start)*1000)),0)::bigint FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND pid<>pg_backend_pid()),
 'longestTransactionMs',(SELECT COALESCE(max(GREATEST(0,EXTRACT(epoch FROM clock_timestamp()-xact_start)*1000)),0)::bigint FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),
 'deadlocksTotal',(SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()),
 'tempBytesTotal',(SELECT temp_bytes FROM pg_stat_database WHERE datname=current_database())
 ,'statsResetAt',(SELECT stats_reset FROM pg_stat_database WHERE datname=current_database())
)) TO STDOUT WITH CSV; ROLLBACK;"""


def database_diagnostics(origin, value):
    """Project known DB rows before classification or persistence; fail closed."""
    fields = DATABASE_DIAGNOSTICS['sources'][origin]['fields']
    if not isinstance(value, dict): return {}
    if origin == 'product_analytics_events' and 'ip_address' in value and 'address_provenance' in value:
        value = {**value, 'address_provenance': 'server_resolved' if value['ip_address'] is not None else 'server_unresolved'}
    result = {}
    for key, rule in fields.items():
        item = value.get(key)
        valid = False
        if rule['type'] == 'enum':
            valid = isinstance(item, str) and item in rule['values']
        elif rule['type'] == 'integer':
            valid = type(item) is int and rule['minimum'] <= item <= rule['maximum']
        elif rule['type'] == 'timestamp' and isinstance(item, str):
            stamp = DATABASE_DIAGNOSTICS['timestamp']
            if re.fullmatch(stamp['pattern'], item):
                try:
                    parsed = datetime.fromisoformat(item.replace('Z', '+00:00'))
                    valid = stamp['minYear'] <= parsed.year <= stamp['maxYear']
                except ValueError: pass
        if valid: result[key] = item
    return result


def history_error(reason):
    return RuntimeError(f"Diagnostic history/index inconsistency: {reason}; private payloads were preserved; restore a consistent diagnostic snapshot")


def immutable_segment_bytes(path, data):
    """Link a complete, flushed file into its final name without replacement."""
    from deployment.paths import plain_paths
    plain_paths(path.parent, ())
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            if os.name != 'nt': os.fchmod(stream.fileno(), 0o640)
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            # The winner is complete because publication itself is atomic.
            # Never open the destination for writing, even after a precheck.
            if path.read_bytes() != data:
                raise history_error(f'immutable segment collision at {path.name}')
    finally:
        temporary.unlink(missing_ok=True)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_store_paths(root):
    from deployment.paths import plain_paths
    plain_paths(root, ('.asa/diagnostics/store', '.asa/diagnostics/private'))


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


def host_source(source: str) -> bool:
    return source.startswith(("windows:", "linux:")) or source in ("docker-desktop", "docker-lifecycle", "metrics")


EDITOR_MODULES = ('scratch', 'electronics', 'three-d', 'chess', 'checkers')
LOG_MODULES = ('system', 'portal', 'auth', *EDITOR_MODULES)


def editor_module(value):
    return 'scratch' if value == 'blocks' else value if value in EDITOR_MODULES else None


def subsystem(source: str, payload=None, origin="") -> str:
    if host_source(source): return "metrics" if source == "metrics" else "host"
    if editor_module(source): return editor_module(source)
    if source == 'api' and isinstance(payload, dict) and payload.get('kind') == 'client_diagnostic' and (not payload.get('path') or str(payload['path']).startswith('/api/diagnostics/')):
        module = payload.get('module')
        if editor_module(module): return editor_module(module)
        if module in ('portal', 'auth'): return {'portal': 'web', 'auth': 'access'}[module]
    if source == 'web' and isinstance(payload, dict) and str(payload.get('path', '')).startswith('/internal/blocks/'): return 'scratch'
    if source == "api":
        route = str(payload.get("path", "")).split("?")[0].split("/") if isinstance(payload, dict) else []
        route = route[2] if len(route) > 2 else ""
        for pattern, name in ((r"^(auth|class-join|account|identity|max|student)", "access"), (r"^classroom", "classrooms"), (r"^(blocks|scratch)", "scratch"), (r"^(files|uploads|storage)", "storage"), (r"^admin", "administration")):
            if re.search(pattern, route): return name
        if route == 'assignments': return 'learning'
        if route in ('session', 'workspaces', 'capabilities', 'schools'): return 'access'
        return route if route in ("projects", "learning", "courses", "analytics", "diagnostics", "electronics", "chess", "checkers", "three-d") else "api"
    if source in ("postgres", "migration"): return "database"
    if source.startswith("minio"): return "storage"
    if source == "tunnel": return "network"
    if origin in ("product_analytics_events", "classroom_activity_events", "grade_change_events"):
        return {"product_analytics_events": "analytics", "classroom_activity_events": "classrooms", "grade_change_events": "learning"}[origin]
    if source == "auth": return "access"
    return source if source in ("web", "scratch", "electronics", "chess", "checkers", "three-d", "audit", "updates", "backup", "metrics") else "audit"


def classification_payload(event):
    if event['source'] not in ('api', 'web'): return {}
    try: payload = json.loads(event['message'])
    except (ValueError, TypeError): return {}
    return payload if isinstance(payload, dict) else {}


def event_subsystem(event):
    source = event['source']
    if host_source(source) or editor_module(source): return subsystem(source)
    if source in ('api', 'web'):
        payload = classification_payload(event)
        if event.get('truncated') and not payload and event.get('subsystem') not in (None, 'host'):
            return event['subsystem']
        return subsystem(source, payload, event.get('origin', ''))
    return event.get('subsystem') or subsystem(source, origin=event.get('origin', ''))


def classify_event(event):
    source = event['source']
    group = event_subsystem(event)
    if host_source(source): module = 'system'
    elif editor_module(source): module = editor_module(source)
    elif source in ('api', 'web'):
        payload = classification_payload(event)
        module = editor_module(group) or editor_module(payload.get('module')) or editor_module(event.get('module'))
        if not module:
            reported = payload.get('module')
            module = reported if reported in ('auth', 'portal', 'system') else event.get('module', 'portal' if source == 'api' else 'system')
    else: module = event.get('module', 'system')
    return {**event, 'subsystem': group, 'module': module}


def normalize(source: str, raw: str, at: str, identity: str, origin: str = "") -> dict:
    payload = None
    try:
        payload = json.loads(raw)
    except ValueError:
        pass
    database_rule = DATABASE_DIAGNOSTICS['sources'].get(origin) if source in ('audit', 'auth') else None
    if database_rule is not None:
        payload = database_diagnostics(origin, payload)
        severity = database_rule.get('severity', {})
        outcome = payload.get(severity.get('field'))
        level = 'error' if outcome in severity.get('error', ()) else 'warn' if outcome in severity.get('warn', ()) else 'info'
    else:
        level = log_level(payload, raw)
    module = "scratch" if source == "scratch" else "auth" if source == "auth" else "system"
    request_id = revision = None
    if isinstance(payload, dict):
        route = str(payload.get("path", "")) if source in ("api", "web") else ""
        module = "electronics" if "electronics" in route else "scratch" if "blocks" in route or "scratch" in route else "auth" if "/auth/" in route or "class-join" in route else "portal" if source == "api" else module
        if source in ("api", "web") and payload.get("module") in LOG_MODULES:
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
    event = classify_event(dict(id=hashlib.sha256((source + "\0" + identity).encode()).hexdigest(), time=at, source=source, subsystem=subsystem(source, payload, origin), module="system" if host_source(source) else module, level=level, message=message, requestId=request_id, revision=revision, origin=clean(origin), truncated=truncated, normalizationVersion=2))
    event['message'] = message[:16384]
    return event


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
        safe_store_paths(root)
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
        index = self.private / "index.sqlite"
        if not index.exists() and (any(SEGMENT_PATTERN.fullmatch(p.name) for p in self.store.glob('seg-*.jsonl*')) or
                                   ((self.store/'catalog.json').exists() and json.loads((self.store/'catalog.json').read_text(encoding='utf-8')).get('segments'))):
            raise history_error('private index is missing beside retained history')
        self.db = sqlite3.connect(index, timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,time TEXT,source TEXT,payload TEXT,published INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS sources(name TEXT PRIMARY KEY,payload TEXT);
            CREATE TABLE IF NOT EXISTS segment_verification(name TEXT PRIMARY KEY,proof TEXT NOT NULL,metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history_mapping_changes(seq INTEGER PRIMARY KEY);
            CREATE TRIGGER IF NOT EXISTS history_mapping_update AFTER UPDATE OF seq,id ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(old.seq);
                INSERT OR IGNORE INTO history_mapping_changes VALUES(new.seq);
            END;
            CREATE TRIGGER IF NOT EXISTS history_mapping_delete AFTER DELETE ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(old.seq);
            END;
            CREATE TRIGGER IF NOT EXISTS history_mapping_insert AFTER INSERT ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(new.seq);
            END;""")
        # A cache receipt is not authority by itself. Bind the exact compressed
        # bytes AND current private sequence/identity mapping to this store's
        # private key. Copied/edited cache rows require full verification again.
        key = self.private / 'segment-verification.key'
        from deployment.paths import plain_paths
        plain_paths(self.root, (str(key.relative_to(self.root)),))
        # The installation collector lock is already held by main(). Atomic
        # replacement prevents a crash leaving a zero/partial-length key.
        if not key.exists(): atomic_bytes(key, os.urandom(32), mode=0o600)
        self.verification_key = key.read_bytes()
        if len(self.verification_key) != 32:
            self.db.close()
            raise history_error('invalid private segment verification key')
        # Published JSONL is the durable payload. Keep only a binary digest and
        # sequence in its duplicate index, rather than a second copy of every log.
        try:
            self.validate_history_index()
            self.upgrade_index()
            self.finish_compaction()
            # Table replacement during legacy upgrade drops its triggers.
            self.db.executescript('''CREATE TRIGGER IF NOT EXISTS history_mapping_update AFTER UPDATE OF seq,id ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(old.seq);
                INSERT OR IGNORE INTO history_mapping_changes VALUES(new.seq); END;
                CREATE TRIGGER IF NOT EXISTS history_mapping_delete AFTER DELETE ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(old.seq); END;
                CREATE TRIGGER IF NOT EXISTS history_mapping_insert AFTER INSERT ON events BEGIN
                INSERT OR IGNORE INTO history_mapping_changes VALUES(new.seq); END;''')
            info = index.stat()
            self.index_identity = (info.st_dev, info.st_ino)
            self.index_schema = self.db.execute('PRAGMA schema_version').fetchone()[0]
            self.index_data_version = self.db.execute('PRAGMA data_version').fetchone()[0]
            self.db.executescript('''CREATE TABLE IF NOT EXISTS database_observations(
                event_id BLOB PRIMARY KEY, native_key BLOB NOT NULL, fields TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS database_native_key ON database_observations(native_key);''')
            self.index_schema = self.db.execute('PRAGMA schema_version').fetchone()[0]
        except Exception:
            self.db.close()
            raise

    def validate_history_index(self, *, continuous=False):
        """Verify history ownership before upgrade, retirement or publication.

        Sequence gaps from duplicate inserts are valid. Retired originals can
        have missing/remapped rows; only durable retirement or compaction intent
        permits that exception, never an unrecognized orphan filename.
        """
        audit = {}
        try:
            if continuous:
                info = (self.private/'index.sqlite').stat()
                if (info.st_dev, info.st_ino) != self.index_identity or self.db.execute('PRAGMA schema_version').fetchone()[0] != self.index_schema:
                    raise ValueError('private index identity or schema changed during collection')
                version = self.db.execute('PRAGMA data_version').fetchone()[0]
                if version != self.index_data_version:
                    self.validate_history_index()
                    self.index_data_version = version
            trusted = getattr(self, 'verified_metadata', {}) if continuous else {}
            self.verified_metadata = dict(trusted)
            started = time.monotonic()
            files = {p.name: p for p in self.store.glob('seg-*.jsonl*') if SEGMENT_PATTERN.fullmatch(p.name)}
            retired = self.state('retired:segments', {})
            pending = self.state('compaction:pending')
            catalog = self.store/'catalog.json'
            metadata = {s['file']: s for s in json.loads(catalog.read_text(encoding='utf-8'))['segments']} if catalog.exists() else {}
            referenced = set(metadata)
            metadata.update(self.state('segments', {}))
            referenced.update(name for name in self.state('segments', {}) if name not in retired)
            if not referenced.issubset(files): raise ValueError('a referenced immutable segment is missing')
            active = sorted(set(files) - set(retired))
            audit = self.state('history:audit', {})
            if continuous and audit.get('state') == 'error': raise ValueError('retained history audit previously failed')
            if continuous and (not audit or audit.get('state') == 'complete' or audit.get('completedAt')):
                audit = dict(generation=uuid.uuid4().hex, cursor='', boundary=max(active, default=''),
                    checked=0, total=len(active), startedAt=now(), deadline=time.time()+900,
                    lastCompletedAt=audit.get('lastCompletedAt'), lastMissedDeadlineAt=audit.get('lastMissedDeadlineAt'),
                    incomplete=audit.get('incomplete', False), state='running')
            changed = [row[0] for row in self.db.execute('SELECT seq FROM history_mapping_changes ORDER BY seq')] if continuous else []
            audited_bytes = audited_count = 0
            sequence = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone()
            high = sequence[0] if sequence else 0
            required = self.db.execute('SELECT coalesce(max(seq),0) FROM events').fetchone()[0]
            if files: required = max(required, max(int(name.split('-')[2].split('.')[0]) for name in files))
            pending_name = None
            if pending:
                required = max(required, pending['first']+pending['count']-1)
                pending_name = f"seg-{pending['first']:016d}-{pending['first']+pending['count']-1:016d}.jsonl.gz"
            if type(high) is not int or high < required: raise ValueError('private event sequence is behind retained history or indexed events')
            for identity,payload in self.db.execute('SELECT id,payload FROM events WHERE published=0'):
                digest = bytes.fromhex(identity) if isinstance(identity,str) else identity
                entry = json.loads(unpack_payload(payload))
                if bytes.fromhex(entry['id']) != digest:
                    raise ValueError('unpublished payload identity differs from private index')
            covered = []
            pending_ids = None
            started = time.monotonic()
            for name, file in sorted(files.items()):
                # Durable retirement authorizes eventual deletion, including
                # compaction originals whose IDs now own different sequences.
                if name in retired: continue
                first, last = map(int, name.split('.')[0].split('-')[1:])
                due = continuous and audit['cursor'] < name <= audit['boundary']
                budget = audited_count < HISTORY_AUDIT_SEGMENTS and audited_bytes < HISTORY_AUDIT_BYTES and time.monotonic()-started < HISTORY_AUDIT_SECONDS
                pos = bisect.bisect_left(changed, first)
                mandatory = name not in trusted or pos < len(changed) and changed[pos] <= last
                verify = not continuous or mandatory or due and budget
                if not verify:
                    expected = metadata.get(name, {})
                    if expected.get('sha256') != trusted[name].get('sha256') or expected.get('rawBytes') != trusted[name].get('rawBytes'):
                        raise ValueError(f'immutable segment metadata differs from verified history: {name}')
                    covered.append((first,last))
                    continue
                if due and budget:
                    audited_count += 1
                    audited_bytes += file.stat().st_size
                    audit['cursor'] = name
                    audit['checked'] += 1
                rows = self.db.execute('SELECT seq,id FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq', (first,last)).fetchall()
                indexed = [bytes.fromhex(row[1]) if isinstance(row[1],str) else row[1] for row in rows]
                mapping = hashlib.sha256()
                for row, identity in zip(rows, indexed):
                    mapping.update(str(row[0]).encode('ascii') + b':' + identity)
                # Hash actual file bytes on every selected check: size/mtime/file IDs
                # alone cannot detect same-size corruption or restored times.
                digest = hashlib.sha256()
                with file.open('rb') as stream:
                    while chunk := stream.read(1024 * 1024): digest.update(chunk)
                expected = metadata.get(name, {})
                identity_proof = name + ':' + digest.hexdigest() + ':' + mapping.hexdigest() + ':'
                cached = self.db.execute('SELECT proof,metadata FROM segment_verification WHERE name=?', (name,)).fetchone()
                proof = hmac.new(self.verification_key, (identity_proof + cached[1]).encode('utf-8'), hashlib.sha256).hexdigest() if cached else None
                if name != pending_name and cached and hmac.compare_digest(cached[0], proof):
                    verified = json.loads(cached[1])
                    if expected.get('sha256') and (expected['sha256'] != verified['sha256'] or expected.get('rawBytes') != verified['rawBytes']):
                        raise ValueError(f'immutable segment checksum differs from retained metadata: {name}')
                    self.verified_metadata[name] = verified
                    covered.append((first,last))
                    continue
                opener = gzip.open if name.endswith('.gz') else open
                with opener(file, 'rb') as stream: raw = stream.read(4*1024*1024+1)
                if len(raw) > 4*1024*1024 or not raw.endswith(b'\n'): raise ValueError(f'invalid segment size or termination: {name}')
                if expected.get('sha256') and (hashlib.sha256(raw).hexdigest() != expected['sha256'] or len(raw) != expected.get('rawBytes')):
                    raise ValueError(f'immutable segment checksum differs from retained metadata: {name}')
                entries = [json.loads(line) for line in raw.splitlines()]
                ids = [bytes.fromhex(e['id']) for e in entries]
                if not ids or any(len(identity) != 32 for identity in ids) or len(set(ids)) != len(ids): raise ValueError(f'invalid segment identities: {name}')
                if name == pending_name:
                    # A crash may publish the reserved output before the index
                    # remap. Check it against the durable original snapshots.
                    if pending_ids is None:
                        pending_ids = []
                        for original in pending['originals']:
                            data = files[original['file']].read_bytes()
                            content = gzip.decompress(data) if original['file'].endswith('.gz') else data
                            if len(content) != original['rawBytes'] or hashlib.sha256(content).hexdigest() != original['sha256']:
                                raise ValueError('compaction original differs from its durable intent')
                            pending_ids.extend(bytes.fromhex(json.loads(line)['id']) for line in content.splitlines())
                    if ids != pending_ids: raise ValueError('pending compaction output identities differ from originals')
                    continue
                if indexed != ids or rows[0][0] != first or rows[-1][0] != last:
                    raise ValueError(f'immutable segment identities differ from private index: {name}')
                classified = [classify_event(e) for e in entries]
                verified = dict(file=name, schema=2, sha256=hashlib.sha256(raw).hexdigest(), bytes=file.stat().st_size,
                    rawBytes=len(raw), count=len(entries), first=min(e['time'] for e in entries), last=max(e['time'] for e in entries),
                    sources=sorted({e['source'] for e in entries}), sourceRanges=self.source_ranges(entries),
                    originRanges=self.source_ranges(entries, 'origin'), subsystems=sorted({e['subsystem'] for e in classified}),
                    modules=sorted({e['module'] for e in classified}), levels=sorted({e['level'] for e in classified}))
                encoded = json.dumps(verified, sort_keys=True, separators=(',', ':'))
                proof = hmac.new(self.verification_key, (identity_proof + encoded).encode('utf-8'), hashlib.sha256).hexdigest()
                self.db.execute('INSERT OR REPLACE INTO segment_verification VALUES(?,?,?)', (name, proof, encoded))
                self.verified_metadata[name] = verified
                covered.append((first,last))
            # Every published index row must still have an active immutable
            # payload. Merge overlapping replay prefixes without retaining IDs.
            end = 0
            for first,last in sorted(covered):
                if first > end+1 and self.db.execute('SELECT 1 FROM events WHERE published=1 AND seq>? AND seq<? LIMIT 1',(end,first)).fetchone():
                    raise ValueError('published private index row has no immutable payload')
                end = max(end,last)
            if self.db.execute('SELECT 1 FROM events WHERE published=1 AND seq>? LIMIT 1',(end,)).fetchone():
                raise ValueError('published private index row has no immutable payload')
            if continuous:
                remaining = sum(audit['cursor'] < name <= audit['boundary'] for name in active)
                audit['total'] = audit['checked'] + remaining
                late = time.time() > audit['deadline']
                if not remaining:
                    audit['completedAt'] = now()
                    if not late: audit.update(state='complete', lastCompletedAt=now(), incomplete=False)
                if late:
                    audit.update(state='overdue', incomplete=True, lastMissedDeadlineAt=now())
                self.set_state('history:audit', audit)
            else:
                self.set_state('history:audit', dict(generation=uuid.uuid4().hex, cursor=max(active, default=''),
                    checked=len(active), total=len(active), lastCompletedAt=now(), deadline=time.time()+900, state='complete'))
            self.db.execute('DELETE FROM history_mapping_changes')
        except (ValueError, TypeError, KeyError, IndexError, OSError, EOFError, sqlite3.Error, zlib.error) as exc:
            if continuous:
                audit.update(state='error', detail=clean(str(exc))[:500])
                self.set_state('history:audit', audit)
                self.db.commit()
            raise history_error(str(exc)) from exc

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
        event = classify_event(event)
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

    def add_database_row(self, table, value, defaults, at):
        """Reuse an exact observation across additive, default-only schemas.

        Private compatibility rows contain only hashes and are bounded by retained
        events and 256 columns per row. Candidate rows stream from SQLite. No raw
        native key, original value or default is written to this index.
        """
        if not isinstance(value, dict) or not 1 <= len(value) <= DATABASE_IDENTITY_LIMIT:
            raise ValueError('Database identity column bound exceeded or invalid row')
        keys = DATABASE_NATIVE_KEYS[table]
        if any(type(value.get(key)) not in (str, int) or not str(value[key]) or
               len(str(value[key]).encode()) > 1024 for key in keys):
            raise ValueError('Missing or invalid database primary key; identity not inferred')
        def digest(item):
            return hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        native = bytes.fromhex(digest([table, [(key, value[key]) for key in keys]]))
        fields = {digest(key): digest(item) for key, item in value.items()}
        missing = {digest(key): digest(item) for key, item in defaults.items()}
        source = 'auth' if table == 'product_analytics_events' else 'audit'
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True)
        event = normalize(source, raw, at, table + ':' + raw, table)
        candidates = self.db.execute('''SELECT o.event_id,o.fields FROM database_observations o
            JOIN events e ON e.id=o.event_id WHERE o.native_key=?''', (native,))
        match = None
        for identity, encoded in candidates:
            previous = json.loads(encoded)
            if all(fields.get(key) == item for key, item in previous.items()) and all(
                    missing.get(key) == item for key, item in fields.items() if key not in previous):
                candidate = (len(previous), identity)
                if match is None or candidate > match: match = candidate
        if match:
            event['id'] = match[1].hex()
        else:
            # PostgreSQL row_to_json preserves physical column order. ADD COLUMN
            # appends fields, so older whole-row hashes can be verified exactly
            # by removing only trailing fields equal to their missing defaults.
            # An index hit includes the complete old raw row and actual PK.
            prefix = dict(value)
            while True:
                legacy_raw = json.dumps(prefix, ensure_ascii=False, sort_keys=True)
                identity = hashlib.sha256((source + '\0' + table + ':' + legacy_raw).encode()).digest()
                if self.db.execute('SELECT 1 FROM events WHERE id=?', (identity,)).fetchone():
                    event['id'] = identity.hex()
                    break
                last = next(reversed(prefix))
                if last in keys or last == DATABASE_DIAGNOSTICS['sources'][table]['timeColumn'] or last not in defaults or digest(prefix[last]) != digest(defaults[last]):
                    break
                prefix.pop(last)
        self.add(event)
        identity = bytes.fromhex(event['id'])
        if self.db.execute('SELECT 1 FROM events WHERE id=?', (identity,)).fetchone():
            self.db.execute('INSERT OR REPLACE INTO database_observations VALUES(?,?,?)',
                            (identity, native, json.dumps(fields, separators=(',', ':'))))

    def prune_database_observations(self):
        self.db.execute('DELETE FROM database_observations WHERE event_id NOT IN (SELECT id FROM events)')

    def docker(self, history=None):
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
            if any(c['Config']['Labels'].get('com.docker.compose.project.working_dir') != actual for c in inspected):
                raise RuntimeError('Mixed installation roots; collection stopped')
            if getattr(self, 'sampler', None):
                self.sampler.set_targets(tuple(c['Id'] for c in inspected if c.get('State', {}).get('Running', True)), canonical['Id'])
            self.postgres = canonical["Id"]
            self.containers = {}
            # Historical catch-up gets one container per cycle. Fresh lanes
            # always run first and never wait for all historical windows.
            historical_target = self.state('docker:history:turn', 0) % len(inspected)
            if history is True: self.set_state('docker:history:turn', historical_target + 1)
            for position, container in enumerate(inspected):
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
                lanes = (True, False) if history is None else (not history,)
                for recent in lanes:
                    if history is True and position != historical_target: continue
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
                        result = self.command(["docker", "logs", "--timestamps", "--since", start.isoformat(), "--until", until.isoformat(), cid], timeout=15 if history is not None else 90, merge_errors=True)
                    except Exception as exc:
                        self.set_state(key + ":span", max(1, span // 2))
                        self.status(status_source, "error", str(exc))
                        continue
                    for line in result.decode(errors="replace").splitlines():
                        token, _, raw = line.partition(" ")
                        self.add(normalize(service, raw, timestamp(token, until.isoformat()), cid + ":" + line))
                    self.set_state(key, until.isoformat())
                    caught_up = until >= datetime.now(UTC)-timedelta(seconds=30)
                    self.status(status_source, 'ok' if caught_up else 'pending',
                        'Fresh events' if recent and caught_up else 'Historical Docker backlog; next window queued' if not caught_up else
                        'History starts at container creation; removed containers cannot be recovered', until.isoformat())
                    self.checkpoint()
            self.status("docker", "ok")
        except Exception as exc:
            if getattr(self, 'sampler', None): self.sampler.set_targets((), None)
            self.status("docker", "error", str(exc))

    def database_batch(self, table, condition, after=None):
        """One bounded keyset page, with a required completion trailer.

        The raw native key is private cursor state only. Its PostgreSQL type is
        inferred from the table column, including uuid and bigint primary keys.
        """
        column = DATABASE_DIAGNOSTICS['sources'][table]['timeColumn']
        keys = (column, *DATABASE_NATIVE_KEYS[table])
        order = ','.join(f'"{key}"' for key in keys)
        def literal(value):
            return "E'" + str(value).replace('\\', '\\\\').replace("'", "''") + "'"
        if after is not None:
            if not isinstance(after, list) or len(after) != len(keys):
                raise ValueError('Invalid database keyset cursor')
            condition = f'({condition}) AND ({order}) > ({",".join(map(literal, after))})'
        defaults_sql = f'''(SELECT json_object_agg(a.attname,
            CASE WHEN a.atthasmissing THEN to_jsonb(a.attmissingval)->0 ELSE 'null'::jsonb END)
            FROM pg_attribute a WHERE a.attrelid='public."{table}"'::regclass
            AND a.attnum>0 AND NOT a.attisdropped)::text'''
        # Limit before encoding. The doubled UTF-8 length also bounds CSV quote
        # escaping; the extra allowance covers separators and the final trailer.
        sql = f'''BEGIN READ ONLY; SET LOCAL statement_timeout='15s';
            COPY (WITH candidates AS MATERIALIZED (
                SELECT * FROM public."{table}" WHERE {condition} ORDER BY {order} LIMIT {DATABASE_BATCH_ROWS + 1}
            ), encoded AS MATERIALIZED (
                SELECT row_to_json(t)::text AS raw, {defaults_sql} AS defaults,
                    row_number() OVER (ORDER BY {order}) AS n FROM candidates t
            ), measured AS (
                SELECT *, sum(2*(octet_length(raw)+octet_length(defaults))+256) OVER (ORDER BY n) AS bytes FROM encoded
            ), batch AS MATERIALIZED (
                SELECT * FROM measured WHERE n<={DATABASE_BATCH_ROWS} AND bytes<={DATABASE_BATCH_BYTES - 256}
            ) SELECT raw,defaults FROM (
                SELECT raw,defaults,n FROM batch
                UNION ALL SELECT 'null', json_build_object('count',(SELECT count(*) FROM batch),
                    'more',(SELECT count(*) FROM encoded)>(SELECT count(*) FROM batch))::text,
                    {DATABASE_BATCH_ROWS + 2}
            ) result ORDER BY n) TO STDOUT WITH CSV; ROLLBACK;'''
        data = self.command(["docker", "exec", "-i", self.postgres, "sh", "-c",
            'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql=sql, timeout=25)
        if len(data) > DATABASE_BATCH_BYTES:
            raise RuntimeError('Database page exceeds byte bound; cursor retained')
        # The process-wide csv default is too small for valid bounded rows.
        prior_limit = csv.field_size_limit()
        try:
            csv.field_size_limit(DATABASE_BATCH_BYTES)
            records = list(csv.reader(io.StringIO(data.decode('utf-8')), strict=True))
        finally:
            csv.field_size_limit(prior_limit)
        if not records or len(records) > DATABASE_BATCH_ROWS + 1 or any(len(row) != 2 for row in records):
            raise ValueError('Incomplete database page; cursor retained')
        trailer = records.pop()
        if trailer[0] != 'null': raise ValueError('Missing database page trailer; cursor retained')
        meta = json.loads(trailer[1])
        if not isinstance(meta, dict) or type(meta.get('count')) is not int or meta['count'] != len(records) or type(meta.get('more')) is not bool:
            raise ValueError('Invalid database page trailer; cursor retained')
        rows = [(json.loads(raw), json.loads(defaults)) for raw, defaults in records]
        if meta['more'] and not rows: raise RuntimeError('Database row exceeds bounded page; cursor retained')
        if any(not isinstance(value, dict) or not isinstance(defaults, dict) or any(key not in value for key in keys) for value, defaults in rows):
            raise ValueError('Invalid database page row; cursor retained')
        return rows, meta['more'], [rows[-1][0][key] for key in keys] if rows else after

    def database(self, history=None):
        last_key = 'database:last' if history is None else 'database:history:last' if history else 'database:fresh:last'
        if time.time() - self.state(last_key, 0) < (120 if history is None else 20): return
        if not getattr(self, "postgres", None):
            self.status("database-events", "unavailable", "Canonical PostgreSQL was not identified")
            return
        tables = {table: rule['timeColumn'] for table, rule in DATABASE_DIAGNOSTICS['sources'].items()}
        if history is True:
            turn = self.state('database:history:turn', 0) % len(tables)
            self.set_state('database:history:turn', turn + 1)
            tables = dict([list(tables.items())[turn]])
        failures, pending = 0, 0
        for table, column in tables.items():
            key = ('db:live:' if history is False else 'db:') + table
            cutoff = datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))
            for historical in ((False, True) if history is None else (history,)):
                lane_key = 'db:history:' + table if historical else key
                source = ('database-history:' if historical else 'database-events:') + table
                if historical and time.time() - self.state(lane_key + ':completed', 0) < 6 * 3600:
                    continue
                span = self.state(lane_key + ':span', self.config.get('retentionDays', 30)*86400 if historical else 6*3600)
                window = self.state(lane_key + ':window')
                if window is None:
                    default_start = max(cutoff, datetime.now(UTC)-timedelta(minutes=5)) if history is False else cutoff
                    start = max(cutoff, datetime.fromisoformat(self.state(lane_key, default_start.isoformat()).replace('Z', '+00:00')))
                    end = min(datetime.now(UTC), start + timedelta(seconds=span))
                    recent_end = datetime.now(UTC)
                    window = dict(start=start.isoformat(), end=end.isoformat(), recentEnd=recent_end.isoformat(),
                                  recentStart=(recent_end-timedelta(minutes=30)).isoformat(), after=None)
                def between(start, end):
                    if column.endswith('_ms'):
                        return f'"{column}" BETWEEN {int(datetime.fromisoformat(start).timestamp()*1000)} AND {int(datetime.fromisoformat(end).timestamp()*1000)}'
                    return f'"{column}" BETWEEN TIMESTAMPTZ \'{start}\' AND TIMESTAMPTZ \'{end}\''
                condition = between(window['start'], window['end'])
                if not historical: condition += ' OR ' + between(window['recentStart'], window['recentEnd'])
                # Keep the attempted window on errors too: an uncommitted page
                # must be retried against the same upper bound, even after restart.
                self.set_state(lane_key + ':window', window)
                self.db.execute('SAVEPOINT database_page')
                try:
                    rows, more, after = self.database_batch(table, condition, window['after'])
                    for value, defaults in rows:
                        stamp = datetime.fromtimestamp(value[column]/1000, UTC).isoformat() if column.endswith('_ms') else value[column]
                        self.add_database_row(table, value, defaults, timestamp(stamp, window['end']))
                    if more:
                        self.set_state(lane_key + ':window', {**window, 'after': after})
                    else:
                        self.set_state(lane_key + ':window', None)
                        complete = historical and datetime.fromisoformat(window['end']) >= datetime.now(UTC)-timedelta(seconds=30)
                        self.set_state(lane_key, cutoff.isoformat() if complete else window['end'])
                        if complete: self.set_state(lane_key + ':completed', time.time())
                    # A keyset time at a tie is not complete coverage through that
                    # timestamp. Only completed windows advance collectedThrough.
                    caught_up = not more and datetime.fromisoformat(window['end']) >= datetime.now(UTC)-timedelta(seconds=30)
                    if not caught_up: pending += 1
                    detail = 'Database backlog; bounded page continuation queued' if more else 'Historical reconciliation complete' if historical and caught_up else 'Fresh database events' if caught_up else 'Database backlog; next time window queued'
                    self.status(source, 'ok' if caught_up else 'pending', detail,
                                window['end'] if not more else None)
                    self.db.execute('RELEASE database_page')
                except Exception as exc:
                    self.db.execute('ROLLBACK TO database_page'); self.db.execute('RELEASE database_page')
                    failures += 1
                    self.set_state(lane_key + ':span', max(1, span // 2))
                    self.status(source, 'error', str(exc))
                self.checkpoint()
        self.set_state(last_key, time.time())
        self.status('database-history' if history is True else "database-events", 'error' if failures else 'pending' if pending else 'ok',
                    f'{failures} table sources require attention' if failures else f'{pending} database sources have queued backlog' if pending else '')

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

    def windows(self, background=False):
        if os.name != "nt":
            self.status("windows", "unavailable", "Windows Event Log is not available on this host")
            return
        worker = getattr(self, 'windows_worker', None)
        if background and worker and worker.is_alive():
            self.status('windows', 'pending', 'Windows collection is running independently of fresh application logs')
            return
        if not worker and time.time() - self.state("windows:last", 0) < 120: return
        since = (datetime.now(UTC) - timedelta(days=7)).isoformat()
        until = datetime.now(UTC).isoformat()
        script = Path(__file__).with_name("collect-windows-logs.ps1")
        try:
            cursor_file = self.private / "windows-cursors.json"
            if background and worker:
                self.windows_worker = None
                data, failed = self.windows_result
                self.windows_result = None
                if failed: raise RuntimeError('Windows collection failed; cursor retained')
            else:
                atomic_bytes(cursor_file, json.dumps(self.state("windows:cursors", {})).encode('utf-8'), mode=0o600)
                args = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Since", since, "-Until", until, "-CursorFile", str(cursor_file)]
                if background:
                    def collect():
                        try: self.windows_result = (self.command(args, timeout=180), False)
                        except Exception: self.windows_result = (None, True)
                    self.windows_worker = threading.Thread(target=collect, name='asa-windows-logs', daemon=True)
                    self.windows_worker.start()
                    self.status('windows', 'pending', 'Windows collection started independently of fresh application logs')
                    return
                data = self.command(args, timeout=180)
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
        return all(host_source(s) for s in meta["sources"])

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
        immutable_segment_bytes(self.store / file, data)
        return dict(file=file, schema=2, sha256=hashlib.sha256(raw).hexdigest(), bytes=len(data), rawBytes=len(raw), count=len(events), first=min(e["time"] for e in events), last=max(e["time"] for e in events), sources=sorted({e["source"] for e in events}), subsystems=sorted({event_subsystem(e) for e in events}), sourceRanges=self.source_ranges(events), originRanges=self.source_ranges(events, "origin"), modules=sorted({classify_event(e)["module"] for e in events}), levels=sorted({e["level"] for e in events}))

    def verify_affected_segment(self, meta, *, mapping=True):
        """Verify bytes before retirement/deletion, and ownership before remap."""
        file = self.store/meta['file']
        opener = gzip.open if file.name.endswith('.gz') else open
        try:
            with opener(file, 'rb') as stream: raw = stream.read(4*1024*1024+1)
            if len(raw) != meta.get('rawBytes') or hashlib.sha256(raw).hexdigest() != meta.get('sha256'):
                raise ValueError('affected immutable segment checksum differs')
            if mapping:
                first,last = map(int, file.name.split('.')[0].split('-')[1:])
                rows = self.db.execute('SELECT id FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq', (first,last)).fetchall()
                indexed = [bytes.fromhex(r[0]) if isinstance(r[0],str) else r[0] for r in rows]
                if indexed != [bytes.fromhex(json.loads(line)['id']) for line in raw.splitlines()]:
                    raise ValueError('affected immutable segment index differs')
        except (ValueError, KeyError, OSError, EOFError, zlib.error) as exc:
            raise history_error(str(exc)) from exc

    def recover_retired_metadata(self, name):
        """Recover only a still-authentic receipt with a reconstructible mapping.

        A contiguous filename range plus authenticated count reconstructs the
        original mapping. Gapped sequences cannot be inferred after retirement.
        Current bytes alone never establish a new reference checksum.
        """
        trusted = self.verified_metadata.get(name)
        if trusted:
            self.verify_affected_segment(trusted, mapping=False)
            return trusted
        try:
            receipt = self.db.execute('SELECT proof,metadata FROM segment_verification WHERE name=?', (name,)).fetchone()
            if not receipt: raise ValueError('saved verification receipt is missing')
            meta = json.loads(receipt[1])
            first,last = map(int, name.split('.')[0].split('-')[1:])
            if meta['file'] != name or type(meta['count']) is not int or meta['count'] != last-first+1:
                raise ValueError('original sequence mapping cannot be reconstructed')
            file = self.store/name
            if file.stat().st_size > 8*1024*1024: raise ValueError('retired segment exceeds bounded recovery size')
            digest = hashlib.sha256()
            with file.open('rb') as stream:
                while chunk := stream.read(1024*1024): digest.update(chunk)
            opener = gzip.open if name.endswith('.gz') else open
            with opener(file, 'rb') as stream: raw = stream.read(4*1024*1024+1)
            if len(raw) != meta['rawBytes'] or not raw.endswith(b'\n') or hashlib.sha256(raw).hexdigest() != meta['sha256']:
                raise ValueError('retired segment differs from saved checksum')
            ids = [bytes.fromhex(json.loads(line)['id']) for line in raw.splitlines()]
            if len(ids) != meta['count'] or any(len(identity) != 32 for identity in ids) or len(set(ids)) != len(ids):
                raise ValueError('retired segment identities are invalid')
            mapping = hashlib.sha256()
            for seq, identity in enumerate(ids, first): mapping.update(str(seq).encode('ascii') + b':' + identity)
            identity_proof = name + ':' + digest.hexdigest() + ':' + mapping.hexdigest() + ':'
            proof = hmac.new(self.verification_key, (identity_proof + receipt[1]).encode('utf-8'), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(receipt[0], proof): raise ValueError('saved verification receipt cannot authenticate original ownership')
            return meta
        except (ValueError, TypeError, KeyError, OSError, EOFError, zlib.error) as exc:
            raise history_error(f'retired segment {name} requires verified diagnostic snapshot recovery: {exc}') from exc

    def system_metadata(self, meta, cached):
        """Repair classification hints without rewriting immutable segment payloads."""
        if meta['sources'] and self.host_segment(meta):
            return {**meta, 'subsystems': sorted({subsystem(s) for s in meta['sources']}), 'modules': ['system']}
        mixed = any(host_source(s) for s in meta['sources'])
        stale_application = 'host' in meta.get('subsystems', ()) and any(s in ('api', 'web', 'scratch') for s in meta['sources'])
        editors = any(s in ('api', 'web', 'blocks', *EDITOR_MODULES) for s in meta['sources'])
        signature = hashlib.sha256(('editor-classification-v1:' + json.dumps(meta, sort_keys=True)).encode()).hexdigest()
        if (mixed or stale_application or editors) and cached.get(meta['file']) != signature:
            opener = gzip.open if meta['file'].endswith('.gz') else open
            with opener(self.store / meta['file'], 'rb') as stream: raw = stream.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024: raise history_error('classification segment exceeds limit')
            events = [classify_event(json.loads(line)) for line in raw.splitlines()]
            meta = {**meta, 'subsystems': sorted({e['subsystem'] for e in events}), 'modules': sorted({e['module'] for e in events}), 'levels': sorted({e['level'] for e in events})}
        cached[meta['file']] = hashlib.sha256(('editor-classification-v1:' + json.dumps(meta, sort_keys=True)).encode()).hexdigest()
        return meta

    def finish_compaction(self, *, newly_reserved=False):
        """Complete a durable compaction intent before accepting new events.

        Files named by the old catalog survive the normal reader grace period.
        Stable event IDs never change; only the private sequence is reassigned.
        Reserving the sequence and intent together prevents reuse after a crash.
        """
        intent = self.state("compaction:pending")
        if not intent: return
        if not newly_reserved: self.validate_history_index()
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
        self.verify_affected_segment(meta)
        self.verified_metadata[meta['file']] = meta
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
            for meta in selected: self.verify_affected_segment(meta)
            first = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone()[0] + 1
            count = sum(m["count"] for m in selected)
            self.set_state("segments", {m["file"]: m for m in segments})
            self.set_state("retired:segments", retired)
            self.set_state("compaction:pending", dict(originals=selected, first=first, count=count))
            self.db.execute("UPDATE sqlite_sequence SET seq=? WHERE name='events'", (first+count-1,))
            self.db.commit()
            self.finish_compaction(newly_reserved=True)
            return list(self.state("segments").values()), self.state("retired:segments", {})
        return segments, retired

    def upgrade_file_event(self, entry):
        entry = classify_event(entry)
        if entry.get("normalizationVersion") == 2: return entry
        file_sources = {"updates", "docker-desktop", *(s["source"] for s in self.config.get("fileSources", []))}
        if entry["source"] in file_sources:
            entry["time"], entry["timeBasis"] = file_timestamp(entry["message"], entry["time"])
        if entry.get("level") not in ("info", "warn", "error") and not entry["source"].startswith("windows:") and not entry.get("truncated"):
            try: payload = json.loads(entry["message"])
            except ValueError: payload = None
            entry["level"] = log_level(payload, entry["message"])
        entry["normalizationVersion"] = 2
        return entry

    def import_history(self, path: Path):
        """Operator-only recovery from an existing, normalized ASA diagnostic ZIP."""
        self.validate_history_index()
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
                                entry.get("module") not in (*LOG_MODULES, "blocks") or entry.get("level") not in ("info", "warn", "error") or
                                not isinstance(entry.get("source"), str) or not 1 <= len(entry["source"]) <= 200 or
                                not isinstance(entry.get("message"), str) or len(entry["message"]) > 16384 or not timestamp(entry.get("time"), "")):
                                raise RuntimeError("Diagnostic archive contains an invalid record")
                            editor_hint = editor_module(entry.get('subsystem')) if entry['source'] in ('api', 'web') else None
                            entry = {k: v for k, v in entry.items() if k in ("id", "time", "source", "module", "level", "message", "requestId", "revision", "origin", "truncated", "timeBasis", "windowsRecordId", "windowsEventId", "normalizationVersion")}
                            entry["time"] = timestamp(entry["time"], "")
                            entry["message"] = clean(entry["message"])
                            entry["origin"] = clean(str(entry.get("origin", "")))[:500]
                            # Truncated editor JSON cannot reconstruct this known classification hint.
                            if editor_hint and entry['origin'] not in DATABASE_DIAGNOSTICS['sources']:
                                entry['subsystem'] = editor_hint
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
        self.validate_history_index(continuous=True)
        self.finish_compaction()
        self.db.commit()
        retired = self.state("retired:segments", {})
        retired_metadata = self.state('retired:metadata', {})
        # Resolve every existing legacy retirement before any cleanup or fresh
        # publication. Unverifiable debt must not disappear behind active quota.
        for name in retired:
            if not SEGMENT_PATTERN.fullmatch(name): raise history_error('invalid retired segment name')
            if name not in retired_metadata and (self.store/name).exists():
                retired_metadata[name] = self.recover_retired_metadata(name)
            if name in retired_metadata and retired_metadata[name].get('file') != name:
                raise history_error('retired segment metadata names a different file')
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
                if (self.store/name).exists(): self.verify_affected_segment(retired_metadata[name], mapping=False)
                (self.store / name).unlink(missing_ok=True)
                self.db.execute('DELETE FROM segment_verification WHERE name=?', (name,))
                retired.pop(name)
                retired_metadata.pop(name, None)
        previous = self.state("segments", {})
        # Classification/range hints are derived from verified immutable bytes,
        # never accepted merely because someone edited the cached state JSON.
        previous.update(self.verified_metadata)
        system_metadata = self.state("classification:system_metadata", {})
        for name, meta in self.verified_metadata.items():
            system_metadata[name] = hashlib.sha256(('editor-classification-v1:' + json.dumps(meta, sort_keys=True)).encode()).hexdigest()
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
            self.verify_affected_segment(written)
            self.verified_metadata[written['file']] = written
            previous[written["file"]] = written
            self.db.executemany("UPDATE events SET published=1,payload=NULL,time=NULL,source=NULL WHERE seq=?", [(r[0],) for r in rows])
            self.db.commit()
        cutoff = (datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        segments = []
        files = {p.name: p for p in self.store.glob("seg-*.jsonl*") if SEGMENT_PATTERN.fullmatch(p.name) and p.name not in retired}
        for name, file in sorted(files.items()):
            if not name.endswith(".gz") and name + ".gz" in files:
                self.verify_affected_segment(previous[name])
                self.verify_affected_segment(previous[name+'.gz'])
                retired.setdefault(name, None)
                continue
            meta = previous.get(name)
            if self.reader_format >= 2 and not name.endswith(".gz"):
                self.verify_affected_segment(meta)
                events = [self.upgrade_file_event(json.loads(line)) for line in file.read_text(encoding="utf-8").splitlines()]
                meta = self.write_segment(name, events)
                self.verify_affected_segment(meta)
                retired.setdefault(name, None)
            elif not meta or "sourceRanges" not in meta or (not meta.get("originRanges") and any(s in ("audit", "auth") for s in meta["sources"])):
                raw = file.read_bytes()
                if name.endswith(".gz"): raw = gzip.decompress(raw)
                events = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
                meta = dict(file=name, bytes=file.stat().st_size, rawBytes=len(raw), count=len(events), first=min(e["time"] for e in events), last=max(e["time"] for e in events), sources=sorted({e["source"] for e in events}), sourceRanges=self.source_ranges(events), originRanges=self.source_ranges(events, "origin"), modules=sorted({e["module"] for e in events}), levels=sorted({e["level"] for e in events}))
                if all(e.get("normalizationVersion") == 2 for e in events):
                    meta.update(schema=2, sha256=hashlib.sha256(raw).hexdigest())
            segments.append(self.system_metadata(meta, system_metadata))
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
                self.verify_affected_segment(segment)
                self.verify_affected_segment(canonical[-1])
                if bounds(segment)[1] > bounds(canonical[-1])[1] or not identities(segment).issubset(identities(canonical[-1])):
                    raise RuntimeError("Overlapping diagnostic segments; originals were preserved")
                retired.setdefault(segment["file"], None)
            else: canonical.append(segment)
        canonical, retired = self.compact(canonical, retired)
        segments = []
        for meta in canonical:
            if meta["last"] < cutoff:
                self.verify_affected_segment(meta)
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
            self.verify_affected_segment(oldest)
            retired.setdefault(oldest["file"], None)
            segments.remove(oldest); total -= oldest["bytes"]
            first, last = map(int, oldest["file"].split(".")[0].split("-")[1:])
            self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", (first, last))
            for source in oldest["sources"]: evicted[source] = True
            trimmed = True
        while total > max(1024 * 1024, limit * 3 // 4) and segments: evict()
        self.prune_database_observations()
        self.db.commit()
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        # Physical quota is still a hard invariant. This existing full rewrite
        # remains an explicit freshness limitation pending separate storage work.
        if trimmed:
            self.db.execute("VACUUM")
            self.index_schema = self.db.execute('PRAGMA schema_version').fetchone()[0]
            self.set_state("vacuum:day", datetime.now(UTC).date().isoformat()); self.db.commit()
        def active_bytes():
            # Retired immutable files protect in-flight 120-second readers;
            # their temporary 180-second overlap is reported separately.
            return sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file() and p.name not in retired)
        while active_bytes() > limit and segments:
            target = total * 0.9
            while segments and total > target: evict()
            self.prune_database_observations()
            self.db.commit(); self.db.execute("VACUUM"); self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self.index_schema = self.db.execute('PRAGMA schema_version').fetchone()[0]
        sources = [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM sources ORDER BY name")]
        for source in sources:
            current = datetime.now(UTC)
            checked = datetime.fromisoformat(source['checkedAt'].replace('Z', '+00:00'))
            source['publicationAgeSeconds'] = max(0, round((current-checked).total_seconds()))
            through = source.get('collectedThrough')
            source['coverageLagSeconds'] = max(0, round((current-datetime.fromisoformat(through.replace('Z', '+00:00'))).total_seconds())) if through else None
            fresh_lane = source['source'] == 'metrics' or source['source'].endswith(':recent') or source['source'].startswith('database-events:')
            source['stale'] = bool(source.get('applicable', True) and fresh_lane and
                (source['publicationAgeSeconds'] > 60 or (source['coverageLagSeconds'] or 0) > 60))
            if source['stale'] and source['state'] == 'ok':
                source.update(state='pending', detail='Fresh source has not been checked within 60 seconds')
            event_source = source["source"].removesuffix(":recent")
            origin = event_source.split(":", 1)[1] if event_source.startswith(("database-events:", "database-history:")) else None
            ranges = [s.get("originRanges", {}).get(origin) if origin else s["sourceRanges"].get(event_source) for s in segments]
            ranges = [r for r in ranges if r]
            source["retainedFrom"] = min((r["first"] for r in ranges), default=None)
            source["retainedTo"] = max((r["last"] for r in ranges), default=None)
            source["trimmed"] = bool(evicted.get("auth" if origin == "product_analytics_events" else "audit" if origin else event_source))
        self.set_state("segments", {s["file"]: s for s in segments})
        self.set_state("classification:system_metadata", {s['file']: system_metadata[s['file']] for s in segments if s['file'] in system_metadata})
        self.set_state("retired:segments", retired)
        for name in retired:
            if name in previous: retired_metadata[name] = previous[name]
            elif name in self.verified_metadata: retired_metadata[name] = self.verified_metadata[name]
        self.set_state('retired:metadata', retired_metadata)
        self.set_state("evicted:sources", evicted)
        if trimmed: self.set_state("trimmedAt", now())
        self.db.commit(); self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        storage_bytes = sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file())
        acknowledged = []
        disposed = []
        if getattr(self, 'sampler', None) and self.sampler.spool:
            for metrics in getattr(self, 'metrics_pending', []):
                sampling = metrics['sampling']
                identity = hashlib.sha256(('metrics\0' + sampling['streamId'] + ':' + str(sampling['sequence'])).encode()).digest()
                row = self.db.execute('SELECT seq,published FROM events WHERE id=?', (identity,)).fetchone()
                if row and row[1] == 1 and any(bounds(meta)[0] <= row[0] <= bounds(meta)[1] for meta in segments):
                    acknowledged.append(metrics)
                elif metrics['sampledAt'] < cutoff:
                    disposed.append((metrics, 'expired'))
                elif not row and evicted.get('metrics'):
                    disposed.append((metrics, 'quota_discarded'))
            losses = self.sampler.loss_counters()
            # Publish the loss warning before terminal spool disposal. If the
            # catalog write fails, no disposition/ACK is committed and replay
            # remains possible. Durable counters survive the later disposal.
            for _, reason in disposed:
                losses['droppedSamplesTotal'] += 1
                losses['expiredSamplesTotal' if reason == 'expired' else 'quotaDiscardedSamplesTotal'] += 1
            for source in sources:
                if source['source'] == 'metrics':
                    source['resourceLossCounters'] = losses
                    if losses['droppedSamplesTotal']:
                        source.update(state='pending', possibleCoverageGap=True,
                            detail='Resource coverage incomplete; inspect durable dropped/expired/quota counters')
                    elif len(acknowledged) != len(getattr(self, 'metrics_pending', [])):
                        source.update(state='pending', detail='Resource samples remain in durable spool until retained catalog publication')
        self.db.execute('DELETE FROM history_mapping_changes')
        self.db.commit()
        audit = self.state('history:audit', {})
        audit_public = {k:v for k,v in audit.items() if k not in ('boundary',)}
        if audit and audit.get('state') != 'complete' and time.time() > audit.get('deadline', 0): audit_public['state'] = 'overdue'
        catalog = dict(version=1, readerFormat=self.reader_format, collectedAt=now(), retentionDays=self.config.get("retentionDays", 30), maxBytes=limit, bytes=total, rawBytes=sum(s.get("rawBytes", s["bytes"]) for s in segments), storageBytes=storage_bytes, activeStorageBytes=active_bytes(), retiredBytes=storage_bytes-active_bytes(), trimmed=bool(self.state("trimmedAt")), historyAudit=audit_public, sources=sources, segments=segments)
        atomic_bytes(self.store / 'catalog.json', json.dumps(catalog, ensure_ascii=False).encode('utf-8'))
        self.verified_metadata = {s['file']: s for s in segments}
        # The resource spool remains replayable until both index and catalog
        # are durable. A failure above must never acknowledge unpublished data.
        if getattr(self, 'sampler', None) and self.sampler.spool:
            for metrics in acknowledged:
                self.sampler.acknowledge(metrics['sampling'])
                self.metrics_pending.remove(metrics)
            for metrics, reason in disposed:
                self.sampler.dispose(metrics['sampling'], reason)
                self.metrics_pending.remove(metrics)

    def checkpoint(self, force=False):
        """Publish only at transaction-safe adapter boundaries, never recursively."""
        if not getattr(self, 'checkpoint_enabled', False) or getattr(self, 'checkpoint_busy', False): return
        if not force and time.monotonic() - getattr(self, 'last_checkpoint', 0) < 20: return
        self.checkpoint_busy = True
        try:
            self.telemetry()
            self.publish()
            self.last_checkpoint = time.monotonic()
        finally: self.checkpoint_busy = False

    def cycle(self):
        self.checkpoint_enabled = True
        try:
            self.finish_compaction()
            self.docker(history=False)
            self.database(history=False)
            self.checkpoint(force=True)
            self.docker(history=True)
            self.database(history=True)
            self.checkpoint()
            self.files()
            self.windows(background=True)
            self.linux()
            self.lifecycle()
            self.checkpoint(force=True)
        finally: self.checkpoint_enabled = False

    def telemetry(self):
        if getattr(self, 'sampler', None):
            if self.sampler.spool:
                try: values = self.sampler.batch()
                except (sqlite3.Error, OSError):
                    self.status('metrics', 'error', 'resource_spool_read_failed; retained samples were not acknowledged')
                    return
                try:
                    for metrics in values:
                        metrics['sampling']['publicationLagMs'] = max(0, round((datetime.now(UTC)-datetime.fromisoformat(metrics['sampledAt'].replace('Z','+00:00'))).total_seconds()*1000))
                        self.persist_metrics(metrics)
                    self.db.commit()
                except Exception:
                    self.db.rollback()
                    raise
                self.metrics_pending = values
                if self.sampler.storage_error:
                    self.status('metrics', 'error', self.sampler.storage_error)
                return
            for _ in range(self.sampler.capacity + 1):
                metrics = self.sampler.acquire()
                if metrics is None: break
                metrics['sampling']['publicationLagMs'] = max(0, round((datetime.now(UTC)-datetime.fromisoformat(metrics['sampledAt'].replace('Z','+00:00'))).total_seconds()*1000))
                try:
                    self.persist_metrics(metrics)
                    # The queue reservation survives failures. Commit before ACK
                    # so a later adapter/publish rollback cannot erase the sample.
                    self.db.commit()
                except Exception:
                    self.db.rollback()
                    raise
                self.sampler.acknowledge(metrics['sampling'])
            return
        if time.time() - self.state("metrics:last", 0) < 60: return
        previous = self.state('metrics:cpu-state', {'windows': self.state('metrics:cpu'), 'linux': self.state('metrics:cpu-linux')})
        metrics, previous = self.sample_resources(tuple(getattr(self, 'containers', {})), getattr(self, 'postgres', None), previous)
        self.persist_metrics(metrics)
        self.set_state('metrics:cpu-state', previous)
        self.set_state("metrics:last", time.time())

    def persist_metrics(self, metrics):
        measured = metrics['sampledAt']
        sampling = metrics.get('sampling', {})
        gapped = sampling.get('droppedSamplesTotal', 0) > 0 or sampling.get('missedIntervals', 0) > 0 or bool(sampling.get('spoolError'))
        delayed = sampling.get('publicationLagMs', 0) >= 60_000
        metrics['samplingCoverage'] = 'gapped' if gapped else 'delayed' if delayed else 'observed'
        if (gapped or delayed) and not metrics.get('incomplete'): metrics['level'] = 'warn'
        identity = f"{sampling['streamId']}:{sampling['sequence']}" if sampling.get('streamId') else measured
        self.add(normalize('metrics', json.dumps(metrics), measured, identity))
        state = 'error' if metrics.get('incomplete') else 'pending' if gapped or delayed else 'ok'
        self.status('metrics', state, 'Incomplete resource sample' if metrics.get('incomplete') else
                    'Sampling gaps or late publication; inspect sampling counters' if gapped or delayed else 'Runtime resource sample', measured)

    def sample_resources(self, ids, postgres, previous):
        # Runs on producer thread: never access state()/db/status()/add().
        memory_deadline = time.monotonic() + CAPTURE_SECONDS
        previous = dict(previous)
        measured = now()
        metrics = dict(kind="runtime_metrics", module="system", sampledAt=measured, host={},
                       units=dict(containerCpu='percent_one_core', hostCpu='percent_all_logical_cpus', duration='milliseconds'))
        try:
            metrics['host']['diskFreeBytes'] = shutil.disk_usage(self.root).free
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes
                class Memory(ctypes.Structure):
                    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD), *[(n, ctypes.c_ulonglong) for n in ("total", "available", "pageTotal", "pageAvailable", "virtualTotal", "virtualAvailable", "extended")]]
                memory = Memory(); memory.length = ctypes.sizeof(memory)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
                    metrics["host"].update(memoryTotalBytes=memory.total, memoryAvailableBytes=memory.available,
                        commitLimitBytes=memory.pageTotal, commitAvailableBytes=memory.pageAvailable,
                        memoryCommittedBytes=memory.pageTotal-memory.pageAvailable)
                idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
                if ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                    value = lambda v: v.dwHighDateTime*2**32+v.dwLowDateTime
                    counters = [value(idle), value(kernel)+value(user)]
                    prior_cpu = previous.get('windows')
                    if prior_cpu and counters[1] > prior_cpu[1]: metrics["host"]["cpuPercent"] = round(100*(1-(counters[0]-prior_cpu[0])/(counters[1]-prior_cpu[1])), 2)
                    previous['windows'] = counters
            elif sys.platform.startswith('linux'):
                try:
                    sample, counters = linux_resources(previous=previous.get('linux'))
                    metrics['host'].update(sample); previous['linux'] = counters
                except Exception:
                    metrics.setdefault('failedComponents', []).append('host')
                metrics["host"]["loadAverage"] = list(os.getloadavg())
            else:
                metrics.setdefault('failedComponents', []).append('host')
            metrics['host']['memoryDiagnostics'] = capture_memory(deadline=memory_deadline)
            warnings = resource_warnings(metrics['host'])
            if warnings: metrics.update(resourceWarnings=warnings, level='warn')
            if ids:
                try:
                    output = self.command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids], timeout=15)
                    metrics["containers"] = [{k: v for k, v in json.loads(line).items() if k in ("Name", "CPUPerc", "MemUsage", "MemPerc", "PIDs")} for line in output.decode("utf-8").splitlines()]
                except Exception:
                    metrics.setdefault("failedComponents", []).append("containers")
            if postgres:
                sql = DATABASE_METRICS_SQL
                output = self.command(["docker", "exec", "-i", postgres, "sh", "-c", 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql=sql, timeout=10)
                rows = list(csv.reader(io.StringIO(output.decode("utf-8"))))
                if len(rows) != 1 or len(rows[0]) != 1: raise ValueError("Invalid database metric envelope")
                sample = json.loads(rows[0][0])
                if not isinstance(sample, dict) or type(sample.get("connections")) is not int or not isinstance(sample.get("waits"), (list, type(None))): raise ValueError("Invalid database metric sample")
                metrics["database"] = sample
            if metrics.get("failedComponents"): raise RuntimeError("Some resource metrics are unavailable; available samples retained")
        except Exception:
            metrics["incomplete"] = True
            metrics["level"] = "error"
            metrics.setdefault('failedComponents', []).append('resource_capture')
        return metrics, previous


def write_collector_health(root, state, last_success=None, detail="", duration=None, sources=None):
    safe_store_paths(root)
    store = root / ".asa" / "diagnostics" / "store"
    store.mkdir(parents=True, exist_ok=True)
    target = store / "collector-health.json"
    if last_success is None and target.exists():
        try: last_success = json.loads(target.read_text(encoding="utf-8")).get("lastSuccessAt")
        except (OSError, ValueError): pass
    value = dict(version=1, state=state, checkedAt=now(), lastSuccessAt=last_success, detail=clean(str(detail))[:500], durationMs=duration)
    catalog_path = store/'catalog.json'
    if catalog_path.exists():
        try:
            audit = json.loads(catalog_path.read_text(encoding='utf-8')).get('historyAudit')
            if isinstance(audit, dict):
                value['historyAudit'] = audit
                if audit.get('incomplete') or audit.get('state') != 'complete' and time.time() > audit.get('deadline', 0):
                    value.update(state='error', detail='Retained history audit overdue; integrity coverage incomplete')
                    value['historyAudit']['state'] = 'overdue'
        except (OSError, ValueError, TypeError):
            value.update(state='error', detail='Retained history audit status unavailable')
    if sources is not None:
        applicable = [s for s in sources if s.get('applicable', True)]
        value['excludedNotApplicable'] = len(sources) - len(applicable)
        value['sourceStates'] = {state: sum(s.get('state') == state for s in applicable) for state in ('ok', 'pending', 'unavailable', 'error')}
        value['coverageComplete'] = bool(applicable) and not any(s.get('state') != 'ok' or s.get('possibleCoverageGap') for s in applicable)
        if value['state'] == 'error': value['coverageComplete'] = False
    atomic_bytes(target, json.dumps(value, ensure_ascii=False).encode('utf-8'))


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
    atomic_bytes(target, json.dumps({**identity, 'checkedAt': now()}).encode('utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--import-history", type=Path, help="Recover retained history from an existing normalized ASA log ZIP")
    args = parser.parse_args()
    safe_store_paths(args.root)
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
        install = SimpleNamespace(root=args.root, state=args.root / '.asa', project=installation['project'], settings=installation)
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
    sampler = None
    if not args.once:
        # Start capture before legacy history/index verification. The producer
        # has its own bounded durable store and never touches the main index.
        from types import SimpleNamespace
        resource_context = SimpleNamespace(root=args.root, command=lambda *a, **kw: Collector.command(None, *a, **kw))
        cpu_state = {}
        def capture(containers, postgres):
            nonlocal cpu_state
            sample, cpu_state = Collector.sample_resources(resource_context, containers, postgres, cpu_state)
            if not containers or not postgres:
                sample.update(incomplete=True, level='warn', resourceTargetState='pending')
            else: sample['resourceTargetState'] = 'verified'
            return sample
        try:
            sampler = ResourceSampler(capture, spool=private/'resources.sqlite',
                max_bytes=min(16 * 1024 * 1024, config.get('maxBytes', 1024**3) // 8))
        except (sqlite3.Error, OSError):
            # Continue core logs with explicitly degraded resource coverage.
            # Never delete or replace an unreadable durable resource spool.
            sampler = ResourceSampler(capture)
            sampler.storage_error = 'resource_spool_unavailable'
            sampler.dropped = 1
        sampler.start()
    try:
        collector = Collector(args.root, config)
    except Exception as exc:
        if sampler: sampler.stop()
        stop_heartbeat.set()
        write_collector_health(args.root, "error", detail=exc)
        raise
    if args.import_history:
        try: collector.import_history(args.import_history)
        except Exception as exc:
            write_collector_health(args.root, "error", detail=exc)
            raise
    collector.sampler = sampler
    try:
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
    finally:
        stop_heartbeat.set()
        try:
            if collector.sampler:
                stopped = collector.sampler.stop()
                try:
                    collector.telemetry(); collector.publish()
                    if not stopped: write_collector_health(args.root, 'error', detail='Resource sampler shutdown deadline exceeded')
                except Exception:
                    write_collector_health(args.root, 'error', detail='Final resource publication failed')
        finally:
            collector.db.close()
            stream.close()


if __name__ == "__main__":
    main()
