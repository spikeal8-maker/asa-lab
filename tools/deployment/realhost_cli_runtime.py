"""Bounded installed-guest CLI reads, independent of the guest harness.

Load this file and realhost_cli_checks.py by explicit, already trusted paths
(register each importlib module in sys.modules before exec_module under -I).
Pass that module's check_read_result and its FixtureContext to run_cli_suite.
No product module or caller working directory is imported. This module never
installs ASA, prepares fixtures, writes control data, or starts a mutation.

The control_snapshot(phase, deadline) callback must independently read DB/S3
control data, enforce its deadline, and return the five closed fields accepted
by _control. It runs outside the filesystem comparison window. A caller must
prepare expected pins, paths, owner UID and snapshot timestamp independently;
observed CLI answers are not a source of expected values.
"""
from __future__ import annotations

from dataclasses import dataclass
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time


ASA = "/usr/local/bin/asa"
REGISTRY = Path("/etc/asa-lab/commands.json")
OUTPUT_LIMIT = 1024 * 1024
FILE_LIMIT = 2 * 1024 * 1024
TOTAL_FILE_LIMIT = 64 * 1024 * 1024
FILE_COUNT_LIMIT = 1024
PROMPT = "Выбор: ".encode("utf-8")
MENU = "Меню: 1 — справка; 2 — диагностика; 3 — диски; 4 — проверка update; Enter — выход."
ERROR_CODES = frozenset({
    "RUNTIME_PLATFORM", "RUNTIME_EXPECTATIONS", "RUNTIME_TIMEOUT", "PROCESS_START",
    "PROCESS_OWNERSHIP", "PROCESS_CLEANUP", "PROCESS_TIMEOUT", "PROCESS_OUTPUT_LIMIT",
    "PROCESS_IO", "CLI_UTF8", "CLI_STDERR", "CLI_JSON", "CLI_SEMANTICS", "CLI_CHECKER",
    "BARE_OUTPUT", "BARE_EXIT", "PTY_PROMPT", "CONTROL_CALLBACK", "CONTROL_TIMEOUT",
    "CONTROL_PROJECTION", "CONTROL_CHANGED", "FILESYSTEM_PATH", "FILESYSTEM_PERMISSIONS",
    "FILESYSTEM_TYPE", "FILESYSTEM_LIMIT", "FILESYSTEM_CHANGED", "FILESYSTEM_MISSING",
    "FILESYSTEM_LAYOUT", "FILESYSTEM_READ", "FILESYSTEM_TIMEOUT", "UNEXPECTED_ERROR",
})
SEMANTIC_CODES = frozenset({
    "INVALID_CONTEXT", "UNSUPPORTED_COMMAND", "CLI_ENVELOPE", "FIELD_SET", "FIELD_TYPE",
    "FIELD_BOUNDS", "UNRECOGNIZED_REASON", "UNEXPECTED_STATE", "INSTALLATION_IDENTITY",
    "RELEASE_PIN_MISMATCH", "SCHEMA_MISMATCH", "SNAPSHOT_MISMATCH", "OPERATION_MISMATCH",
    "MEASUREMENT_INCONSISTENT", "HELP_CONTRACT",
})
REJECTION_FORMAT = "asa-realhost-cli-rejection-v1"
UPDATE_REJECTION_SECTIONS = frozenset({
    "UPDATE_ENVELOPE", "UPDATE_TARGET", "UPDATE_CURRENT", "UPDATE_CURRENT_DATABASE",
    "UPDATE_MIGRATIONS", "UPDATE_DISK", "UPDATE_SPACE", "UPDATE_BACKUP", "UPDATE_CLOUD",
})
REJECTION_STATUSES = frozenset({
    "OK", "RECORDED", "PLANNED", "BLOCKED", "FAILED", "UNAVAILABLE", "INTERRUPTED",
    "BLOCKED_PLAN", "NOT_CONFIGURED", "SCHEMA_RANGE_ONLY", "MEASURED_BACKUP_BUDGET",
})
# These are source literal observations, not accepted outcomes or a regex for
# arbitrary producer strings. A new/unknown reason remains UNRECOGNIZED.
REJECTION_REASONS = frozenset({
    "RELEASE", "RELEASE_UNAVAILABLE", "RELEASE_AUTH", "RELEASE_BUDGET", "RELEASE_DIGEST_MISMATCH",
    "RELEASE_JSON", "RELEASE_LAYER", "RELEASE_OCI", "RELEASE_PLATFORM", "RELEASE_REDIRECT",
    "RELEASE_SELECTOR", "RELEASE_SIZE", "CI_BLOCKED", "CI_UNAVAILABLE", "CLI_UNAVAILABLE",
    "USAGE", "INTERRUPTED", "INSTALLED_RELEASE_UNAVAILABLE", "CURRENT_SCHEMA_UNAVAILABLE",
    "SCHEMA_DOWNGRADE", "BACKUP_POLICY_UNAVAILABLE", "REQUIRED_CLOUD_TRANSPORT_UNAVAILABLE",
    "BACKUP_SPACE", "BACKUP_EVIDENCE_MISSING", "BACKUP_PATH", "CLOUD_NOT_CONFIGURED",
    "CLOUD_TRANSPORT_UNAVAILABLE", "NO_READ_ONLY_PROVIDER_PROBE", "POSTGRES_UNAVAILABLE",
    "POSTGRES_QUERY_UNAVAILABLE", "STORAGE_MEASUREMENT_UNAVAILABLE", "SPACE_MEASUREMENT_UNAVAILABLE",
    "SPACE", "FILESYSTEM_OR_ACCESS", "ROOT_REQUIRED", "DOCKER_DATA_ROOT", "STORAGE_MOUNT",
    "USE_DISK_HEALTH", "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME", "SCHEDULE_CONFIGURATION",
})
REJECTION_COMPONENTS = (
    "current", "currentDatabase", "migrations", "backupSpaceEstimate", "disk", "disk.database",
    "disk.filesystems.application", "disk.filesystems.backups", "disk.filesystems.docker",
    "disk.filesystems.postgres", "disk.filesystems.minio", "backup", "backup.lastAttempt",
    "backup.lastAttempt.local", "backup.lastAttempt.encryption", "backup.lastAttempt.cloud",
    "backup.lastLocalSuccess", "backup.lastLocalSuccess.local", "backup.lastLocalSuccess.encryption",
    "backup.lastLocalSuccess.cloud", "backup.lastCloudSuccess", "backup.schedule", "cloud",
    "cloud.transport", "cloud.remote", "cloud.lastDelivery",
)
READ_COMMANDS = (
    "version", "status", "doctor", "disk", "disk usage", "disk health", "services",
    "services status", "update", "update check", "update plan", "update history",
    "backup status", "backup list", "backup verify", "backup schedule", "cloud status",
    "config show", "history", "logs", "logs update", "logs backup", "restore plan",
)
HELP_FORMS = (
    ("help", ("help",), ""), ("help-option", ("--help",), ""),
    ("help-update", ("help", "update"), "update"),
    ("update-help-option", ("update", "--help"), "update"),
    ("backup-help-option", ("backup", "--help"), "backup"),
)
FIXED_FILES = (
    (".env", True, 256 * 1024), (".asa/setup.json", True, 256 * 1024),
    (".asa/installation.json", True, FILE_LIMIT),
    (".asa/runtime-configuration.json", False, FILE_LIMIT),
    (".asa/installed-release.json", True, FILE_LIMIT),
    (".asa/setup-last-attempt.json", True, FILE_LIMIT),
    (".asa/setup-last-successful.json", True, FILE_LIMIT),
)
JOURNAL_NAME = re.compile(r"[a-f0-9]{32}\.json\Z")
BACKUP_NAME = re.compile(
    r"(?:[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}|operation-[a-f0-9]{32}|last-attempt|last-local-success|last-cloud-success)\.json\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")


