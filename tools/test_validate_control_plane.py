#!/usr/bin/env python3
"""Each rule the control-plane validator exists to enforce, exercised deliberately.

This validator guards the record of what the project is doing, and until now it
had no tests of its own. Both defects found in it during the August 2026
stabilisation surfaced only because something went red at an awkward moment: it
compared the state file against the tip of main rather than the merge base, so a
branch that had never touched the file failed for it; and it read a git blob
through a helper that strips trailing whitespace, so the comparison could only
ever have succeeded by accident.

Every case below is a violation that must be rejected, or a legitimate
arrangement that must be accepted. A suite that only checks the happy path would
have passed against both defects.

Run: python tools/test_validate_control_plane.py
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cp", HERE / "validate_control_plane.py")
cp = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(cp)

EXECUTOR = "assistant-stabilisation"


def stamp(offset_hours: float) -> str:
    moment = datetime.now(timezone.utc) + timedelta(hours=offset_hours)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def lease(**overrides) -> dict:
    held = {
        "executor_id": EXECUTOR,
        "holder": EXECUTOR,
        "acquired_at": stamp(-1),
        "expires_at": stamp(+7),
    }
    held.update(overrides)
    return held


def gates(**overrides) -> dict:
    declared = {"governance": {"workflow": "spec-validation.yml", "command": "pnpm gate:governance"}}
    declared.update(overrides)
    return declared


CASES: list[tuple[str, object, str]] = []


def case(name: str, expect: str = ""):
    def decorate(fn):
        CASES.append((name, fn, expect))
        return fn
    return decorate


# ── the lease: who may write ─────────────────────────────────────────────────


@case("a lease held by its declared executor", expect="")
def lease_healthy(_):
    errors: list[str] = []
    cp.check_lease(lease(), errors)
    return errors


@case("a second agent granting itself the lease", expect="cannot grant itself")
def lease_second_writer(_):
    errors: list[str] = []
    cp.check_lease(lease(holder="some-other-agent"), errors)
    return errors


@case("an unassigned lease still carrying timestamps", expect="must be null while holder is unassigned")
def lease_released_but_dated(_):
    errors: list[str] = []
    cp.check_lease(lease(holder="unassigned"), errors)
    return errors


@case("a lease whose window has passed", expect="expired at")
def lease_expired(_):
    errors: list[str] = []
    cp.check_lease(lease(acquired_at=stamp(-9), expires_at=stamp(-1)), errors)
    return errors


@case("a lease that expires before it was acquired", expect="must be after acquired_at")
def lease_inverted(_):
    errors: list[str] = []
    cp.check_lease(lease(acquired_at=stamp(+3), expires_at=stamp(+1)), errors)
    return errors


@case("a lease timestamp with no UTC offset", expect="ISO-8601")
def lease_naive(_):
    errors: list[str] = []
    cp.check_lease(lease(acquired_at="2026-08-07 03:24:35"), errors)
    return errors


@case("a released lease, properly cleared", expect="")
def lease_released(_):
    errors: list[str] = []
    cp.check_lease({"executor_id": EXECUTOR, "holder": "unassigned",
                    "acquired_at": None, "expires_at": None}, errors)
    return errors


# ── gates: outcomes are not stored here ──────────────────────────────────────


@case("a gate recording a status", expect="outcomes are read from")
def gate_status(_):
    errors: list[str] = []
    cp.check_gate_shape(gates(governance={"workflow": "w.yml", "status": "PASS"}), errors)
    return errors


@case("a gate recording a verified_sha", expect="outcomes are read from")
def gate_verified_sha(_):
    errors: list[str] = []
    cp.check_gate_shape(gates(governance={"workflow": "w.yml", "verified_sha": "a" * 40}), errors)
    return errors


@case("a gate that names no workflow", expect="must name a GitHub workflow")
def gate_no_workflow(_):
    errors: list[str] = []
    cp.check_gate_shape({"governance": {"command": "pnpm gate:governance"}}, errors)
    return errors


@case("gates declared with a workflow and nothing else", expect="")
def gate_healthy(_):
    errors: list[str] = []
    cp.check_gate_shape(gates(), errors)
    return errors


# ── the task record ──────────────────────────────────────────────────────────


def task_document(**overrides) -> dict:
    task = {
        "id": "TASK-ELECTRONICS-M1-001",
        "issue": 63,
        "branch": "agent/r4-electronics-m1",
        "base_branch": "main",
        "pr": 72,
        "status": "in_progress",
        "checkpoint": "phase_5_asset_separation",
    }
    task.update(overrides)
    return {"task": task, "execution_lease": lease(), "gates": gates()}


@case("a status outside the allowed set", expect="task.status invalid")
def task_bad_status(_):
    errors: list[str] = []
    cp.check_current(task_document(status="nearly_done"), errors)
    return errors


# ── the pull request a task points at ────────────────────────────────────────
#
# The rule demanded OPEN whatever the status, which made a finished task
# impossible to record: merging its pull request turned main's own gate red, so
# the only way to stay green was never to complete anything. It also sat inside
# the function that talks to GitHub, where no test could reach it.


def state_error(status: str, state: str) -> list[str]:
    problem = cp.pull_request_state_error(
        status=status, state=state, task_id="TASK-ELECTRONICS-M1-001", pr=72
    )
    return [problem] if problem else []


@case("work in flight pointing at a merged pull request", expect="still names it")
def pr_merged_while_in_flight(_):
    return state_error("in_progress", "MERGED")


@case("work in flight pointing at a closed pull request", expect="still names it")
def pr_closed_while_in_flight(_):
    return state_error("in_review", "CLOSED")


@case("work in flight with its pull request open", expect="")
def pr_open_while_in_flight(_):
    return state_error("in_progress", "OPEN")


@case("a task called done whose pull request never landed", expect="a merged one")
def pr_open_while_done(_):
    return state_error("done", "OPEN")


@case("a task called done whose pull request was merged", expect="")
def pr_merged_while_done(_):
    return state_error("done", "MERGED")


@case("a task id that does not match the scheme", expect="task.id invalid")
def task_bad_id(_):
    errors: list[str] = []
    cp.check_current(task_document(id="ELECTRONICS-1"), errors)
    return errors


@case("a complete task record", expect="")
def task_healthy(_):
    errors: list[str] = []
    cp.check_current(task_document(), errors)
    return errors


# ── the state file, against a real repository ────────────────────────────────


def git(*args: str, cwd: Path) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True).stdout


def build_repo(root: Path, *, main_state: str, branch_state: str | None) -> None:
    """A repository with main, an origin that tracks it, and a task branch.

    branch_state None means the task branch leaves the file exactly as inherited.
    """
    root.mkdir(parents=True, exist_ok=True)
    state = root / "docs/execution/current.yaml"
    state.parent.mkdir(parents=True, exist_ok=True)

    git("init", "-q", "-b", "main", cwd=root)
    git("config", "user.email", "test@example.invalid", cwd=root)
    git("config", "user.name", "test", cwd=root)

    state.write_text(main_state, encoding="utf-8")
    git("add", "-A", cwd=root)
    git("commit", "-q", "-m", "main state", cwd=root)

    git("checkout", "-q", "-b", "agent/r4-electronics-m1", cwd=root)
    if branch_state is not None:
        state.write_text(branch_state, encoding="utf-8")
        git("add", "-A", cwd=root)
        git("commit", "-q", "-m", "branch touches state", cwd=root)

    # An origin that points at this repository gives a real origin/main ref.
    git("remote", "add", "origin", str(root), cwd=root)
    git("fetch", "-q", "origin", cwd=root)


BASE_STATE = "task:\n  id: TASK-ELECTRONICS-M1-001\n  branch: agent/r4-electronics-m1\n"


def state_file_case(main_state: str, branch_state: str | None, advance_main: str | None = None):
    """Run the canonical-copy check against a fixture repository."""
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "repo"
        build_repo(root, main_state=main_state, branch_state=branch_state)
        if advance_main is not None:
            git("checkout", "-q", "main", cwd=root)
            (root / "docs/execution/current.yaml").write_text(advance_main, encoding="utf-8")
            git("add", "-A", cwd=root)
            git("commit", "-q", "-m", "main moves on", cwd=root)
            git("checkout", "-q", "agent/r4-electronics-m1", cwd=root)
            git("fetch", "-q", "origin", cwd=root)

        saved = cp.ROOT
        try:
            cp.bind_root(root)
            errors: list[str] = []
            notes: list[str] = []
            cp.check_state_file_is_canonical(
                {"branch": "agent/r4-electronics-m1"}, errors, notes
            )
            return errors, notes
        finally:
            cp.bind_root(saved)


@case("the task branch edits the state file", expect="modifies docs/execution/current.yaml")
def state_edited(_):
    errors, _ = state_file_case(BASE_STATE, BASE_STATE + "  pr: 72\n")
    return errors


@case("the task branch leaves the state file alone", expect="")
def state_untouched(_):
    errors, notes = state_file_case(BASE_STATE, None)
    assert any("byte for byte" in n for n in notes), notes
    return errors


@case("main moves on and the branch is merely behind", expect="")
def state_behind(_):
    errors, notes = state_file_case(BASE_STATE, None, advance_main=BASE_STATE + "  pr: 72\n")
    assert any("behind origin/main" in n for n in notes), notes
    return errors


def main() -> int:
    failures = 0
    for name, prepare, expect in CASES:
        try:
            errors = prepare(None)
        except AssertionError as exc:
            print(f"  FAIL {name:56} note missing: {exc}")
            failures += 1
            continue
        if expect:
            ok = any(expect in error for error in errors)
            verdict = "rejected" if ok else "ACCEPTED"
        else:
            ok = not errors
            verdict = "accepted" if ok else "REJECTED"
        print(f"  {'ok  ' if ok else 'FAIL'} {name:56} {verdict}")
        if not ok:
            failures += 1
            for error in errors[:3]:
                print(f"         {error}")

    print()
    if failures:
        print(f"control plane validator tests: FAIL ({failures} of {len(CASES)})")
        return 1
    print(f"control plane validator tests: PASS ({len(CASES)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
