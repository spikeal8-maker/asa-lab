#!/usr/bin/env python3
"""Validate ASA Lab document authority registry."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = "docs/agent/document-registry.yaml"
REQUIRED_FIELDS = {"id", "path", "scope", "kind", "status", "authority", "read_when"}
ALLOWED_STATUS = {"canonical", "supporting", "historical", "superseded", "review_only"}


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


def validate_registry(root: Path, data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if data.get("coverage") not in {"partial", "full"}:
        errors.append("coverage must be 'partial' or 'full'")
    if not isinstance(data.get("unregistered_documents_allowed"), bool):
        errors.append("unregistered_documents_allowed must be boolean")
    if data.get("coverage") == "full" and data.get("unregistered_documents_allowed"):
        errors.append("full coverage cannot allow unregistered documents")

    declared = data.get("status_values")
    if declared != ["canonical", "supporting", "historical", "superseded", "review_only"]:
        errors.append("status_values must use the canonical ordered set")

    documents = data.get("documents")
    if not isinstance(documents, list) or not documents:
        return errors + ["documents must be a non-empty array"]

    ids: set[str] = set()
    paths: set[str] = set()
    canonical_authorities: dict[str, str] = {}
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

    live = [raw for raw in documents if isinstance(raw, dict) and raw.get("kind") == "live_state"]
    if len(live) != 1 or live[0].get("path") != "docs/execution/current.yaml":
        errors.append("the only live_state document must be docs/execution/current.yaml")

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
