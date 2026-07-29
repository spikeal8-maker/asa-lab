#!/usr/bin/env python3
"""Validate the R0 baseline capture/compare tool without a database.

The database capture itself is an R0B environment gate. This validator proves
syntax, schema presence and positive/negative comparison behavior using
synthetic non-secret manifests. Missing Node is BLOCKED, never PASS.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/r0-baseline-manifest.mjs"
SCHEMA = ROOT / "docs/delivery/R0_BASELINE_MANIFEST.schema.json"
REPORTS = ROOT / "reports"
EX_CONFIG = 78
DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
DIGEST_C = "c" * 64


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
        timeout=60,
    )


def manifest(*, added: bool = False, changed: bool = False) -> dict:
    stable = {DIGEST_A: DIGEST_B}
    credentials = {DIGEST_A: DIGEST_C if changed else DIGEST_B}
    drafts = {DIGEST_A: {"documentDigest": DIGEST_B, "revision": 1}}
    versions = {
        DIGEST_A: {
            "projectKey": DIGEST_B,
            "documentDigest": DIGEST_C,
            "versionNo": 1,
        }
    }
    electronics = {DIGEST_A: DIGEST_C}
    if added:
        stable[DIGEST_B] = DIGEST_C
    return {
        "schemaVersion": "1.0.0",
        "manifestType": "asa-r0-baseline",
        "generatedAt": "2026-07-29T00:00:00.000Z",
        "sourceCommitSha": "1" * 40 if not added else "2" * 40,
        "database": {
            "nameFingerprint": DIGEST_A,
            "migrationVersions": ["0001"] if not added else ["0001", "0002"],
        },
        "tables": {
            "tenants": {"exists": True, "rowCount": 1 if not added else 2},
            "projects": {"exists": False, "rowCount": 0},
        },
        "stableIdentifiers": stable,
        "credentialFingerprints": credentials,
        "projectDrafts": drafts,
        "projectVersions": versions,
        "electronicsDocuments": electronics,
        "routes": ["/api/auth/login"],
        "screenshots": [],
    }


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print("ASA R0 baseline tool BLOCKED: Node.js is not installed", file=sys.stderr)
        return EX_CONFIG
    if not TOOL.is_file() or not SCHEMA.is_file():
        print("ASA R0 baseline tool FAIL: tool or schema is missing", file=sys.stderr)
        return 1

    try:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        if schema.get("title") != "ASA Lab R0 baseline manifest":
            raise ValueError("unexpected baseline manifest schema title")
        required = set(schema.get("required") or [])
        expected_required = {
            "schemaVersion",
            "manifestType",
            "generatedAt",
            "sourceCommitSha",
            "database",
            "tables",
            "stableIdentifiers",
            "credentialFingerprints",
            "projectDrafts",
            "projectVersions",
            "electronicsDocuments",
            "routes",
            "screenshots",
        }
        if required != expected_required:
            raise ValueError("baseline manifest schema required fields are incomplete")

        tool_text = TOOL.read_text(encoding="utf-8")
        for marker in (
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
            "R0_BASELINE_DATABASE_URL",
            "R0_MANIFEST_HMAC_KEY",
            "canonicalJson",
            "credentialFingerprints",
            "projectDrafts",
            "projectVersions",
            "electronicsDocuments",
            "R0 baseline comparison PASS",
            "R0 baseline comparison FAIL",
        ):
            if marker not in tool_text:
                raise ValueError(f"baseline tool misses required marker: {marker}")
        for forbidden in (
            "DROP TABLE",
            "TRUNCATE ",
            "DELETE FROM public.",
            "UPDATE public.",
            "INSERT INTO public.",
        ):
            if forbidden in tool_text:
                raise ValueError(f"baseline capture tool contains write operation: {forbidden}")

        syntax = run([node, "--check", str(TOOL)])
        if syntax.returncode != 0:
            raise ValueError(f"node --check failed: {syntax.stderr.strip()}")

        REPORTS.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".r0-baseline-test-", dir=REPORTS) as temp:
            temp_path = Path(temp)
            before_path = temp_path / "before.json"
            after_path = temp_path / "after.json"
            changed_path = temp_path / "changed.json"
            pass_report = temp_path / "pass-report.json"
            fail_report = temp_path / "fail-report.json"
            before_path.write_text(json.dumps(manifest(), indent=2), encoding="utf-8")
            after_path.write_text(json.dumps(manifest(added=True), indent=2), encoding="utf-8")
            changed_path.write_text(
                json.dumps(manifest(added=True, changed=True), indent=2),
                encoding="utf-8",
            )

            positive = run(
                [
                    node,
                    str(TOOL),
                    "compare",
                    "--before",
                    relative(before_path),
                    "--after",
                    relative(after_path),
                    "--report",
                    relative(pass_report),
                ]
            )
            if positive.returncode != 0 or "R0 baseline comparison PASS" not in positive.stdout:
                raise ValueError(
                    "positive comparison did not PASS: "
                    + (positive.stderr.strip() or positive.stdout.strip())
                )
            pass_payload = json.loads(pass_report.read_text(encoding="utf-8"))
            if pass_payload.get("pass") is not True or pass_payload.get("failures") != []:
                raise ValueError("positive comparison report is not a clean PASS")

            negative = run(
                [
                    node,
                    str(TOOL),
                    "compare",
                    "--before",
                    relative(before_path),
                    "--after",
                    relative(changed_path),
                    "--report",
                    relative(fail_report),
                ]
            )
            if negative.returncode == 0 or "R0 baseline comparison FAIL" not in negative.stderr:
                raise ValueError("negative comparison did not fail on changed credential fingerprint")
            fail_payload = json.loads(fail_report.read_text(encoding="utf-8"))
            if fail_payload.get("pass") is not False or not fail_payload.get("failures"):
                raise ValueError("negative comparison report does not contain failures")

    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        print(f"ASA R0 baseline tool FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 baseline tool PASS")
    print("- Node syntax: PASS")
    print("- read-only capture markers: PASS")
    print("- positive comparison: PASS")
    print("- negative preservation detection: PASS")
    print("- database capture: NOT_RUN (R0B environment gate)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
