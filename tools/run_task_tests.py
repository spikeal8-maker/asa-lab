#!/usr/bin/env python3
"""Execute every mandatory test registered for one ASA Lab task."""

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
CATALOG_PATHS = (
    ROOT / "docs/testing/test-catalog.yaml",
    ROOT / "docs/testing/active-task-tests.yaml",
)
TASK_ID_PATTERN = re.compile(r"^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
BLOCKED_EXIT_CODE = 78
OUTPUT_TAIL_LINES = 20


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


def run_test(test: dict[str, Any], task_id: str) -> dict[str, Any]:
    test_id = str(test.get("id", "unknown"))
    command = str(test.get("command", "")).strip()
    timeout = test.get("timeout_seconds")
    timeout_value = timeout if isinstance(timeout, int) and not isinstance(timeout, bool) else 600
    record: dict[str, Any] = {"id": test_id, "command": command, "state": "NOT_RUN", "exit_code": None, "duration_s": 0.0, "reason": ""}
    if not command:
        record.update(state="BLOCKED", reason="empty command")
        return record
    try:
        parts = shlex.split(command, posix=os.name != "nt")
    except ValueError as exc:
        record.update(state="BLOCKED", reason=f"cannot tokenize command: {exc}")
        return record
    executable = parts[0] if parts else ""
    if shutil.which(executable) is None:
        record.update(state="BLOCKED", reason=f"executable not available: {executable}")
        return record
    start = time.monotonic()
    try:
        completed = subprocess.run(
            command if os.name == "nt" else parts,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=timeout_value,
            shell=os.name == "nt",
            env={**os.environ, "ASA_TASK_ID": task_id, "ASA_TEST_ID": test_id},
        )
    except subprocess.TimeoutExpired:
        record.update(state="FAIL", reason=f"timeout after {timeout_value}s", duration_s=round(time.monotonic() - start, 3))
        return record
    except FileNotFoundError:
        record.update(state="BLOCKED", reason=f"executable not available: {executable}", duration_s=round(time.monotonic() - start, 3))
        return record
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
