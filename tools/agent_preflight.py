#!/usr/bin/env python3
"""One-shot, read-only startup check for ASA Lab coding agents.

The preflight composes the existing canonical agent context and crash-recovery
logic. It does not create another execution state and never edits the repository.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PureWindowsPath
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import agent_context
import agent_recover

DEFAULT_ROOT = HERE.parent
CONTROL_PLANE_SCRIPT = "tools/validate_control_plane.py"


def _git_bytes(root: Path, arguments: list[str]) -> bytes:
    """Keep NUL-delimited Git paths intact, and never treat a failed read as empty."""
    try:
        result = subprocess.run(
            ["git", *arguments], cwd=root, capture_output=True, check=False, timeout=30
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError(f"cannot inspect Git paths: {exc}") from exc
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"git {' '.join(arguments[:2])} failed: {detail}")
    return result.stdout


def _path_key(path: str) -> str:
    return os.path.normcase(path.replace("\\", "/")).replace("\\", "/")


def _paths_overlap(left: str, right: str) -> bool:
    left, right = _path_key(left), _path_key(right)
    # A file cannot coexist with another task's file below that same path.
    return left == right or left.startswith(right + "/") or right.startswith(left + "/")


def _planned_paths(root: Path, paths: list[str] | None) -> list[str] | None:
    """Accept exact portable files, never directories, metadata or filesystem aliases."""
    if paths is None:
        return None
    if not paths:
        raise ValueError("the planned file set must not be empty")
    root = root.resolve()
    normalized: dict[str, str] = {}
    for raw in paths:
        path = raw.replace("\\", "/")
        windows = PureWindowsPath(path)
        if not path or windows.drive or windows.root or path.startswith("/"):
            raise ValueError(f"planned path must be repository-relative: {raw!r}")
        parts = [part for part in path.split("/") if part != "."]
        if not parts or any(
            not part or part == ".." or part.endswith((".", " "))
            or any(ord(char) < 32 or char in ':*?<>|"' for char in part)
            or part.casefold() == ".git"
            or re.fullmatch(r"con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]", part.split(".", 1)[0].rstrip(" "), re.I)
            for part in parts
        ):
            raise ValueError(f"invalid or ambiguous planned path: {raw!r}")
        candidate = root.joinpath(*parts)
        try:
            resolved = candidate.resolve()
            resolved.relative_to(root)
        except (OSError, RuntimeError, ValueError) as exc:
            raise ValueError(f"planned path escapes the repository: {raw!r}") from exc
        if _path_key(str(candidate)) != _path_key(str(resolved)):
            raise ValueError(f"planned path uses a filesystem alias: {raw!r}")
        cursor = root
        for part in parts:
            cursor = cursor / part
            if cursor.is_symlink() or getattr(cursor, "is_junction", lambda: False)():
                raise ValueError(f"planned path uses a filesystem alias: {raw!r}")
            if cursor != candidate and cursor.exists() and not cursor.is_dir():
                raise ValueError(f"planned path has a file as parent: {raw!r}")
        if candidate.is_dir():
            raise ValueError(f"planned path must name a file, not a directory: {raw!r}")
        value = "/".join(parts)
        normalized.setdefault(_path_key(value), value)
    return sorted(normalized.values())


def _check_git_path_separators(payload: bytes) -> None:
    # Git emits portable '/' separators on every host. A literal '\\' is a
    # distinct POSIX filename, never an alias for a planned directory separator.
    if b"\\" in payload:
        raise ValueError("Git paths contain non-portable literal backslashes")


def _worktree_status(root: Path) -> list[str]:
    # -uall is essential: default Git status collapses a new directory to dir/.
    payload = _git_bytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    _check_git_path_separators(payload)
    return agent_context._parse_porcelain(payload)


def _check_plan(root: Path, planned: list[str] | None, diff_base: str | None) -> dict[str, Any]:
    if planned is None:
        if diff_base is not None:
            raise ValueError("--diff-base requires --planned-path")
        return {"status": "NOT_APPLICABLE", "paths": [], "unplanned_paths": []}
    try:
        actual = _worktree_status(root)
        base_sha = None
        if diff_base is not None:
            if not diff_base or diff_base.startswith("-"):
                raise ValueError("--diff-base must name a known baseline commit")
            base_sha = _git_bytes(root, ["rev-parse", "--verify", f"{diff_base}^{{commit}}"])
            base_sha = base_sha.decode("ascii").strip()
            _git_bytes(root, ["merge-base", "--is-ancestor", base_sha, "HEAD"])
            # No rename folding: both the deleted and added paths must be planned.
            payload = _git_bytes(root, ["diff", "--name-only", "--no-renames", "-z", base_sha, "HEAD", "--"])
            _check_git_path_separators(payload)
            actual.extend(path for path in payload.decode("utf-8", errors="strict").split("\0") if path)
        keys = {_path_key(path) for path in planned}
        outside = sorted({path for path in actual if _path_key(path) not in keys})
        return {
            "status": "FAIL" if outside else "PASS",
            "paths": planned,
            "actual_paths": sorted(set(actual)),
            "unplanned_paths": outside,
            "diff_base": base_sha,
        }
    except (ValueError, UnicodeError) as exc:
        return {"status": "BLOCKED", "paths": planned, "unplanned_paths": [], "error": str(exc)}


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
            encoding="utf-8",
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


def _refresh_origin_main(root: Path) -> dict[str, Any]:
    code, output = _run(
        root,
        [
            "git",
            "fetch",
            "--quiet",
            "origin",
            "refs/heads/main:refs/remotes/origin/main",
        ],
        timeout=60,
    )
    return {
        "status": "PASS" if code == 0 else "FAIL",
        "exit_code": code,
        "output": output,
    }


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
    payload = _git_bytes(root, ["worktree", "list", "--porcelain", "-z"])
    try:
        output = payload.decode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise ValueError("worktree list contains undecodable paths") from exc
    if not output.endswith("\0\0"):
        raise ValueError("worktree list is empty or malformed")
    result: list[Path] = []
    for record in output.rstrip("\0").split("\0\0"):
        fields = record.split("\0")
        if not fields[0].startswith("worktree ") or not fields[0][9:]:
            raise ValueError("worktree list contains a malformed record")
        result.append(Path(fields[0][9:]).resolve())
    if root.resolve() not in result:
        raise ValueError("current checkout is absent from the worktree list")
    return result


def _matches_any(path: str, patterns: list[str]) -> bool:
    return any(agent_context._matches_scope(path, pattern) for pattern in patterns)


def _other_worktree_overlaps(
    root: Path,
    context: dict[str, Any],
    shared_paths: list[str],
    planned_paths: list[str] | None = None,
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
    try:
        worktrees = _worktree_paths(root)
    except (ValueError, OSError, RuntimeError) as exc:
        return [{"worktree": None, "status": "unknown", "dirty_paths": None,
                 "overlap_paths": None, "error": str(exc)}]
    for worktree in worktrees:
        if worktree == current:
            continue
        try:
            dirty = _worktree_status(worktree)
            # Recheck aliases in each checkout: the same logical path can be a
            # normal file here and an unsafe symlink/junction in another worktree.
            if planned_paths is not None:
                _planned_paths(worktree, planned_paths)
        except (ValueError, OSError, RuntimeError) as exc:
            result.append(
                {
                    "worktree": str(worktree),
                    "status": "unknown",
                    "dirty_paths": None,
                    "overlap_paths": None,
                    "error": str(exc),
                }
            )
            continue
        overlaps = sorted(
            {
                path
                for path in dirty
                if (
                    any(_paths_overlap(path, item) for item in planned_paths)
                    if planned_paths is not None
                    else _matches_any(path, overlap_patterns)
                )
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
    planned_paths: list[str] | None = None,
    verify_plan: bool = False,
    diff_base: str | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    planned = _planned_paths(root, planned_paths)
    if verify_plan and (planned is None or diff_base is None):
        raise ValueError("--verify-plan requires --planned-path and --diff-base")
    remote_refresh = _refresh_origin_main(root)
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
    worktree_overlaps = _other_worktree_overlaps(root, context, shared_paths, planned)
    plan = _check_plan(root, planned, diff_base)
    blockers = list(context.get("blocking") or [])
    execution_blockers = _execution_blockers(blockers)
    control_plane = _control_plane(root, skip=skip_control_plane)

    if remote_refresh["status"] == "FAIL":
        mode = "BLOCKED_GIT_FRESHNESS"
        safe_action = "Refresh origin/main successfully before writing; GitHub is canonical."
    elif control_plane["status"] == "FAIL":
        mode = "BLOCKED_CONTROL_PLANE"
        safe_action = "Repair the control-plane failure before writing."
    elif execution_blockers:
        mode = "BLOCKED_EXECUTION"
        safe_action = "Resolve the lane execution blocker before writing."
    elif plan["status"] in {"FAIL", "BLOCKED"}:
        mode = "BLOCKED_PLAN"
        safe_action = "Resolve the unknown or unplanned paths; a file plan never authorizes changes outside it."
    elif verify_plan and (recovery.get("git") or {}).get("dirty_paths") is None:
        mode = "RECOVERY_REQUIRED"
        safe_action = "Git status is unknown; plan verification cannot authorize publication."
    elif verify_plan and worktree_overlaps:
        mode = "WAITING_HANDOFF"
        safe_action = "Coordinate the reported overlapping or unknown worktrees before publication."
    elif verify_plan:
        mode = "PLAN_VALID"
        safe_action = "Only diff scope is verified. This does not clear recovery or authorize new edits or publication."
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
        "operation": "verify_plan" if verify_plan else "startup",
        "mode": mode,
        "scope": resolved_scope,
        "task": context.get("task"),
        "selector": context.get("selector"),
        "git": recovery.get("git"),
        "recovery_mode": recovery.get("mode"),
        "plan": plan,
        "remote_refresh": remote_refresh,
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
        f"REMOTE_REFRESH: {(preflight.get('remote_refresh') or {}).get('status')}",
        f"CONTROL_PLANE: {(preflight.get('control_plane') or {}).get('status')}",
    ]
    plan = preflight.get("plan") or {}
    if plan.get("status") != "NOT_APPLICABLE":
        lines.append(f"PLAN: {plan.get('status')}")
        lines.extend(f"  planned: {path}" for path in plan.get("paths") or [])
        lines.extend(f"  unplanned: {path}" for path in plan.get("unplanned_paths") or [])
        if plan.get("error"):
            lines.append(f"  error: {plan['error']}")
    lines.append(f"RECOVERY_MODE: {preflight.get('recovery_mode')}")
    for overlap in preflight.get("worktree_overlaps") or []:
        lines.append(f"  worktree: {overlap.get('worktree')}")
        if overlap.get("error"):
            lines.append(f"    error: {overlap['error']}")
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
    operations = parser.add_mutually_exclusive_group()
    operations.add_argument(
        "--check",
        action="store_true",
        help="exit 2 unless the result is SAFE_TO_START",
    )
    operations.add_argument(
        "--verify-plan", action="store_true",
        help="validate dirty and committed diff scope only; never grants SAFE_TO_START",
    )
    parser.add_argument("--planned-path", action="append", help="exact repository-relative file; repeat for every intended write")
    parser.add_argument("--diff-base", help="known ancestor commit used to check the complete unpublished diff before commit/push")
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
            planned_paths=args.planned_path,
            verify_plan=args.verify_plan,
            diff_base=args.diff_base,
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
    if args.verify_plan and preflight["mode"] != "PLAN_VALID":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
