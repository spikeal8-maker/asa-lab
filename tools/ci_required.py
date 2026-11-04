#!/usr/bin/env python3
"""Summarize the four mandatory General jobs for the exact checked-out source.

The workflow supplies its native needs results and event HEAD through environment
variables. This command neither queries GitHub nor authorizes integration/release.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_JOBS = ("governance", "code", "postgres-tests", "access-a-browser")
RESULT_STATES = {
    "success": "PASS",
    "failure": "FAIL",
    "cancelled": "CANCELLED",
    "skipped": "NOT_RUN",
    "not_applicable": "NOT_APPLICABLE",
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate needs key: " + key)
        result[key] = value
    return result


def summarize(expected_sha, actual_sha, needs):
    errors = []
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        errors.append("Missing or invalid event HEAD SHA")
    if not isinstance(actual_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", actual_sha):
        errors.append("Missing or invalid checkout HEAD SHA")
    if expected_sha != actual_sha:
        errors.append("Checkout HEAD does not match event HEAD")
    if not isinstance(needs, dict):
        errors.append("Native needs results must be an object")
        needs = {}
    if set(needs) - set(REQUIRED_JOBS):
        errors.append("Unexpected job in mandatory needs results")

    checks = {}
    for job in REQUIRED_JOBS:
        if job not in needs:
            checks[job] = "NOT_RUN"
        elif not isinstance(needs[job], dict):
            checks[job] = "BLOCKED"
        else:
            result = needs[job].get("result")
            checks[job] = RESULT_STATES.get(result, "BLOCKED") if isinstance(result, str) else "BLOCKED"
    # Source/shape uncertainty takes precedence: it is not evidence of a test
    # failure. Every non-PASS state still fails this mandatory aggregate.
    if errors:
        status = "BLOCKED"
    else:
        status = next((state for state in ("FAIL", "CANCELLED", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE")
                       if state in checks.values()), "PASS")
    return {
        "status": status,
        "source_sha": actual_sha,
        "expected_sha": expected_sha,
        "checks": checks,
        "errors": errors,
        "full_regression_verified": status == "PASS",
        "integration_ready": False,
        "release_ready": False,
    }


def main():
    expected_sha = os.environ.get("ASA_REQUIRED_EXPECTED_SHA", "")
    try:
        payload = os.environ.get("ASA_REQUIRED_NEEDS_JSON", "")
        if len(payload) > 16384:
            raise ValueError("Native needs payload exceeds 16 KiB")
        needs = json.loads(payload, object_pairs_hook=unique_object)
        actual = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True, check=True, timeout=10).stdout.strip()
        report = summarize(expected_sha, actual, needs)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        report = summarize(expected_sha, None, {})
        report["errors"].append(str(exc))
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