class CLIRuntimeError(RuntimeError):
    """Fixed-code exception; evidence never includes raw stdout or exception text."""

    def __init__(self, code, *, semantic_code=None, evidence=None):
        self.code = code if type(code) is str and code in ERROR_CODES else "UNEXPECTED_ERROR"
        self.semantic_code = semantic_code if type(semantic_code) is str and semantic_code in SEMANTIC_CODES else None
        self.evidence = evidence
        self.rejection_context = None
        super().__init__(self.code)


@dataclass(frozen=True)
class RuntimeExpectations:
    operator_uid: int
    last_local_snapshot_at: str


def _require(condition, code):
    if not condition:
        raise CLIRuntimeError(code)


def _linux():
    _require(sys.platform == "linux" and hasattr(os, "WNOWAIT"), "RUNTIME_PLATFORM")


def _deadline(deadline, code="RUNTIME_TIMEOUT"):
    _require(time.monotonic() < deadline, code)


def _absolute(value):
    _require(type(value) is str and len(value) <= 512 and re.fullmatch(r"/[A-Za-z0-9_./-]+", value)
             and all(part not in ("", ".", "..") for part in value.split("/")[1:]), "FILESYSTEM_PATH")
    return Path(value)


def _timestamp(value):
    _require(type(value) is str and len(value) <= 40, "RUNTIME_EXPECTATIONS")
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CLIRuntimeError("RUNTIME_EXPECTATIONS") from None
    _require(stamp.tzinfo is not None and stamp.utcoffset() == dt.timedelta(0), "RUNTIME_EXPECTATIONS")
    return stamp.isoformat()


