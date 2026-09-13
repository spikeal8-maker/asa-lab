#!/usr/bin/env python3
"""Read-only crash recovery snapshot for ASA Lab coding agents."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import agent_context

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
PROCESS_TOKENS = (
    "node",
    "pnpm",
    "npm",
    "nx",
    "vite",
    "playwright",
    "docker",
    "git",
    "python",
)


def _run(root: Path, *args: str) -> tuple[int, str]:
    try:
        result = subprocess.run(
            list(args), cwd=root, capture_output=True, check=False, timeout=20
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return 127, ""
    return result.returncode, result.stdout.decode("utf-8", errors="replace").strip()


def _git_value(root: Path, *args: str) -> str | None:
    code, value = _run(root, "git", *args)
    return value if code == 0 and value else None


def _divergence(root: Path, left: str, right: str) -> dict[str, int] | None:
    code, value = _run(root, "git", "rev-list", "--left-right", "--count", f"{left}...{right}")
    if code != 0:
        return None
    parts = value.split()
    if len(parts) != 2:
        return None
    try:
        return {"left_only": int(parts[0]), "right_only": int(parts[1])}
    except ValueError:
        return None


def _process_snapshot() -> list[str]:
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True,
                check=False,
                timeout=10,
            )
            text = result.stdout.decode("utf-8", errors="replace")
        else:
            result = subprocess.run(
                ["ps", "-eo", "pid=,comm=,args="],
                capture_output=True,
                check=False,
                timeout=10,
            )
            text = result.stdout.decode("utf-8", errors="replace")
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return []

    matches = []
    for line in text.splitlines():
        lowered = line.lower()
        if any(token in lowered for token in PROCESS_TOKENS):
            matches.append(line.strip())
    return matches[:25]


def _lane_for_scope(document: dict[str, Any], scope: str | None) -> dict[str, Any] | None:
    lanes = agent_context.collect_lanes(document)
    if scope is None:
        return lanes[0]
    return next((lane for lane in lanes if lane.get("id") == scope), None)


def build_snapshot(root: Path, scope: str | None) -> dict[str, Any]:
    document = agent_context.load_current(root)
    lane = _lane_for_scope(document, scope)
    if scope is not None and lane is None:
        raise ValueError(f"unknown lane: {scope}")

    status = agent_context._git_status(root)
    dirty_paths = sorted(set(status.get("paths") or [])) if status.get("state") == "available" else None
    owned_paths = list((lane or {}).get("owned_paths") or [])
    dirty_in_scope = (
        [
            path
            for path in dirty_paths
            if any(agent_context._matches_scope(path, pattern) for pattern in owned_paths)
        ]
        if dirty_paths is not None
        else None
    )

    branch = _git_value(root, "branch", "--show-current")
    head = _git_value(root, "rev-parse", "HEAD")
    origin_main = _git_value(root, "rev-parse", "refs/remotes/origin/main")
    origin_branch = (
        _git_value(root, "rev-parse", f"refs/remotes/origin/{branch}") if branch else None
    )
    task = (lane or {}).get("task") or {}

    if dirty_paths is None:
        recovery_state = "RECOVERY_REQUIRED"
        safe_action = "Git status is unavailable; do not edit or rerun interrupted commands."
    elif dirty_paths:
        recovery_state = "RECOVERY_REQUIRED"
        safe_action = "Inspect and classify the existing diff before any new edit or command retry."
    else:
        recovery_state = "SAFE_TO_START"
        safe_action = "Worktree is clean; select one bounded task before editing."

    return {
        "mode": recovery_state,
        "scope": (lane or {}).get("id"),
        "task": {
            "id": task.get("id"),
            "status": task.get("status"),
            "checkpoint": task.get("checkpoint"),
        },
        "git": {
            "branch": branch,
            "head": head,
            "origin_main": origin_main,
            "origin_branch": origin_branch,
            "vs_origin_main": (
                _divergence(root, "HEAD", "refs/remotes/origin/main") if origin_main else None
            ),
            "vs_origin_branch": (
                _divergence(root, "HEAD", f"refs/remotes/origin/{branch}")
                if origin_branch and branch
                else None
            ),
            "dirty_paths": dirty_paths,
            "dirty_in_scope": dirty_in_scope,
        },
        "running_processes": _process_snapshot(),
        "safe_action": safe_action,
    }


def render_text(snapshot: dict[str, Any]) -> str:
    git = snapshot["git"]
    task = snapshot["task"]
    lines = [
        snapshot["mode"],
        f"SCOPE: {snapshot.get('scope')}",
        f"TASK: {task.get('id')} ({task.get('status')})",
        f"CHECKPOINT: {task.get('checkpoint')}",
        f"BRANCH: {git.get('branch')}",
        f"HEAD: {git.get('head')}",
        f"ORIGIN_MAIN: {git.get('origin_main')}",
        f"ORIGIN_BRANCH: {git.get('origin_branch')}",
        f"DIRTY_PATHS: {len(git.get('dirty_paths') or []) if git.get('dirty_paths') is not None else 'UNKNOWN'}",
        f"DIRTY_IN_SCOPE: {len(git.get('dirty_in_scope') or []) if git.get('dirty_in_scope') is not None else 'UNKNOWN'}",
    ]
    for path in git.get("dirty_paths") or []:
        lines.append(f"  dirty: {path}")
    processes = snapshot.get("running_processes") or []
    lines.append(f"RUNNING_PROCESSES: {len(processes)}")
    for process in processes[:10]:
        lines.append(f"  process: {process}")
    lines.append(f"SAFE_ACTION: {snapshot['safe_action']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Read-only ASA Lab crash recovery snapshot")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--scope", default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--check",
        action="store_true",
        help="return exit 2 when recovery is required",
    )
    args = parser.parse_args()

    try:
        snapshot = build_snapshot(args.root.resolve(), args.scope)
    except ValueError as exc:
        print(f"agent recovery: FAIL: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    else:
        print(render_text(snapshot), end="")
    if args.check and snapshot["mode"] != "SAFE_TO_START":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
