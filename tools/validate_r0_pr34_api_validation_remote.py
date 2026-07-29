#!/usr/bin/env python3
"""Verify PR #34 request-value validation directly from the remote head.

The gate proves only source presence and scope. Local compilation, API
integration and browser execution remain mandatory before foundation acceptance.
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
    "apps/api/src/projects.controller.ts",
    "tests/portal/projects-api.spec.ts",
    "tests/portal/projects-validation.spec.ts",
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


def file_at(ref: str, path: str) -> str:
    encoded_path = "/".join(part.replace(" ", "%20") for part in path.split("/"))
    payload = gh_api(f"repos/{REPOSITORY}/contents/{encoded_path}?ref={ref}")
    if not isinstance(payload, dict) or payload.get("type") != "file":
        raise RuntimeError(f"GitHub content is not a file: {path}")
    if payload.get("encoding") != "base64" or not isinstance(payload.get("content"), str):
        raise RuntimeError(f"unsupported GitHub content encoding: {path}")
    try:
        return base64.b64decode(payload["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"cannot decode {path}: {error}") from error


def require(text: str, marker: str, source: str, failures: list[str]) -> None:
    if marker not in text:
        failures.append(f"{source} misses required marker: {marker}")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 PR34 API validation BLOCKED: gh CLI is not installed", file=sys.stderr)
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
            entry.get("filename")
            for entry in files
            if isinstance(entry, dict) and isinstance(entry.get("filename"), str)
        }
        missing = sorted(REQUIRED_FILES - filenames)
        if missing:
            failures.append("PR #34 misses validation files: " + ", ".join(missing))

        if head_sha:
            controller = file_at(head_sha, "apps/api/src/projects.controller.ts")
            for marker in (
                "const UUID_PATTERN",
                "const PROJECT_TITLE_MAX_LENGTH = 160",
                "const CHECKPOINT_LABEL_MAX_LENGTH = 160",
                "const SUPPORTED_MODULE_KEYS = new Set(['electronics'])",
                "const PROJECT_SCOPES = new Set<ProjectScope>(['personal', 'classroom'])",
                "function requireUuid",
                "function requireTrimmedString",
                "function optionalTrimmedString",
                "function requireModuleKey",
                "function requireProjectScope",
                "requireUuid(projectId, 'projectId')",
                "requireUuid(body.classroomId, 'classroomId')",
                "optionalUuid(query.classroomId, 'classroomId')",
                "requireTrimmedString(body.title, 'title', PROJECT_TITLE_MAX_LENGTH)",
                "requireModuleKey(body.moduleKey)",
                "requireProjectScope(body.scope)",
                "requireProjectScope(query.scope, true)",
                "Object.hasOwn(body, 'document')",
                "optionalTrimmedString(body.label, 'label', CHECKPOINT_LABEL_MAX_LENGTH)",
            ):
                require(controller, marker, "projects.controller.ts", failures)
            for unsafe_marker in (
                "title: body.title as string",
                "moduleKey: body.moduleKey as string",
                "scope: body.scope as ProjectScope",
                "label: body.label as string",
                "classroomId: query.classroomId as string",
            ):
                if unsafe_marker in controller:
                    failures.append(
                        f"projects controller retains unsafe request cast: {unsafe_marker}"
                    )

            identifier_spec = file_at(head_sha, "tests/portal/projects-api.spec.ts")
            for marker in (
                "rejects malformed project and classroom identifiers with 400",
                "/api/projects/not-a-uuid",
                "classroomId=not-a-uuid",
                "classroomId: 'not-a-uuid'",
                "expect(response.json().code).toBe('validation_error')",
            ):
                require(identifier_spec, marker, "projects-api.spec.ts", failures)

            value_spec = file_at(head_sha, "tests/portal/projects-validation.spec.ts")
            for marker in (
                "project request value validation",
                "non-string title",
                "oversized title",
                "unsupported module key",
                "missing scope",
                "invalid scope",
                "trims valid project titles before persistence",
                "rejects invalid list scope values",
                "rejects missing draft documents before module validation",
                "blank checkpoint label",
                "oversized checkpoint label",
            ):
                require(value_spec, marker, "projects-validation.spec.ts", failures)

    except RuntimeError as error:
        print(f"ASA R0 PR34 API validation BLOCKED: {error}", file=sys.stderr)
        return EX_CONFIG

    if failures:
        print("ASA R0 PR34 API validation FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("ASA R0 PR34 API validation source PASS")
    print(f"- PR head: {head_sha}")
    print("- UUID validation: present")
    print("- title/module/scope/label validation: present")
    print("- missing draft document rejection: present")
    print("- negative API source tests: present")
    print("- local typecheck/API execution: NOT_RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
