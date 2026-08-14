#!/usr/bin/env python3
"""Transactional consistency check for the ASA Lab control plane.

docs/execution/current.yaml is the single source of execution state. Every other
surface — entry point, policy, delivery manifest, project map, active test
registry, Git, and the GitHub pull request — must either agree with it or stay
silent about state entirely. Any disagreement is a FAIL, never a judgement call.

GitHub checks are skipped (not failed) when `gh` is unavailable or unauthenticated,
so the same command runs locally, in CI and offline. Pass --require-github to turn
a skipped remote check into a failure.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CURRENT_PATH = ROOT / "docs/execution/current.yaml"
START_HERE_PATH = ROOT / "START_HERE_FOR_AI.md"
AGENTS_PATH = ROOT / "AGENTS.md"
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
ACTIVE_TESTS_PATH = ROOT / "docs/testing/active-task-tests.yaml"
CATALOG_VALIDATOR_PATH = ROOT / "tools/validate_test_catalog.py"
PACKAGE_JSON_PATH = ROOT / "package.json"

TASK_ID_PATTERN = re.compile(r"\bTASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}\b")
PRODUCT_BRANCH_PATTERN = re.compile(r"\bagent/[a-z0-9][a-z0-9./_-]*", re.IGNORECASE)
BRANCH_PATTERN = re.compile(r"(?:main|agent/[a-z0-9][a-z0-9./_-]*)", re.IGNORECASE)
SHA_PATTERN = re.compile(r"\b[0-9a-f]{40}\b")

# Documents that describe policy or process and must not restate execution state.
STATELESS_DOCUMENTS = (START_HERE_PATH, AGENTS_PATH)

# Keys that used to be duplicated into the delivery manifest.
FORBIDDEN_MANIFEST_KEYS = (
    "active_task",
    "active_branch",
    "active_issue",
    "active_checkpoint",
    "sole_executor",
    "assistant_role",
)

REQUIRED_TASK_FIELDS = ("id", "issue", "branch", "base_branch", "status", "checkpoint")
ALLOWED_STATUSES = {"ready", "in_progress", "in_review", "blocked", "done"}
ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
LANE_ID = re.compile(r"^[a-z][a-z0-9-]*$")
PORTABLE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")
SUPPORTED_SCHEMA_VERSIONS = {"1.0.0", "1.1.0"}
DIRECT_MAIN_MODE = "direct_main"

# Engineering invariants AGENTS.md states as already in force. A policy claim
# that nothing checks is how the documents drifted apart in the first place, so
# each one here is a grep the governance gate actually runs.
SOURCE_INVARIANTS = (
    (
        "contexts/electronics/domain/netlist.ts",
        re.compile(r"\blocaleCompare\b"),
        "net numbering must not depend on runtime locale (AGENTS.md §5); "
        "use code-unit comparison instead of localeCompare",
    ),
)


def run(command: list[str], cwd: Path | None = None) -> tuple[int, str]:
    """Run a command in the repository under validation.

    The default is resolved here rather than in the signature: a default argument
    is bound once, when the function is defined, so `cwd: Path = ROOT` would keep
    pointing at the original repository even after bind_root moved everything else
    — and every git question would be answered by the wrong tree.
    """
    try:
        result = subprocess.run(
            command, cwd=cwd or ROOT, capture_output=True, text=True, timeout=90, check=False
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return 1, str(exc)
    return result.returncode, (result.stdout or result.stderr).strip()


def load_yaml(path: Path, errors: list[str]) -> Any:
    if not path.is_file():
        errors.append(f"Missing required file: {path.relative_to(ROOT)}")
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the operator
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return None


# YAML permits a repeated key and keeps the last one, silently. In a file whose
# whole purpose is to be the single answer, a second answer that quietly wins is
# worse than a malformed file: it parses, it validates, and it is not what the
# author wrote. This happened here — current.yaml carried two `blocking` keys and
# every check passed.
STRUCTURED_DOCUMENTS = (
    "docs/execution/current.yaml",
    "docs/delivery/EXECUTION_MANIFEST.yaml",
    "docs/project-map/project-map.yaml",
    "docs/testing/test-catalog.yaml",
    "docs/testing/planned-test-catalog.yaml",
    "docs/testing/active-task-tests.yaml",
)


class _RejectDuplicateKeys(yaml.SafeLoader):
    """A loader that refuses what safe_load accepts."""


def _no_duplicates(loader: yaml.SafeLoader, node: yaml.MappingNode) -> dict:
    seen: set = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None, f"duplicate key {key!r}", key_node.start_mark
            )
        seen.add(key)
    return loader.construct_mapping(node, deep=True)


_RejectDuplicateKeys.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates
)


def check_no_duplicate_keys(errors: list[str]) -> None:
    for relative in STRUCTURED_DOCUMENTS:
        path = ROOT / relative
        if not path.is_file():
            continue
        try:
            yaml.load(path.read_text(encoding="utf-8"), Loader=_RejectDuplicateKeys)
        except yaml.YAMLError as exc:
            detail = str(exc).replace("\n", " ")
            errors.append(f"{relative}: {detail}")


def check_task_record(task: Any, errors: list[str], label: str = "current.yaml task") -> dict[str, Any]:
    if not isinstance(task, dict):
        errors.append(f"{label} must be a mapping")
        return {}
    for field in REQUIRED_TASK_FIELDS:
        if task.get(field) in (None, ""):
            errors.append(f"{label}.{field} must be set")
    if task.get("status") not in ALLOWED_STATUSES:
        errors.append(f"{label}.status invalid: {task.get('status')!r}")
    if not TASK_ID_PATTERN.fullmatch(str(task.get("id", ""))):
        errors.append(f"{label}.id invalid: {task.get('id')!r}")
    branch = task.get("branch")
    if not isinstance(branch, str) or not BRANCH_PATTERN.fullmatch(branch):
        errors.append(f"{label}.branch invalid: {branch!r}")
    issue = task.get("issue")
    if not isinstance(issue, int) or isinstance(issue, bool) or issue <= 0:
        errors.append(f"{label}.issue must be a positive integer")
    pr = task.get("pr")
    if branch == "main":
        if pr is not None and (
            not isinstance(pr, int) or isinstance(pr, bool) or pr <= 0
        ):
            errors.append(f"{label}.pr must be null or a positive integer for main")
    elif not isinstance(pr, int) or isinstance(pr, bool) or pr <= 0:
        errors.append(f"{label}.pr must be a positive integer")
    base_branch = task.get("base_branch")
    if not isinstance(base_branch, str) or not PORTABLE_SEGMENT.fullmatch(base_branch):
        errors.append(f"{label}.base_branch invalid: {base_branch!r}")
    return task


def development_mode(current: dict[str, Any]) -> str:
    policy = current.get("development_policy")
    if not isinstance(policy, dict):
        return "coordinated_lanes"
    return str(policy.get("mode") or "coordinated_lanes")


def check_development_policy(current: dict[str, Any], errors: list[str]) -> str:
    policy = current.get("development_policy")
    if policy is None:
        return "coordinated_lanes"
    if not isinstance(policy, dict):
        errors.append("current.yaml development_policy must be a mapping")
        return "coordinated_lanes"
    mode = development_mode(current)
    if mode != DIRECT_MAIN_MODE:
        errors.append(
            "current.yaml development_policy.mode must be 'direct_main' when declared"
        )
        return mode
    expected = {
        "branch": "main",
        "feature_branches": "optional",
        "pull_requests": "optional",
        "execution_leases": "disabled",
        "lane_path_ownership": "advisory",
    }
    for field, value in expected.items():
        if policy.get(field) != value:
            errors.append(
                f"current.yaml development_policy.{field} must be {value!r} in direct_main mode"
            )
    return mode


def check_current(current: Any, errors: list[str]) -> dict[str, Any]:
    if not isinstance(current, dict):
        errors.append("current.yaml must be a mapping")
        return {}
    version = str(current.get("schema_version") or "1.0.0")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        errors.append(f"current.yaml schema_version unsupported: {version!r}")
    mode = check_development_policy(current, errors)
    task = check_task_record(current.get("task"), errors)
    if mode != DIRECT_MAIN_MODE:
        check_lease(current.get("execution_lease"), errors)
    check_gate_shape(current.get("gates"), errors)
    return task


def check_lease(lease: Any, errors: list[str]) -> None:
    """The lease decides who may write. Declaring it is not enough to trust it."""
    if not isinstance(lease, dict):
        errors.append("current.yaml must declare an execution_lease mapping")
        return
    holder = lease.get("holder")
    executor = lease.get("executor_id")
    acquired = lease.get("acquired_at")
    expires = lease.get("expires_at")
    if not isinstance(executor, str) or not executor.strip():
        errors.append("execution_lease.executor_id must be a non-empty string")
    if holder is None or (not isinstance(holder, str)) or not holder.strip():
        errors.append("execution_lease.holder must be 'unassigned' or the executor id")
        return
    if holder not in {"unassigned", executor}:
        errors.append(
            f"execution_lease.holder {holder!r} must be 'unassigned' or the declared "
            f"executor_id {executor!r}; a second agent cannot grant itself the lease"
        )
    if holder == "unassigned":
        # An unheld lease must not carry the timestamps of a held one, or a
        # reader cannot tell a released lease from a live one.
        if acquired is not None:
            errors.append("execution_lease.acquired_at must be null while holder is unassigned")
        if expires is not None:
            errors.append("execution_lease.expires_at must be null while holder is unassigned")
        return
    parsed: dict[str, datetime] = {}
    for field, value in (("acquired_at", acquired), ("expires_at", expires)):
        if not isinstance(value, str) or not ISO_TIMESTAMP.fullmatch(value):
            errors.append(
                f"execution_lease.{field} must be an ISO-8601 timestamp while the lease is held"
            )
            continue
        try:
            # Compared as instants, not as text: two timestamps written in
            # different UTC offsets sort correctly one way and not the other.
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            errors.append(f"execution_lease.{field} is not a valid timestamp: {exc}")
            continue
        if moment.tzinfo is None:
            errors.append(f"execution_lease.{field} must carry a UTC offset")
            continue
        parsed[field] = moment
    if len(parsed) == 2:
        if parsed["expires_at"] <= parsed["acquired_at"]:
            errors.append("execution_lease.expires_at must be after acquired_at")
        elif parsed["expires_at"] <= datetime.now(timezone.utc):
            # A lease nobody released still locks out every other agent. Expiry
            # has to be observed, or the lock outlives the work it protected.
            errors.append(
                f"execution_lease expired at {expires}; release or extend it before working"
            )


def check_gate_shape(gates: Any, errors: list[str]) -> None:
    if not isinstance(gates, dict) or not gates:
        errors.append("current.yaml must declare gates")
        return
    for name, gate in gates.items():
        if not isinstance(gate, dict):
            errors.append(f"current.yaml gates.{name} must be a mapping")
            continue
        # Outcomes belong to GitHub Actions, which already holds them per commit
        # and cannot be talked out of them. Copying them here produced a second
        # record to keep in step with the first, rewritten after every push, on
        # every branch that carried the file.
        for stale in ("status", "verified_sha", "last_known"):
            if stale in gate:
                errors.append(
                    f"current.yaml gates.{name} records {stale}; outcomes are read from "
                    "GitHub Actions, not written here"
                )
        if not isinstance(gate.get("workflow"), str):
            errors.append(f"current.yaml gates.{name}.workflow must name a GitHub workflow")


def canonical_scope(value: Any, errors: list[str], label: str) -> str | None:
    """Return a portable exact path or terminal /** subtree pattern.

    Scope strings cross Windows, Linux and GitHub runners. Backslashes, drive
    prefixes, traversal, empty segments and partial globs would not identify the
    same files everywhere, so schema 1.1 deliberately permits only one small
    grammar: `segment/segment` or `segment/segment/**`.
    """
    if not isinstance(value, str) or not value:
        errors.append(f"{label} must be a non-empty portable path")
        return None
    if "\\" in value or value.startswith("/") or value.endswith("/") or "//" in value:
        errors.append(f"{label} is not a portable repository-relative path: {value!r}")
        return None
    subtree = value.endswith("/**")
    plain = value[:-3] if subtree else value
    if "*" in plain or "?" in plain or "[" in plain or "]" in plain or ":" in plain:
        errors.append(f"{label} uses an unsupported glob or platform prefix: {value!r}")
        return None
    segments = plain.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        errors.append(f"{label} contains an empty or traversal segment: {value!r}")
        return None
    if any(not PORTABLE_SEGMENT.fullmatch(segment) for segment in segments):
        errors.append(f"{label} contains a non-portable segment: {value!r}")
        return None
    return value


def scope_root(pattern: str) -> tuple[tuple[str, ...], bool]:
    subtree = pattern.endswith("/**")
    plain = pattern[:-3] if subtree else pattern
    return tuple(plain.split("/")), subtree


def scopes_overlap(left: str, right: str) -> bool:
    left_parts, left_tree = scope_root(left)
    right_parts, right_tree = scope_root(right)
    if left_parts == right_parts:
        return True
    if left_tree and right_parts[: len(left_parts)] == left_parts:
        return True
    if right_tree and left_parts[: len(right_parts)] == right_parts:
        return True
    return False


def path_in_scope(path: str, pattern: str) -> bool:
    path_parts = tuple(path.split("/"))
    pattern_parts, subtree = scope_root(pattern)
    return path_parts == pattern_parts or (
        subtree and path_parts[: len(pattern_parts)] == pattern_parts
    )


def collect_lanes(
    current: dict[str, Any], primary_task: dict[str, Any], errors: list[str]
) -> list[dict[str, Any]]:
    """Collect schema 1.0 as one unscoped lane and schema 1.1 as scoped lanes."""
    version = str(current.get("schema_version") or "1.0.0")
    leases_required = development_mode(current) != DIRECT_MAIN_MODE
    primary_meta = current.get("primary_lane")
    parallel = current.get("parallel_lanes")
    integration = current.get("integration")

    if version == "1.0.0":
        if any(value is not None for value in (primary_meta, parallel, integration)):
            errors.append("schema 1.0.0 must not declare schema 1.1 lane fields")
        return [
            {
                "id": "primary",
                "worktree_id": "primary",
                "owned_paths": [],
                "task": primary_task,
                "execution_lease": current.get("execution_lease"),
                "gates": current.get("gates"),
                "revisions": current.get("revisions") or {},
                "scoped": False,
            }
        ]

    if not isinstance(primary_meta, dict):
        errors.append("schema 1.1.0 requires a primary_lane mapping")
        primary_meta = {}
    if not isinstance(parallel, list) or not parallel:
        errors.append("schema 1.1.0 requires a non-empty parallel_lanes list")
        parallel = []
    if not isinstance(integration, dict):
        errors.append("schema 1.1.0 requires an integration mapping")
        integration = {}

    lanes: list[dict[str, Any]] = []
    lane_inputs: list[tuple[str, dict[str, Any], bool]] = [
        ("primary_lane", primary_meta, True)
    ]
    lane_inputs.extend(
        (f"parallel_lanes[{index}]", lane, False)
        for index, lane in enumerate(parallel)
        if isinstance(lane, dict)
    )
    for index, lane in enumerate(parallel):
        if not isinstance(lane, dict):
            errors.append(f"current.yaml parallel_lanes[{index}] must be a mapping")

    for label, source, is_primary in lane_inputs:
        lane_id = source.get("id")
        worktree_id = source.get("worktree_id")
        if not isinstance(lane_id, str) or not LANE_ID.fullmatch(lane_id):
            errors.append(f"current.yaml {label}.id invalid: {lane_id!r}")
        if not isinstance(worktree_id, str) or not LANE_ID.fullmatch(worktree_id):
            errors.append(f"current.yaml {label}.worktree_id invalid: {worktree_id!r}")
        raw_paths = source.get("owned_paths")
        if not isinstance(raw_paths, list) or not raw_paths:
            errors.append(f"current.yaml {label}.owned_paths must be a non-empty list")
            raw_paths = []
        paths = [
            valid
            for path_index, raw in enumerate(raw_paths)
            if (
                valid := canonical_scope(
                    raw, errors, f"current.yaml {label}.owned_paths[{path_index}]"
                )
            )
            is not None
        ]
        if len(paths) != len(set(paths)):
            errors.append(f"current.yaml {label}.owned_paths contains duplicates")

        if is_primary:
            task = primary_task
            lease = current.get("execution_lease")
            gates = current.get("gates")
            revisions = current.get("revisions") or {}
        else:
            task = check_task_record(
                source.get("task"), errors, f"current.yaml {label}.task"
            )
            lease = source.get("execution_lease")
            gates = source.get("gates")
            revisions = source.get("revisions") or {}
            if leases_required:
                check_lease(lease, errors)
            check_gate_shape(gates, errors)
        if not isinstance(revisions, dict):
            errors.append(f"current.yaml {label}.revisions must be a mapping")
            revisions = {}
        required_sha_fields = ("convergence_baseline_sha", "head_sha") if not is_primary else ()
        for sha_field in ("convergence_baseline_sha", "head_sha"):
            value = revisions.get(sha_field)
            if sha_field in required_sha_fields and value is None:
                errors.append(f"current.yaml {label}.revisions.{sha_field} must be a full SHA")
            elif value is not None and (
                not isinstance(value, str) or not FULL_SHA.fullmatch(value)
            ):
                errors.append(f"current.yaml {label}.revisions.{sha_field} must be a full SHA")
        lanes.append(
            {
                "id": lane_id,
                "worktree_id": worktree_id,
                "owned_paths": paths,
                "task": task,
                "execution_lease": lease,
                "gates": gates,
                "revisions": revisions,
                "scoped": True,
            }
        )

    shared_raw = integration.get("shared_paths")
    if not isinstance(shared_raw, list) or not shared_raw:
        errors.append("current.yaml integration.shared_paths must be a non-empty list")
        shared_raw = []
    shared_paths = [
        valid
        for index, raw in enumerate(shared_raw)
        if (valid := canonical_scope(raw, errors, f"current.yaml integration.shared_paths[{index}]"))
        is not None
    ]
    if len(shared_paths) != len(set(shared_paths)):
        errors.append("current.yaml integration.shared_paths contains duplicates")

    for field, values in (
        ("lane id", [lane.get("id") for lane in lanes]),
        ("worktree_id", [lane.get("worktree_id") for lane in lanes]),
        ("task id", [lane.get("task", {}).get("id") for lane in lanes]),
        ("branch", [lane.get("task", {}).get("branch") for lane in lanes]),
        ("issue", [lane.get("task", {}).get("issue") for lane in lanes]),
        ("PR", [lane.get("task", {}).get("pr") for lane in lanes]),
        (
            "executor_id",
            [lane.get("execution_lease", {}).get("executor_id") for lane in lanes],
        ),
    ):
        populated = [value for value in values if value not in (None, "")]
        if len(populated) != len(set(populated)):
            errors.append(f"schema 1.1 lanes must have unique {field} values")

    owner_lane = integration.get("owner_lane")
    lane_ids = {lane.get("id") for lane in lanes}
    if owner_lane not in lane_ids:
        errors.append(
            f"current.yaml integration.owner_lane {owner_lane!r} must name a declared lane"
        )

    for left_index, left in enumerate(lanes):
        for right in lanes[left_index + 1 :]:
            for left_path in left["owned_paths"]:
                for right_path in right["owned_paths"]:
                    if scopes_overlap(left_path, right_path):
                        errors.append(
                            f"lane scopes overlap: {left['id']}:{left_path} and "
                            f"{right['id']}:{right_path}"
                        )
        for owned in left["owned_paths"]:
            for shared in shared_paths:
                if scopes_overlap(owned, shared):
                    errors.append(
                        f"lane {left['id']} owned scope {owned} overlaps shared scope {shared}"
                    )

    for lane in lanes:
        lane["integration_owner"] = lane.get("id") == owner_lane
        lane["shared_paths"] = shared_paths
    return lanes


def check_source_invariants(errors: list[str]) -> None:
    for relative, pattern, message in SOURCE_INVARIANTS:
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"Invariant target is missing: {relative}")
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            # The rationale comment names the forbidden call; only code counts.
            stripped = line.lstrip()
            if stripped.startswith(("*", "//", "/*")):
                continue
            if pattern.search(line):
                errors.append(f"{relative}:{line_number} violates an AGENTS.md invariant — {message}")


def check_stateless_documents(errors: list[str]) -> None:
    """Policy and entry-point documents must not hard-code execution state."""
    for path in STATELESS_DOCUMENTS:
        if not path.is_file():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")
            continue
        name = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            # A reference to the state file itself is the whole point; allow it.
            if "current.yaml" in line:
                continue
            for pattern, label in (
                (TASK_ID_PATTERN, "task id"),
                (PRODUCT_BRANCH_PATTERN, "product branch"),
                (SHA_PATTERN, "commit SHA"),
            ):
                found = pattern.search(line)
                if found:
                    errors.append(
                        f"{name}:{line_number} hard-codes {label} {found.group(0)!r}; "
                        "state belongs only in docs/execution/current.yaml"
                    )


def check_manifest(task: dict[str, Any], errors: list[str]) -> None:
    manifest = load_yaml(MANIFEST_PATH, errors)
    if not isinstance(manifest, dict):
        return
    canonical = manifest.get("canonical_state")
    if isinstance(canonical, dict):
        for key in FORBIDDEN_MANIFEST_KEYS:
            if key in canonical:
                errors.append(
                    f"EXECUTION_MANIFEST.yaml canonical_state.{key} duplicates current.yaml"
                )
    if manifest.get("execution_state_source") != "docs/execution/current.yaml":
        errors.append(
            "EXECUTION_MANIFEST.yaml must declare "
            "execution_state_source: docs/execution/current.yaml"
        )
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list):
        errors.append("EXECUTION_MANIFEST.yaml must contain a tasks array")
        return
    entry = next(
        (item for item in tasks if isinstance(item, dict) and item.get("task_id") == task.get("id")),
        None,
    )
    if entry is None:
        errors.append(f"EXECUTION_MANIFEST.yaml has no task {task.get('id')}")
        return
    if entry.get("status") != task.get("status"):
        errors.append(
            f"EXECUTION_MANIFEST.yaml task status {entry.get('status')!r} != "
            f"current.yaml {task.get('status')!r}"
        )
    for manifest_key, task_key in (("branch", "branch"), ("checkpoint", "checkpoint")):
        if manifest_key in entry and entry.get(manifest_key) != task.get(task_key):
            errors.append(
                f"EXECUTION_MANIFEST.yaml task {manifest_key} {entry.get(manifest_key)!r} != "
                f"current.yaml {task.get(task_key)!r}"
            )


def check_project_map(task: dict[str, Any], errors: list[str]) -> None:
    document = load_yaml(MAP_PATH, errors)
    if not isinstance(document, dict):
        return
    project = document.get("project")
    project = project if isinstance(project, dict) else document
    focus = project.get("current_focus")
    # While a task is in flight the map names it. Once it is done there is nothing
    # to focus on until the next task is defined, and the map says null — which
    # validate_project_map permits only when the executable queue is complete, so
    # a null focus cannot stand in for unfinished work.
    #
    # Demanding the id whatever the status left no way to record a finished task:
    # this check wanted the name, while the map's own focus rule wanted an active
    # node, and a done task is not one.
    if focus != task.get("id") and not (focus is None and task.get("status") == "done"):
        errors.append(
            f"project-map.yaml current_focus {focus!r} != current.yaml task.id {task.get('id')!r}"
        )
    if project.get("active_checkpoint") != task.get("checkpoint"):
        errors.append(
            f"project-map.yaml active_checkpoint {project.get('active_checkpoint')!r} != "
            f"current.yaml task.checkpoint {task.get('checkpoint')!r}"
        )
    nodes = document.get("nodes")
    if isinstance(nodes, list):
        node = next(
            (item for item in nodes if isinstance(item, dict) and item.get("id") == task.get("id")),
            None,
        )
        if node is not None and node.get("status") != task.get("status"):
            errors.append(
                f"project-map.yaml node {task.get('id')} status {node.get('status')!r} != "
                f"current.yaml {task.get('status')!r}"
            )


def check_active_tests(task: dict[str, Any], errors: list[str]) -> None:
    document = load_yaml(ACTIVE_TESTS_PATH, errors)
    if not isinstance(document, dict):
        return
    if document.get("active_task") != task.get("id"):
        errors.append(
            f"active-task-tests.yaml active_task {document.get('active_task')!r} != "
            f"current.yaml task.id {task.get('id')!r}"
        )


def check_catalog_validator(errors: list[str]) -> None:
    if not CATALOG_VALIDATOR_PATH.is_file():
        errors.append("Missing tools/validate_test_catalog.py")
        return
    text = CATALOG_VALIDATOR_PATH.read_text(encoding="utf-8")
    if re.search(r'^ACTIVE_TASK\s*=\s*"', text, re.MULTILINE):
        errors.append(
            "tools/validate_test_catalog.py hard-codes ACTIVE_TASK; "
            "it must read docs/execution/current.yaml"
        )


def check_gate_scripts(
    current: dict[str, Any], errors: list[str], lanes: list[dict[str, Any]] | None = None
) -> None:
    try:
        scripts = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8")).get("scripts", {})
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Cannot read package.json: {exc}")
        return
    gate_sets = (
        [("gates", current.get("gates"))]
        if lanes is None
        else [(f"lane {lane.get('id')} gates", lane.get("gates")) for lane in lanes]
    )
    for gate_label, gates in gate_sets:
        if not isinstance(gates, dict):
            errors.append(f"current.yaml {gate_label} must be a mapping")
            continue
        for name, gate in gates.items():
            if not isinstance(gate, dict):
                errors.append(f"current.yaml {gate_label}.{name} must be a mapping")
                continue
            commands = gate.get("commands")
            if not isinstance(commands, list) or not commands:
                errors.append(
                    f"current.yaml {gate_label}.{name}.commands must be a non-empty list"
                )
                continue
            for command in commands:
                script = str(command).removeprefix("pnpm ").strip()
                if not script or script not in scripts:
                    errors.append(
                        f"current.yaml {gate_label}.{name} references {command!r}, "
                        "which is not a package.json script"
                    )
    if "control-plane:check" not in scripts:
        errors.append("package.json must expose the control-plane:check script")


def changed_paths(ref: str, base_branch: str) -> tuple[list[str], str | None]:
    code, base = run(["git", "merge-base", ref, f"origin/{base_branch}"])
    if code != 0 or not base:
        return [], f"cannot find merge base for {ref} and origin/{base_branch}"
    code, payload = run(["git", "diff", "--name-only", "--no-renames", f"{base}...{ref}"])
    if code != 0:
        return [], f"cannot inspect committed diff for {ref}: {payload}"
    return [line for line in payload.splitlines() if line], None


def current_worktree_paths() -> tuple[list[str], list[str]]:
    paths: list[str] = []
    problems: list[str] = []
    for command, label in (
        (["git", "diff", "--cached", "--name-only", "--no-renames"], "staged"),
        (["git", "diff", "--name-only", "--no-renames"], "unstaged"),
        (["git", "ls-files", "--others", "--exclude-standard"], "untracked"),
    ):
        code, payload = run(command)
        if code != 0:
            problems.append(f"cannot inspect {label} paths: {payload}")
        else:
            paths.extend(line for line in payload.splitlines() if line)
    return paths, problems


def refresh_product_ref(
    branch: str, errors: list[str], notes: list[str], require_remote: bool
) -> str | None:
    """Return a remote-tracking ref that is not silently stale."""
    ref = f"refs/remotes/origin/{branch}"
    local_code, local_oid = run(["git", "rev-parse", "--verify", ref])
    remote_code, remote_payload = run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch]
    )
    if remote_code != 0:
        message = f"cannot verify current remote head of product branch {branch}"
        (errors if require_remote else notes).append(message)
        return ref if local_code == 0 else None
    remote_oid = remote_payload.split()[0] if remote_payload.split() else ""
    if not FULL_SHA.fullmatch(remote_oid):
        errors.append(f"remote returned an invalid head for product branch {branch}")
        return None
    if local_code != 0 or local_oid != remote_oid:
        fetch_code, fetch_output = run(
            [
                "git",
                "fetch",
                "--no-tags",
                "origin",
                f"+refs/heads/{branch}:{ref}",
            ]
        )
        if fetch_code != 0:
            message = f"cannot fetch current head of product branch {branch}: {fetch_output}"
            (errors if require_remote else notes).append(message)
            return ref if local_code == 0 else None
        notes.append(f"refreshed origin/{branch} to {remote_oid[:7]} for scope validation")
    return ref


def check_lane_branch_scopes(
    lanes: list[dict[str, Any]],
    errors: list[str],
    notes: list[str],
    require_remote: bool = False,
) -> None:
    """Validate published branch diffs and every local, not-yet-committed path."""
    code, current_branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if code != 0:
        errors.append(f"cannot determine current branch for scope validation: {current_branch}")
        return
    for lane in lanes:
        if not lane.get("scoped"):
            continue
        task = lane.get("task") or {}
        branch = str(task.get("branch"))
        if current_branch == branch:
            ref = "HEAD"
        else:
            ref = refresh_product_ref(branch, errors, notes, require_remote)
            if ref is None:
                errors.append(
                    f"cannot validate scope of lane {lane.get('id')}: origin/{branch} is unavailable"
                )
                continue
        paths, problem = changed_paths(ref, str(task.get("base_branch")))
        if problem:
            errors.append(f"lane {lane.get('id')}: {problem}")
            continue
        if current_branch == branch:
            worktree_paths, worktree_problems = current_worktree_paths()
            paths.extend(worktree_paths)
            errors.extend(f"lane {lane.get('id')}: {item}" for item in worktree_problems)
        unique_paths = sorted(set(paths))
        for path in unique_paths:
            if path == "docs/execution/current.yaml":
                errors.append(
                    f"product branch {branch} modifies protected docs/execution/current.yaml"
                )
                continue
            owned = any(path_in_scope(path, pattern) for pattern in lane["owned_paths"])
            shared = any(path_in_scope(path, pattern) for pattern in lane["shared_paths"])
            if owned:
                continue
            if shared and lane.get("integration_owner"):
                continue
            if shared:
                errors.append(
                    f"lane {lane.get('id')} changes shared path {path}; only integration owner "
                    "may change shared paths"
                )
            else:
                errors.append(
                    f"lane {lane.get('id')} changes out-of-scope path {path}"
                )
        notes.append(
            f"lane {lane.get('id')} scope: {len(unique_paths)} changed path(s) checked"
        )


def check_git(task: dict[str, Any], errors: list[str], notes: list[str]) -> str | None:
    code, head = run(["git", "rev-parse", "HEAD"])
    if code != 0:
        errors.append(f"Cannot resolve git HEAD: {head}")
        return None
    branch = str(task.get("branch"))
    code, _ = run(["git", "rev-parse", "--verify", f"refs/remotes/origin/{branch}"])
    if code != 0:
        # A missing remote-tracking ref is not the same as a missing branch: a
        # single-branch or shallow clone simply never fetched it. Ask the remote
        # before blaming it, or the validator reports a cause that is not true.
        code, _ = run(["git", "ls-remote", "--exit-code", "--heads", "origin", branch])
        if code != 0:
            errors.append(f"Product branch {branch} does not exist on the remote")
        else:
            notes.append(
                f"origin/{branch} is not fetched in this clone; confirmed on the remote instead"
            )
    code, current_branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if code == 0 and current_branch != branch:
        notes.append(
            f"working on {current_branch}, product branch is {branch} (allowed for control-plane work)"
        )
    return head


def pull_request_state_error(status: str, state: str, task_id: str, pr: Any) -> str | None:
    """Is this pull request in the state the task's status implies?

    While work is in flight a merged or closed pull request cannot be the one the
    task points at. Once the task is done the opposite holds: it must have been
    merged, and an open one would mean the work was called finished without
    landing anywhere.

    The rule used to demand OPEN whatever the status, which made a completed task
    impossible to record: merging the pull request turned main's own gate red, and
    the only way to stay green was never to finish anything. It lived inside
    check_github, which talks to GitHub, so nothing could test it either.
    """
    if status == "done":
        if state != "MERGED":
            return (
                f"current.yaml says {task_id} is done, but PR #{pr} is {state}; "
                "a finished task's pull request is a merged one"
            )
        return None
    if state != "OPEN":
        return (
            f"PR #{pr} is {state}, but current.yaml still names it as the "
            f"pull request for {task_id}"
        )
    return None


def check_github(task: dict[str, Any], errors: list[str], notes: list[str], require: bool) -> None:
    code, _ = run(["gh", "auth", "status"])
    if code != 0:
        message = "GitHub checks skipped: gh is unavailable or unauthenticated"
        (errors if require else notes).append(message)
        return
    pr = task.get("pr")
    code, payload = run(
        ["gh", "pr", "view", str(pr), "--json", "number,isDraft,state,headRefName,headRefOid,body"]
    )
    if code != 0:
        (errors if require else notes).append(f"GitHub checks skipped: cannot read PR #{pr}")
        return
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        errors.append(f"Cannot parse PR #{pr} payload: {exc}")
        return
    if data.get("headRefName") != task.get("branch"):
        errors.append(
            f"PR #{pr} head branch {data.get('headRefName')!r} != "
            f"current.yaml task.branch {task.get('branch')!r}"
        )
    problem = pull_request_state_error(
        status=str(task.get("status")),
        state=str(data.get("state")),
        task_id=str(task.get("id")),
        pr=pr,
    )
    if problem:
        errors.append(problem)
    expected_draft = task.get("pr_draft")
    if isinstance(expected_draft, bool) and bool(data.get("isDraft")) != expected_draft:
        errors.append(
            f"PR #{pr} isDraft={data.get('isDraft')} but current.yaml declares "
            f"task.pr_draft={expected_draft}"
        )
    head_oid = str(data.get("headRefOid", ""))
    expected_head = (task.get("_revisions") or {}).get("head_sha")
    if expected_head is not None and head_oid != expected_head:
        code, detail = run(["git", "merge-base", "--is-ancestor", expected_head, head_oid])
        if code != 0:
            errors.append(
                f"PR #{pr} head {head_oid or '<missing>'} does not descend from the "
                f"activated revisions.head_sha {expected_head}: {detail}"
            )
        else:
            notes.append(
                f"PR #{pr} advanced from activated head {expected_head[:7]} to {head_oid[:7]}"
            )
    body = str(data.get("body") or "")
    # A body that never mentions the current head is describing a different
    notes.append(f"PR #{pr}: draft={data.get('isDraft')} state={data.get('state')} head={head_oid[:7]}")
    head_verified = check_gate_results(task, head_oid, errors, notes, require)
    check_pr_body(task, pr, head_oid, body, head_verified, errors, notes)


def check_pr_body(
    task: dict[str, Any],
    pr: Any,
    head_oid: str,
    body: str,
    head_verified: bool,
    errors: list[str],
    notes: list[str],
) -> None:
    """The body must describe an identified revision, and a review claim must
    describe the current one.

    Demanding the current head unconditionally would turn every ordinary push
    into a red gate, which trains people to ignore the check. The rule instead
    scales with what is being claimed: while work is in progress the body may
    describe the last verified revision, but a task offered for review must
    describe the head a reviewer will actually see.
    """
    if not head_oid:
        return
    if head_oid in body:
        return
    if str(task.get("status")) == "in_review":
        errors.append(
            f"PR #{pr} body does not reference the current head {head_oid[:7]} while "
            f"{task.get('id')} is in_review; a review claim must describe the revision "
            "a reviewer sees"
        )
        return
    # Not an error while work is in progress: a push moves the head, and the body
    # is refreshed straight after. Naming a superseded revision is only a lie once
    # the task is offered for review, which the branch above already covers.
    notes.append(
        f"PR #{pr} body does not name head {head_oid[:7]}; refresh it before review"
    )


def check_gate_results(
    task: dict[str, Any], head_oid: str, errors: list[str], notes: list[str], require: bool
) -> bool:
    """Read each gate's conclusion for the current head from GitHub Actions.

    Nothing is recorded in current.yaml and then compared: GitHub already holds a
    conclusion per commit, and a second copy only creates something to keep in
    step. Reading it makes the answer current by construction, and removes the
    bookkeeping commit that used to follow every push on every branch carrying the
    file.

    Returns True when every gate has a successful completed run on this head.
    """
    gates = task.get("_gates") or {}
    all_green = bool(gates)
    result_is_required = require and str(task.get("status")) == "in_review"
    for name, gate in gates.items():
        workflow = gate.get("workflow")
        code, payload = run(
            [
                "gh", "run", "list",
                "--branch", str(task.get("branch")),
                "--workflow", str(workflow),
                "--limit", "40",
                "--json", "headSha,status,conclusion",
            ]
        )
        # Draft/in-progress work is allowed to have no run yet (including a
        # newly introduced workflow or an externally blocked Actions account).
        # Remote PR identity and head are still checked above. Gate conclusions
        # become mandatory only when the lane claims in_review readiness.
        sink = errors if result_is_required else notes
        if code != 0:
            sink.append(f"gate {name}: cannot read runs of workflow {workflow!r}")
            all_green = False
            continue
        try:
            runs = json.loads(payload)
        except json.JSONDecodeError:
            sink.append(f"gate {name}: unreadable workflow run payload for {workflow!r}")
            all_green = False
            continue
        here = [
            item
            for item in runs
            if item.get("headSha") == head_oid and item.get("status") == "completed"
        ]
        if not here:
            notes.append(f"gate {name}: no completed run on head {head_oid[:7]} yet")
            all_green = False
            continue
        conclusions = {str(item.get("conclusion")) for item in here}
        if conclusions == {"success"}:
            notes.append(f"gate {name}: success on head {head_oid[:7]}")
        else:
            all_green = False
            notes.append(
                f"gate {name}: {', '.join(sorted(conclusions))} on head {head_oid[:7]}"
            )

    # A task offered for review must stand on a head the gates have actually
    # passed. Mid-work this is normal and only noted; claiming readiness without
    # it is the failure this mechanism exists to prevent.
    if str(task.get("status")) == "in_review" and not all_green:
        errors.append(
            f"{task.get('id')} is in_review, but not every gate has a successful run on "
            f"head {head_oid[:7]}"
        )
    return all_green


def check_state_file_is_canonical(
    task: dict[str, Any] | list[dict[str, Any]], errors: list[str], notes: list[str]
) -> None:
    """The branch doing the work inherits programme state; it does not author it.

    A file tracked in main is inherited by every branch cut from it, so "the file
    exists nowhere else" is not a condition Git can satisfy. What can be required
    is that the branch doing the work does not also rewrite the record of what the
    work is — otherwise the two copies drift, which is what happened.

    A governance branch proposing a change to main is the intended way to change
    it, so the rule does not apply there.

    The comparison is against the merge base, not against the tip of main. Against
    the tip, a branch that has never touched the file fails the moment main's copy
    changes for reasons of its own — releasing a lease did exactly that — because
    "inherited and now behind" and "edited here" look identical from the tip. From
    the merge base they do not: equal means this branch left the file alone,
    whatever main has done since.
    """
    code, branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if code != 0:
        notes.append("cannot determine the current branch; canonical-copy check skipped")
        return
    tasks = task if isinstance(task, list) else [task]
    product_task = next(
        (candidate for candidate in tasks if branch == str(candidate.get("branch"))), None
    )
    if product_task is None:
        product_branches = ", ".join(str(candidate.get("branch")) for candidate in tasks)
        notes.append(
            f"on {branch}: not a product branch ({product_branches}), so it may propose state changes"
        )
        return

    code, base = run(["git", "merge-base", "HEAD", "origin/main"])
    if code != 0 or not base:
        notes.append("no merge base with origin/main; canonical-copy check skipped")
        return

    def blob(ref: str) -> str | None:
        """Read verbatim: run() strips, and a stripped blob can never equal a file
        that ends in a newline, so every comparison would fail for the wrong reason."""
        try:
            shown = subprocess.run(
                ["git", "show", f"{ref}:docs/execution/current.yaml"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=90,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return shown.stdout if shown.returncode == 0 else None

    inherited = blob(base)
    if inherited is None:
        notes.append("merge-base copy of current.yaml unreadable; comparison skipped")
        return

    here = CURRENT_PATH.read_text(encoding="utf-8")
    if here != inherited:
        errors.append(
            f"task branch {branch} modifies docs/execution/current.yaml relative to the "
            "merge base with origin/main; programme state changes on main and is "
            "inherited, never edited where the work happens"
        )
        return

    tip = blob("origin/main")
    if tip is not None and here != tip:
        notes.append(
            "current.yaml is inherited unmodified but behind origin/main; "
            "merging main will bring it forward"
        )
    else:
        notes.append("current.yaml matches origin/main byte for byte")


def bind_root(root: Path) -> None:
    """Point every path this validator reads at `root`.

    The paths are module-level so the checks can stay small, which also means the
    validator could only ever examine the repository it happens to live in — and
    so could only be tested by breaking that repository. A fixture repository is
    the only way to exercise a rule like "a task branch must not modify the state
    file" without doing it here for real.
    """
    global ROOT, CURRENT_PATH, START_HERE_PATH, AGENTS_PATH, MANIFEST_PATH
    global MAP_PATH, ACTIVE_TESTS_PATH, CATALOG_VALIDATOR_PATH, PACKAGE_JSON_PATH
    global STATELESS_DOCUMENTS

    ROOT = root.resolve()
    CURRENT_PATH = ROOT / "docs/execution/current.yaml"
    START_HERE_PATH = ROOT / "START_HERE_FOR_AI.md"
    AGENTS_PATH = ROOT / "AGENTS.md"
    MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
    MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
    ACTIVE_TESTS_PATH = ROOT / "docs/testing/active-task-tests.yaml"
    CATALOG_VALIDATOR_PATH = ROOT / "tools/validate_test_catalog.py"
    PACKAGE_JSON_PATH = ROOT / "package.json"
    STATELESS_DOCUMENTS = (START_HERE_PATH, AGENTS_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-github", action="store_true")
    parser.add_argument(
        "--root",
        help="repository to validate; defaults to the one this file lives in. "
        "Used by the regression suite, which needs fixture repositories that are "
        "broken on purpose.",
    )
    args = parser.parse_args()
    if args.root:
        bind_root(Path(args.root))

    errors: list[str] = []
    notes: list[str] = []

    current = load_yaml(CURRENT_PATH, errors)
    if current is None:
        print("ASA Lab control plane validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    check_no_duplicate_keys(errors)
    task = check_current(current, errors)
    if task:
        direct_main = development_mode(current) == DIRECT_MAIN_MODE
        lanes = collect_lanes(current, task, errors)
        # Revisions listed in current.yaml are legitimate historical references.
        lane_tasks = [
            {
                **(lane.get("task") or {}),
                "_revisions": lane.get("revisions") or {},
                "_gates": lane.get("gates") or {},
                "_lane_id": lane.get("id"),
            }
            for lane in lanes
        ]
        task = lane_tasks[0]
        check_stateless_documents(errors)
        check_source_invariants(errors)
        check_catalog_validator(errors)
        check_gate_scripts(current, errors, lanes)
        if direct_main:
            notes.append(
                "direct_main mode: leases, lane path ownership, product branches and PRs "
                "are advisory and do not block development"
            )
        else:
            check_state_file_is_canonical(lane_tasks, errors, notes)
            check_manifest(task, errors)
            check_project_map(task, errors)
            check_active_tests(task, errors)
            check_lane_branch_scopes(lanes, errors, notes, args.require_github)
            for lane_task in lane_tasks:
                check_git(lane_task, errors, notes)
                check_github(lane_task, errors, notes, args.require_github)

    if errors:
        print("ASA Lab control plane validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA Lab control plane validation: PASS")
    print(f"activeTask={task.get('id')}")
    if development_mode(current) == DIRECT_MAIN_MODE:
        print("developmentMode=direct_main")
        print("branch=main")
        print("pullRequests=optional")
        print("executionLeases=disabled")
    else:
        print(f"branch={task.get('branch')}")
        print(f"pr={task.get('pr')}")
        print(f"leaseHolder={(current.get('execution_lease') or {}).get('holder')}")
    print(f"status={task.get('status')}")
    if len(lane_tasks) > 1:
        print(f"lanes={','.join(str(lane.get('id')) for lane in lanes)}")
        print(f"integrationOwner={(current.get('integration') or {}).get('owner_lane')}")
    blocking = current.get("blocking") or []
    print(f"blocking={len(blocking)}")
    for note in notes:
        print(f"note: {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