def command_plan(context):
    """Return only fixed read/help argv; update observes stable without repinning."""
    _absolute(context.root)
    root = context.root  # Linux guest argv must not become WindowsPath text.
    _require(type(context.last_local_success) is str
             and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", context.last_local_success), "RUNTIME_EXPECTATIONS")
    restore = context.restore_snapshot_id
    _require(restore is None or type(restore) is str and restore in context.snapshot_ids, "RUNTIME_EXPECTATIONS")
    cases = []
    for label, words, topic in HELP_FORMS:
        cases.append((label, (ASA, *words, "--json", "--no-color"), "help", topic, 15))
    cases.append(("bare-json", (ASA, "--root", root, "--json", "--no-color"), "status", "", 90))
    for command in READ_COMMANDS:
        options = ("--snapshot-id", context.last_local_success) if command == "backup verify" else \
            ("--snapshot-id", restore) if command == "restore plan" and restore is not None else ()
        argv = (ASA, *command.split(), "--root", root, "--json", "--no-color", *options)
        seconds = 180 if command in ("update", "update check", "update plan") else 120 if command == "doctor" else 90
        cases.append((command.replace(" ", "-"), argv, command, "", seconds))
    return tuple(cases)


def _environment(tokens):
    result = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root",
              "USER": "root", "LOGNAME": "root", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
              "NO_COLOR": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    _require(tokens is None or type(tokens) is dict and tokens.keys() <= {"GH_TOKEN", "GITHUB_TOKEN"}, "RUNTIME_EXPECTATIONS")
    for name, token in (tokens or {}).items():
        _require(type(token) is str and 0 < len(token) <= 8192 and not any(ord(c) < 32 or ord(c) == 127 for c in token), "RUNTIME_EXPECTATIONS")
        result[name] = token
    return result


def _unreaped(process):
    # WNOWAIT keeps the owned leader's PID reserved until group cleanup. A
    # descendant retaining a pipe cannot turn a later killpg into a stale PID
    # signal after Popen.poll() has reaped and released the original leader.
    try:
        return os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except (OSError, ChildProcessError):
        raise CLIRuntimeError("PROCESS_OWNERSHIP") from None


def _finish_owned(process):
    _unreaped(process)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except OSError:
        raise CLIRuntimeError("PROCESS_CLEANUP") from None
    deadline = time.monotonic() + 1
    while _unreaped(process) is None and time.monotonic() < deadline:
        time.sleep(0.01)
    # The leader is still our unreaped child, including if it is a zombie.
    # Terminate remaining members of this same session/group before reaping it.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError:
        raise CLIRuntimeError("PROCESS_CLEANUP") from None
    try:
        return process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        raise CLIRuntimeError("PROCESS_CLEANUP") from None


def _run_process(argv, *, timeout, environment, terminal=False):
    """Private bounded capture. Tests may use a harmless child, never local ASA."""
    _linux()
    _require(type(timeout) in (int, float) and 0 < timeout <= 900, "RUNTIME_EXPECTATIONS")
    process, master, slave = None, None, None
    output, errors = bytearray(), bytearray()
    sent_enter = False
    reaped = False
    primary = None
    try:
        options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE}
        if terminal:
            master, slave = os.openpty()
            options = {"stdin": slave, "stdout": slave, "stderr": slave}
        try:
            process = subprocess.Popen(argv, cwd="/", env=environment, start_new_session=True,
                                       close_fds=True, bufsize=0, **options)
        except OSError:
            raise CLIRuntimeError("PROCESS_START") from None
        if slave is not None:
            os.close(slave)
            slave = None
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            streams = ((master, output),) if terminal else ((process.stdout.fileno(), output), (process.stderr.fileno(), errors))
            for descriptor, target in streams:
                os.set_blocking(descriptor, False)
                selector.register(descriptor, selectors.EVENT_READ, target)
            while selector.get_map() or _unreaped(process) is None:
                _deadline(deadline, "PROCESS_TIMEOUT")
                for key, _ in selector.select(min(0.05, max(0, deadline - time.monotonic()))):
                    try:
                        data = os.read(key.fd, 4096)
                    except OSError as error:
                        if terminal and error.errno == errno.EIO:
                            data = b""
                        elif error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                            continue
                        else:
                            raise CLIRuntimeError("PROCESS_IO") from None
                    if not data:
                        selector.unregister(key.fd)
                        continue
                    _require(len(output) + len(errors) + len(data) <= OUTPUT_LIMIT, "PROCESS_OUTPUT_LIMIT")
                    key.data.extend(data)
                    if terminal and not sent_enter and PROMPT in output:
                        _require(os.write(master, b"\n") == 1, "PROCESS_IO")
                        sent_enter = True
        code = _finish_owned(process)
        reaped = True
        return {"returncode": code, "stdout": bytes(output), "stderr": bytes(errors), "enterSent": sent_enter}
    except CLIRuntimeError as error:
        primary = error
        raise
    except Exception:
        primary = CLIRuntimeError("PROCESS_IO")
        raise primary from None
    finally:
        if process is not None and not reaped:
            try:
                _finish_owned(process)
            except CLIRuntimeError:
                if primary is None:
                    raise
        for stream in (() if process is None else (process.stdout, process.stderr)):
            if stream is not None:
                stream.close()
        for descriptor in (master, slave):
            if descriptor is not None:
                os.close(descriptor)


