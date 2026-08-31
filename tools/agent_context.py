#!/usr/bin/env python3
"""Print a compact, lane-specific ASA Lab execution context.

The command deliberately reads live execution state only from
``docs/execution/current.yaml``.  It does not merge the execution manifest,
project map or human status pages, because those documents describe programme
structure and history and used to drift from the live lane records.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
MAX_RENDERED_CHARS = 12_000


def load_current(root: Path) -> dict[str, Any]:
    path = root / "docs/execution/current.yaml"
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - the CLI must explain malformed state
        raise ValueError(f"cannot read {path.relative_to(root)}: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError("docs/execution/current.yaml root must be a mapping")
    return document


def collect_lanes(document: dict[str, Any]) -> list[dict[str, Any]]:
    task = document.get("task")
    primary = document.get("primary_lane")
    if not isinstance(task, dict) or not isinstance(primary, dict):
        raise ValueError("current.yaml must define task and primary_lane mappings")
    lanes: list[dict[str, Any]] = [
        {
            **primary,
            "task": task,
            "revisions": document.get("revisions") or {},
            "gates": document.get("gates") or {},
            "execution_lease": document.get("execution_lease") or {},
            "primary": True,
        }
    ]
    parallel = document.get("parallel_lanes") or []
    if not isinstance(parallel, list):
        raise ValueError("current.yaml parallel_lanes must be an array")
    for lane in parallel:
        if not isinstance(lane, dict):
            raise ValueError("every current.yaml parallel lane must be a mapping")
        lanes.append({**lane, "primary": False})
    ids = [lane.get("id") for lane in lanes]
    if any(not isinstance(lane_id, str) or not lane_id for lane_id in ids):
        raise ValueError("every lane must have a non-empty id")
    if len(ids) != len(set(ids)):
        raise ValueError("lane ids must be unique")
    return lanes


def _doc_hints(root: Path, owned_paths: list[Any]) -> list[str]:
    hints: list[str] = []
    for raw in owned_paths:
        if not isinstance(raw, str) or not raw.startswith("docs/"):
            continue
        clean = raw.removesuffix("/**")
        candidate = root / PurePosixPath(clean)
        if candidate.is_file():
            relative = candidate.relative_to(root).as_posix()
        elif candidate.is_dir() and (candidate / "README.md").is_file():
            relative = (candidate / "README.md").relative_to(root).as_posix()
        else:
            continue
        if relative not in hints:
            hints.append(relative)
    return hints


def _checkpoint_hint(checkpoint: Any) -> str | None:
    if not isinstance(checkpoint, str):
        return None
    match = re.match(r"(?i)^([a-z]+)[_-](\d+)", checkpoint)
    if not match:
        return None
    return f"{match.group(1).upper()}-{int(match.group(2))}"


def _section_hints(root: Path, docs: list[str], checkpoint: Any) -> list[dict[str, Any]]:
    marker = _checkpoint_hint(checkpoint)
    if marker is None:
        return []
    matches: list[dict[str, Any]] = []
    pattern = re.compile(rf"^#{{1,6}}\s+.*\b{re.escape(marker)}(?:\b|[A-Z0-9_-])", re.I)
    for relative in docs:
        path = root / relative
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                matches.append(
                    {"path": relative, "line": line_number, "heading": line.lstrip("# ")}
                )
                break
    return matches


def _git_paths(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z"],
        cwd=root,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    paths: list[str] = []
    records = result.stdout.decode("utf-8", errors="replace").split("\0")
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        path = record[3:]
        if record[:2] in {"R ", "C ", "RM", "CM"} and index < len(records):
            path = records[index]
            index += 1
        if path:
            paths.append(path.replace("\\", "/"))
    return paths


def _matches_scope(path: str, scope: Any) -> bool:
    if not isinstance(scope, str):
        return False
    if scope.endswith("/**"):
        prefix = scope[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return path == scope


def build_context(root: Path, document: dict[str, Any], lane: dict[str, Any]) -> dict[str, Any]:
    task = lane.get("task")
    if not isinstance(task, dict):
        raise ValueError(f"lane {lane.get('id')} has no task mapping")
    owned_paths = lane.get("owned_paths") or []
    shared_paths = (document.get("integration") or {}).get("shared_paths") or []
    dirty = _git_paths(root)
    lane_dirty = sorted(
        path for path in dirty if any(_matches_scope(path, scope) for scope in owned_paths)
    )
    shared_dirty = sorted(
        path for path in dirty if any(_matches_scope(path, scope) for scope in shared_paths)
    )
    docs = _doc_hints(root, owned_paths)
    gates = lane.get("gates") or {}
    gate_commands = {
        str(name): list(value.get("commands") or [])
        for name, value in gates.items()
        if isinstance(value, dict)
    }
    return {
        "source": "docs/execution/current.yaml",
        "policy": "AGENTS.md",
        "scope": lane.get("id"),
        "primary": bool(lane.get("primary")),
        "development_mode": (document.get("development_policy") or {}).get("mode"),
        "task": {
            key: task.get(key)
            for key in (
                "id",
                "issue",
                "status",
                "checkpoint",
                "owner_acceptance",
                "branch",
                "base_branch",
                "pr",
            )
        },
        "blocking": list(document.get("blocking") or []),
        "revisions": dict(lane.get("revisions") or {}),
        "gate_commands": gate_commands,
        "contract_documents": docs,
        "contract_sections": _section_hints(root, docs, task.get("checkpoint")),
        "owned_paths": list(owned_paths),
        "dirty": {
            "total_count": len(dirty),
            "lane_paths": lane_dirty,
            "shared_paths": shared_dirty,
        },
    }


def render_text(context: dict[str, Any]) -> str:
    task = context["task"]
    lines = [
        "ASA Lab agent context",
        f"source: {context['source']}",
        f"policy: {context['policy']}",
        f"scope: {context['scope']}",
        f"development: {context['development_mode']}",
        f"task: {task.get('id')}",
        f"issue: #{task.get('issue')}",
        f"status: {task.get('status')}",
        f"checkpoint: {task.get('checkpoint')}",
        f"ownerAcceptance: {task.get('owner_acceptance')}",
        f"branch: {task.get('branch')}",
        f"blocking: {len(context['blocking'])}",
    ]
    if context["revisions"]:
        lines.append("revisions:")
        lines.extend(f"  {key}: {value}" for key, value in context["revisions"].items())
    lines.append("gates:")
    for name, commands in context["gate_commands"].items():
        lines.append(f"  {name}: {' && '.join(commands)}")
    lines.append("read:")
    lines.append("  AGENTS.md")
    for section in context["contract_sections"]:
        lines.append(f"  {section['path']}:{section['line']}  # {section['heading']}")
    section_paths = {section["path"] for section in context["contract_sections"]}
    for path in context["contract_documents"]:
        if path not in section_paths:
            lines.append(f"  {path}")
    dirty = context["dirty"]
    lines.append(f"workingTreeDirty: {dirty['total_count']}")
    if dirty["lane_paths"]:
        lines.append("dirtyInScope:")
        lines.extend(f"  {path}" for path in dirty["lane_paths"][:20])
    if dirty["shared_paths"]:
        lines.append("dirtySharedPaths:")
        lines.extend(f"  {path}" for path in dirty["shared_paths"][:20])
    return "\n".join(lines) + "\n"


def validate_all(root: Path, document: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    try:
        lanes = collect_lanes(document)
    except ValueError as exc:
        return [str(exc)]
    for lane in lanes:
        try:
            context = build_context(root, document, lane)
            rendered = render_text(context)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if len(rendered) > MAX_RENDERED_CHARS:
            errors.append(
                f"lane {lane.get('id')} context is {len(rendered)} chars; "
                f"maximum is {MAX_RENDERED_CHARS}"
            )
        if context["scope"] != lane.get("id"):
            errors.append(f"lane {lane.get('id')} rendered with the wrong scope")
        if not context["gate_commands"]:
            errors.append(f"lane {lane.get('id')} has no gate commands")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", help="lane id; defaults to the primary lane")
    parser.add_argument("--list", action="store_true", help="list available lane ids")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    parser.add_argument("--check", action="store_true", help="validate every lane context")
    parser.add_argument("--root", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else DEFAULT_ROOT
    try:
        document = load_current(root)
        lanes = collect_lanes(document)
    except ValueError as exc:
        print(f"agent context: FAIL\n- {exc}", file=sys.stderr)
        return 1
    if args.list:
        for lane in lanes:
            task = lane.get("task") or {}
            print(f"{lane.get('id')}\t{task.get('id')}\t{task.get('status')}")
        return 0
    if args.check:
        errors = validate_all(root, document)
        if errors:
            print("ASA Lab agent context validation: FAIL", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        print(f"ASA Lab agent context validation: PASS ({len(lanes)} lanes)")
        return 0
    selected = args.scope or str(lanes[0].get("id"))
    lane = next((item for item in lanes if item.get("id") == selected), None)
    if lane is None:
        available = ", ".join(str(item.get("id")) for item in lanes)
        print(f"unknown scope {selected!r}; available: {available}", file=sys.stderr)
        return 2
    context = build_context(root, document, lane)
    if args.json:
        print(json.dumps(context, ensure_ascii=False, indent=2))
    else:
        print(render_text(context), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
