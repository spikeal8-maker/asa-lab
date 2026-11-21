#!/usr/bin/env python3
"""Execute every mandatory test registered for one ASA Lab task."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATHS = (
    ROOT / "docs/testing/test-catalog.yaml",
    ROOT / "docs/testing/active-task-tests.yaml",
)
TASK_ID_PATTERN = re.compile(r"^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
BLOCKED_EXIT_CODE = 78
OUTPUT_TAIL_LINES = 20
OUTPUT_DRAIN_SECONDS = 1


class WindowsJob:
    """Own a suspended launch before any command code can create descendants.

    Unnamed, non-inheritable handle; children inherit membership, not the handle.
    No breakaway limits are enabled. Closing the last handle kills only this job.
    https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
    """
    def __init__(self):
        import ctypes
        from ctypes import wintypes as w
        self.ctypes = ctypes
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        self.handle = None
        size = ctypes.c_size_t
        class BasicLimits(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                        ('flags', w.DWORD), ('min_working', size), ('max_working', size),
                        ('active_limit', w.DWORD), ('affinity', size),
                        ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]
        class ExtendedLimits(ctypes.Structure):
            _fields_ = [('basic', BasicLimits), ('io', IoCounters), ('process_memory', size),
                        ('job_memory', size), ('peak_process_memory', size), ('peak_job_memory', size)]
        class ThreadEntry(ctypes.Structure):
            _fields_ = [('dwSize', w.DWORD), ('cntUsage', w.DWORD), ('thread_id', w.DWORD),
                        ('owner_pid', w.DWORD), ('base_priority', w.LONG),
                        ('delta_priority', w.LONG), ('flags', w.DWORD)]
        self.ThreadEntry = ThreadEntry
        signatures = {
            'CreateJobObjectW': ([w.LPVOID, w.LPCWSTR], w.HANDLE),
            'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD], w.BOOL),
            'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
            'TerminateJobObject': ([w.HANDLE, w.UINT], w.BOOL),
            'CloseHandle': ([w.HANDLE], w.BOOL),
            'CreateToolhelp32Snapshot': ([w.DWORD, w.DWORD], w.HANDLE),
            'Thread32First': ([w.HANDLE, ctypes.POINTER(ThreadEntry)], w.BOOL),
            'Thread32Next': ([w.HANDLE, ctypes.POINTER(ThreadEntry)], w.BOOL),
            'OpenThread': ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            'ResumeThread': ([w.HANDLE], w.DWORD),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.api, name)
            function.argtypes, function.restype = arguments, result
        handle = self.api.CreateJobObjectW(None, None)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.handle = handle
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign_and_resume(self, process):
        ctypes = self.ctypes
        if not self.api.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())
        # Popen closes CreateProcess's primary-thread handle. The process is still
        # suspended, so enumerate only the exact owned PID and require one thread.
        snapshot = self.api.CreateToolhelp32Snapshot(0x4, 0)  # TH32CS_SNAPTHREAD
        if snapshot == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            entry = self.ThreadEntry()
            entry.dwSize = ctypes.sizeof(entry)
            thread_ids = []
            found = self.api.Thread32First(snapshot, ctypes.byref(entry))
            while found:
                if entry.owner_pid == process.pid:
                    thread_ids.append(entry.thread_id)
                found = self.api.Thread32Next(snapshot, ctypes.byref(entry))
            if len(thread_ids) != 1:
                raise OSError('cannot identify the suspended owned primary thread')
            thread = self.api.OpenThread(0x2, False, thread_ids[0])  # THREAD_SUSPEND_RESUME
            if not thread:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if self.api.ResumeThread(thread) != 1:
                    raise OSError('owned primary thread did not resume from exactly one suspension')
            finally:
                self.api.CloseHandle(thread)
        finally:
            self.api.CloseHandle(snapshot)

    def terminate(self):
        if self.handle and not self.api.TerminateJobObject(self.handle, 1):
            raise self.ctypes.WinError(self.ctypes.get_last_error())

    def close(self):
        if self.handle:
            if not self.api.CloseHandle(self.handle):
                raise self.ctypes.WinError(self.ctypes.get_last_error())
            self.handle = None


def stop_and_drain(process, job, *, owned: bool) -> list[str]:
    """Never wait indefinitely for an exited launcher's inherited pipe writers."""
    errors = []
    if job:
        try:
            job.terminate()
        except OSError as exc:
            errors.append(f'job termination: {exc}')
    if process is not None:
        try:
            if owned and os.name != 'nt':
                # The group outlives its launcher and remains our new session.
                os.killpg(process.pid, signal.SIGKILL)
            elif process.poll() is None:
                # Also covers assignment failure: the own launcher is suspended
                # and has never been allowed to execute or create descendants.
                process.kill()
        except ProcessLookupError:
            pass
        except OSError as exc:
            errors.append(f'owned launcher termination: {exc}')
    if job:
        try:
            job.close()  # kill-on-close is also a fallback for termination failure
        except OSError as exc:
            errors.append(f'job close: {exc}')
    if process is not None:
        try:
            process.communicate(timeout=OUTPUT_DRAIN_SECONDS)
        except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
            errors.append(f'bounded output drain did not finish: {type(exc).__name__}')
            # Windows Popen reader threads are daemon threads. Do NOT close their
            # buffered streams here: a synchronous close can wait on a reader's
            # lock forever. No unbounded wait/join/communicate follows this path.
    return errors


