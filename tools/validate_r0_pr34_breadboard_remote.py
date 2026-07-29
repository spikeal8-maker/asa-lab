#!/usr/bin/env python3
"""Verify the native breadboard physical/mounting source on remote PR #34.

This is a source gate, not a substitute for local typecheck, domain tests,
PostgreSQL integration or Playwright owner evidence.
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
    "contexts/electronics/domain/physical-model.ts",
    "contexts/electronics/domain/breadboard-mounting.ts",
    "contexts/electronics/testing/physical-model.spec.ts",
    "contexts/electronics/testing/breadboard-mounting-physical.spec.ts",
    "apps/web/src/electronics/component-catalog.ts",
    "apps/web/src/electronics/WorkbenchStage.tsx",
    "apps/web/public/assets/electronics/components/breadboard-half-400.svg",
    "tests/electronics/physical-catalog-contract.spec.ts",
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


def remote_text(ref: str, path: str) -> tuple[str, str]:
    encoded_path = "/".join(part.replace(" ", "%20") for part in path.split("/"))
    payload = gh_api(f"repos/{REPOSITORY}/contents/{encoded_path}?ref={ref}")
    if not isinstance(payload, dict) or payload.get("type") != "file":
        raise RuntimeError(f"GitHub content is not a file: {path}")
    if payload.get("encoding") != "base64" or not isinstance(payload.get("content"), str):
        raise RuntimeError(f"unsupported GitHub encoding for {path}")
    try:
        text = base64.b64decode(payload["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"cannot decode {path}: {error}") from error
    return str(payload.get("sha", "")), text


def require(text: str, marker: str, source: str, failures: list[str]) -> None:
    if marker not in text:
        failures.append(f"{source} misses required marker: {marker}")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 PR34 breadboard gate BLOCKED: gh CLI is not installed", file=sys.stderr)
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
            failures.append("PR #34 misses native breadboard files: " + ", ".join(missing))

        if head_sha:
            _, physical = remote_text(head_sha, "contexts/electronics/domain/physical-model.ts")
            for marker in (
                "ELECTRONICS_GRID_PITCH_MM = 2.54",
                "widthMm: 83.5",
                "heightMm: 54.5",
                "depthMm: 8.5",
                "centerChannelMm: 7.62",
                "fieldColumns: 30",
                "railPointsPerLine: 25",
                "totalTerminalCount: 400",
                "halfBreadboardFieldTerminalId",
                "halfBreadboardRailTerminalId",
                "parseHalfBreadboardTerminalId",
                "halfBreadboardBusTerminalIds",
                "allHalfBreadboardTerminalIds",
            ):
                require(physical, marker, "physical-model.ts", failures)

            _, mounting = remote_text(
                head_sha, "contexts/electronics/domain/breadboard-mounting.ts"
            )
            for marker in (
                "type QuarterTurn = 0 | 90 | 180 | 270",
                "POSITION_TOLERANCE_MM = 0.02",
                "halfBreadboardFieldHolePositionMm",
                "halfBreadboardFieldTerminalAtMm",
                "createAxialResistorFootprint",
                "createLed5mmFootprint",
                "planHalfBreadboardFieldMount",
                "terminal_does_not_land_on_hole",
                "duplicate_terminal_id",
            ):
                require(mounting, marker, "breadboard-mounting.ts", failures)
            for forbidden in (
                "Math.random",
                "getBoundingClientRect",
                "elementFromPoint",
                "pixel",
            ):
                if forbidden in mounting:
                    failures.append(
                        f"breadboard mounting must not infer connectivity from UI geometry: {forbidden}"
                    )

            _, catalog = remote_text(head_sha, "apps/web/src/electronics/component-catalog.ts")
            for marker in (
                "HALF_BREADBOARD_400_PHYSICAL",
                "halfBreadboardFieldTerminalId",
                "halfBreadboardRailTerminalId",
                "breadboard-half-400",
                "breadboard-half-400.svg",
            ):
                require(catalog, marker, "component-catalog.ts", failures)

            _, stage = remote_text(head_sha, "apps/web/src/electronics/WorkbenchStage.tsx")
            for marker in (
                "workbench-terminal--breadboard",
                "data-component-kind",
                "data-terminal-count",
            ):
                require(stage, marker, "WorkbenchStage.tsx", failures)

            _, physical_test = remote_text(
                head_sha, "contexts/electronics/testing/physical-model.spec.ts"
            )
            for marker in (
                "toHaveLength(400)",
                "upper and lower five-hole strips electrically separate",
                "four power rails",
                "malformed or out-of-range terminal identifiers",
            ):
                require(physical_test, marker, "physical-model.spec.ts", failures)

            _, mounting_test = remote_text(
                head_sha,
                "contexts/electronics/testing/breadboard-mounting-physical.spec.ts",
            )
            for marker in (
                "mounts a four-pitch axial resistor horizontally",
                "mounts a 2.54 mm LED horizontally or vertically",
                "does not pretend the central channel is a 2.54 mm hole step",
                "rejects a footprint that extends beyond the board",
            ):
                require(mounting_test, marker, "breadboard-mounting-physical.spec.ts", failures)

            _, catalog_test = remote_text(
                head_sha, "tests/electronics/physical-catalog-contract.spec.ts"
            )
            for marker in (
                "canonical 400-point board terminal namespace",
                "does not expose a second active planning-only breadboard card",
                "every visible breadboard terminal in a real internal bus",
            ):
                require(catalog_test, marker, "physical-catalog-contract.spec.ts", failures)

            _, svg = remote_text(
                head_sha,
                "apps/web/public/assets/electronics/components/breadboard-half-400.svg",
            )
            for marker in (
                "viewBox=\"0 0 835 545\"",
                "<svg",
            ):
                require(svg, marker, "breadboard-half-400.svg", failures)
            for forbidden in (
                "<script",
                "data:image/",
                "http://",
                "https://",
                "Autodesk",
                "Tinkercad",
            ):
                if forbidden.lower() in svg.lower():
                    failures.append(f"native breadboard SVG contains forbidden marker: {forbidden}")

    except RuntimeError as error:
        print(f"ASA R0 PR34 breadboard gate BLOCKED: {error}", file=sys.stderr)
        return EX_CONFIG

    if failures:
        print("ASA R0 PR34 breadboard gate FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("ASA R0 PR34 breadboard source PASS")
    print(f"- PR head: {head_sha}")
    print("- physical units: millimetres / 2.54 mm lattice")
    print("- active board: 83.5 x 54.5 x 8.5 mm / 400 terminals")
    print("- internal bus IDs: stable")
    print("- resistor and LED mounting planner: present")
    print("- original native SVG: present")
    print("- persisted attachment/UI snap/browser proof: not claimed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
