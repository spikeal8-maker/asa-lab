#!/usr/bin/env python3
"""Validate ASA Lab document authority registry."""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = "docs/agent/document-registry.yaml"
REQUIRED_FIELDS = {"id", "path", "scope", "kind", "status", "authority", "read_when"}
ALLOWED_STATUS = {"canonical", "supporting", "historical", "superseded", "review_only"}
CONTEXT_ROLE_VALUES = ["root", "compact", "target", "task", "escalation", "trace", "historical", "review"]
ALLOWED_CONTEXT_ROLES = set(CONTEXT_ROLE_VALUES)
SUPPORTED_SCHEMA_VERSIONS = {"1.0.0", "1.1.0"}
ENCODING_GUARD_PATHS = (
    "AGENTS.md",
    "START_HERE_FOR_AI.md",
    "docs/agent/README.md",
    "docs/agent/review-protocol.md",
    "docs/architecture/AI_MAINTENANCE_DOCUMENTATION_SYSTEM.md",
    "tools/gate-governance.sh",
)



def load_registry(root: Path) -> dict[str, Any]:
    path = root / REGISTRY
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"cannot read {REGISTRY}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("document registry root must be a mapping")
    return data


def _valid_relative_path(raw: Any) -> bool:
    if not isinstance(raw, str) or not raw or "\\" in raw:
        return False
    path = PurePosixPath(raw)
    return not path.is_absolute() and ".." not in path.parts


def _valid_delegated_root(raw: Any) -> bool:
    if not isinstance(raw, str) or not raw.endswith("/**") or "\\" in raw:
        return False
    prefix = raw[:-3].rstrip("/")
    return prefix.startswith("docs/") and _valid_relative_path(prefix)


