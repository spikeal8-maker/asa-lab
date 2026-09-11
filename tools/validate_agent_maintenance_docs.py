#!/usr/bin/env python3
"""Validate compact agent Domain Contracts and Surface Maps."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = "docs/agent/document-registry.yaml"
DOMAIN_SCHEMA_PATH = "docs/agent/schemas/domain-contract-v1.yaml"
SURFACE_SCHEMA_PATH = "docs/agent/schemas/surface-map-v1.yaml"
CONTRACT_DIR = "docs/agent/contracts"
SURFACE_DIR = "docs/agent/surfaces"
TEST_CATALOGS = (
    "docs/testing/test-catalog.yaml",
    "docs/testing/active-task-tests.yaml",
)


class _RejectDuplicateKeys(yaml.SafeLoader):
    pass


def _no_duplicates(loader: yaml.SafeLoader, node: yaml.MappingNode) -> dict:
    seen: set[Any] = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        if key in seen:
            raise yaml.constructor.ConstructorError(None, None, f"duplicate key {key!r}", key_node.start_mark)
        seen.add(key)
    return loader.construct_mapping(node, deep=True)

_RejectDuplicateKeys.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates
)


def _load_yaml(path: Path) -> Any:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_RejectDuplicateKeys)


def _safe_repo_path(raw: Any) -> bool:
    if not isinstance(raw, str) or not raw or "\\" in raw:
        return False
    path = PurePosixPath(raw)
    return not path.is_absolute() and ".." not in path.parts


def _load_registry(root: Path, errors: list[str]) -> dict[str, dict[str, Any]]:
    path = root / REGISTRY_PATH
    if not path.is_file():
        errors.append(f"missing {REGISTRY_PATH}")
        return {}
    try:
        data = _load_yaml(path)
    except yaml.YAMLError as exc:
        errors.append(f"cannot parse {REGISTRY_PATH}: {exc}")
        return {}
    documents = data.get("documents") if isinstance(data, dict) else None
    if not isinstance(documents, list):
        errors.append(f"{REGISTRY_PATH} documents must be an array")
        return {}
    return {
        str(item.get("id")): item
        for item in documents
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }

def _load_test_ids(root: Path, errors: list[str]) -> set[str]:
    result: set[str] = set()
    for relative in TEST_CATALOGS:
        path = root / relative
        if not path.is_file():
            errors.append(f"missing test catalog {relative}")
            continue
        try:
            data = _load_yaml(path)
        except yaml.YAMLError as exc:
            errors.append(f"cannot parse {relative}: {exc}")
            continue
        tests = data.get("tests") if isinstance(data, dict) else None
        if not isinstance(tests, list):
            errors.append(f"{relative} tests must be an array")
            continue
        for item in tests:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                result.add(item["id"])
    return result


def _load_schema(root: Path, relative: str, expected_id: str, errors: list[str]) -> dict[str, Any]:
    path = root / relative
    if not path.is_file():
        errors.append(f"missing schema {relative}")
        return {}
    try:
        data = _load_yaml(path)
    except yaml.YAMLError as exc:
        errors.append(f"cannot parse {relative}: {exc}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"{relative} must be a mapping")
        return {}
    if data.get("schema_id") != expected_id:
        errors.append(f"{relative} schema_id must be {expected_id}")
    for label, pattern in (data.get("id_rules") or {}).items():
        try:
            re.compile(str(pattern))
        except re.error as exc:
            errors.append(f"{relative} id_rules.{label} invalid regex: {exc}")
    return data


def _required_mapping_fields(
    raw: Any, required: list[str], label: str, errors: list[str]
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        errors.append(f"{label} must be a mapping")
        return {}
    missing = [field for field in required if field not in raw]
    if missing:
        errors.append(f"{label} missing fields: {', '.join(missing)}")
    return raw

_SECTION_ID_PATTERN = re.compile(r"\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b")
_SECTION_NUMBER_PATTERN = re.compile(r"§(\d+(?:\.\d+)*)")


def _validate_master_ref_target(
    root: Path,
    registry: dict[str, dict[str, Any]],
    ref: dict[str, Any],
    label: str,
    errors: list[str],
) -> None:
    document_id = str(ref.get("document") or "")
    registered = registry.get(document_id)
    if registered is None:
        return
    relative = registered.get("path")
    if not _safe_repo_path(relative):
        errors.append(f"{label}.document has no safe registered path")
        return
    target = root / PurePosixPath(str(relative))
    if not target.is_file():
        return
    text = target.read_text(encoding="utf-8")
    section = str(ref.get("section") or "").strip()
    ids = _SECTION_ID_PATTERN.findall(section)
    numbers = _SECTION_NUMBER_PATTERN.findall(section)
    for token in ids:
        if not re.search(rf"(?<![A-Z0-9-]){re.escape(token)}(?![A-Z0-9-])", text):
            errors.append(f"{label}.section references missing anchor {token} in {relative}")
    for number in numbers:
        heading = re.compile(rf"^#{{1,6}}\s+{re.escape(number)}(?:[.\s]|$)", re.MULTILINE)
        if not heading.search(text):
            errors.append(f"{label}.section references missing heading §{number} in {relative}")
    if not ids and not numbers and section.casefold() not in text.casefold():
        errors.append(f"{label}.section text was not found in {relative}: {section!r}")

def _validate_contract(
    root: Path,
    path: Path,
    schema: dict[str, Any],
    registry: dict[str, dict[str, Any]],
    invariant_ids: set[str],
    invariant_domains: dict[str, str],
    errors: list[str],
) -> None:
    relative = path.relative_to(root).as_posix()
    try:
        data = _load_yaml(path)
    except yaml.YAMLError as exc:
        errors.append(f"{relative}: {exc}")
        return
    required = list(schema.get("required_top_level") or [])
    doc = _required_mapping_fields(data, required, relative, errors)
    if not doc:
        return
    if doc.get("schema_version") != "1.0.0":
        errors.append(f"{relative}.schema_version must be '1.0.0'")
    for forbidden in schema.get("forbidden_top_level") or []:
        if forbidden in doc:
            errors.append(f"{relative} must not contain live-state field {forbidden}")

    contract_pattern = re.compile(str((schema.get("id_rules") or {}).get("contract_id")))
    invariant_pattern = re.compile(str((schema.get("id_rules") or {}).get("invariant_id")))
    if not contract_pattern.fullmatch(str(doc.get("contract_id") or "")):
        errors.append(f"{relative}.contract_id has invalid format")
    domain = doc.get("domain")
    if not isinstance(domain, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", domain):
        errors.append(f"{relative}.domain has invalid format")
    registry_id = doc.get("registry_document_id")
    registered = registry.get(str(registry_id))
    if registered is None:
        errors.append(f"{relative}.registry_document_id points to unknown document")
    else:
        if registered.get("path") != relative:
            errors.append(f"{relative} registry path does not match {registry_id}")
        if registered.get("status") != "canonical" or registered.get("context_role") != "compact":
            errors.append(f"{relative} must be registered as canonical compact authority")

    masters = doc.get("master_documents")
    if not isinstance(masters, list) or not masters:
        errors.append(f"{relative}.master_documents must be a non-empty array")
    else:
        for master_id in masters:
            master = registry.get(str(master_id))
            if master is None:
                errors.append(f"{relative} references unknown master document {master_id}")
            elif master.get("status") != "canonical" or master.get("context_role") not in {"target", "escalation"}:
                errors.append(f"{relative} master {master_id} must be canonical target/escalation")

    invariants = doc.get("invariants")
    if not isinstance(invariants, list) or not invariants:
        errors.append(f"{relative}.invariants must be a non-empty array")
        return
    required_inv = list(schema.get("invariant_required_fields") or [])
    local_ids: set[str] = set()
    for index, raw in enumerate(invariants):
        label = f"{relative}.invariants[{index}]"
        inv = _required_mapping_fields(raw, required_inv, label, errors)
        if not inv:
            continue
        invariant_id = str(inv.get("id") or "")
        if not invariant_pattern.fullmatch(invariant_id):
            errors.append(f"{label}.id has invalid format")
        elif invariant_id in local_ids or invariant_id in invariant_ids:
            errors.append(f"duplicate invariant id: {invariant_id}")
        else:
            local_ids.add(invariant_id)
            invariant_ids.add(invariant_id)
            invariant_domains[invariant_id] = str(domain)
        if not isinstance(inv.get("statement"), str) or not inv.get("statement").strip():
            errors.append(f"{label}.statement must be non-empty")
        master_refs = inv.get("master_refs")
        if not isinstance(master_refs, list) or not master_refs:
            errors.append(f"{label}.master_refs must be non-empty")
        else:
            master_ids = {str(item) for item in (masters or [])}
            required_ref = list(schema.get("master_ref_required_fields") or [])
            for ref_index, raw_ref in enumerate(master_refs):
                ref_label = f"{label}.master_refs[{ref_index}]"
                ref = _required_mapping_fields(raw_ref, required_ref, ref_label, errors)
                if not ref:
                    continue
                if str(ref.get("document")) not in master_ids:
                    errors.append(f"{ref_label}.document must name a master_documents entry")
                if not isinstance(ref.get("section"), str) or not ref.get("section").strip():
                    errors.append(f"{ref_label}.section must be non-empty")
                else:
                    _validate_master_ref_target(root, registry, ref, ref_label, errors)
        if not isinstance(inv.get("applies_to"), list) or not inv.get("applies_to"):
            errors.append(f"{label}.applies_to must be non-empty")

def _compact_route_lanes(
    registry: dict[str, dict[str, Any]], context: str
) -> set[str]:
    lanes: set[str] = set()
    for raw in registry.values():
        if (
            raw.get("status") == "canonical"
            and raw.get("context_role") == "compact"
            and raw.get("scope") == context
        ):
            for lane in raw.get("lanes") or []:
                if isinstance(lane, str) and lane and lane != "*":
                    lanes.add(lane)
    return lanes


def _validate_surface_map(
    root: Path,
    path: Path,
    schema: dict[str, Any],
    invariant_ids: set[str],
    invariant_domains: dict[str, str],
    registry: dict[str, dict[str, Any]],
    surface_ids: set[str],
    control_ids: set[str],
    test_ids: set[str],
    errors: list[str],
) -> None:
    relative = path.relative_to(root).as_posix()
    try:
        data = _load_yaml(path)
    except yaml.YAMLError as exc:
        errors.append(f"{relative}: {exc}")
        return
    required = list(schema.get("required_top_level") or [])
    doc = _required_mapping_fields(data, required, relative, errors)
    if not doc:
        return
    if doc.get("schema_version") != "1.0.0":
        errors.append(f"{relative}.schema_version must be '1.0.0'")
    for forbidden in schema.get("forbidden_top_level") or []:
        if forbidden in doc:
            errors.append(f"{relative} must not contain routing/live-state field {forbidden}")
    context = doc.get("context")
    if not isinstance(context, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", context):
        errors.append(f"{relative}.context must be a bounded-context id")
        context = ""
    if context:
        lanes = _compact_route_lanes(registry, context)
        if len(lanes) != 1:
            errors.append(
                f"{relative}.context {context!r} must route through exactly one canonical "
                f"compact-document lane; found {sorted(lanes)}"
            )

    surface_pattern = re.compile(str((schema.get("id_rules") or {}).get("surface_id")))
    control_pattern = re.compile(str((schema.get("id_rules") or {}).get("control_id")))
    test_pattern = re.compile(str((schema.get("id_rules") or {}).get("test_id")))
    allowed_classes = set(schema.get("allowed_change_classes") or [])
    surfaces = doc.get("surfaces")
    if not isinstance(surfaces, list) or not surfaces:
        errors.append(f"{relative}.surfaces must be a non-empty array")
        return
    required_surface = list(schema.get("surface_required_fields") or [])
    for index, raw in enumerate(surfaces):
        label = f"{relative}.surfaces[{index}]"
        surface = _required_mapping_fields(raw, required_surface, label, errors)
        if not surface:
            continue
        surface_id = str(surface.get("id") or "")
        if not surface_pattern.fullmatch(surface_id):
            errors.append(f"{label}.id has invalid format")
        elif surface_id in surface_ids:
            errors.append(f"duplicate surface id: {surface_id}")
        else:
            surface_ids.add(surface_id)

        routes = surface.get("routes")
        if not isinstance(routes, list) or not routes or not all(isinstance(item, str) and item for item in routes):
            errors.append(f"{label}.routes must be a non-empty string array")

        implementation = surface.get("implementation")
        if not isinstance(implementation, dict):
            errors.append(f"{label}.implementation must be a mapping")
        else:
            files = implementation.get("files")
            if not isinstance(files, list) or not files:
                errors.append(f"{label}.implementation.files must be non-empty")
            else:
                for item in files:
                    if not _safe_repo_path(item):
                        errors.append(f"{label} has unsafe implementation path {item!r}")
                    elif not (root / PurePosixPath(str(item))).is_file():
                        errors.append(f"{label} implementation path does not exist: {item}")

        refs = surface.get("invariants")
        if not isinstance(refs, list):
            errors.append(f"{label}.invariants must be an array")
        else:
            for invariant_id in refs:
                invariant_key = str(invariant_id)
                if invariant_key not in invariant_ids:
                    errors.append(f"{label} references unknown invariant {invariant_id}")
                elif context and invariant_domains.get(invariant_key) != context:
                    errors.append(
                        f"{label} references invariant {invariant_key} from bounded context "
                        f"{invariant_domains.get(invariant_key)!r}, expected {context!r}"
                    )

        tests = surface.get("tests")
        if not isinstance(tests, list) or not tests or not all(isinstance(item, str) and item for item in tests):
            errors.append(f"{label}.tests must be a non-empty string array")
        else:
            for test_id in tests:
                if not test_pattern.fullmatch(test_id):
                    errors.append(f"{label}.tests contains invalid test id {test_id!r}")
                elif test_id not in test_ids:
                    errors.append(f"{label}.tests references unregistered test {test_id}")

        controls = surface.get("controls") or []
        if not isinstance(controls, list):
            errors.append(f"{label}.controls must be an array")
            continue
        required_control = list(schema.get("control_required_fields") or [])
        for control_index, raw_control in enumerate(controls):
            control_label = f"{label}.controls[{control_index}]"
            control = _required_mapping_fields(
                raw_control, required_control, control_label, errors
            )
            if not control:
                continue
            control_id = str(control.get("id") or "")
            if not control_pattern.fullmatch(control_id):
                errors.append(f"{control_label}.id has invalid format")
            elif control_id in control_ids:
                errors.append(f"duplicate control id: {control_id}")
            else:
                control_ids.add(control_id)
            change_class = control.get("change_class")
            if change_class not in allowed_classes:
                errors.append(f"{control_label}.change_class invalid: {change_class!r}")
            files = control.get("files")
            if not isinstance(files, list) or not files:
                errors.append(f"{control_label}.files must be non-empty")
            else:
                for item in files:
                    if not _safe_repo_path(item):
                        errors.append(f"{control_label} has unsafe file path {item!r}")
                    elif not (root / PurePosixPath(str(item))).is_file():
                        errors.append(f"{control_label} file does not exist: {item}")
            refs = control.get("invariants")
            if not isinstance(refs, list):
                errors.append(f"{control_label}.invariants must be an array")
            else:
                for invariant_id in refs:
                    invariant_key = str(invariant_id)
                    if invariant_key not in invariant_ids:
                        errors.append(f"{control_label} references unknown invariant {invariant_id}")
                    elif context and invariant_domains.get(invariant_key) != context:
                        errors.append(
                            f"{control_label} references invariant {invariant_key} from bounded context "
                            f"{invariant_domains.get(invariant_key)!r}, expected {context!r}"
                        )
            control_tests = control.get("tests")
            if not isinstance(control_tests, list) or not control_tests:
                errors.append(f"{control_label}.tests must be non-empty")
            else:
                for test_id in control_tests:
                    if not isinstance(test_id, str) or not test_pattern.fullmatch(test_id):
                        errors.append(f"{control_label}.tests contains invalid test id {test_id!r}")
                    elif test_id not in test_ids:
                        errors.append(f"{control_label}.tests references unregistered test {test_id}")


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    registry = _load_registry(root, errors)
    domain_schema = _load_schema(
        root, DOMAIN_SCHEMA_PATH, "ASA-AGENT-DOMAIN-CONTRACT-V1", errors
    )
    surface_schema = _load_schema(
        root, SURFACE_SCHEMA_PATH, "ASA-AGENT-SURFACE-MAP-V1", errors
    )
    invariant_ids: set[str] = set()
    invariant_domains: dict[str, str] = {}
    surface_ids: set[str] = set()
    control_ids: set[str] = set()
    test_ids = _load_test_ids(root, errors)

    contract_paths = sorted((root / CONTRACT_DIR).glob("*.yaml"))
    surface_paths = sorted((root / SURFACE_DIR).glob("*.yaml"))
    for path in contract_paths:
        _validate_contract(
            root, path, domain_schema, registry, invariant_ids, invariant_domains, errors
        )
    for path in surface_paths:
        _validate_surface_map(
            root, path, surface_schema, invariant_ids, invariant_domains, registry,
            surface_ids, control_ids, test_ids, errors
        )
    return errors

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    errors = validate(root)
    if errors:
        print("agent maintenance docs: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    contract_count = len(list((root / CONTRACT_DIR).glob("*.yaml")))
    surface_count = len(list((root / SURFACE_DIR).glob("*.yaml")))
    print(
        "agent maintenance docs: PASS "
        f"(contracts={contract_count}, surfaceMaps={surface_count})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
