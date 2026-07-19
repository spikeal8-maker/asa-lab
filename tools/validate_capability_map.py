#!/usr/bin/env python3
"""Validate the ASA Lab product capability graph."""

from __future__ import annotations

import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "docs/product/CAPABILITY_MAP.yaml"
REQUIRED_FILES = (
    ROOT / "docs/product/README.md",
    ROOT / "docs/product/PRODUCT_BLUEPRINT.md",
    ROOT / "docs/product/CAPABILITY_MAP.md",
    ROOT / "docs/product/CLASSROOM_CORE_SPEC.md",
    ROOT / "docs/product/MODULE_PLATFORM_SPEC.md",
    ROOT / "docs/product/ASSESSMENT_REWARDS_SPEC.md",
)
ALLOWED_TARGETS = {"foundation", "mvp", "next", "scale", "future"}


def fail(errors: list[str]) -> int:
    print("ASA Lab capability map validation: FAIL", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


def load_document(errors: list[str]) -> dict[str, Any]:
    if not MAP_PATH.is_file():
        errors.append(f"Missing capability map: {MAP_PATH.relative_to(ROOT)}")
        return {}
    try:
        value = yaml.safe_load(MAP_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse capability map: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append("Capability map root must be an object")
        return {}
    return value


def validate_files(errors: list[str]) -> None:
    for path in REQUIRED_FILES:
        if not path.is_file():
            errors.append(f"Missing product document: {path.relative_to(ROOT)}")


def validate_capabilities(
    document: dict[str, Any], errors: list[str]
) -> dict[str, dict[str, Any]]:
    capabilities = document.get("capabilities")
    if not isinstance(capabilities, list):
        errors.append("capabilities must be an array")
        return {}

    required = {"id", "name", "domain", "target", "outcome", "includes", "depends_on"}
    index: dict[str, dict[str, Any]] = {}
    for position, capability in enumerate(capabilities, start=1):
        if not isinstance(capability, dict):
            errors.append(f"Capability #{position} must be an object")
            continue
        missing = required - set(capability)
        if missing:
            errors.append(
                f"Capability #{position} misses fields: {', '.join(sorted(missing))}"
            )
            continue
        capability_id = capability.get("id")
        if not isinstance(capability_id, str) or not capability_id.startswith("CAP-"):
            errors.append(f"Capability #{position} has invalid id: {capability_id!r}")
            continue
        if capability_id in index:
            errors.append(f"Duplicate capability id: {capability_id}")
            continue
        if capability.get("target") not in ALLOWED_TARGETS:
            errors.append(
                f"Capability {capability_id} has invalid target: {capability.get('target')!r}"
            )
        for field in ("name", "domain", "outcome"):
            value = capability.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Capability {capability_id} has empty {field}")
        includes = capability.get("includes")
        if not isinstance(includes, list) or not includes:
            errors.append(f"Capability {capability_id} must include at least one item")
        dependencies = capability.get("depends_on")
        if not isinstance(dependencies, list):
            errors.append(f"Capability {capability_id} depends_on must be an array")
        index[capability_id] = capability

    if len(index) < 20:
        errors.append(f"Capability map is unexpectedly small: {len(index)} capabilities")
    return index


def validate_dependencies(
    capabilities: dict[str, dict[str, Any]], errors: list[str]
) -> None:
    dependencies: dict[str, set[str]] = {key: set() for key in capabilities}
    reverse: dict[str, set[str]] = defaultdict(set)

    for capability_id, capability in capabilities.items():
        for dependency in capability.get("depends_on", []):
            if dependency not in capabilities:
                errors.append(
                    f"Capability {capability_id} depends on unknown capability {dependency}"
                )
                continue
            if dependency == capability_id:
                errors.append(f"Capability {capability_id} cannot depend on itself")
                continue
            if dependency in dependencies[capability_id]:
                errors.append(
                    f"Capability {capability_id} repeats dependency {dependency}"
                )
                continue
            dependencies[capability_id].add(dependency)
            reverse[dependency].add(capability_id)

    indegree = {key: len(value) for key, value in dependencies.items()}
    queue = deque(sorted(key for key, count in indegree.items() if count == 0))
    visited = 0
    while queue:
        current = queue.popleft()
        visited += 1
        for dependent in reverse[current]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)
    if visited != len(capabilities):
        cycle = sorted(key for key, count in indegree.items() if count > 0)
        errors.append("Capability dependency cycle detected: " + ", ".join(cycle))


def validate_releases(
    document: dict[str, Any], capabilities: dict[str, dict[str, Any]], errors: list[str]
) -> None:
    releases = document.get("release_slices")
    if not isinstance(releases, list) or not releases:
        errors.append("release_slices must be a non-empty array")
        return

    release_ids: set[str] = set()
    covered: set[str] = set()
    for position, release in enumerate(releases, start=1):
        if not isinstance(release, dict):
            errors.append(f"Release #{position} must be an object")
            continue
        for field in ("id", "name", "capabilities", "exit"):
            if field not in release:
                errors.append(f"Release #{position} misses {field}")
        release_id = release.get("id")
        if not isinstance(release_id, str) or not release_id.startswith("RELEASE-"):
            errors.append(f"Release #{position} has invalid id: {release_id!r}")
            continue
        if release_id in release_ids:
            errors.append(f"Duplicate release id: {release_id}")
        release_ids.add(release_id)
        listed = release.get("capabilities")
        if not isinstance(listed, list) or not listed:
            errors.append(f"Release {release_id} must list capabilities")
            continue
        for capability_id in listed:
            if capability_id not in capabilities:
                errors.append(
                    f"Release {release_id} references unknown capability {capability_id}"
                )
            covered.add(str(capability_id))

    uncovered = sorted(set(capabilities) - covered)
    if uncovered:
        errors.append("Capabilities missing from release slices: " + ", ".join(uncovered))


def main() -> int:
    errors: list[str] = []
    document = load_document(errors)
    validate_files(errors)
    capabilities = validate_capabilities(document, errors)
    validate_dependencies(capabilities, errors)
    validate_releases(document, capabilities, errors)

    if errors:
        return fail(errors)

    print("ASA Lab capability map validation: PASS")
    print(f"- capabilities: {len(capabilities)}")
    print(f"- releases: {len(document.get('release_slices', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
