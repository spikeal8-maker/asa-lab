#!/usr/bin/env python3
"""Verify the actual native geometry and breadboard source on remote PR #34.

This is a source gate, not a substitute for local typecheck, domain tests,
PostgreSQL integration or Playwright owner evidence. The validator deliberately
references the real current files rather than an imagined parallel geometry
implementation.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
from typing import Any

REPOSITORY = "spikeal8-maker/asa-lab"
PR_NUMBER = 34
EXPECTED_HEAD = "agent/task-electronics-slice-001"
API_TIMEOUT_SECONDS = 30
EX_CONFIG = 78
REQUIRED_FILES = {
    "contexts/electronics/domain/breadboard.ts",
    "contexts/electronics/domain/breadboard-netlist.ts",
    "contexts/electronics/domain/breadboard-placement.ts",
    "contexts/electronics/domain/component-model.ts",
    "contexts/electronics/domain/component-properties.ts",
    "contexts/electronics/domain/native-component-geometry.ts",
    "contexts/electronics/domain/resistor-color-code.ts",
    "contexts/electronics/index.ts",
    "contexts/electronics/testing/breadboard.spec.ts",
    "contexts/electronics/testing/breadboard-placement.spec.ts",
    "contexts/electronics/testing/component-properties.spec.ts",
    "contexts/electronics/testing/native-component-geometry.spec.ts",
    "contexts/electronics/testing/resistor-color-code.spec.ts",
    "apps/web/src/electronics/workbench-scale.ts",
    "apps/web/src/electronics/component-catalog.ts",
    "apps/web/src/electronics/WorkbenchStage.tsx",
    "tests/electronics/geometry.spec.ts",
    "tests/electronics/component-catalog-contract.spec.ts",
}


def gh_api(path: str) -> Any:
    try:
        completed = subprocess.run(
            ["gh", "api", "--method", "GET", path],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=API_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"gh api timed out for {path}") from error
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"gh api {path} failed: {message}")
    try:
        return json.loads(completed.stdout.lstrip("\ufeff"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"gh api returned invalid JSON for {path}: {error}") from error


def remote_text(ref: str, path: str) -> str:
    encoded_path = "/".join(part.replace(" ", "%20") for part in path.split("/"))
    payload = gh_api(f"repos/{REPOSITORY}/contents/{encoded_path}?ref={ref}")
    if not isinstance(payload, dict) or payload.get("type") != "file":
        raise RuntimeError(f"GitHub content is not a file: {path}")
    if payload.get("encoding") != "base64" or not isinstance(payload.get("content"), str):
        raise RuntimeError(f"unsupported GitHub encoding for {path}")
    try:
        return base64.b64decode(payload["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"cannot decode {path}: {error}") from error


def require(text: str, marker: str, source: str, failures: list[str]) -> None:
    if marker not in text:
        failures.append(f"{source} misses required marker: {marker}")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 PR34 native geometry gate BLOCKED: gh CLI is not installed", file=sys.stderr)
        return EX_CONFIG

    failures: list[str] = []
    try:
        pr = gh_api(f"repos/{REPOSITORY}/pulls/{PR_NUMBER}")
        head_ref = pr.get("head", {}).get("ref")
        head_sha = pr.get("head", {}).get("sha")
        if head_ref != EXPECTED_HEAD:
            failures.append(f"PR #34 head must be {EXPECTED_HEAD}, got {head_ref!r}")
        if not isinstance(head_sha, str) or len(head_sha) != 40:
            failures.append("PR #34 head SHA is missing or invalid")
            head_sha = ""

        files = gh_api(f"repos/{REPOSITORY}/pulls/{PR_NUMBER}/files?per_page=100")
        if not isinstance(files, list):
            raise RuntimeError("PR #34 files endpoint did not return a list")
        filenames = {
            item.get("filename")
            for item in files
            if isinstance(item, dict) and isinstance(item.get("filename"), str)
        }
        missing = sorted(REQUIRED_FILES - filenames)
        if missing:
            failures.append("PR #34 misses native geometry files: " + ", ".join(missing))

        if head_sha:
            scale = remote_text(head_sha, "apps/web/src/electronics/workbench-scale.ts")
            for marker in (
                "BREADBOARD_PITCH_MM = 2.54",
                "BREADBOARD_PITCH_UNITS = 20",
                "WORKBENCH_MM_PER_UNIT",
                "renderWidthForTerminalSpan",
                "terminal geometry, not arbitrary pixels",
            ):
                require(scale, marker, "workbench-scale.ts", failures)

            breadboard = remote_text(head_sha, "contexts/electronics/domain/breadboard.ts")
            for marker in (
                "BREADBOARD_HOLE_PITCH_MM = 2.54",
                "BREADBOARD_CENTER_GAP_MM = 7.62",
                "'mini-170' | 'half-400' | 'full-830'",
                "widthMm: 83.5",
                "heightMm: 54.5",
                "thicknessMm: 8.5",
                "terminalColumns: 30",
                "railHolesPerRow: 25",
                "${profile.kind}:terminal:${column}:${row}",
                "${profile.kind}:terminal:${column}:upper",
                "${profile.kind}:rail:${rail}:${railIndex}",
                "nearestBreadboardHole",
            ):
                require(breadboard, marker, "breadboard.ts", failures)
            for forbidden in (
                "getBoundingClientRect",
                "elementFromPoint",
                "Math.random",
            ):
                if forbidden in breadboard:
                    failures.append(f"breadboard domain contains UI/random inference: {forbidden}")

            placement = remote_text(
                head_sha, "contexts/electronics/domain/breadboard-placement.ts"
            )
            for marker in (
                "snapPartToBreadboard",
                "anchorSearchRadiusMm",
                "terminalToleranceMm",
                "BREADBOARD_HOLE_PITCH_MM * 1.5",
                "BREADBOARD_HOLE_PITCH_MM * 0.12",
                "terminals_collide_on_one_hole",
                "terminal_hole_not_found",
                "electrically impossible on a real solderless breadboard",
            ):
                require(placement, marker, "breadboard-placement.ts", failures)
            for forbidden in (
                "getBoundingClientRect",
                "elementFromPoint",
                "pixel",
            ):
                if forbidden in placement:
                    failures.append(
                        f"breadboard placement must not infer connectivity from UI pixels: {forbidden}"
                    )

            native = remote_text(
                head_sha, "contexts/electronics/domain/native-component-geometry.ts"
            )
            for marker in (
                "NATIVE_GRID_PITCH_MM = 2.54",
                "NATIVE_GEOMETRY_EPSILON_MM = 0.02",
                "bodyMm",
                "bodyOriginMm",
                "envelopeMm",
                "createAxialResistorGeometry",
                "pitchMultiple < 4 || pitchMultiple > 20",
                "body dimensions must stay",
                "targetTerminalSpanMm: 10.16",
                "targetTerminalSpanMm: 2.54",
                "validateNativeComponentGeometry",
            ):
                require(native, marker, "native-component-geometry.ts", failures)
            if "Math.random" in native or "getBoundingClientRect" in native:
                failures.append("native component geometry must remain deterministic and DOM-free")

            properties = remote_text(
                head_sha, "contexts/electronics/domain/component-properties.ts"
            )
            for marker in (
                "COMPONENT_PROPERTY_SCHEMAS",
                "legacyValueToComponentProperties",
                "resistanceOhm",
                "tolerancePercent",
                "leadSpanPitches",
                "boardKind",
                "unknown_property",
                "property_out_of_range",
            ):
                require(properties, marker, "component-properties.ts", failures)

            bands = remote_text(head_sha, "contexts/electronics/domain/resistor-color-code.ts")
            for marker in (
                "resistorFourBandCode",
                "resistorBandCssColors",
                "relativeRepresentationError",
                "multiplierExponent",
                "tolerancePercent",
            ):
                require(bands, marker, "resistor-color-code.ts", failures)

            catalog = remote_text(head_sha, "apps/web/src/electronics/component-catalog.ts")
            for marker in (
                "BREADBOARD_PITCH_MM",
                "renderWidthForTerminalSpan",
                "bodyMm: { width: 44, height: 76.6, depth: 16 }",
                "terminalSpanPitches: 10",
                "bodyMm: { width: 5, height: 8.6, depth: 5 }",
                "referenceBehaviorVerified: false",
                "enabled: false",
            ):
                require(catalog, marker, "component-catalog.ts", failures)
            if "breadboard: ACTIVE" not in catalog and "breadboard: FUTURE" not in catalog:
                failures.append(
                    "component-catalog.ts does not explicitly resolve the breadboard ComponentKind; "
                    "local typecheck must fix or prove the registry typing before acceptance"
                )

            stage = remote_text(head_sha, "apps/web/src/electronics/WorkbenchStage.tsx")
            for marker in (
                "data-physical",
                "data-physical-evidence",
                "data-terminal-count",
                "workbench-terminal-hit",
                "r=\"14\"",
                "Сетка {BREADBOARD_PITCH_MM",
            ):
                require(stage, marker, "WorkbenchStage.tsx", failures)

            breadboard_test = remote_text(
                head_sha, "contexts/electronics/testing/breadboard.spec.ts"
            )
            for marker in (
                "['mini-170', 170, 47, 35, 10]",
                "['half-400', 400, 83.5, 54.5, 8.5]",
                "['full-830', 830, 165.1, 54.29, 9.68]",
                "centre channel at the standard 0.3 inch separation",
                "four isolated continuous 25-hole rails",
                "two isolated 25-hole segments",
            ):
                require(breadboard_test, marker, "breadboard.spec.ts", failures)

            placement_test = remote_text(
                head_sha, "contexts/electronics/testing/breadboard-placement.spec.ts"
            )
            for marker in (
                "snaps a 10-pitch resistor",
                "snaps a one-pitch LED",
                "supports a rotated through-hole component",
                "lead spacing cannot land on the board pitch",
                "two leads that would occupy one physical hole",
                "does not pull a component onto a distant board",
            ):
                require(placement_test, marker, "breadboard-placement.spec.ts", failures)

            native_test = remote_text(
                head_sha, "contexts/electronics/testing/native-component-geometry.spec.ts"
            )
            for marker in (
                "keeps the resistor body native while the lead footprint changes",
                "rejects unsupported resistor lead spans",
                "exactly one breadboard pitch apart",
                "preserves terminal distance",
                "rejects duplicate and outside terminal geometry",
            ):
                require(native_test, marker, "native-component-geometry.spec.ts", failures)

            properties_test = remote_text(
                head_sha, "contexts/electronics/testing/component-properties.spec.ts"
            )
            for marker in (
                "maps the legacy scalar resistor value",
                "rejects ownership and arbitrary over-posting",
                "does not treat the breadboard as a scalar-valued electrical load",
            ):
                require(properties_test, marker, "component-properties.spec.ts", failures)

            color_test = remote_text(
                head_sha, "contexts/electronics/testing/resistor-color-code.spec.ts"
            )
            for marker in (
                "maps %s ohm to expected bands",
                "nearest representable two-significant-digit value",
                "stable CSS colours",
            ):
                require(color_test, marker, "resistor-color-code.spec.ts", failures)

    except RuntimeError as error:
        print(f"ASA R0 PR34 native geometry gate BLOCKED: {error}", file=sys.stderr)
        return EX_CONFIG

    if failures:
        print("ASA R0 PR34 native geometry gate FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("ASA R0 PR34 native geometry source PASS")
    print(f"- PR head: {head_sha}")
    print("- coordinate scale: 2.54 mm pitch / 20 workbench units")
    print("- board definitions: mini-170 / half-400 / full-830")
    print("- current resistor footprint: 10 pitches; flexible body-invariant target: present")
    print("- typed component properties and resistor colour model: present")
    print("- visual overlap connectivity inference: absent from domain")
    print("- local typecheck/domain/browser proof: NOT_RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
