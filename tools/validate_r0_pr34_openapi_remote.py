#!/usr/bin/env python3
"""Validate the Project API OpenAPI contract on the live PR #34 head.

This gate proves contract source only. Runtime contract tests and the complete
PR #34 gate remain mandatory before foundation acceptance.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
from typing import Any

import yaml

REPOSITORY = "spikeal8-maker/asa-lab"
PR_NUMBER = 34
EXPECTED_HEAD = "agent/task-electronics-slice-001"
API_TIMEOUT_SECONDS = 30
EX_CONFIG = 78
REQUIRED_PATHS = {
    "/api/projects",
    "/api/projects/{projectId}",
    "/api/projects/{projectId}/draft",
    "/api/projects/{projectId}/checkpoints",
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
        raise RuntimeError(f"unsupported GitHub content encoding: {path}")
    try:
        return base64.b64decode(payload["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"cannot decode {path}: {error}") from error


def fail(message: str) -> None:
    raise ValueError(message)


def property_keys(schema: Any) -> set[str]:
    if not isinstance(schema, dict):
        return set()
    properties = schema.get("properties")
    return set(properties) if isinstance(properties, dict) else set()


def one_schema(
    schemas: dict[str, Any],
    label: str,
    predicate,
) -> tuple[str, dict[str, Any]]:
    matches = [
        (name, schema)
        for name, schema in schemas.items()
        if isinstance(schema, dict) and predicate(name, schema)
    ]
    if len(matches) != 1:
        fail(f"expected exactly one {label} schema, got {[name for name, _ in matches]}")
    return matches[0]


def parameter_schemas(node: Any, name: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("name") == name and node.get("in") in {"path", "query"}:
            schema = node.get("schema")
            if isinstance(schema, dict):
                result.append(schema)
        for value in node.values():
            result.extend(parameter_schemas(value, name))
    elif isinstance(node, list):
        for value in node:
            result.extend(parameter_schemas(value, name))
    return result


def assert_string_constraints(
    schema: dict[str, Any],
    *,
    min_length: int | None = None,
    max_length: int | None = None,
    enum: list[str] | None = None,
    label: str,
) -> None:
    if schema.get("type") != "string":
        fail(f"{label}.type must be string")
    if min_length is not None and schema.get("minLength") != min_length:
        fail(f"{label}.minLength must be {min_length}")
    if max_length is not None and schema.get("maxLength") != max_length:
        fail(f"{label}.maxLength must be {max_length}")
    if enum is not None and schema.get("enum") != enum:
        fail(f"{label}.enum must be {enum}")


def main() -> int:
    if shutil.which("gh") is None:
        print("ASA R0 PR34 OpenAPI gate BLOCKED: gh CLI is not installed", file=sys.stderr)
        return EX_CONFIG

    try:
        pr = gh_api(f"repos/{REPOSITORY}/pulls/{PR_NUMBER}")
        if pr.get("head", {}).get("ref") != EXPECTED_HEAD:
            fail(f"PR #34 head must be {EXPECTED_HEAD}")
        head_sha = pr.get("head", {}).get("sha")
        if not isinstance(head_sha, str) or len(head_sha) != 40:
            fail("PR #34 head SHA is missing or invalid")

        document = yaml.safe_load(remote_text(head_sha, "schemas/openapi.yaml"))
        if not isinstance(document, dict):
            fail("OpenAPI document must be a mapping")
        if not str(document.get("openapi", "")).startswith("3."):
            fail("OpenAPI version must be 3.x")
        paths = document.get("paths")
        if not isinstance(paths, dict):
            fail("OpenAPI paths must be a mapping")
        missing_paths = sorted(REQUIRED_PATHS - set(paths))
        if missing_paths:
            fail("OpenAPI misses Project paths: " + ", ".join(missing_paths))

        project_id_parameters = parameter_schemas(paths, "projectId")
        if not project_id_parameters:
            fail("OpenAPI has no projectId path parameter schema")
        for index, schema in enumerate(project_id_parameters):
            if schema.get("type") != "string" or schema.get("format") != "uuid":
                fail(f"projectId parameter {index} must be string/uuid")

        classroom_parameters = parameter_schemas(paths, "classroomId")
        for index, schema in enumerate(classroom_parameters):
            if schema.get("type") != "string" or schema.get("format") != "uuid":
                fail(f"classroomId query parameter {index} must be string/uuid")

        schemas = (document.get("components") or {}).get("schemas")
        if not isinstance(schemas, dict):
            fail("OpenAPI components.schemas must be a mapping")

        _, create = one_schema(
            schemas,
            "create project request",
            lambda _name, schema: {"title", "moduleKey", "scope"} <= property_keys(schema),
        )
        if create.get("additionalProperties") is not False:
            fail("create project request must set additionalProperties: false")
        if set(create.get("required") or []) != {"title", "moduleKey", "scope"}:
            fail("create project required fields must be title/moduleKey/scope")
        create_properties = create["properties"]
        assert_string_constraints(
            create_properties["title"],
            min_length=1,
            max_length=160,
            label="create.title",
        )
        assert_string_constraints(
            create_properties["moduleKey"],
            max_length=64,
            enum=["electronics"],
            label="create.moduleKey",
        )
        assert_string_constraints(
            create_properties["scope"],
            enum=["personal", "classroom"],
            label="create.scope",
        )
        classroom = create_properties.get("classroomId")
        if isinstance(classroom, dict):
            string_variants = []
            if classroom.get("type") == "string":
                string_variants.append(classroom)
            if isinstance(classroom.get("oneOf"), list):
                string_variants.extend(
                    item
                    for item in classroom["oneOf"]
                    if isinstance(item, dict) and item.get("type") == "string"
                )
            if not string_variants or any(item.get("format") != "uuid" for item in string_variants):
                fail("create.classroomId string schema must use format: uuid")

        _, rename = one_schema(
            schemas,
            "rename project request",
            lambda name, schema: (
                property_keys(schema) == {"title"}
                or (name.lower().startswith("rename") and "title" in property_keys(schema))
            ),
        )
        if rename.get("additionalProperties") is not False:
            fail("rename project request must set additionalProperties: false")
        if set(rename.get("required") or []) != {"title"}:
            fail("rename project request must require title")
        assert_string_constraints(
            rename["properties"]["title"],
            min_length=1,
            max_length=160,
            label="rename.title",
        )

        _, draft = one_schema(
            schemas,
            "save draft request",
            lambda name, schema: (
                "document" in property_keys(schema)
                and ("draft" in name.lower() or property_keys(schema) == {"document"})
            ),
        )
        if draft.get("additionalProperties") is not False:
            fail("save draft request must set additionalProperties: false")
        if set(draft.get("required") or []) != {"document"}:
            fail("save draft request must require document")

        _, checkpoint = one_schema(
            schemas,
            "checkpoint request",
            lambda name, schema: (
                "label" in property_keys(schema)
                and ("checkpoint" in name.lower() or property_keys(schema) == {"label"})
            ),
        )
        if checkpoint.get("additionalProperties") is not False:
            fail("checkpoint request must set additionalProperties: false")
        assert_string_constraints(
            checkpoint["properties"]["label"],
            min_length=1,
            max_length=160,
            label="checkpoint.label",
        )

        for path in REQUIRED_PATHS:
            for method, operation in (paths[path] or {}).items():
                if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                    continue
                if not isinstance(operation, dict):
                    continue
                responses = operation.get("responses")
                if not isinstance(responses, dict) or "400" not in responses:
                    fail(f"{method.upper()} {path} must document a 400 validation response")

    except (RuntimeError, ValueError, yaml.YAMLError) as error:
        prefix = "BLOCKED" if isinstance(error, RuntimeError) else "FAIL"
        print(f"ASA R0 PR34 OpenAPI gate {prefix}: {error}", file=sys.stderr)
        return EX_CONFIG if isinstance(error, RuntimeError) else 1

    print("ASA R0 PR34 OpenAPI source PASS")
    print(f"- PR head: {head_sha}")
    print("- Project paths: 4")
    print("- UUID parameter formats: enforced")
    print("- request additionalProperties: false")
    print("- title/module/scope/label limits: aligned with controller")
    print("- runtime contract execution: NOT_RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
