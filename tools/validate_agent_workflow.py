#!/usr/bin/env python3
"""Validate the permanent agent publication and Docker recovery route."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str, errors: list[str]) -> str:
    path = ROOT / relative
    if not path.is_file():
        errors.append(f"missing required workflow file: {relative}")
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 - report the exact broken file
        errors.append(f"cannot read {relative}: {exc}")
        return ""


def require(relative: str, source: str, markers: list[str], errors: list[str]) -> None:
    for marker in markers:
        if marker not in source:
            errors.append(f"{relative}: missing workflow marker {marker!r}")


def main() -> int:
    errors: list[str] = []
    sources = {
        relative: read(relative, errors)
        for relative in (
            "AGENTS.md",
            "START_HERE_FOR_AI.md",
            "docs/delivery/BOT_RUNBOOK.md",
            "docs/delivery/AGENT_CHANGE_WORKFLOW.md",
            "docs/deployment/GUARDED_UPDATE.md",
            "docs/deployment/DOCKER_BACKUP_RESTORE.md",
            "docs/architecture/OFFLINE_MULTI_NODE_DATA_SYNC_IDEA.md",
            "tools/agent_context.py",
            "tools/docker-update.sh",
            "tools/docker-update.ps1",
            "tools/docker-backup.sh",
            "tools/docker-backup.ps1",
            "tools/docker-restore.sh",
            "tools/docker-restore.ps1",
        )
    }

    workflow_path = "docs/delivery/AGENT_CHANGE_WORKFLOW.md"
    workflow = sources[workflow_path]
    for relative in ("AGENTS.md", "START_HERE_FOR_AI.md"):
        require(relative, sources[relative], [workflow_path], errors)
    require(
        "docs/delivery/BOT_RUNBOOK.md",
        sources["docs/delivery/BOT_RUNBOOK.md"],
        ["AGENT_CHANGE_WORKFLOW.md"],
        errors,
    )
    require(
        "tools/agent_context.py",
        sources["tools/agent_context.py"],
        [workflow_path, "delivery_workflow"],
        errors,
    )
    require(
        workflow_path,
        workflow,
        [
            "pnpm agent:context --scope <lane>",
            "git diff --cached --name-only",
            "git push origin main",
            "CI success",
            "-CheckOnly",
            "docker-update.sh --check",
            "docker-backup.ps1",
            "docker-backup.sh",
            "docker-restore.ps1",
            "docker-restore.sh",
            "_test",
            "COMMIT_SHA",
            "DATABASE_ACTIONS",
            "CHECK BLOCKED",
            "build-metadata.json",
        ],
        errors,
    )
    require(
        "tools/docker-backup.sh",
        sources["tools/docker-backup.sh"],
        ["pg_dump --format=custom", "pg_restore --list", "umask 077"],
        errors,
    )
    for relative in ("tools/docker-restore.sh", "tools/docker-restore.ps1"):
        require(relative, sources[relative], ["_test", "pg_restore", "schema_migrations"], errors)
    require(
        "tools/docker-update.sh",
        sources["tools/docker-update.sh"],
        ["mixed_origin_services", "database_origin", "build-metadata.json", "CHECK BLOCKED"],
        errors,
    )
    require(
        "tools/docker-update.ps1",
        sources["tools/docker-update.ps1"],
        [
            "Select-RequiredWorkflowRun",
            "Get-MixedOriginServices",
            "Assert-CanonicalDatabaseOrigin",
            "build-metadata.json",
            "CHECK BLOCKED",
        ],
        errors,
    )
    require(
        "docs/architecture/OFFLINE_MULTI_NODE_DATA_SYNC_IDEA.md",
        sources["docs/architecture/OFFLINE_MULTI_NODE_DATA_SYNC_IDEA.md"],
        ["архитектурная идея", "transactional outbox", "идемпотент", "multi-master PostgreSQL"],
        errors,
    )

    package_path = ROOT / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
        command = (package.get("scripts") or {}).get("agent-workflow:check")
        if command != "python tools/validate_agent_workflow.py":
            errors.append("package.json: agent-workflow:check must run the canonical validator")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"cannot validate package.json: {exc}")

    if errors:
        print("ASA Lab agent workflow validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ASA Lab agent workflow validation: PASS")
    print("- focused change, Git publication, exact-SHA CI and Docker recovery are linked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