def _utf8(raw):
    _require(type(raw) is bytes and len(raw) <= OUTPUT_LIMIT, "CLI_UTF8")
    try:
        value = raw.decode("utf-8")
    except UnicodeError:
        raise CLIRuntimeError("CLI_UTF8") from None
    _require("\x1b" not in value and "\x00" not in value, "CLI_UTF8")
    return value


def _json_result(captured):
    _require(type(captured) is dict and type(captured.get("returncode")) is int, "CLI_CHECKER")
    _require(captured.get("stderr") == b"", "CLI_STDERR")
    text = _utf8(captured.get("stdout"))
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "CLI_JSON")
            result[key] = value
        return result
    def constant(_value):
        raise CLIRuntimeError("CLI_JSON")
    try:
        document = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, RecursionError):
        raise CLIRuntimeError("CLI_JSON") from None
    _require(type(document) is dict, "CLI_JSON")
    return document


def _bare(captured, context, expectations, *, terminal):
    _require(type(captured.get("returncode")) is int and captured["returncode"] == 0, "BARE_EXIT")
    _require(captured.get("stderr") == b"", "CLI_STDERR")
    text = _utf8(captured.get("stdout")).replace("\r\n", "\n")
    _require("\r" not in text and len(text) <= 8192, "BARE_OUTPUT")
    lines = text.splitlines()
    _require(len(lines) == (10 if terminal else 7), "BARE_OUTPUT")
    expected_lines = (
        "ASA Lab · OK", "Установка: " + context.root,
        "CLI: 1.0.0 · записанный выпуск: " + context.installed.revision,
        "PostgreSQL сейчас: " + str(context.installed.schema),
    )
    _require(tuple(lines[:4]) == expected_lines, "BARE_OUTPUT")
    match = re.fullmatch(r"Сервисы: OK · healthy 6/([678])", lines[4])
    _require(match is not None, "BARE_OUTPUT")
    _require(lines[5] == "Последняя локальная копия: " + expectations.last_local_snapshot_at + " · RECORDED"
             and lines[6] == "Справка: asa help · подробности: asa status · безопасная проверка: asa update", "BARE_OUTPUT")
    if terminal:
        _require(captured.get("enterSent") is True and lines[7:] == ["", MENU, "Выбор: "], "PTY_PROMPT")
    else:
        _require(captured.get("enterSent") is False, "BARE_OUTPUT")
    return {"status": "OK", "exitCode": 0, "mode": "PTY" if terminal else "PIPE",
            "stdin": "ENTER_AFTER_PROMPT" if terminal else "CLOSED", "menuObserved": terminal,
            "root": context.root, "revision": context.installed.revision, "schema": context.installed.schema,
            "healthyServices": 6, "containers": int(match.group(1)),
            "lastLocalSnapshotAt": expectations.last_local_snapshot_at, "compactLines": 7}


