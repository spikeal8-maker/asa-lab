#!/usr/bin/env python3
"""Validate the ASA Lab product capability graph and release ordering."""

from __future__ import annotations

import re
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
    ROOT / "docs/delivery/DEVELOPMENT_PROGRAM_V1.md",
    ROOT / "docs/delivery/LOCAL_PORT_POLICY.md",
)
ALLOWED_TARGETS = {"foundation", "mvp", "next", "scale", "future"}
CAPABILITY_ID_PATTERN = re.compile(r"^CAP-[A-Z0-9]+(?:-[A-Z0-9]+)*$")
RELEASE_ID_PATTERN = re.compile(r"^RELEASE-[0-9]+$")


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
            errors.append(f"Missing normative file: {path.relative_to(ROOT)}")


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
        if not isinstance(capability_id, str) or not CAPABILITY_ID_PATTERN.fullmatch(
            capability_id
        ):
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
        elif any(not isinstance(item, str) or not item.strip() for item in includes):
            errors.append(f"Capability {capability_id} includes invalid item")
        dependencies = capability.get("depends_on")
        if not isinstance(dependencies, list):
            errors.append(f"Capability {capability_id} depends_on must be an array")
        index[capability_id] = capability

    if len(index) < 25:
        errors.append(f"Capability map is unexpectedly small: {len(index)} capabilities")
    return index


def validate_dependencies(
    capabilities: dict[str, dict[str, Any]], errors: list[str]
) -> None:
    dependencies: dict[str, set[str]] = {key: set() for key in capabilities}
    reverse: dict[str, set[str]] = defaultdict(set)

    for capability_id, capability in capabilities.items():
        raw_dependencies = capability.get("depends_on", [])
        if not isinstance(raw_dependencies, list):
            continue
        for dependency in raw_dependencies:
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
        for dependent in sorted(reverse[current]):
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)
    if visited != len(capabilities):
        cycle = sorted(key for key, count in indegree.items() if count > 0)
        errors.append("Capability dependency cycle detected: " + ", ".join(cycle))


def validate_releases(
    document: dict[str, Any], capabilities: dict[str, dict[str, Any]], errors: list[str]
) -> tuple[int, dict[str, int]]:
    releases = document.get("release_slices")
    if not isinstance(releases, list) or not releases:
        errors.append("release_slices must be a non-empty array")
        return 0, {}

    release_ids: set[str] = set()
    capability_release: dict[str, int] = {}
    for position, release in enumerate(releases):
        if not isinstance(release, dict):
            errors.append(f"Release #{position + 1} must be an object")
            continue
        for field in ("id", "name", "capabilities", "exit"):
            if field not in release:
                errors.append(f"Release #{position + 1} misses {field}")
        release_id = release.get("id")
        if not isinstance(release_id, str) or not RELEASE_ID_PATTERN.fullmatch(release_id):
            errors.append(f"Release #{position + 1} has invalid id: {release_id!r}")
            continue
        expected_id = f"RELEASE-{position}"
        if release_id != expected_id:
            errors.append(
                f"Release positions must be contiguous: expected {expected_id}, got {release_id}"
            )
        if release_id in release_ids:
            errors.append(f"Duplicate release id: {release_id}")
        release_ids.add(release_id)
        if not isinstance(release.get("name"), str) or not release.get("name", "").strip():
            errors.append(f"Release {release_id} has empty name")
        if not isinstance(release.get("exit"), str) or not release.get("exit", "").strip():
            errors.append(f"Release {release_id} has empty exit")
        listed = release.get("capabilities")
        if not isinstance(listed, list) or not listed:
            errors.append(f"Release {release_id} must list capabilities")
            continue
        for capability_id in listed:
            if capability_id not in capabilities:
                errors.append(
                    f"Release {release_id} references unknown capability {capability_id}"
                )
                continue
            if capability_id in capability_release:
                errors.append(
                    f"Capability {capability_id} appears in more than one release"
                )
                continue
            capability_release[capability_id] = position

    uncovered = sorted(set(capabilities) - set(capability_release))
    if uncovered:
        errors.append("Capabilities missing from release slices: " + ", ".join(uncovered))

    for capability_id, capability in capabilities.items():
        current_release = capability_release.get(capability_id)
        if current_release is None:
            continue
        dependencies = capability.get("depends_on", [])
        if not isinstance(dependencies, list):
            continue
        for dependency in dependencies:
            dependency_release = capability_release.get(dependency)
            if dependency_release is None:
                continue
            if dependency_release > current_release:
                errors.append(
                    f"Release ordering violation: {capability_id} in RELEASE-{current_release} "
                    f"depends on later {dependency} in RELEASE-{dependency_release}"
                )

    return len(releases), capability_release


def validate_program_alignment(
    document: dict[str, Any], capability_release: dict[str, int], errors: list[str]
) -> None:
    expected = {
        "CAP-PORTAL-BASIC": 1,
        "CAP-PROJECT-SHELL": 2,
        "CAP-CHECKERS-LITE": 3,
        "CAP-ELECTRONICS-ALPHA": 4,
        "CAP-STUDENT-SEAT": 5,
        "CAP-ASSIGNMENTS": 6,
        "CAP-REVIEW": 7,
        "CAP-ELECTRONICS-CLASSROOM": 8,
    }
    for capability_id, release_position in expected.items():
        actual = capability_release.get(capability_id)
        if actual != release_position:
            errors.append(
                f"Development Program alignment: {capability_id} must be in "
                f"RELEASE-{release_position}, got {actual!r}"
            )

    product = document.get("product")
    if not isinstance(product, dict):
        errors.append("product must be an object")
        return
    definition = product.get("definition")
    outcome = product.get("primary_outcome")
    for field, value in (("definition", definition), ("primary_outcome", outcome)):
        if not isinstance(value, str) or not value.strip():
            errors.append(f"product.{field} must be non-empty")


def main() -> int:
    errors: list[str] = []
    document = load_document(errors)
    validate_files(errors)
    capabilities = validate_capabilities(document, errors)
    validate_dependencies(capabilities, errors)
    releases, capability_release = validate_releases(document, capabilities, errors)
    validate_program_alignment(document, capability_release, errors)

    if errors:
        return fail(errors)

    print("ASA Lab capability map validation: PASS")
    print(f"- capabilities: {len(capabilities)}")
    print(f"- releases: {releases}")
    print("- release dependency ordering: PASS")
    print("- Development Program alignment: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