def validate_registry(root: Path, data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    version = str(data.get("schema_version") or "1.0.0")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        errors.append(f"schema_version unsupported: {version!r}")
    if data.get("coverage") not in {"partial", "full"}:
        errors.append("coverage must be 'partial' or 'full'")
    if not isinstance(data.get("unregistered_documents_allowed"), bool):
        errors.append("unregistered_documents_allowed must be boolean")
    if data.get("coverage") == "full" and data.get("unregistered_documents_allowed"):
        errors.append("full coverage cannot allow unregistered documents")

    declared = data.get("status_values")
    if declared != ["canonical", "supporting", "historical", "superseded", "review_only"]:
        errors.append("status_values must use the canonical ordered set")
    if version == "1.1.0" and data.get("context_role_values") != CONTEXT_ROLE_VALUES:
        errors.append("context_role_values must use the canonical ordered set")

    documents = data.get("documents")
    if not isinstance(documents, list) or not documents:
        return errors + ["documents must be a non-empty array"]

    ids: set[str] = set()
    paths: set[str] = set()
    canonical_authorities: dict[str, str] = {}
    delegated_root_owners: dict[str, str] = {}
    by_id: dict[str, dict[str, Any]] = {}

    for index, raw in enumerate(documents):
        prefix = f"documents[{index}]"
        if not isinstance(raw, dict):
            errors.append(f"{prefix} must be a mapping")
            continue
        missing = REQUIRED_FIELDS - raw.keys()
        if missing:
            errors.append(f"{prefix} missing fields: {', '.join(sorted(missing))}")
            continue

        doc_id = raw.get("id")
        path = raw.get("path")
        status = raw.get("status")
        authority = raw.get("authority")
        read_when = raw.get("read_when")
        lanes = raw.get("lanes")
        context_role = raw.get("context_role")

        if version == "1.1.0":
            if not isinstance(lanes, list) or not lanes or not all(
                isinstance(item, str) and item for item in lanes
            ):
                errors.append(f"{prefix}.lanes must be a non-empty string array")
            if context_role not in ALLOWED_CONTEXT_ROLES:
                errors.append(f"{prefix}.context_role invalid: {context_role!r}")

        if not isinstance(doc_id, str) or not doc_id:
            errors.append(f"{prefix}.id must be non-empty string")
            continue
        if doc_id in ids:
            errors.append(f"duplicate document id: {doc_id}")
        ids.add(doc_id)
        by_id[doc_id] = raw

        if not _valid_relative_path(path):
            errors.append(f"{prefix}.path must be a safe POSIX-relative path")
        elif path in paths:
            errors.append(f"duplicate document path: {path}")
        else:
            paths.add(path)
            if not (root / PurePosixPath(path)).is_file():
                errors.append(f"registered document does not exist: {path}")

        if status not in ALLOWED_STATUS:
            errors.append(f"{prefix}.status has invalid value: {status!r}")
        if not isinstance(authority, str) or not authority:
            errors.append(f"{prefix}.authority must be non-empty string")
        if not isinstance(read_when, list) or not read_when or not all(
            isinstance(item, str) and item for item in read_when
        ):
            errors.append(f"{prefix}.read_when must be a non-empty string array")

        delegated_roots = raw.get("delegated_roots")
        if delegated_roots is not None:
            if version != "1.1.0":
                errors.append(f"{prefix}.delegated_roots requires registry schema 1.1.0")
            if status != "canonical" or context_role != "compact":
                errors.append(f"{prefix}.delegated_roots requires canonical compact document")
            if (
                not isinstance(delegated_roots, list)
                or not delegated_roots
                or not all(isinstance(item, str) and item for item in delegated_roots)
                or len(delegated_roots) != len(set(delegated_roots))
            ):
                errors.append(f"{prefix}.delegated_roots must be a unique non-empty string array")
            else:
                for delegated_root in delegated_roots:
                    if not _valid_delegated_root(delegated_root):
                        errors.append(f"{prefix}.delegated_roots contains unsafe root {delegated_root!r}")
                        continue
                    root_prefix = delegated_root[:-3].rstrip("/")
                    if not (root / PurePosixPath(root_prefix)).is_dir():
                        errors.append(f"{prefix}.delegated_roots directory does not exist: {root_prefix}")
                    previous = delegated_root_owners.get(delegated_root)
                    if previous is not None and previous != doc_id:
                        errors.append(
                            f"delegated document root {delegated_root!r} is duplicated by "
                            f"{previous} and {doc_id}"
                        )
                    else:
                        delegated_root_owners[delegated_root] = str(doc_id)

        if status == "canonical":
            if authority == "none":
                errors.append(f"canonical document {doc_id} cannot have authority 'none'")
            elif authority in canonical_authorities:
                errors.append(
                    f"canonical authority {authority!r} is duplicated by "
                    f"{canonical_authorities[authority]} and {doc_id}"
                )
            else:
                canonical_authorities[authority] = doc_id

    for doc_id, raw in by_id.items():
        snapshot_hash = raw.get("snapshot_sha256")
        if snapshot_hash is not None:
            if not isinstance(snapshot_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", snapshot_hash):
                errors.append(f"document {doc_id} has invalid snapshot_sha256")
            elif _valid_relative_path(raw.get("path")) and (root / raw["path"]).is_file():
                if hashlib.sha256((root / raw["path"]).read_bytes()).hexdigest() != snapshot_hash:
                    errors.append(f"document {doc_id} historical snapshot checksum mismatch")
        if raw.get("status") != "superseded":
            continue
        target = raw.get("superseded_by")
        if not isinstance(target, str) or not target:
            errors.append(f"superseded document {doc_id} must define superseded_by")
            continue
        target_doc = by_id.get(target)
        if target_doc is None:
            errors.append(f"superseded document {doc_id} points to unknown id {target}")
        elif target_doc.get("status") != "canonical":
            errors.append(f"superseded document {doc_id} must point to canonical document")

    strict_scopes = data.get("strict_task_scopes") or []
    if version == "1.1.0" and (
        not isinstance(strict_scopes, list)
        or not all(isinstance(item, str) and item for item in strict_scopes)
        or len(strict_scopes) != len(set(strict_scopes))
    ):
        errors.append("strict_task_scopes must be a unique string array")

    live = [raw for raw in documents if isinstance(raw, dict) and raw.get("kind") == "live_state"]
    if len(live) != 1 or live[0].get("path") != "docs/execution/current.yaml":
        errors.append("the only live_state document must be docs/execution/current.yaml")

    for relative in ENCODING_GUARD_PATHS:
        guarded = root / PurePosixPath(relative)
        if not guarded.is_file():
            continue
        try:
            payload = guarded.read_text(encoding="utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            errors.append(f"encoding guard cannot decode {relative} as UTF-8: {exc}")
            continue
        if "\ufffd" in payload or re.search(r"\?{3,}", payload):
            errors.append(f"encoding guard found replacement/question-mark corruption in {relative}")

    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    try:
        data = load_registry(root)
    except ValueError as exc:
        print(f"document registry: FAIL\n- {exc}", file=sys.stderr)
        return 1
    errors = validate_registry(root, data)
    if errors:
        print("document registry: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"document registry: PASS ({len(data['documents'])} documents)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