def _metadata(info):
    # atime is deliberately excluded: reading these files may advance it.
    return (info.st_dev, info.st_ino, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _open_control(path, base, uid, *, directory=False, public=False, executable=False):
    path, base = _absolute(str(path)), _absolute(str(base))
    _require(path.is_relative_to(base), "FILESYSTEM_PATH")
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        current = Path("/")
        for index, part in enumerate(path.parts[1:]):
            current /= part
            is_directory = directory or index < len(path.parts) - 2
            child = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if is_directory else 0), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            inside = current.is_relative_to(base)
            expected_uid = uid if inside else 0
            _require(info.st_uid == expected_uid, "FILESYSTEM_PERMISSIONS")
            if is_directory:
                sticky_ancestor = not inside and info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
                _require(stat.S_ISDIR(info.st_mode), "FILESYSTEM_TYPE")
                _require(not info.st_mode & 0o022 or sticky_ancestor, "FILESYSTEM_PERMISSIONS")
                _require(not inside or current == base or public or not info.st_mode & 0o077, "FILESYSTEM_PERMISSIONS")
            else:
                _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "FILESYSTEM_TYPE")
                expected_mode = 0o755 if executable else 0o644 if public else 0o600
                _require(stat.S_IMODE(info.st_mode) == expected_mode, "FILESYSTEM_PERMISSIONS")
        result, descriptor = descriptor, None
        return result
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _verify_executable():
    # Registry ownership alone must not authorize a user-writable root exec.
    # The caller separately attests the candidate registration/bundle identity.
    try:
        descriptor = _open_control(Path(ASA), Path("/usr/local/bin"), 0, public=True, executable=True)
    except CLIRuntimeError:
        raise
    except OSError:
        raise CLIRuntimeError("PROCESS_START") from None
    os.close(descriptor)


