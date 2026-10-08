"""Durable ASA diagnostic collector. Standard library only; never changes app data."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
SENSITIVE = re.compile(r"password|passwd|secret|cookie|authorization|credential|student.?code|token|api.?key|jwt|signing.?key", re.I)


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean(value):
    if isinstance(value, dict):
        return {k: "[redacted]" if SENSITIVE.search(k) else clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value[:100]]
    if not isinstance(value, str):
        return value
    value = re.sub(r"(?im)((?:set-)?cookie\s*:)\s*[^\r\n]+", r"\1 [redacted]", value)
    value = re.sub(r"(?i)(bearer\s+)[^\s\"',;]+", r"\1[redacted]", value)
    value = re.sub(r"(?i)(://[^\s:/]+:)[^\s@]+(@)", r"\1[redacted]\2", value)
    value = re.sub(r"(?i)((?:password|passwd|secret|cookie|authorization|student[_-]?code|(?:access[_-]?|refresh[_-]?|bot[_-]?)?token|api[_-]?key|signing[_-]?key)[\"']?\s*[=:]\s*[\"']?)[^\s\"',;&}]+", r"\1[redacted]", value)
    value = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", value)
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


def normalize(source: str, raw: str, at: str, identity: str, origin: str = "") -> dict:
    payload = None
    try:
        payload = json.loads(raw)
    except ValueError:
        pass
    code = payload.get("status") if isinstance(payload, dict) else None
    level = "error" if isinstance(code, int) and code >= 500 else "warn" if isinstance(code, int) and code >= 400 else "info"
    if re.search(r"\b(error|fatal|panic|exception|failed|failure|blocked)\b|\[E\]", raw, re.I):
        level = "error"
    elif level == "info" and re.search(r"\b(warn|warning)\b|\[W\]", raw, re.I):
        level = "warn"
    module = "scratch" if source == "scratch" else "auth" if source == "auth" else "system"
    request_id = revision = None
    if isinstance(payload, dict):
        route = str(payload.get("path", ""))
        module = "electronics" if "electronics" in route else "scratch" if "blocks" in route or "scratch" in route else "auth" if "/auth/" in route or "class-join" in route else "portal" if source == "api" else module
        if payload.get("module") in ("scratch", "electronics", "auth", "portal", "system"):
            module = payload["module"]
        if payload.get("kind") == "client_diagnostic":
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
    return dict(id=hashlib.sha256((source + "\0" + identity).encode()).hexdigest(), time=at, source=source, module=module, level=level, message=message[:16384], requestId=request_id, revision=revision, origin=clean(origin), truncated=truncated)


class Collector:
    def __init__(self, root: Path, config: dict):
        self.root = root.resolve()
        self.config = config
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
            CREATE INDEX IF NOT EXISTS event_time ON events(time);
            CREATE INDEX IF NOT EXISTS event_unpublished ON events(published,seq);
            CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS sources(name TEXT PRIMARY KEY,payload TEXT);""")

    def state(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key: str, value):
        self.db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", (key, json.dumps(value)))

    def status(self, source: str, state: str, detail="", collected_through=None):
        previous = self.db.execute("SELECT payload FROM sources WHERE name=?", (source,)).fetchone()
        prior = json.loads(previous[0]) if previous else {}
        value = dict(source=source, state=state, checkedAt=now(), lastCollectedAt=now() if state == "ok" else prior.get("lastCollectedAt"), collectedThrough=collected_through or prior.get("collectedThrough"), detail=clean(str(detail))[:500])
        self.db.execute("INSERT OR REPLACE INTO sources VALUES(?,?)", (source, json.dumps(value)))

    def add(self, event):
        cutoff = (datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if event["time"] < cutoff: return
        self.db.execute("INSERT OR IGNORE INTO events(id,time,source,payload) VALUES(?,?,?,?)", (event["id"], event["time"], event["source"], json.dumps(event, ensure_ascii=False, separators=(",", ":"))))

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
            template = '{"Id":{{json .Id}},"Created":{{json .Created}},"Config":{"Labels":{{json .Config.Labels}}}}'
            inspected = [json.loads(line) for line in self.command(["docker", "inspect", "--format", template, *ids]).decode().splitlines()]
            canonical = next((c for c in inspected if c["Config"]["Labels"].get("com.docker.compose.service") == "postgres"), None)
            if not canonical:
                raise RuntimeError("Canonical PostgreSQL container is absent")
            actual = canonical["Config"]["Labels"].get("com.docker.compose.project.working_dir", "")
            if os.path.normcase(os.path.abspath(actual)) != os.path.normcase(str(self.root)):
                raise RuntimeError("Collector root differs from the canonical installation")
            self.postgres = canonical["Id"]
            for container in inspected:
                labels = container["Config"].get("Labels") or {}
                if labels.get("com.docker.compose.project.working_dir") != actual:
                    raise RuntimeError("Mixed installation roots; collection stopped")
                service = labels.get("com.docker.compose.service", "unknown")
                cid = container["Id"]
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
            if datetime.fromisoformat(since) >= datetime.now(UTC) - timedelta(seconds=120):
                since = cutoff.isoformat()
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
                self.status("database-events:" + table, "ok", "Periodic reconciliation of the retained interval", until)
            except Exception as exc:
                failures += 1
                self.set_state(key + ":span", max(1, span // 2))
                self.status("database-events:" + table, "error", str(exc))
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
                for file in path.rglob("*") if path.is_dir() else [path]:
                    if not file.is_file() or not re.search(r"\.log(?:\.|$)|\.out\.", file.name, re.I): continue
                    stat = file.stat()
                    if stat.st_mtime < cutoff: continue
                    key = "file:" + str(file.resolve())
                    previous = self.state(key, {"offset": 0, "head": "", "generation": uuid.uuid4().hex})
                    with file.open("rb") as stream:
                        head = hashlib.sha256(stream.read(min(128, stat.st_size))).hexdigest()
                        # An initially short, appended file has a changing head.
                        offset = previous["offset"] if previous["offset"] <= stat.st_size and (previous.get("headSize", 128) < 128 or previous["head"] == head) else 0
                        generation = previous.get("generation", uuid.uuid4().hex) if offset else uuid.uuid4().hex
                        stream.seek(offset)
                        data = stream.read(8 * 1024 * 1024)
                    consumed = data.rfind(b"\n") + 1
                    if not consumed and data:
                        # Preserve a complete non-newline file when the writer is idle.
                        consumed = len(data) if stat.st_mtime < time.time() - 10 and len(data) < 8 * 1024 * 1024 else 0
                    if not consumed and len(data) == 8 * 1024 * 1024:
                        raise RuntimeError(f"Oversized unterminated line in {file.name}; cursor preserved")
                    at = datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()
                    byte_offset = offset
                    for raw_line in data[:consumed].splitlines(keepends=True):
                        line = raw_line.decode("utf-8-sig", errors="replace").rstrip("\r\n")
                        match = re.match(r"(?:\[)?(\d{4}[-/]\d\d[-/]\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:\d\d)?)", line)
                        event_at = timestamp(match[1].replace("/", "-").replace(",", "."), at) if match else timestamp(at, at)
                        self.add(normalize(source, line, event_at, generation + ":" + str(byte_offset), file.name))
                        byte_offset += len(raw_line)
                    self.set_state(key, {"offset": offset + consumed, "head": head, "headSize": min(128, stat.st_size), "generation": generation})
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
                entry["truncated"] = event.get("truncated", False)
                self.add(entry)
            for status in value.get("sources", []): self.status("windows:" + status["channel"], status["state"], status.get("detail", ""), status.get("collectedThrough"))
            self.set_state("windows:cursors", value.get("cursors", {}))
            self.set_state("windows:last", time.time())
            self.status("windows", "ok", "Per-channel coverage and access limitations are listed separately")
        except Exception as exc:
            self.status("windows", "error", str(exc))

    def publish(self):
        self.db.commit()
        while True:
            fetched = self.db.execute("SELECT seq,payload FROM events WHERE published=0 ORDER BY seq LIMIT 1000").fetchall()
            rows = []
            byte_count = 0
            for row in fetched:
                size = len(row[1].encode("utf-8")) + 1
                if rows and byte_count + size > 1024 * 1024: break
                rows.append(row); byte_count += size
            if not rows: break
            name = f"seg-{rows[0][0]:016d}-{rows[-1][0]:016d}.jsonl"
            dest = self.store / name
            data = "\n".join(row[1] for row in rows) + "\n"
            temp = dest.with_suffix(".tmp")
            temp.write_text(data, encoding="utf-8")
            if os.name != "nt": os.chmod(temp, 0o640)
            os.replace(temp, dest)
            self.db.executemany("UPDATE events SET published=1 WHERE seq=?", [(r[0],) for r in rows])
            self.db.commit()
        cutoff = (datetime.now(UTC) - timedelta(days=self.config.get("retentionDays", 30))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        segments = []
        previous = self.state("segments", {})
        for file in sorted(self.store.glob("seg-*.jsonl")):
            meta = previous.get(file.name)
            if not meta:
                events = [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines()]
                meta = dict(file=file.name, bytes=file.stat().st_size, count=len(events), first=min(e["time"] for e in events), last=max(e["time"] for e in events), sources=sorted({e["source"] for e in events}), modules=sorted({e["module"] for e in events}), levels=sorted({e["level"] for e in events}))
            if meta["last"] < cutoff:
                file.unlink()
                start_seq, end_seq = map(int, file.stem.split("-")[1:])
                self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", (start_seq, end_seq))
            else:
                segments.append(meta)
        total = sum(s["bytes"] for s in segments)
        limit = self.config.get("maxBytes", 1024 * 1024 * 1024)
        trimmed = False
        while total > max(1024 * 1024, limit // 3) and segments:
            oldest = min(segments, key=lambda s: s["last"])
            (self.store / oldest["file"]).unlink()
            segments.remove(oldest)
            total -= oldest["bytes"]
            start_seq, end_seq = map(int, Path(oldest["file"]).stem.split("-")[1:])
            self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", (start_seq, end_seq))
            trimmed = True
        retained_first = min((s["first"] for s in segments), default=cutoff)
        self.db.execute("DELETE FROM events WHERE time < ?", (max(cutoff, retained_first),))
        self.set_state("segments", {s["file"]: s for s in segments})
        self.db.commit()
        # SQLite free pages are reused; a bound on retained segments is not claimed
        # as an exact bound on total disk use (the private index is also counted).
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if trimmed or self.state("vacuum:day") != datetime.now(UTC).date().isoformat():
            self.db.execute("VACUUM")
            self.set_state("vacuum:day", datetime.now(UTC).date().isoformat())
            self.db.commit()
        sources = [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM sources ORDER BY name")]
        if trimmed: self.set_state("trimmedAt", now()); self.db.commit()
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        storage_bytes = sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file())
        while storage_bytes > limit and segments:
            target = total * 0.9
            while segments and total > target:
                oldest = min(segments, key=lambda s: s["last"])
                (self.store / oldest["file"]).unlink()
                segments.remove(oldest)
                total -= oldest["bytes"]
                start_seq, end_seq = map(int, Path(oldest["file"]).stem.split("-")[1:])
                self.db.execute("DELETE FROM events WHERE seq BETWEEN ? AND ?", (start_seq, end_seq))
            self.set_state("segments", {s["file"]: s for s in segments})
            self.set_state("trimmedAt", now())
            self.db.commit()
            self.db.execute("VACUUM")
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            storage_bytes = sum(p.stat().st_size for p in self.base.rglob("*") if p.is_file())
        catalog = dict(version=1, collectedAt=now(), retentionDays=self.config.get("retentionDays", 30), maxBytes=limit, bytes=total, storageBytes=storage_bytes, trimmed=bool(self.state("trimmedAt")), sources=sources, segments=segments)
        temp = self.store / "catalog.tmp"
        temp.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
        if os.name != "nt": os.chmod(temp, 0o640)
        os.replace(temp, self.store / "catalog.json")

    def cycle(self):
        self.docker()
        self.files()
        self.database()
        self.windows()
        self.publish()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config_path = args.root / ".asa" / "log-collector.json"
    config = json.loads(config_path.read_text(encoding="utf-8-sig")) if config_path.exists() else {}
    installation = json.loads((args.root / ".asa" / "installation.json").read_text(encoding="utf-8-sig"))
    config.setdefault("project", installation["project"])
    for key, lower, upper in (("retentionDays", 1, 365), ("maxBytes", 16 * 1024 * 1024, 10 * 1024 * 1024 * 1024), ("intervalSeconds", 10, 300)):
        if key in config and (type(config[key]) is not int or not lower <= config[key] <= upper):
            raise SystemExit(f"Invalid collector setting: {key}")
    collector = Collector(args.root, config)
    script_version = Path(__file__).stat().st_mtime_ns
    # Only one collector may publish the installation's catalog at a time.
    lock = collector.private / "collector.lock"
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
    while True:
        try:
            collector.cycle()
        except Exception as exc:
            if sys.stderr: print(clean(f"Collector cycle failed: {exc}"), file=sys.stderr, flush=True)
            if args.once: raise
        if args.once: break
        if Path(__file__).stat().st_mtime_ns != script_version: break
        time.sleep(max(10, config.get("intervalSeconds", 20)))


if __name__ == "__main__":
    main()
