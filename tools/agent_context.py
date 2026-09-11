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
TEXT_PATH_LIMIT = 20
DELIVERY_WORKFLOW = "docs/delivery/AGENT_CHANGE_WORKFLOW.md"
DOCUMENT_REGISTRY = "docs/agent/document-registry.yaml"
DOMAIN_CONTRACT_DIR = "docs/agent/contracts"
SURFACE_MAP_DIR = "docs/agent/surfaces"
TEST_CATALOGS = ("docs/testing/test-catalog.yaml", "docs/testing/active-task-tests.yaml")
MAX_TARGETED_RENDERED_CHARS = 8_000
CHANGE_CLASS_RANK = {
    "L0_LOCAL_UI": 0,
    "L1_UI_BEHAVIOR": 1,
    "L2_DOMAIN_MUTATION": 2,
    "L3_CRITICAL": 3,
}


def load_current(root: Path) -> dict[str, Any]:
    path = root / "docs/execution/current.yaml"
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - the CLI must explain malformed state
        raise ValueError(f"cannot read {path.relative_to(root)}: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError("docs/execution/current.yaml root must be a mapping")
    return document


def load_registry(root: Path) -> dict[str, Any]:
    path = root / DOCUMENT_REGISTRY
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"cannot read {DOCUMENT_REGISTRY}: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("documents"), list):
        raise ValueError(f"{DOCUMENT_REGISTRY} must contain a documents array")
    return document


def _registry_routes(
    registry: dict[str, Any], lane_id: str, task: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    refs = task.get("normative_refs") or []
    normative_ids = {
        str(item.get("document"))
        for item in refs
        if isinstance(item, dict) and isinstance(item.get("document"), str)
    }
    result: dict[str, list[dict[str, Any]]] = {
        "read_first": [], "read_if_needed": [], "do_not_use": [], "process": []
    }
    for raw in registry.get("documents") or []:
        if not isinstance(raw, dict):
            continue
        lanes = raw.get("lanes") or []
        routed = "*" in lanes or lane_id in lanes
        role = raw.get("context_role")
        status = raw.get("status")
        doc_id = str(raw.get("id") or "")
        if status in {"historical", "superseded"} and routed:
            bucket = "do_not_use"
        elif role == "review" and routed:
            bucket = "process"
        elif role == "compact" and routed and status == "canonical":
            bucket = "read_first"
        elif role == "task" and routed and status in {"canonical", "supporting"}:
            bucket = "read_first"
        elif role == "target" and routed and (not normative_ids or doc_id in normative_ids):
            bucket = "read_first"
        elif role in {"escalation", "trace"} and routed and (
            not normative_ids or doc_id in normative_ids or role == "trace"
        ):
            bucket = "read_if_needed"
        else:
            continue
        result[bucket].append({
            "id": doc_id,
            "path": raw.get("path"),
            "revision": raw.get("revision"),
            "role": role,
            "authority": raw.get("authority"),
        })
    return result


def _load_yaml_directory(root: Path, relative: str) -> list[tuple[str, dict[str, Any]]]:
    directory = root / relative
    if not directory.is_dir():
        return []
    result: list[tuple[str, dict[str, Any]]] = []
    for path in sorted(directory.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"cannot read {path.relative_to(root)}: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError(f"{path.relative_to(root)} root must be a mapping")
        result.append((path.relative_to(root).as_posix(), data))
    return result


def _invariant_index(root: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for relative, contract in _load_yaml_directory(root, DOMAIN_CONTRACT_DIR):
        for raw in contract.get("invariants") or []:
            if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
                continue
            invariant_id = raw["id"]
            if invariant_id in result:
                raise ValueError(f"duplicate invariant id {invariant_id} across compact contracts")
            result[invariant_id] = {
                **raw,
                "contract_id": contract.get("contract_id"),
                "domain": contract.get("domain"),
                "source": relative,
            }
    return result


def _surface_index(root: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for relative, document in _load_yaml_directory(root, SURFACE_MAP_DIR):
        context = document.get("context")
        for raw in document.get("surfaces") or []:
            if isinstance(raw, dict) and isinstance(raw.get("id"), str):
                result.append({**raw, "context": context, "source": relative})
    return result


def _test_index(root: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for relative in TEST_CATALOGS:
        path = root / relative
        if not path.is_file():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"cannot read {relative}: {exc}") from exc
        for raw in (data or {}).get("tests") or []:
            if isinstance(raw, dict) and isinstance(raw.get("id"), str):
                result[raw["id"]] = {**raw, "source": relative}
    return result


def _normalize_repo_path(raw: str) -> str:
    value = raw.replace("\\", "/").removeprefix("./")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not value:
        raise ValueError(f"unsafe repository path {raw!r}")
    return path.as_posix()


def _resolve_target(
    root: Path,
    *,
    surface_id: str | None = None,
    control_id: str | None = None,
    requested_path: str | None = None,
) -> dict[str, Any]:
    surfaces = _surface_index(root)
    selected_surfaces: list[dict[str, Any]] = []
    selected_controls: list[dict[str, Any]] = []
    normalized_path = _normalize_repo_path(requested_path) if requested_path else None

    if surface_id is not None:
        selected_surfaces = [item for item in surfaces if item.get("id") == surface_id]
        if not selected_surfaces:
            raise ValueError(f"unknown surface {surface_id!r}")
        selected_controls = [
            {**control, "surface_id": surface["id"]}
            for surface in selected_surfaces
            for control in surface.get("controls") or []
            if isinstance(control, dict)
        ]
    elif control_id is not None:
        for surface in surfaces:
            for control in surface.get("controls") or []:
                if isinstance(control, dict) and control.get("id") == control_id:
                    selected_surfaces.append(surface)
                    selected_controls.append({**control, "surface_id": surface["id"]})
        if not selected_controls:
            raise ValueError(f"unknown control {control_id!r}")
    elif normalized_path is not None:
        for surface in surfaces:
            surface_files = ((surface.get("implementation") or {}).get("files") or [])
            controls = [item for item in surface.get("controls") or [] if isinstance(item, dict)]
            control_hits = [item for item in controls if normalized_path in (item.get("files") or [])]
            if normalized_path in surface_files or control_hits:
                selected_surfaces.append(surface)
                selected_controls.extend(
                    {**control, "surface_id": surface["id"]} for control in control_hits
                )
        if not selected_surfaces:
            raise ValueError(
                f"path {normalized_path!r} is not mapped to an agent surface; "
                "use --scope for broad context or add the missing Surface Map"
            )
        if not selected_controls:
            selected_controls = [
                {**control, "surface_id": surface["id"]}
                for surface in selected_surfaces
                for control in surface.get("controls") or []
                if isinstance(control, dict)
            ]
    else:
        raise ValueError("targeted context requires --surface, --control or --path")

    contexts = {str(item.get("context")) for item in selected_surfaces}
    if len(contexts) != 1:
        raise ValueError(f"target resolves to multiple bounded contexts: {sorted(contexts)}")
    return {
        "selector": {
            "surface": surface_id,
            "control": control_id,
            "path": normalized_path,
        },
        "context": next(iter(contexts)),
        "surfaces": selected_surfaces,
        "controls": selected_controls,
    }


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
    match = re.match(r"(?i)^([a-z]+)[_-](\d+)([a-z]\d*)?", checkpoint)
    if not match:
        return None
    suffix = (match.group(3) or "").upper()
    return f"{match.group(1).upper()}-{int(match.group(2))}{suffix}"


def _section_hints(root: Path, docs: list[str], checkpoint: Any) -> list[dict[str, Any]]:
    marker = _checkpoint_hint(checkpoint)
    if marker is None:
        return []
    matches: list[dict[str, Any]] = []
    pattern = re.compile(
        rf"^#{{1,6}}\s+.*(?<![A-Z0-9]){re.escape(marker)}(?![A-Z0-9])",
        re.I,
    )
    for relative in docs:
        path = root / relative
        with path.open(encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if pattern.search(line):
                    matches.append(
                        {
                            "path": relative,
                            "line": line_number,
                            "heading": line.lstrip("# ").strip(),
                        }
                    )
                    break
    return matches


def _parse_porcelain(payload: bytes) -> list[str]:
    """Parse porcelain v1 -z without losing either side of rename/copy entries."""
    try:
        records = payload.decode("utf-8", errors="strict").split("\0")
    except UnicodeDecodeError as exc:
        raise ValueError("git status returned non-UTF-8 path data") from exc

    paths: list[str] = []
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if len(record) < 4 or record[2] != " ":
            raise ValueError("git status returned malformed porcelain data")
        status = record[:2]
        path = record[3:].replace("\\", "/")
        if path:
            paths.append(path)
        if status[0] in {"R", "C"} or status[1] in {"R", "C"}:
            if index >= len(records) or not records[index]:
                raise ValueError("git status returned incomplete rename/copy data")
            paired_path = records[index].replace("\\", "/")
            index += 1
            paths.append(paired_path)
    return paths


def _git_status(root: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z"],
            cwd=root,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except FileNotFoundError:
        return {
            "state": "unavailable",
            "message": "git executable unavailable",
            "paths": None,
        }
    except (OSError, subprocess.SubprocessError):
        return {
            "state": "unavailable",
            "message": "git status unavailable",
            "paths": None,
        }
    if result.returncode != 0:
        return {
            "state": "unavailable",
            "message": (
                f"git status failed (exit {result.returncode}); "
                "repository status is unknown"
            ),
            "paths": None,
        }
    try:
        paths = _parse_porcelain(result.stdout)
    except ValueError as exc:
        return {"state": "unavailable", "message": str(exc), "paths": None}
    return {"state": "available", "message": None, "paths": paths}


def _matches_scope(path: str, scope: Any) -> bool:
    if not isinstance(scope, str):
        return False
    if scope.endswith("/**"):
        prefix = scope[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return path == scope


def build_context(
    root: Path,
    document: dict[str, Any],
    lane: dict[str, Any],
    *,
    git_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task = lane.get("task")
    if not isinstance(task, dict):
        raise ValueError(f"lane {lane.get('id')} has no task mapping")
    owned_paths = lane.get("owned_paths") or []
    shared_paths = (document.get("integration") or {}).get("shared_paths") or []
    git_snapshot = git_status if git_status is not None else _git_status(root)
    git_state = git_snapshot.get("state")
    if git_state not in {"available", "unavailable"}:
        raise ValueError("git status snapshot has an invalid state")
    raw_paths = git_snapshot.get("paths")
    if git_state == "available" and not isinstance(raw_paths, list):
        raise ValueError("available git status snapshot must contain a paths array")
    dirty = sorted(set(raw_paths or [])) if git_state == "available" else None
    lane_dirty = (
        sorted(
            path
            for path in dirty
            if any(_matches_scope(path, scope) for scope in owned_paths)
        )
        if dirty is not None
        else None
    )
    shared_dirty = (
        sorted(
            path
            for path in dirty
            if any(_matches_scope(path, scope) for scope in shared_paths)
        )
        if dirty is not None
        else None
    )
    overlap_dirty = (
        sorted(set(lane_dirty or []).intersection(shared_dirty or []))
        if dirty is not None
        else None
    )
    docs = _doc_hints(root, owned_paths)
    registry = load_registry(root)
    registry_routes = _registry_routes(registry, str(lane.get("id") or ""), task)
    registry_paths = {
        str(item.get("path"))
        for item in registry.get("documents") or []
        if isinstance(item, dict) and item.get("path")
    }
    section_docs = list(dict.fromkeys(
        docs
        + [str(item.get("path")) for item in registry_routes["read_first"] if item.get("path")]
        + [str(item.get("path")) for item in registry_routes["read_if_needed"] if item.get("path")]
    ))
    checkpoint_marker = _checkpoint_hint(task.get("checkpoint"))
    sections = _section_hints(root, section_docs, task.get("checkpoint"))
    if checkpoint_marker is None:
        section_resolution = "not_applicable"
    elif sections:
        section_resolution = "found"
    else:
        section_resolution = "not_found"
    gates = lane.get("gates") or {}
    gate_commands = {
        str(name): list(value.get("commands") or [])
        for name, value in gates.items()
        if isinstance(value, dict)
    }
    return {
        "source": "docs/execution/current.yaml",
        "policy": "AGENTS.md",
        "delivery_workflow": DELIVERY_WORKFLOW,
        "gitStatus": git_state,
        "gitError": git_snapshot.get("message"),
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
                "normative_refs",
            )
        },
        "blocking": list(document.get("blocking") or []),
        "revisions": dict(lane.get("revisions") or {}),
        "gate_commands": gate_commands,
        "document_registry": DOCUMENT_REGISTRY,
        "document_routes": registry_routes,
        "contract_documents": docs,
        "unregistered_contract_documents": [path for path in docs if path not in registry_paths],
        "checkpoint_marker": checkpoint_marker,
        "contract_section_resolution": section_resolution,
        "contract_sections": sections,
        "owned_paths": list(owned_paths),
        "dirty": {
            "known": dirty is not None,
            "total_count": len(dirty) if dirty is not None else None,
            "all_paths": dirty,
            "lane_paths": lane_dirty,
            "shared_paths": shared_dirty,
            "overlap_paths": overlap_dirty,
        },
    }


def _highest_change_class(controls: list[dict[str, Any]]) -> str:
    ranked = [
        str(item.get("change_class"))
        for item in controls
        if str(item.get("change_class")) in CHANGE_CLASS_RANK
    ]
    return max(ranked, key=lambda item: CHANGE_CLASS_RANK[item]) if ranked else "L1_UI_BEHAVIOR"


def build_targeted_context(
    root: Path,
    document: dict[str, Any],
    lane: dict[str, Any],
    target: dict[str, Any],
    *,
    git_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if str(lane.get("id")) != target.get("context"):
        raise ValueError(
            f"target belongs to context {target.get('context')!r}, "
            f"not selected scope {lane.get('id')!r}"
        )
    base = build_context(root, document, lane, git_status=git_status)
    invariants = _invariant_index(root)
    tests = _test_index(root)
    registry = load_registry(root)
    registry_by_id = {
        str(item.get("id")): item
        for item in registry.get("documents") or []
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }

    selector = target["selector"]
    controls = target["controls"]
    surfaces = target["surfaces"]
    if selector.get("surface") is not None:
        chosen_files = sorted(
            {
                str(path)
                for surface in surfaces
                for path in ((surface.get("implementation") or {}).get("files") or [])
            }
        )
        invariant_ids = sorted(
            {str(item) for surface in surfaces for item in (surface.get("invariants") or [])}
        )
        test_ids = sorted({str(item) for surface in surfaces for item in (surface.get("tests") or [])})
    else:
        chosen_files = sorted({str(path) for control in controls for path in (control.get("files") or [])})
        invariant_ids = sorted({str(item) for control in controls for item in (control.get("invariants") or [])})
        test_ids = sorted({str(item) for control in controls for item in (control.get("tests") or [])})
        if not chosen_files:
            chosen_files = sorted(
                {
                    str(path)
                    for surface in surfaces
                    for path in ((surface.get("implementation") or {}).get("files") or [])
                }
            )
            invariant_ids = sorted(
                {str(item) for surface in surfaces for item in (surface.get("invariants") or [])}
            )
            test_ids = sorted({str(item) for surface in surfaces for item in (surface.get("tests") or [])})

    invariant_details: list[dict[str, Any]] = []
    escalation: list[dict[str, Any]] = []
    escalation_seen: set[tuple[str, str]] = set()
    compact_sources: set[str] = set()
    for invariant_id in invariant_ids:
        detail = invariants.get(invariant_id)
        if detail is None:
            raise ValueError(f"target references unknown invariant {invariant_id}")
        compact_sources.add(str(detail.get("source")))
        invariant_details.append(
            {
                "id": invariant_id,
                "statement": detail.get("statement"),
                "source": detail.get("source"),
            }
        )
        for raw_ref in detail.get("master_refs") or []:
            if not isinstance(raw_ref, dict):
                continue
            doc_id = str(raw_ref.get("document"))
            section = str(raw_ref.get("section"))
            key = (doc_id, section)
            if key in escalation_seen:
                continue
            escalation_seen.add(key)
            registered = registry_by_id.get(doc_id) or {}
            escalation.append(
                {
                    "document": doc_id,
                    "path": registered.get("path"),
                    "revision": registered.get("revision"),
                    "section": section,
                }
            )

    test_details = [
        {
            "id": test_id,
            "title": (tests.get(test_id) or {}).get("title"),
            "command": (tests.get(test_id) or {}).get("command"),
        }
        for test_id in test_ids
    ]
    commands = sorted(
        {str(command) for control in controls for command in (control.get("commands") or [])}
    )
    change_class = _highest_change_class(controls)
    dirty_all = base["dirty"]["all_paths"] if base["dirty"]["known"] else None
    targeted_dirty = (
        sorted(set(chosen_files).intersection(dirty_all or [])) if dirty_all is not None else None
    )
    task_docs = [
        item["path"]
        for item in base["document_routes"]["read_first"]
        if item.get("role") == "task" and item.get("path")
    ]
    return {
        "mode": "targeted",
        "source": base["source"],
        "policy": base["policy"],
        "scope": base["scope"],
        "task": base["task"],
        "selector": selector,
        "surfaces": [
            {"id": item.get("id"), "routes": item.get("routes"), "source": item.get("source")}
            for item in surfaces
        ],
        "controls": [
            {
                "id": item.get("id"),
                "label": item.get("label"),
                "change_class": item.get("change_class"),
                "surface_id": item.get("surface_id"),
            }
            for item in controls
        ],
        "change_class": change_class,
        "implementation_files": chosen_files,
        "commands": commands,
        "invariants": invariant_details,
        "tests": test_details,
        "compact_sources": sorted(compact_sources),
        "task_packages": task_docs,
        "escalation_refs": escalation,
        "do_not_use": base["document_routes"]["do_not_use"],
        "review": {
            "post_step_required": True,
            "challenge_required": change_class == "L3_CRITICAL",
            "protocol": "docs/agent/review-protocol.md",
        },
        "gitStatus": base["gitStatus"],
        "gitError": base["gitError"],
        "targeted_dirty": targeted_dirty,
        "render_budget_chars": MAX_TARGETED_RENDERED_CHARS,
    }


def render_targeted_text(context: dict[str, Any]) -> str:
    task = context["task"]
    selector = context["selector"]
    selected = selector.get("control") or selector.get("surface") or selector.get("path")
    lines = [
        "ASA Lab targeted agent context",
        f"scope: {context['scope']}",
        f"task: {task.get('id')}",
        f"target: {selected}",
        f"changeClass: {context['change_class']}",
        f"policy: {context['policy']}",
        "readMode: targeted; do not read whole master specifications unless an escalationRef is needed",
    ]
    lines.append("surfaces:")
    lines.extend(f"  {item['id']}  # {', '.join(item.get('routes') or [])}" for item in context["surfaces"])
    if context["controls"]:
        lines.append("controls:")
        lines.extend(
            f"  {item['id']} [{item['change_class']}]  # {item.get('label') or ''}"
            for item in context["controls"]
        )
    lines.append("files:")
    lines.extend(f"  {path}" for path in context["implementation_files"])
    if context["commands"]:
        lines.append("commands:")
        lines.extend(f"  {item}" for item in context["commands"])
    lines.append("invariants:")
    lines.extend(f"  {item['id']}: {item['statement']}" for item in context["invariants"])
    lines.append("tests:")
    for item in context["tests"]:
        lines.append(f"  {item['id']}: {item.get('command') or 'NO_COMMAND'}")
    lines.append("compactSources:")
    lines.extend(f"  {path}" for path in context["compact_sources"])
    if context["task_packages"]:
        lines.append("taskPackageForScopeOnly:")
        lines.extend(f"  {path}" for path in context["task_packages"])
    if context["escalation_refs"]:
        lines.append("escalationRefs:")
        grouped: dict[tuple[str, str, str], list[str]] = {}
        for item in context["escalation_refs"]:
            key = (
                str(item.get("document") or ""),
                str(item.get("path") or ""),
                str(item.get("revision") or ""),
            )
            grouped.setdefault(key, []).append(str(item.get("section") or ""))
        for (document, path, revision_value), sections in grouped.items():
            revision = f"@{revision_value}" if revision_value else ""
            unique_sections = list(dict.fromkeys(sections))
            lines.append(
                f"  {path} :: {'; '.join(unique_sections)}  # {document}{revision}"
            )
    if context["do_not_use"]:
        lines.append("doNotUse:")
        lines.extend(f"  {item['path']}" for item in context["do_not_use"] if item.get("path"))
    lines.append("review:")
    lines.append("  POST_STEP_REVIEW: REQUIRED")
    lines.append(
        "  CHALLENGE_REVIEW: "
        + ("REQUIRED" if context["review"]["challenge_required"] else "not required unless scope expands to L3")
    )
    lines.append(f"gitStatus: {context['gitStatus']}")
    if context["targeted_dirty"] is None:
        lines.append("targetedDirty: unknown")
    else:
        lines.append(f"targetedDirty: {len(context['targeted_dirty'])}")
        lines.extend(f"  {path}" for path in context["targeted_dirty"])
    rendered = "\n".join(lines) + "\n"
    if len(rendered) > context["render_budget_chars"]:
        raise ValueError(
            f"targeted context is {len(rendered)} chars; "
            f"budget is {context['render_budget_chars']}"
        )
    return rendered


def _render_paths(lines: list[str], label: str, paths: list[str]) -> None:
    if not paths:
        return
    lines.append(f"{label}:")
    lines.extend(f"  {path}" for path in paths[:TEXT_PATH_LIMIT])
    remaining = len(paths) - TEXT_PATH_LIMIT
    if remaining > 0:
        lines.append(f"  ... and {remaining} more")


def render_text(context: dict[str, Any]) -> str:
    task = context["task"]
    lines = [
        "ASA Lab agent context",
        f"source: {context['source']}",
        f"policy: {context['policy']}",
        f"delivery: {context['delivery_workflow']}",
        f"scope: {context['scope']}",
        f"development: {context['development_mode']}",
        f"task: {task.get('id')}",
        f"issue: #{task.get('issue')}",
        f"status: {task.get('status')}",
        f"checkpoint: {task.get('checkpoint')}",
        f"checkpointMarker: {context['checkpoint_marker']}",
        f"contractSection: {context['contract_section_resolution']}",
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
    lines.append(f"documentRegistry: {context['document_registry']}")
    lines.append("read:")
    lines.append("  AGENTS.md")
    lines.append(f"  {context['delivery_workflow']}")
    refs = task.get("normative_refs") or []
    if refs:
        lines.append("normativeRefs:")
        for ref in refs:
            if isinstance(ref, dict):
                lines.append(f"  {ref.get('document')}@{ref.get('revision')}")
    labels = (
        ("readFirst", "read_first"),
        ("readIfNeeded", "read_if_needed"),
        ("doNotUse", "do_not_use"),
        ("reviewProcess", "process"),
    )
    for label, bucket in labels:
        items = context["document_routes"][bucket]
        if not items:
            continue
        lines.append(f"{label}:")
        for item in items:
            revision = f"@{item['revision']}" if item.get("revision") is not None else ""
            lines.append(f"  {item['path']}  # {item['id']}{revision} [{item['role']}]")
    if context["contract_sections"]:
        lines.append("exactContractSections:")
        for section in context["contract_sections"]:
            lines.append(f"  {section['path']}:{section['line']}  # {section['heading']}")
    if context["unregistered_contract_documents"]:
        lines.append("unregisteredLaneDocs:")
        lines.extend(f"  {path}" for path in context["unregistered_contract_documents"])
    if context["contract_section_resolution"] == "not_found":
        lines.append(
            f"WARNING: exact section {context['checkpoint_marker']} was not found "
            "in the lane contract documents; no broader heading was substituted."
        )
    dirty = context["dirty"]
    lines.append(f"gitStatus: {context['gitStatus']}")
    if context["gitStatus"] == "unavailable":
        lines.append(f"gitError: {context['gitError']}")
        lines.append("workingTreeDirty: unknown")
        lines.append("dirtyInScopeCount: unknown")
        lines.append("dirtySharedCount: unknown")
        lines.append("dirtyOverlapCount: unknown")
        lines.append(
            "WARNING: working-tree intersections are unverified; do not start writing."
        )
        return "\n".join(lines) + "\n"

    lines.append(f"workingTreeDirty: {dirty['total_count']}")
    lines.append(f"dirtyInScopeCount: {len(dirty['lane_paths'])}")
    _render_paths(lines, "dirtyInScope", dirty["lane_paths"])
    lines.append(f"dirtySharedCount: {len(dirty['shared_paths'])}")
    _render_paths(lines, "dirtySharedPaths", dirty["shared_paths"])
    lines.append(f"dirtyOverlapCount: {len(dirty['overlap_paths'])}")
    _render_paths(lines, "dirtyOverlapPaths", dirty["overlap_paths"])
    if dirty["overlap_paths"]:
        lines.append(
            "handoff: dirty paths match both lane and shared scopes; owned_paths are "
            "advisory, so coordinate before writing."
        )
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
        if context["gitStatus"] != "available":
            errors.append(
                f"lane {lane.get('id')} git status is unavailable; "
                "working-tree intersections are unknown"
            )
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", help="lane id; defaults to the primary lane, or inferred for a mapped target")
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--surface", help="stable SURF-* id for targeted context")
    target.add_argument("--control", help="stable CTRL-* id for a specific action/control")
    target.add_argument("--path", dest="target_path", help="repository path to resolve through Surface Maps")
    parser.add_argument("--list", action="store_true", help="list available lane ids")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    parser.add_argument("--check", action="store_true", help="validate every lane context")
    parser.add_argument("--root", help=argparse.SUPPRESS)
    return parser.parse_args()


def _configure_utf8_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="strict")


def main() -> int:
    _configure_utf8_streams()
    args = parse_args()
    root = Path(args.root).resolve() if args.root else DEFAULT_ROOT
    try:
        document = load_current(root)
        lanes = collect_lanes(document)
    except ValueError as exc:
        print(f"agent context: FAIL\n- {exc}", file=sys.stderr)
        return 1
    targeted = args.surface is not None or args.control is not None or args.target_path is not None
    if args.list:
        if targeted:
            print("--list cannot be combined with a targeted selector", file=sys.stderr)
            return 2
        for lane in lanes:
            task = lane.get("task") or {}
            print(f"{lane.get('id')}\t{task.get('id')}\t{task.get('status')}")
        return 0
    if args.check:
        if targeted:
            print("--check cannot be combined with a targeted selector", file=sys.stderr)
            return 2
        errors = validate_all(root, document)
        if errors:
            print("ASA Lab agent context validation: FAIL", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        print(f"ASA Lab agent context validation: PASS ({len(lanes)} lanes)")
        return 0

    target_context: dict[str, Any] | None = None
    if targeted:
        try:
            target_context = _resolve_target(
                root,
                surface_id=args.surface,
                control_id=args.control,
                requested_path=args.target_path,
            )
        except ValueError as exc:
            print(f"agent context: FAIL\n- {exc}", file=sys.stderr)
            return 1
    selected = args.scope or (
        str(target_context.get("context")) if target_context is not None else str(lanes[0].get("id"))
    )
    lane = next((item for item in lanes if item.get("id") == selected), None)
    if lane is None:
        available = ", ".join(str(item.get("id")) for item in lanes)
        print(f"unknown scope {selected!r}; available: {available}", file=sys.stderr)
        return 2
    try:
        context = (
            build_targeted_context(root, document, lane, target_context)
            if target_context is not None
            else build_context(root, document, lane)
        )
        rendered = render_targeted_text(context) if target_context is not None else render_text(context)
    except ValueError as exc:
        print(f"agent context: FAIL\n- {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(context, ensure_ascii=False, indent=2))
    else:
        print(rendered, end="")
    return 0 if context["gitStatus"] == "available" else 1


if __name__ == "__main__":
    raise SystemExit(main())