def _snapshot_controls(root, uid, *, registry=REGISTRY, registry_uid=0):
    """Hash only bounded control files. Optional registry args are test seams."""
    _linux()
    root, registry = _absolute(str(root)), _absolute(str(registry))
    _require(type(uid) is int and uid >= 0 and type(registry_uid) is int and registry_uid >= 0, "FILESYSTEM_PERMISSIONS")
    deadline = time.monotonic() + 15
    records, file_count, directory_count, byte_count, absent_count = [], 0, 0, 0, 0
    def file(path, key, *, required=True, maximum=FILE_LIMIT, public=False):
        nonlocal file_count, byte_count, absent_count
        _deadline(deadline, "FILESYSTEM_TIMEOUT")
        try:
            descriptor = _open_control(path, registry.parent if public else root, registry_uid if public else uid, public=public)
        except FileNotFoundError:
            _require(not required, "FILESYSTEM_MISSING")
            records.append((key, "ABSENT"))
            absent_count += 1
            return
        try:
            before = os.fstat(descriptor)
            file_count += 1
            byte_count += before.st_size
            _require(0 <= before.st_size <= maximum and file_count <= FILE_COUNT_LIMIT
                     and byte_count <= TOTAL_FILE_LIMIT, "FILESYSTEM_LIMIT")
            digest, remaining = hashlib.sha256(), before.st_size
            while remaining:
                _deadline(deadline, "FILESYSTEM_TIMEOUT")
                chunk = os.read(descriptor, min(65536, remaining))
                _require(bool(chunk), "FILESYSTEM_CHANGED")
                digest.update(chunk)
                remaining -= len(chunk)
            _require(_metadata(before) == _metadata(os.fstat(descriptor)), "FILESYSTEM_CHANGED")
            records.append((key, "FILE", _metadata(before), digest.hexdigest()))
        finally:
            os.close(descriptor)
    def directory(path, key, pattern=None, *, optional=False, retention=False):
        nonlocal directory_count, absent_count
        _deadline(deadline, "FILESYSTEM_TIMEOUT")
        try:
            descriptor = _open_control(path, root, uid, directory=True)
        except FileNotFoundError:
            _require(optional, "FILESYSTEM_MISSING")
            records.append((key, "ABSENT"))
            absent_count += 1
            return
        try:
            before = os.fstat(descriptor)
            directory_count += 1
            if pattern is not None:
                entries = []
                with os.scandir(descriptor) as iterator:
                    for index, item in enumerate(iterator):
                        _deadline(deadline, "FILESYSTEM_TIMEOUT")
                        _require(index < 512, "FILESYSTEM_LIMIT")
                        _require(pattern.fullmatch(item.name) is not None or retention and item.name == "retention", "FILESYSTEM_LAYOUT")
                        entries.append(item.name)
                for name in sorted(entries):
                    if retention and name == "retention":
                        directory(path / name, key + "/retention", JOURNAL_NAME)
                    else:
                        file(path / name, key + "/" + name)
            _require(_metadata(before) == _metadata(os.fstat(descriptor)), "FILESYSTEM_CHANGED")
            records.append((key, "DIRECTORY", _metadata(before)))
        finally:
            os.close(descriptor)
    try:
        directory(root, "root")
        directory(root / ".asa", "state")
        for relative, required, maximum in FIXED_FILES:
            file(root / relative, relative, required=required, maximum=maximum)
        file(registry, "registry", public=True, maximum=256 * 1024)
        directory(root / ".asa/setup-operations", "operations", JOURNAL_NAME)
        directory(root / ".asa/setup-backups", "backups", BACKUP_NAME, retention=True)
        combined = hashlib.sha256(json.dumps(sorted(records), separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
        return {"files": file_count, "directories": directory_count, "absent": absent_count, "sha256": combined}
    except CLIRuntimeError:
        raise
    except FileNotFoundError:
        raise CLIRuntimeError("FILESYSTEM_MISSING") from None
    except OSError:
        raise CLIRuntimeError("FILESYSTEM_READ") from None


def _control(value):
    fields = {"databaseSha256", "databaseRows", "objectsSha256", "objectCount", "objectBytes"}
    _require(type(value) is dict and value.keys() == fields, "CONTROL_PROJECTION")
    for name in ("databaseSha256", "objectsSha256"):
        _require(type(value[name]) is str and HEX64.fullmatch(value[name]) is not None, "CONTROL_PROJECTION")
    for name in ("databaseRows", "objectCount", "objectBytes"):
        _require(type(value[name]) is int and 0 <= value[name] <= 2 ** 63 - 1, "CONTROL_PROJECTION")
    return {"databaseSha256": value["databaseSha256"], "databaseRows": value["databaseRows"],
            "objectsSha256": value["objectsSha256"], "objectCount": value["objectCount"], "objectBytes": value["objectBytes"]}


def _control_call(callback, phase, deadline):
    local_deadline = min(deadline, time.monotonic() + 60)
    _deadline(local_deadline, "CONTROL_TIMEOUT")
    try:
        result = callback(phase, local_deadline)
    except Exception:
        raise CLIRuntimeError("CONTROL_CALLBACK") from None
    _deadline(local_deadline, "CONTROL_TIMEOUT")
    return _control(result)


def _rejection_value(document, key, allowed, output):
    if key not in document:
        return {"state": "MISSING"}
    value = document[key]
    if value is None:
        return {"state": "NULL"}
    if type(value) is str and value in allowed:
        return {"state": "RECOGNIZED", output: value}
    return {"state": "UNRECOGNIZED"}


def _rejection_component(document, path):
    value = document
    for key in path.split("."):
        if type(value) is not dict:
            return {"state": "UNAVAILABLE"}
        if key not in value:
            return {"state": "MISSING"}
        value = value[key]
    if value is None:
        return {"state": "NULL"}
    if type(value) is not dict:
        return {"state": "UNRECOGNIZED"}
    return {"state": "OBSERVED", "status": _rejection_value(value, "status", REJECTION_STATUSES, "value"),
            "reason": _rejection_value(value, "reasonCode", REJECTION_REASONS, "code")}


def _rejection_context(command, document, returncode, section):
    """Closed observation of this parsed stdout, never acceptance or receipt proof."""
    if not (type(command) is str and command in ("update", "update check", "update plan")
            and type(document) is dict and document.get("format") == "asa-cli-result-v1"
            and document.get("command") == command and type(returncode) is int and returncode in (0, 1, 2)
            and type(document.get("exitCode")) is int and document["exitCode"] == returncode):
        return {"format": REJECTION_FORMAT, "status": "UNAVAILABLE", "reasonCode": "REJECTION_BINDING"}
    return {"format": REJECTION_FORMAT, "status": "OBSERVED", "binding": "CAPTURED_RESPONSE",
            "command": command, "actualExitCode": returncode,
            "section": section if type(section) is str and section in UPDATE_REJECTION_SECTIONS else "UNAVAILABLE",
            "publicStatus": _rejection_value(document, "status", REJECTION_STATUSES, "value"),
            "publicReason": _rejection_value(document, "reasonCode", REJECTION_REASONS, "code"),
            "components": {path: _rejection_component(document, path) for path in REJECTION_COMPONENTS}}


def _checked(checker, command, captured, context, topic):
    document = _json_result(captured)
    try:
        result = checker(command, document, returncode=captured["returncode"], expected=context, help_topic=topic)
    except Exception as error:
        failure = CLIRuntimeError("CLI_SEMANTICS", semantic_code=getattr(error, "code", None))
        if command in ("update", "update check", "update plan"):
            try:
                failure.rejection_context = _rejection_context(command, document, captured["returncode"], getattr(error, "section", None))
            except Exception:
                failure.rejection_context = {"format": REJECTION_FORMAT, "status": "UNAVAILABLE", "reasonCode": "REJECTION_PROJECTION"}
        raise failure from None
    _require(type(result) is dict and result.get("format") == "asa-cli-result-v1" and result.get("command") == command
             and type(result.get("exitCode")) is int and result["exitCode"] == captured["returncode"]
             and result.get("status") in ("OK", "RECORDED", "PLANNED", "UNAVAILABLE", "BLOCKED_PLAN"), "CLI_CHECKER")
    return result


def run_cli_suite(context, expectations, *, checker, control_snapshot, tokens=None, timeout=900):
    """Run all read forms and raise CLIRuntimeError with closed partial evidence.

    Hooks must respect their supplied monotonic deadline. A containing guest
    harness should retain its outer process timeout as the final callback guard.
    This function performs no fixture setup and must be called outside any
    backup write freeze. The checker must come from the trusted pinned helper.
    """
    _linux()
    _require(type(expectations) is RuntimeExpectations and type(expectations.operator_uid) is int
             and expectations.operator_uid > 0 and callable(checker) and callable(control_snapshot)
             and type(timeout) in (int, float) and 0 < timeout <= 1800, "RUNTIME_EXPECTATIONS")
    _require(_timestamp(expectations.last_local_snapshot_at) == expectations.last_local_snapshot_at, "RUNTIME_EXPECTATIONS")
    environment, plan = _environment(tokens), command_plan(context)
    deadline = time.monotonic() + timeout
    evidence = {"format": "asa-realhost-cli-runtime-v1", "status": "FAIL", "cases": [], "examples": {}, "observations": {},
                "bare": {}, "filesystem": {"status": "NOT_RUN"}, "control": {"status": "NOT_RUN"}}
    before_control, before_files = None, None
    primary, current = None, "control-before"
    try:
        before_control = _control_call(control_snapshot, "before", deadline)
        current = "filesystem-before"
        before_files = _snapshot_controls(context.root, expectations.operator_uid)
        current = "command-trust"
        _verify_executable()
        for label, argv, command, topic, seconds in plan:
            current = label
            _deadline(deadline)
            captured = _run_process(argv, timeout=min(seconds, deadline - time.monotonic()), environment=environment)
            checked = _checked(checker, command, captured, context, topic)
            evidence["cases"].append({"case": label, "command": command, "status": checked["status"], "exitCode": checked["exitCode"]})
            if label in ("help", "help-update", "status", "disk", "update-check"):
                evidence["examples"][label] = checked
            if label in ("doctor", "disk-health", "cloud-status", "restore-plan", "backup-status", "backup-list", "backup-verify", "config-show", "history", "logs"):
                evidence["observations"][label] = checked
        argv = (ASA, "--root", context.root, "--no-color")
        for terminal in (False, True):
            current = "bare-pty" if terminal else "bare-pipe"
            _deadline(deadline)
            captured = _run_process(argv, timeout=min(120, deadline - time.monotonic()), environment=environment, terminal=terminal)
            evidence["bare"]["pty" if terminal else "pipe"] = _bare(captured, context, expectations, terminal=terminal)
    except CLIRuntimeError as error:
        primary = error
    except Exception:
        primary = CLIRuntimeError("UNEXPECTED_ERROR")
    if before_files is not None:
        try:
            after_files = _snapshot_controls(context.root, expectations.operator_uid)
            unchanged = before_files == after_files
            evidence["filesystem"] = {"status": "UNCHANGED" if unchanged else "CHANGED", "unchanged": unchanged,
                                      "before": before_files, "after": after_files}
            _require(unchanged, "FILESYSTEM_CHANGED")
        except CLIRuntimeError as error:
            if evidence["filesystem"]["status"] == "NOT_RUN":
                evidence["filesystem"] = {"status": "UNAVAILABLE", "reasonCode": error.code}
            if primary is None:
                primary, current = error, "filesystem-after"
    if before_control is not None:
        try:
            after_control = _control_call(control_snapshot, "after", deadline)
            unchanged = before_control == after_control
            evidence["control"] = {"status": "UNCHANGED" if unchanged else "CHANGED", "unchanged": unchanged,
                                   "before": before_control, "after": after_control}
            _require(unchanged, "CONTROL_CHANGED")
        except CLIRuntimeError as error:
            if evidence["control"]["status"] == "NOT_RUN":
                evidence["control"] = {"status": "UNAVAILABLE", "reasonCode": error.code}
            if primary is None:
                primary, current = error, "control-after"
    if primary is not None:
        evidence["reasonCode"], evidence["failedCase"] = primary.code, current
        if primary.semantic_code is not None:
            evidence["semanticCode"] = primary.semantic_code
        if primary.rejection_context is not None:
            evidence["rejectionContext"] = primary.rejection_context
        primary.evidence = evidence
        raise primary
    evidence["status"] = "PASS"
    return evidence
