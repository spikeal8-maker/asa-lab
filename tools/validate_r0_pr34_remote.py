#!/usr/bin/env python3
"""Verify the static PR #34 foundation corrective directly from GitHub.

This is not a substitute for migration/RLS/browser execution. It prevents the
R0 contract from claiming the known privilege defects were addressed when the
remote PR still contains broad table-level UPDATE grants.
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
API_TIMEOUT_SECONDS = 30
EXPECTED_HEAD = "agent/task-electronics-slice-001"
EXPECTED_0004_BLOB = "ad94c538407f4ce1cc4712c37555ccbb5c858f94"
REQUIRED_FILES = {
    "migrations/0003_electronics_project_slice.sql",
    "migrations/0004_personal_teacher_projects.sql",
    "migrations/0005_project_rename_least_privilege.sql",
    "tests/portal/rls.spec.ts",
}
FORBIDDEN_R1_PREFIXES = (
    "contexts/accounts/",
    "contexts/principals/",
    "contexts/workspaces/",
    "contexts/student-seats/",
)
FORBIDDEN_R1_FILENAMES = (
    "sessions_v2",
    "account_identity",
    "studentseat",
    "class_code",
)
EX_CONFIG = 78


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


def file_at(ref: str, path: str) -> tuple[str, str]:
    encoded_path = "/".join(part.replace(" ", "%20") for part in path.split("/"))
    payload = gh_api(f"repos/{REPOSITORY}/contents/{encoded_path}?ref={ref}")
    if not isinstance(payload, dict) or payload.get("type") != "file":
        raise RuntimeError(f"GitHub content is not a file: {path}")
    content = payload.get("content")
    if not isinstance(content, str) or payload.get("encoding") != "base64":
        raise RuntimeError(f"GitHub file has unsupported encoding: {path}")
    try:
        text = base64.b64decode(content).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"cannot decode UTF-8 file {path}: {error}") from error
    return str(payload.get("sha", "")), text


def require(text: str, marker: str, source: str, errors: list[str]) -> None:
    if marker not in text:
        errors.append(f"{source} misses required marker: {marker}")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 PR34 remote gate BLOCKED: gh CLI is not installed", file=sys.stderr)
        return EX_CONFIG

    errors: list[str] = []
    try:
        pr = gh_api(f"repos/{REPOSITORY}/pulls/{PR_NUMBER}")
        head_ref = pr.get("head", {}).get("ref")
        head_sha = pr.get("head", {}).get("sha")
        if head_ref != EXPECTED_HEAD:
            errors.append(f"PR #34 head must be {EXPECTED_HEAD}, got {head_ref!r}")
        if not isinstance(head_sha, str) or len(head_sha) != 40:
            errors.append("PR #34 head SHA is missing or invalid")

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
            errors.append("PR #34 misses corrective files: " + ", ".join(missing))
        forbidden_paths = sorted(
            path
            for path in filenames
            if path.startswith(FORBIDDEN_R1_PREFIXES)
            or any(marker in path.lower() for marker in FORBIDDEN_R1_FILENAMES)
        )
        if forbidden_paths:
            errors.append(
                "PR #34 contains R1/R5 scope outside foundation: "
                + ", ".join(forbidden_paths)
            )

        if isinstance(head_sha, str) and len(head_sha) == 40:
            sha0004, migration0004 = file_at(head_sha, "migrations/0004_personal_teacher_projects.sql")
            if sha0004 != EXPECTED_0004_BLOB:
                errors.append(
                    "migration 0004 checksum changed; applied migration must remain immutable "
                    f"(expected {EXPECTED_0004_BLOB}, got {sha0004})"
                )
            require(
                migration0004,
                "GRANT UPDATE ON projects TO asalab_app;",
                "migration 0004 historical content",
                errors,
            )

            _, migration0005 = file_at(
                head_sha, "migrations/0005_project_rename_least_privilege.sql"
            )
            for marker in (
                "REVOKE UPDATE ON projects FROM asalab_app;",
                "GRANT UPDATE (title) ON projects TO asalab_app;",
                "REVOKE UPDATE ON project_drafts FROM asalab_app;",
                "GRANT UPDATE (document_json, revision, updated_at, updated_by)",
                "ON project_drafts TO asalab_app;",
            ):
                require(migration0005, marker, "migration 0005", errors)
            for broad_grant in (
                "GRANT UPDATE ON projects",
                "GRANT UPDATE ON project_drafts",
            ):
                if broad_grant in migration0005:
                    errors.append(f"migration 0005 reintroduces broad privilege: {broad_grant}")
            for forbidden_column in (
                "tenant_id",
                "created_by",
                "classroom_id",
                "project_scope",
                "module_key",
                "idempotency_key",
                "request_fingerprint",
                "project_id",
            ):
                if f"UPDATE ({forbidden_column})" in migration0005:
                    errors.append(
                        f"migration 0005 grants UPDATE on forbidden identity column {forbidden_column}"
                    )

            _, rls_test = file_at(head_sha, "tests/portal/rls.spec.ts")
            for marker in (
                "information_schema.column_privileges",
                "toEqual(['title'])",
                "draftUpdateColumns",
                "'document_json'",
                "'revision'",
                "'updated_at'",
                "'updated_by'",
                "forbiddenProjectColumns",
                "['tenant_id', 'project_id']",
                "tenant B cannot rename tenant A project",
                "code: '42501'",
            ):
                require(rls_test, marker, "tests/portal/rls.spec.ts", errors)
            for column in (
                "tenant_id",
                "classroom_id",
                "module_key",
                "created_by",
                "project_scope",
                "project_id",
            ):
                require(rls_test, f"'{column}'", "project/draft privilege negative matrix", errors)

    except RuntimeError as error:
        print(f"ASA R0 PR34 remote gate BLOCKED: {error}", file=sys.stderr)
        return EX_CONFIG

    if errors:
        print("ASA R0 PR34 remote gate FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA R0 PR34 remote gate PASS")
    print(f"- PR head: {head_sha}")
    print("- migration 0004 checksum preserved: true")
    print("- additive privilege correction migration: present")
    print("- project UPDATE columns: title only")
    print("- draft UPDATE columns: document_json, revision, updated_at, updated_by")
    print("- runtime negative privilege test source: present")
    print("- local migration/RLS execution: NOT_RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
