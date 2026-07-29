#!/usr/bin/env python3
"""Validate the owner-facing generated wireframe viewer for every surface."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
SURFACE_PATH = ROOT / "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml"
WIREFRAME_PATH = ROOT / "docs/product/page-wireframes.html"
EXPECTED_TEMPLATES = {
    "PUBLIC": "publicFrame",
    "PORTAL": "portalFrame",
    "CLASSROOM": "classroomFrame",
    "STUDENT": "studentFrame",
    "EDITOR_HOST": "editorFrame",
    "ADMIN": "adminFrame",
    "PUBLICATION": "publicationFrame",
}
FORBIDDEN_PORTS = (3000, 3100, 5173)


def fail(message: str) -> None:
    raise ValueError(message)


def load_surfaces() -> list[dict[str, Any]]:
    if not SURFACE_PATH.is_file():
        fail(f"missing {SURFACE_PATH.relative_to(ROOT)}")
    document = yaml.safe_load(SURFACE_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("surfaces"), list):
        fail("surface catalog must contain a surfaces list")
    surfaces = [item for item in document["surfaces"] if isinstance(item, dict)]
    if len(surfaces) != len(document["surfaces"]):
        fail("surface catalog contains malformed entries")
    return surfaces


def main() -> int:
    try:
        surfaces = load_surfaces()
        if len(surfaces) < 75:
            fail("wireframe viewer requires the complete surface catalog")
        if not WIREFRAME_PATH.is_file():
            fail(f"missing {WIREFRAME_PATH.relative_to(ROOT)}")
        text = WIREFRAME_PATH.read_text(encoding="utf-8")

        for marker in (
            "ASA Lab — визуальные схемы всех страниц",
            "ASA_PRODUCT_SURFACE_CATALOG.yaml",
            "Это структура, а не финальный pixel-design",
            "Все роли",
            "Все релизы",
            "Все shell-шаблоны",
            "Runtime:",
            "Screenshot IDs:",
            "function wireframe(template)",
        ):
            if marker not in text:
                fail(f"page-wireframes.html misses marker: {marker}")

        for template, function_name in EXPECTED_TEMPLATES.items():
            if template not in {surface.get("template") for surface in surfaces}:
                fail(f"surface catalog does not use template {template}")
            if f"function {function_name}" not in text:
                fail(f"wireframe viewer misses renderer {function_name} for {template}")

        if "(catalog.surfaces||[])" not in text and "catalog.surfaces||[]" not in text:
            fail("wireframe viewer does not iterate the complete surface catalog")
        if "visible.map" not in text:
            fail("wireframe viewer does not render every filtered surface")
        if "s.implementation" not in text:
            fail("wireframe viewer does not expose runtime implementation status")
        if "s.primary_actions" not in text or "s.required_states" not in text:
            fail("wireframe viewer does not expose actions and states")

        ids = re.findall(r'\bid="([^"]+)"', text)
        duplicates = sorted({value for value in ids if ids.count(value) > 1})
        if duplicates:
            fail("page-wireframes.html has duplicate HTML ids: " + ", ".join(duplicates))

        for port in FORBIDDEN_PORTS:
            if f"127.0.0.1:{port}" in text or f"localhost:{port}" in text:
                fail(f"wireframe viewer contains forbidden runtime port {port}")

        surface_templates = {surface.get("template") for surface in surfaces}
        if surface_templates != set(EXPECTED_TEMPLATES):
            fail(
                f"surface template coverage must be {sorted(EXPECTED_TEMPLATES)}, "
                f"got {sorted(surface_templates)}"
            )

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA page wireframes FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA page wireframes PASS")
    print(f"- catalogued pages visualized: {len(surfaces)}")
    print(f"- layout templates visualized: {len(EXPECTED_TEMPLATES)}")
    print("- filters: search / actor / release / template")
    print("- runtime status displayed: true")
    print("- pixel-final claim: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
