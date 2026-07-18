#!/usr/bin/env python3
"""Deterministic validation of the ASA Lab architecture foundation."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = (
    "README.md",
    "AGENTS.md",
    "START_HERE_FOR_AI.md",
    "docs/architecture/ARCHITECTURE_BASELINE.md",
    "docs/architecture/CAPACITY_AND_SLO.md",
    "docs/architecture/AI_DELIVERY_GOVERNANCE.md",
    "docs/architecture/DECISIONS.md",
    "docs/architecture/IMPLEMENTATION_ROADMAP.md",
    "docs/architecture/DATA_SECURITY_AND_TENANCY.md",
    "docs/architecture/ADMIN_AND_COMMERCIAL.md",
    "docs/architecture/architecture-rules.yaml",
    ".github/workflows/spec-validation.yml",
)

BASELINE_INVARIANTS = (
    "Modular Monolith Control Plane",
    "Compute Plane",
    "tenant_id",
    "ProjectVersion",
    "transactional outbox",
    "Module SDK",
    "EntitlementService",
    "StudentSeat",
    "TenantPlacement",
    "Rust/WASM",
)

RULE_REQUIRED_FIELDS = {"id", "severity", "statement", "verification"}
RULE_ID_PATTERN = re.compile(r"^ARCH-[0-9]{3}$")
MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
IMPLEMENTATION_MARKER_PATTERN = re.compile(
    r"(^|[^A-Za-z])(TODO|TBD|FIXME|mock success)([^A-Za-z]|$)",
    re.IGNORECASE,
)
CODE_DIRECTORIES = ("apps", "packages", "contexts", "modules", "crates")
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".rs", ".sql", ".py"}


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def validate_required_files(errors: list[str]) -> None:
    for relative_path in REQUIRED_FILES:
        if not (ROOT / relative_path).is_file():
            errors.append(f"Missing required file: {relative_path}")


def validate_rules(errors: list[str]) -> int:
    path = ROOT / "docs/architecture/architecture-rules.yaml"
    if not path.is_file():
        return 0

    try:
        document: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse architecture rules: {exc}")
        return 0

    if not isinstance(document, dict):
        errors.append("Architecture rules root must be an object")
        return 0

    rules = document.get("rules")
    if not isinstance(rules, list):
        errors.append("Architecture rules must contain a rules array")
        return 0

    if len(rules) < 30:
        errors.append(f"Expected at least 30 architecture rules, got {len(rules)}")

    seen_ids: set[str] = set()
    for index, rule in enumerate(rules, start=1):
        if not isinstance(rule, dict):
            errors.append(f"Rule #{index} must be an object")
            continue

        missing = RULE_REQUIRED_FIELDS - set(rule)
        if missing:
            errors.append(f"Rule #{index} misses fields: {', '.join(sorted(missing))}")

        rule_id = rule.get("id")
        if not isinstance(rule_id, str) or not RULE_ID_PATTERN.fullmatch(rule_id):
            errors.append(f"Rule #{index} has invalid id: {rule_id!r}")
        elif rule_id in seen_ids:
            errors.append(f"Duplicate architecture rule id: {rule_id}")
        else:
            seen_ids.add(rule_id)

        if rule.get("severity") not in {"error", "warning"}:
            errors.append(f"Rule {rule_id or index} has invalid severity")
        if not isinstance(rule.get("statement"), str) or not rule.get("statement", "").strip():
            errors.append(f"Rule {rule_id or index} has an empty statement")
        if not isinstance(rule.get("verification"), str) or not rule.get("verification", "").strip():
            errors.append(f"Rule {rule_id or index} has an empty verification method")

    return len(rules)


def validate_baseline(errors: list[str]) -> None:
    path = ROOT / "docs/architecture/ARCHITECTURE_BASELINE.md"
    if not path.is_file():
        return

    baseline = path.read_text(encoding="utf-8")
    for invariant in BASELINE_INVARIANTS:
        if invariant not in baseline:
            errors.append(f"Architecture baseline misses invariant: {invariant}")

    if baseline.count("## ") < 20:
        errors.append("Architecture baseline is unexpectedly incomplete")


def validate_markdown_links(errors: list[str]) -> int:
    scanned = 0
    for path in sorted(ROOT.rglob("*.md")):
        if ".git" in path.parts:
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK_PATTERN.finditer(text):
            target = match.group(1).strip()
            if target.startswith(("#", "http://", "https://", "mailto:")):
                continue
            relative_target = target.split("#", 1)[0]
            if not relative_target:
                continue
            resolved = (path.parent / relative_target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                errors.append(f"Markdown link escapes repository: {path.relative_to(ROOT)} -> {target}")
                continue
            if not resolved.exists():
                errors.append(f"Broken Markdown link: {path.relative_to(ROOT)} -> {target}")
    return scanned


def validate_implementation_markers(errors: list[str]) -> int:
    scanned = 0
    for directory_name in CODE_DIRECTORIES:
        directory = ROOT / directory_name
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            scanned += 1
            text = path.read_text(encoding="utf-8", errors="replace")
            for line_number, line in enumerate(text.splitlines(), start=1):
                if IMPLEMENTATION_MARKER_PATTERN.search(line):
                    errors.append(
                        f"Prohibited implementation marker: "
                        f"{path.relative_to(ROOT)}:{line_number}"
                    )
    return scanned


def validate_decision_coverage(errors: list[str]) -> int:
    path = ROOT / "docs/architecture/DECISIONS.md"
    if not path.is_file():
        return 0
    text = path.read_text(encoding="utf-8")
    ids = sorted(set(re.findall(r"ADR-[0-9]{4}", text)))
    required = {f"ADR-{index:04d}" for index in range(1, 11)}
    missing = sorted(required - set(ids))
    for decision_id in missing:
        errors.append(f"Missing accepted decision: {decision_id}")
    return len(ids)


def main() -> int:
    errors: list[str] = []

    validate_required_files(errors)
    rules = validate_rules(errors)
    validate_baseline(errors)
    markdown_files = validate_markdown_links(errors)
    implementation_files = validate_implementation_markers(errors)
    decisions = validate_decision_coverage(errors)

    if errors:
        print("ASA Lab architecture validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA Lab architecture validation: PASS")
    print(f"architectureRules={rules}")
    print(f"acceptedDecisions={decisions}")
    print(f"markdownFilesScanned={markdown_files}")
    print(f"implementationFilesScanned={implementation_files}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
