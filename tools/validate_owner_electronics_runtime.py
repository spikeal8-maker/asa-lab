#!/usr/bin/env python3
"""Fail-closed validation for the owner-supplied Electronics runtime catalog."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps/web/public"
ASSETS = PUBLIC / "assets/electronics"
MANIFEST = ASSETS / "owner-catalog/manifest.json"
AUDIT_MANIFEST = ASSETS / "owner-audit/manifest.json"
EXPECTED_SCHEMA = "asa-lab.electronics-owner-catalog.v1"
EXPECTED_EXACT_FILES = 650
OWNER_APPROVED_REFERENCE_CANDIDATES = {
    f"components/reference-candidates/{name}.svg"
    for name in (
        "arduino-uno",
        "battery-9v",
        "dc-motor",
        "electrolytic-capacitor",
        "multimeter",
        "photoresistor",
        "piezo",
        "potentiometer",
        "regulated-power-supply",
        "resistor-axial",
        "servo-motor",
        "transistor-npn",
    )
}
PROHIBITED_PATHS = (
    ROOT / "tools/electronics-production-vectors",
    ROOT / "tools/build_electronics_production_assets.py",
    ROOT / "tools/vectorize_owner_references.py",
)
PROHIBITED_SOURCE_MARKERS = (
    "/assets/electronics/production/",
    "RESISTOR_BODY_ASSET",
    "RESISTOR_PREVIEW_ASSET",
    "derived_from_owner_reference",
    "electronics-production-vectors",
)


def fail(message: str) -> None:
    raise RuntimeError(message)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runtime_file(url: str) -> Path:
    prefix = "/assets/electronics/owner-audit/"
    if not url.startswith(prefix) or not url.endswith(".svg"):
        fail(f"runtime asset is not an owner-audit SVG: {url}")
    path = ASSETS / "owner-audit" / url.removeprefix(prefix)
    try:
        path.resolve().relative_to((ASSETS / "owner-audit").resolve())
    except ValueError:
        fail(f"runtime asset escapes owner-audit: {url}")
    if not path.is_file():
        fail(f"runtime SVG missing: {url}")
    return path


def validate_svg(path: Path) -> None:
    raw = path.read_bytes()
    lowered = raw.lower()
    if b"data:image" in lowered or b"base64" in lowered:
        fail(f"embedded raster/base64 in runtime SVG: {path}")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        fail(f"invalid runtime SVG {path}: {error}")
    for element in root.iter():
        local = element.tag.rsplit("}", 1)[-1].lower()
        if local in {"image", "foreignobject", "script"}:
            fail(f"forbidden <{local}> in runtime SVG: {path}")
        for key, value in element.attrib.items():
            if key.rsplit("}", 1)[-1].lower() in {"href", "src"}:
                normalized = value.strip().lower()
                if normalized.startswith(("http:", "https:", "//", "data:")):
                    fail(f"external/raster reference in runtime SVG: {path}: {value}")


def load_manifest() -> dict[str, Any]:
    if not MANIFEST.is_file():
        fail("owner-catalog/manifest.json is missing")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def accepted_owner_assets() -> dict[str, dict[str, Any]]:
    if not AUDIT_MANIFEST.is_file():
        fail("immutable owner-audit/manifest.json is missing")
    audit = json.loads(AUDIT_MANIFEST.read_text(encoding="utf-8"))
    accepted: dict[str, dict[str, Any]] = {}
    for item in audit.get("importedReviewAssets", []):
        path = item.get("importedFile")
        acceptance = str(item.get("acceptance", ""))
        explicitly_approved_reference = path in OWNER_APPROVED_REFERENCE_CANDIDATES
        if (
            isinstance(path, str)
            and path.endswith(".svg")
            and item.get("provenance") == "owner_supplied"
            and (
                explicitly_approved_reference
                or (
                    "unaccepted" not in acceptance
                    and "candidate" not in acceptance
                    and "raster" not in acceptance
                )
            )
        ):
            accepted[path] = item
    if not accepted:
        fail("owner audit contains no accepted owner SVG records")
    return accepted


def assert_owner_audit_match(
    runtime_url: str,
    source_archive: str,
    source_path: str,
    source_sha: str,
    accepted: dict[str, dict[str, Any]],
) -> None:
    imported_file = runtime_url.removeprefix("/assets/electronics/owner-audit/")
    evidence = accepted.get(imported_file)
    if evidence is None:
        fail(f"unknown or unaccepted SVG entered runtime: {runtime_url}")
    if (
        evidence.get("sourceArchive") != source_archive
        or evidence.get("sourceFile") != source_path
        or evidence.get("sha256") != source_sha
    ):
        fail(f"runtime provenance differs from immutable owner audit: {runtime_url}")


def validate_catalog(
    manifest: dict[str, Any],
    accepted: dict[str, dict[str, Any]],
) -> dict[str, int]:
    if manifest.get("schema") != EXPECTED_SCHEMA:
        fail(f"unexpected owner catalog schema: {manifest.get('schema')}")
    if manifest.get("worldUnitsPerMm") != 5:
        fail("owner catalog must use the single WORLD_UNITS_PER_MM=5")
    policy = manifest.get("policy", {})
    if policy.get("failClosed") is not True or policy.get("runtimeArt") != "byte_exact_owner_svg_only":
        fail("owner catalog is not fail-closed")

    components = manifest.get("components", [])
    if len(components) <= 33:
        fail(f"owner catalog is still truncated: {len(components)} positions")
    ids = [item.get("componentId") for item in components]
    variants = [item.get("variantId") for item in components]
    if len(ids) != len(set(ids)) or len(variants) != len(set(variants)):
        fail("componentId/variantId values must be unique")
    expected_order = sorted(
        components,
        key=lambda item: (item["catalogOrder"], item["familyId"], item["variantId"]),
    )
    if components != expected_order:
        fail("owner catalog ordering is not deterministic")
    for family_id in {item["familyId"] for item in components}:
        defaults = [
            item for item in components
            if item["familyId"] == family_id and item.get("isDefaultVariant") is True
        ]
        if len(defaults) != 1:
            fail(f"family must declare exactly one default variant: {family_id}")

    referenced: set[Path] = set()
    state_count = 0
    enabled = 0
    for item in components:
        status = item.get("status")
        runtime_eligible = status == "enabled"
        has_owner_art = status in {"enabled", "disabled_missing_model"}
        runtime_url = item.get("runtimePath")
        source_sha = item.get("sourceSha256")
        runtime_sha = item.get("runtimeSha256")
        if has_owner_art:
            if runtime_eligible:
                enabled += 1
            if item.get("provenance") != "exact_owner_svg":
                fail(f"runtime component lacks exact_owner_svg provenance: {item.get('componentId')}")
            if not source_sha or source_sha != runtime_sha:
                fail(f"source/runtime SHA mismatch: {item.get('componentId')}")
            assert_owner_audit_match(
                runtime_url,
                item.get("sourceOwnerArchive"),
                item.get("sourceOwnerPath"),
                source_sha,
                accepted,
            )
            path = runtime_file(runtime_url)
            if digest(path) != runtime_sha:
                fail(f"runtime file SHA mismatch: {item.get('componentId')}: {path}")
            validate_svg(path)
            referenced.add(path.resolve())
        else:
            if runtime_url is not None or runtime_sha is not None:
                fail(f"disabled component exposes a runtime substitute: {item.get('componentId')}")
            if not item.get("blockReason"):
                fail(f"disabled component has no blockReason: {item.get('componentId')}")
        for state in item.get("stateAssets", []):
            state_count += 1
            if state.get("sourceSha256") != state.get("runtimeSha256"):
                fail(f"state SHA mismatch: {item.get('componentId')}:{state.get('state')}")
            assert_owner_audit_match(
                state["runtimePath"],
                state["sourceOwnerArchive"],
                state["sourceOwnerPath"],
                state["sourceSha256"],
                accepted,
            )
            path = runtime_file(state["runtimePath"])
            if digest(path) != state["runtimeSha256"]:
                fail(f"state file SHA mismatch: {item.get('componentId')}:{state.get('state')}")
            validate_svg(path)
            referenced.add(path.resolve())
    if state_count != EXPECTED_EXACT_FILES:
        fail(f"exact owner SVG state inventory changed: {state_count} != {EXPECTED_EXACT_FILES}")

    for component_id in ("microbit", "vibration-motor"):
        item = next((entry for entry in components if entry.get("componentId") == component_id), None)
        if (
            not item
            or item.get("status") != "disabled_missing_svg"
            or item.get("sourceOwnerPath") is not None
        ):
            fail(f"{component_id} must remain explicitly missing until an owner file is supplied")

    boards = manifest.get("breadboards", [])
    if {board.get("componentId") for board in boards} != {"breadboard-small", "breadboard-medium", "breadboard-large"}:
        fail("breadboard 170/420/882 definitions are incomplete")
    for board in boards:
        if board.get("pitchMm") != 2.54:
            fail(f"breadboard pitch must be 2.54 mm: {board.get('componentId')}")
        hole_ids = [hole.get("id") for hole in board.get("holes", [])]
        if len(hole_ids) != len(set(hole_ids)):
            fail(f"duplicate breadboard hole IDs: {board.get('componentId')}")
    return {
        "componentPositions": len(components),
        "families": len({item["familyId"] for item in components}),
        "runtimeEligible": enabled,
        "blocked": len(components) - enabled,
        "exactOwnerSvgFiles": state_count,
        "runtimeFiles": len(referenced),
    }


def validate_repository() -> None:
    for path in PROHIBITED_PATHS:
        if path.exists():
            fail(f"prohibited generated runtime path still exists: {path.relative_to(ROOT)}")
    source_root = ROOT / "apps/web/src/electronics"
    for path in source_root.rglob("*"):
        if (
            not path.is_file()
            or path.suffix not in {".ts", ".tsx", ".js", ".css"}
            or "testing" in path.relative_to(source_root).parts
        ):
            continue
        text = path.read_text(encoding="utf-8")
        for marker in PROHIBITED_SOURCE_MARKERS:
            if marker in text:
                fail(f"hard-coded/generated runtime marker {marker!r} remains in {path.relative_to(ROOT)}")
    adapter = (source_root / "production-manifest-adapter.ts").read_text(encoding="utf-8")
    if not re.search(r"OWNER_CATALOG_MANIFEST_URL\s*=\s*'/assets/electronics/owner-catalog/manifest\.json'", adapter):
        fail("editor adapter does not read owner-catalog/manifest.json")


def main() -> int:
    try:
        summary = validate_catalog(load_manifest(), accepted_owner_assets())
        validate_repository()
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: owner Electronics runtime is fail-closed")
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
