#!/usr/bin/env python3
"""One-shot, read-only startup check for ASA Lab coding agents.

The preflight composes the existing canonical agent context and crash-recovery
logic. It does not create another execution state and never edits the repository.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import agent_context
import agent_recover

DEFAULT_ROOT = HERE.parent
CONTROL_PLANE_SCRIPT = "tools/validate_control_plane.py"


def _run(
    root: Path,
    command: list[str],
    *,
    timeout: int = 120,
) -> tuple[int, str]:
    try:
        result = subprocess.run(
            command,
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)
    output = "\n".join(
        item.strip()
        for item in (result.stdout, result.stderr)
        if item and item.strip()
    )
    return result.returncode, output


def _resolve_context(
    root: Path,
    *,
    scope: str | None,
    surface: str | None,
    control: str | None,
    target_path: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    document = agent_context.load_current(root)
    lanes = agent_context.collect_lanes(document)
    targeted = any(value is not None for value in (surface, control, target_path))

    target: dict[str, Any] | None = None
    if targeted:
        target = agent_context._resolve_target(
            root,
            surface_id=surface,
            control_id=control,
            requested_path=target_path,
        )

    selected = scope or (
        str(target.get("lane")) if target is not None else str(lanes[0].get("id"))
    )
    lane = next((item for item in lanes if item.get("id") == selected), None)
    if lane is None:
        available = ", ".join(str(item.get("id")) for item in lanes)
        raise ValueError(f"unknown scope {selected!r}; available: {available}")

    context = (
        agent_context.build_targeted_context(root, document, lane, target)
        if target is not None
        else agent_context.build_context(root, document, lane)
    )
    return document, context


def _worktree_paths(root: Path) -> list[Path]:
    code, output = _run(root, ["git", "worktree", "list", "--porcelain"], timeout=30)
    if code != 0:
        return []
    result: list[Path] = []
    for line in output.splitlines():
        if not line.startswith("worktree "):
            continue
        raw = line[len("worktree ") :].strip()
        if raw:
            result.append(Path(raw).resolve())
    return result


def _matches_any(path: str, patterns: list[str]) -> bool:
    return any(agent_context._matches_scope(path, pattern) for pattern in patterns)


def _other_worktree_overlaps(
    root: Path,
    context: dict[str, Any],
    shared_paths: list[str],
) -> list[dict[str, Any]]:
    selected_files = [
        str(path)
        for path in (context.get("implementation_files") or [])
        if isinstance(path, str)
    ]
    selected_patterns = selected_files or [
        str(path)
        for path in (context.get("owned_paths") or [])
        if isinstance(path, str)
    ]
    overlap_patterns = list(dict.fromkeys(selected_patterns + shared_paths))

    result: list[dict[str, Any]] = []
    current = root.resolve()
    for worktree in _worktree_paths(root):
        if worktree == current:
            continue
        status = agent_context._git_status(worktree)
        dirty = status.get("paths") if status.get("state") == "available" else None
        if dirty is None:
            result.append(
                {
                    "worktree": str(worktree),
                    "status": "unknown",
                    "dirty_paths": None,
                    "overlap_paths": None,
                }
            )
            continue
        overlaps = sorted(
            {
                path
                for path in dirty
                if _matches_any(path, overlap_patterns)
            }
        )
        if overlaps:
            result.append(
                {
                    "worktree": str(worktree),
                    "status": "overlap",
                    "dirty_paths": sorted(set(dirty)),
                    "overlap_paths": overlaps,
                }
            )
    return result


def _execution_blockers(blockers: list[Any]) -> list[Any]:
    result: list[Any] = []
    for blocker in blockers:
        if not isinstance(blocker, dict):
            result.append(blocker)
            continue
        if blocker.get("kind") == "execution_blocker":
            result.append(blocker)
    return result


def _control_plane(root: Path, *, skip: bool) -> dict[str, Any]:
    if skip:
        return {
            "status": "SKIPPED_FOR_FIXTURE",
            "exit_code": 0,
            "output": "fixture requested --skip-control-plane",
        }
    script = root / CONTROL_PLANE_SCRIPT
    if not script.is_file():
        return {
            "status": "FAIL",
            "exit_code": 127,
            "output": f"missing {CONTROL_PLANE_SCRIPT}",
        }
    code, output = _run(root, [sys.executable, str(script)], timeout=180)
    return {
        "status": "PASS" if code == 0 else "FAIL",
        "exit_code": code,
        "output": output,
    }


def build_preflight(
    root: Path,
    *,
    scope: str | None = None,
    surface: str | None = None,
    control: str | None = None,
    target_path: str | None = None,
    skip_control_plane: bool = False,
) -> dict[str, Any]:
    root = root.resolve()
    document, context = _resolve_context(
        root,
        scope=scope,
        surface=surface,
        control=control,
        target_path=target_path,
    )
    resolved_scope = str(context.get("scope"))
    recovery = agent_recover.build_snapshot(root, resolved_scope)
    shared_paths = [
        str(path)
        for path in ((document.get("integration") or {}).get("shared_paths") or [])
        if isinstance(path, str)
    ]
    worktree_overlaps = _other_worktree_overlaps(root, context, shared_paths)
    blockers = list(context.get("blocking") or [])
    execution_blockers = _execution_blockers(blockers)
    control_plane = _control_plane(root, skip=skip_control_plane)

    if control_plane["status"] == "FAIL":
        mode = "BLOCKED_CONTROL_PLANE"
        safe_action = "Repair the control-plane failure before writing."
    elif execution_blockers:
        mode = "BLOCKED_EXECUTION"
        safe_action = "Resolve the lane execution blocker before writing."
    elif recovery.get("mode") != "SAFE_TO_START":
        mode = "RECOVERY_REQUIRED"
        safe_action = str(recovery.get("safe_action") or "Classify the current workspace before writing.")
    elif worktree_overlaps:
        mode = "WAITING_HANDOFF"
        safe_action = "Coordinate the reported overlapping dirty worktree paths before writing."
    else:
        mode = "SAFE_TO_START"
        safe_action = "Preflight is green; work only inside the bounded context printed below."

    return {
        "schema_version": "1.0.0",
        "mode": mode,
        "scope": resolved_scope,
        "task": context.get("task"),
        "selector": context.get("selector"),
        "git": recovery.get("git"),
        "dirty": context.get("dirty"),
        "blocking": blockers,
        "execution_blocking": execution_blockers,
        "gates": context.get("gate_commands"),
        "worktree_overlaps": worktree_overlaps,
        "control_plane": control_plane,
        "safe_action": safe_action,
        "context": context,
    }


def render_text(preflight: dict[str, Any]) -> str:
    git = preflight.get("git") or {}
    task = preflight.get("task") or {}
    lines = [
        f"ASA Lab agent preflight: {preflight.get('mode')}",
        f"SCOPE: {preflight.get('scope')}",
        f"TASK: {task.get('id')} ({task.get('status')})",
        f"CHECKPOINT: {task.get('checkpoint')}",
        f"BRANCH: {git.get('branch')}",
        f"HEAD: {git.get('head')}",
        f"ORIGIN_MAIN: {git.get('origin_main')}",
        f"DIRTY_PATHS: {len(git.get('dirty_paths') or []) if git.get('dirty_paths') is not None else 'UNKNOWN'}",
        f"BLOCKERS: {len(preflight.get('blocking') or [])}",
        f"EXECUTION_BLOCKERS: {len(preflight.get('execution_blocking') or [])}",
        f"WORKTREE_OVERLAPS: {len(preflight.get('worktree_overlaps') or [])}",
        f"CONTROL_PLANE: {(preflight.get('control_plane') or {}).get('status')}",
    ]
    for overlap in preflight.get("worktree_overlaps") or []:
        lines.append(f"  worktree: {overlap.get('worktree')}")
        for path in overlap.get("overlap_paths") or []:
            lines.append(f"    overlap: {path}")
    lines.append("GATES:")
    for name, commands in (preflight.get("gates") or {}).items():
        lines.append(f"  {name}: {' && '.join(commands)}")
    lines.append(f"SAFE_ACTION: {preflight.get('safe_action')}")
    context = preflight.get("context") or {}
    lines.append("")
    lines.append("--- scoped context ---")
    if "bounded_context" in context:
        lines.append(agent_context.render_targeted_text(context).rstrip())
    else:
        lines.append(agent_context.render_text(context).rstrip())
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", help="execution lane; defaults to primary lane")
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--surface", help="stable SURF-* id")
    target.add_argument("--control", help="stable CTRL-* id")
    target.add_argument("--path", dest="target_path", help="repository path resolved through Surface Maps")
    parser.add_argument("--json", action="store_true", help="emit one machine-readable preflight package")
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 2 unless the result is SAFE_TO_START",
    )
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--skip-control-plane", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    try:
        preflight = build_preflight(
            args.root,
            scope=args.scope,
            surface=args.surface,
            control=args.control,
            target_path=args.target_path,
            skip_control_plane=args.skip_control_plane,
        )
    except ValueError as exc:
        print(f"agent preflight: FAIL\n- {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(preflight, ensure_ascii=False, indent=2))
    else:
        print(render_text(preflight), end="")

    if args.check and preflight["mode"] != "SAFE_TO_START":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