def git_value(args: list[str]) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, check=True, text=True, capture_output=True).stdout.strip() or "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def working_tree_state() -> str:
    try:
        output = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, check=True, text=True, capture_output=True).stdout
        return "dirty" if output.strip() else "clean"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def load_catalogs() -> tuple[list[dict[str, Any]], list[str]]:
    tests: list[dict[str, Any]] = []
    loaded: list[str] = []
    for path in CATALOG_PATHS:
        if not path.is_file():
            if path == CATALOG_PATHS[0]:
                raise SystemExit(f"Missing test catalog: {path}")
            continue
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or not isinstance(document.get("tests"), list):
            raise SystemExit(f"Malformed test catalog: {path}")
        tests.extend(test for test in document["tests"] if isinstance(test, dict))
        loaded.append(str(path.relative_to(ROOT)))
    return tests, loaded


def tail(text: str) -> str:
    lines = text.splitlines()
    return "\n".join(lines[-OUTPUT_TAIL_LINES:])


def run_test(test: dict[str, Any], task_id: str, *, python_executable: str | None = None,
             root: Path | None = None) -> dict[str, Any]:
    test_id = str(test.get("id", "unknown"))
    command = str(test.get("command", "")).strip()
    timeout = test.get("timeout_seconds")
    timeout_value = timeout if isinstance(timeout, int) and not isinstance(timeout, bool) else 600
    record: dict[str, Any] = {"id": test_id, "command": command, "state": "NOT_RUN", "exit_code": None, "duration_s": 0.0, "reason": ""}
    if not command:
        record.update(state="BLOCKED", reason="empty command")
        return record
    try:
        # Catalog commands use the same POSIX quoting grammar as their validator.
        # In selected-interpreter mode, strip quote syntax before passing argv to
        # Python. shlex(posix=False) retains quotes and can turn `-c` into a no-op.
        parts = shlex.split(command, posix=True if python_executable else os.name != "nt")
    except ValueError as exc:
        record.update(state="BLOCKED", reason=f"cannot tokenize command: {exc}")
        return record
    executable = parts[0] if parts else ""
    selected_python = python_executable is not None and executable in {"python", "python3"}
    if selected_python:
        if not Path(python_executable).is_absolute():
            record.update(state="BLOCKED", reason="selected Python must be absolute")
            return record
        parts[0] = python_executable
        executable = python_executable
    if shutil.which(executable) is None:
        record.update(state="BLOCKED", reason=f"executable not available: {executable}")
        return record
    start = time.monotonic()
    process = None
    job = None
    try:
        arguments = parts if selected_python or os.name != "nt" else command
        environment = {**os.environ, "ASA_TASK_ID": task_id, "ASA_TEST_ID": test_id}
        if python_executable:
            environment.update(ASA_PYTHON=python_executable, PYTHON=python_executable,
                               PYTHONUTF8="1", PYTHONIOENCODING="utf-8", NX_SKIP_NX_CACHE="true",
                               NX_DAEMON="false")
            record["python_executable"] = python_executable
        if os.name == 'nt' and python_executable:
            job = WindowsJob()
        process = subprocess.Popen(
            arguments,
            cwd=root or ROOT,
            text=True,
            encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            shell=os.name == "nt" and not selected_python,
            env=environment,
            start_new_session=os.name != "nt" and python_executable is not None,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | 0x4) if os.name == "nt" and python_executable else 0,
        )
        if job:
            job.assign_and_resume(process)
        stdout, stderr = process.communicate(timeout=timeout_value)
        completed = subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        errors = stop_and_drain(process, job, owned=python_executable is not None)
        record.update(state="FAIL", reason=f"timeout after {timeout_value}s" + (f'; {"; ".join(errors)}' if errors else ''), duration_s=round(time.monotonic() - start, 3))
        return record
    except (OSError, ValueError) as exc:
        errors = stop_and_drain(process, job, owned=python_executable is not None)
        record.update(state="BLOCKED", reason=f"cannot execute {executable}: {exc}" + (f'; {"; ".join(errors)}' if errors else ''), duration_s=round(time.monotonic() - start, 3))
        return record
    except BaseException:
        stop_and_drain(process, job, owned=python_executable is not None)
        raise
    cleanup_error = None
    if job:
        try:
            job.close()
        except OSError as exc:
            cleanup_error = str(exc)
            errors = stop_and_drain(process, job, owned=True)
            if errors:
                cleanup_error += '; ' + '; '.join(errors)
    record["duration_s"] = round(time.monotonic() - start, 3)
    record["exit_code"] = completed.returncode
    record["stdout_tail"] = tail(completed.stdout)
    record["stderr_tail"] = tail(completed.stderr)
    if completed.returncode == 0:
        record["state"] = "PASS"
    elif completed.returncode == BLOCKED_EXIT_CODE:
        record["state"] = "BLOCKED"
        record["reason"] = next((line for line in completed.stderr.splitlines() if line.strip()), "required environment unavailable")
    else:
        record["state"] = "FAIL"
        record["reason"] = f"exit code {completed.returncode}"
    if cleanup_error:
        record['reason'] += f'; job cleanup failed: {cleanup_error}'
        if record['state'] != 'FAIL':
            record['state'] = 'BLOCKED'
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", required=True)
    parser.add_argument("--json")
    args = parser.parse_args()
    task_id = args.task.strip()
    if not TASK_ID_PATTERN.fullmatch(task_id):
        print(f"Invalid task id: {task_id!r}", file=sys.stderr)
        return 2
    tests, catalogs = load_catalogs()
    selected = sorted(
        (test for test in tests if task_id in (test.get("required_for") or [])),
        key=lambda test: str(test.get("id")),
    )
    results = [run_test(test, task_id) for test in selected]
    passed = sum(item["state"] == "PASS" for item in results)
    failed = sum(item["state"] == "FAIL" for item in results)
    blocked = sum(item["state"] == "BLOCKED" for item in results)
    not_run = sum(item["state"] == "NOT_RUN" for item in results)
    gate = "NO_TESTS" if not results else "FAIL" if failed or not_run else "BLOCKED" if blocked else "PASS"
    report = {
        "task": task_id,
        "commit": git_value(["rev-parse", "HEAD"]),
        "branch": git_value(["rev-parse", "--abbrev-ref", "HEAD"]),
        "working_tree": working_tree_state(),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "catalogs": catalogs,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "blocked": blocked,
        "not_run": not_run,
        "gate": gate,
        "results": results,
    }
    print("ASA Lab local task test report")
    print(f"  task           : {task_id}")
    print(f"  commit         : {report['commit']}")
    print(f"  branch         : {report['branch']}")
    print(f"  working_tree   : {report['working_tree']}")
    print(f"  catalogs       : {', '.join(catalogs)}")
    print(f"  mandatory tests: {len(results)}\n")
    for item in results:
        exit_code = item["exit_code"] if item["exit_code"] is not None else "-"
        reason = f" reason={item['reason']}" if item["reason"] else ""
        print(f"  {item['id']:<32} {item['state']:<8} exit={exit_code} duration={item['duration_s']}s{reason}")
        print(f"      command: {item['command']}")
    print(f"\n  GATE: {gate} (PASS={passed} FAIL={failed} BLOCKED={blocked} NOT_RUN={not_run} / {len(results)})")
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not results:
        print(f"No mandatory tests registered for {task_id}", file=sys.stderr)
        return 2
    return 0 if gate == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
