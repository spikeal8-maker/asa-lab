#!/usr/bin/env python3
"""Unified local task test runner for ASA Lab.

Reads ``docs/testing/test-catalog.yaml``, selects the mandatory tests of a task
(every test whose ``required_for`` contains the task id), actually executes each
registered command and prints a verifiable report bound to the current git
commit SHA.

Result states follow the catalog contract: PASS, FAIL, NOT_RUN, BLOCKED.
A state is never reported as PASS unless the command was actually executed and
returned exit code 0. The process exit code is 0 only when every selected
mandatory test is PASS.

Usage:
    python tools/run_task_tests.py --task TASK-PORTAL-001
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
TASK_ID_PATTERN = re.compile(r"^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
OUTPUT_TAIL_LINES = 20
# EX_CONFIG (sysexits.h): a command uses this to signal that a required
# environment is unavailable, which the runner records as BLOCKED.
BLOCKED_EXIT_CODE = 78


def git_value(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return result.stdout.strip() or "unknown"


def working_tree_state() -> str:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return "dirty" if result.stdout.strip() else "clean"


def load_catalog() -> dict[str, Any]:
    if not CATALOG_PATH.is_file():
        raise SystemExit(f"Missing test catalog: {CATALOG_PATH}")
    document = yaml.safe_load(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("tests"), list):
        raise SystemExit("Test catalog is malformed: missing tests array")
    return document


def select_tests(catalog: dict[str, Any], task_id: str) -> list[dict[str, Any]]:
    selected = [
        test
        for test in catalog["tests"]
        if isinstance(test, dict) and task_id in (test.get("required_for") or [])
    ]
    return sorted(selected, key=lambda test: str(test.get("id")))


def tail(text: str) -> str:
    lines = text.splitlines()
    if len(lines) <= OUTPUT_TAIL_LINES:
        return "\n".join(lines)
    return "\n".join(lines[-OUTPUT_TAIL_LINES:])


def run_test(test: dict[str, Any], task_id: str) -> dict[str, Any]:
    test_id = str(test.get("id"))
    command = str(test.get("command", "")).strip()
    timeout = test.get("timeout_seconds")
    timeout_value = timeout if isinstance(timeout, int) and not isinstance(timeout, bool) else 600

    record: dict[str, Any] = {
        "id": test_id,
        "command": command,
        "state": "NOT_RUN",
        "exit_code": None,
        "duration_s": 0.0,
        "reason": "",
    }

    if not command:
        record["state"] = "BLOCKED"
        record["reason"] = "empty command"
        return record

    try:
        parts = shlex.split(command, posix=os.name != "nt")
    except ValueError as exc:
        record["state"] = "BLOCKED"
        record["reason"] = f"cannot tokenize command: {exc}"
        return record

    executable = parts[0] if parts else ""
    if shutil.which(executable) is None:
        record["state"] = "BLOCKED"
        record["reason"] = f"executable not available: {executable}"
        return record

    on_windows = os.name == "nt"
    run_target: Any = command if on_windows else parts
    child_env = {**os.environ, "ASA_TASK_ID": task_id, "ASA_TEST_ID": test_id}

    start = time.monotonic()
    try:
        completed = subprocess.run(
            run_target,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=timeout_value,
            shell=on_windows,
            env=child_env,
        )
    except FileNotFoundError:
        record["state"] = "BLOCKED"
        record["reason"] = f"executable not available: {executable}"
        record["duration_s"] = round(time.monotonic() - start, 3)
        return record
    except subprocess.TimeoutExpired:
        record["state"] = "FAIL"
        record["reason"] = f"timeout after {timeout_value}s"
        record["duration_s"] = round(time.monotonic() - start, 3)
        return record

    record["duration_s"] = round(time.monotonic() - start, 3)
    record["exit_code"] = completed.returncode
    record["stdout_tail"] = tail(completed.stdout)
    record["stderr_tail"] = tail(completed.stderr)
    if completed.returncode == 0:
        record["state"] = "PASS"
    elif completed.returncode == BLOCKED_EXIT_CODE:
        record["state"] = "BLOCKED"
        first_stderr_line = next(
            (line for line in completed.stderr.splitlines() if line.strip()), ""
        )
        record["reason"] = first_stderr_line or "required environment unavailable"
    else:
        record["state"] = "FAIL"
        record["reason"] = f"exit code {completed.returncode}"
    return record


def build_report(task_id: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    passed = sum(1 for item in results if item["state"] == "PASS")
    failed = sum(1 for item in results if item["state"] == "FAIL")
    blocked = sum(1 for item in results if item["state"] == "BLOCKED")
    not_run = sum(1 for item in results if item["state"] == "NOT_RUN")
    if not results:
        gate = "NO_TESTS"
    elif failed or not_run:
        gate = "FAIL"
    elif blocked:
        gate = "BLOCKED"
    else:
        gate = "PASS"
    return {
        "task": task_id,
        "commit": git_value(["rev-parse", "HEAD"]),
        "commit_short": git_value(["rev-parse", "--short", "HEAD"]),
        "branch": git_value(["rev-parse", "--abbrev-ref", "HEAD"]),
        "working_tree": working_tree_state(),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "catalog": str(CATALOG_PATH.relative_to(ROOT)),
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "blocked": blocked,
        "not_run": not_run,
        "gate": gate,
        "results": results,
    }


def print_report(report: dict[str, Any]) -> None:
    print("ASA Lab local task test report")
    print(f"  task           : {report['task']}")
    print(f"  commit         : {report['commit']} ({report['commit_short']})")
    print(f"  branch         : {report['branch']}")
    print(f"  working_tree   : {report['working_tree']}")
    print(f"  timestamp      : {report['timestamp']}")
    print(f"  catalog        : {report['catalog']}")
    print(f"  mandatory tests: {report['total']}")
    print("")
    for item in report["results"]:
        exit_code = item["exit_code"] if item["exit_code"] is not None else "-"
        line = (
            f"  {item['id']:<32} {item['state']:<8} "
            f"exit={exit_code} duration={item['duration_s']}s"
        )
        if item["reason"]:
            line += f" reason={item['reason']}"
        print(line)
        print(f"      command: {item['command']}")
    print("")
    print(
        f"  GATE: {report['gate']} "
        f"(PASS={report['passed']} FAIL={report['failed']} "
        f"BLOCKED={report['blocked']} NOT_RUN={report['not_run']} / {report['total']})"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", required=True, help="Task id, e.g. TASK-PORTAL-001")
    parser.add_argument("--json", help="Optional path to write the machine-readable report")
    arguments = parser.parse_args()

    task_id = arguments.task.strip()
    if not TASK_ID_PATTERN.fullmatch(task_id):
        print(f"Invalid task id: {task_id!r}", file=sys.stderr)
        return 2

    catalog = load_catalog()
    selected = select_tests(catalog, task_id)
    results = [run_test(test, task_id) for test in selected]
    report = build_report(task_id, results)
    print_report(report)

    if arguments.json:
        Path(arguments.json).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if not results:
        print(
            f"No mandatory tests registered for {task_id} in {CATALOG_PATH.name}",
            file=sys.stderr,
        )
        return 2
    return 0 if report["gate"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
