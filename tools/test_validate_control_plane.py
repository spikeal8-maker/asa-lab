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


def gate_result_case(status: str) -> list[str]:
    saved_run = cp.run
    try:
        cp.run = lambda _command: (1, "workflow not registered")
        errors: list[str] = []
        notes: list[str] = []
        cp.check_gate_results(
            {
                "id": "TASK-CHESS-R1-001",
                "branch": "agent/chess-r1-foundation",
                "status": status,
                "_gates": {"focused": {"workflow": "Chess R1 Focused"}},
            },
            "a" * 40,
            errors,
            notes,
            require=True,
        )
        return errors
    finally:
        cp.run = saved_run


@case("an in-progress lane need not have a workflow conclusion yet", expect="")
def gate_result_in_progress(_):
    return gate_result_case("in_progress")


@case("an in-review lane must have a workflow conclusion", expect="cannot read runs")
def gate_result_in_review(_):
    return gate_result_case("in_review")


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


# ── structural registries: no second live-state copy ───────────────────────


def registry_case(relative: str, document: dict, check) -> list[str]:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        import yaml

        path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
        saved = cp.ROOT
        try:
            cp.bind_root(root)
            errors: list[str] = []
            check(errors)
            return errors
        finally:
            cp.bind_root(saved)


@case("the architecture map cannot copy current focus", expect="duplicates execution state")
def project_map_live_focus(_):
    return registry_case(
        "docs/project-map/project-map.yaml",
        {
            "project": {
                "current_focus": "TASK-PRIMARY-001",
                "execution_state_source": "docs/execution/current.yaml",
            }
        },
        cp.check_project_map,
    )


@case("a structural architecture map points to current.yaml", expect="")
def project_map_structural(_):
    return registry_case(
        "docs/project-map/project-map.yaml",
        {"project": {"execution_state_source": "docs/execution/current.yaml"}},
        cp.check_project_map,
    )


@case("the execution test registry cannot copy active_task", expect="must not duplicate")
def active_tests_live_task(_):
    return registry_case(
        "docs/testing/active-task-tests.yaml",
        {
            "active_task": "TASK-PRIMARY-001",
            "task_selection_source": "docs/execution/current.yaml",
        },
        cp.check_active_tests,
    )


@case("the execution test registry delegates task selection", expect="")
def active_tests_structural(_):
    return registry_case(
        "docs/testing/active-task-tests.yaml",
        {"task_selection_source": "docs/execution/current.yaml"},
        cp.check_active_tests,
    )


@case("direct main ignores expired legacy leases", expect="")
def direct_main_ignores_expired_lease(_):
    document = task_document()
    document["development_policy"] = {
        "mode": "direct_main",
        "branch": "main",
        "feature_branches": "optional",
        "pull_requests": "optional",
        "execution_leases": "disabled",
        "lane_path_ownership": "advisory",
    }
    document["execution_lease"] = lease(
        acquired_at=stamp(-9), expires_at=stamp(-1)
    )
    errors: list[str] = []
    cp.check_current(document, errors)
    return errors


@case("direct main task may omit a pull request", expect="")
def direct_main_without_pr(_):
    document = task_document(branch="main", pr=None)
    document["development_policy"] = {
        "mode": "direct_main",
        "branch": "main",
        "feature_branches": "optional",
        "pull_requests": "optional",
        "execution_leases": "disabled",
        "lane_path_ownership": "advisory",
    }
    errors: list[str] = []
    cp.check_current(document, errors)
    return errors


# ── schema 1.1 lanes: identity and portable disjoint scopes ─────────────────


def chess_task(**overrides) -> dict:
    task = {
        "id": "TASK-CHESS-R1-001",
        "issue": 97,
        "branch": "agent/chess-r1-foundation",
        "base_branch": "main",
        "pr": 103,
        "status": "in_progress",
        "checkpoint": "engine_contract",
    }
    task.update(overrides)
    return task


def multilane_document(**overrides) -> dict:
    document = task_document()
    document.update(
        {
            "schema_version": "1.1.0",
            "primary_lane": {
                "id": "electronics",
                "worktree_id": "electronics-m1",
                "owned_paths": ["contexts/electronics/**"],
            },
            "parallel_lanes": [
                {
                    "id": "chess",
                    "worktree_id": "chess-r1",
                    "owned_paths": ["contexts/chess/**"],
                    "task": chess_task(),
                    "revisions": {
                        "convergence_baseline_sha": "a" * 40,
                        "head_sha": "a" * 40,
                    },
                    "execution_lease": lease(
                        executor_id="assistant-chess", holder="assistant-chess"
                    ),
                    "gates": gates(),
                }
            ],
            "integration": {
                "owner_lane": "electronics",
                "shared_paths": ["package.json", "docs/execution/current.yaml"],
            },
        }
    )
    document.update(overrides)
    return document


def collect_errors(document: dict) -> list[str]:
    errors: list[str] = []
    primary = cp.check_current(document, errors)
    cp.collect_lanes(document, primary, errors)
    return errors


@case("schema 1.0 remains a valid single-lane document", expect="")
def lane_schema_1_0(_):
    return collect_errors(task_document())


@case("schema 1.1 accepts two disjoint leased lanes", expect="")
def lane_schema_1_1(_):
    return collect_errors(multilane_document())


@case("a parallel lane reusing the primary branch", expect="unique branch")
def lane_duplicate_branch(_):
    document = multilane_document()
    document["parallel_lanes"][0]["task"]["branch"] = document["task"]["branch"]
    return collect_errors(document)


@case("direct main accepts multiple lanes on main without PRs", expect="")
def lane_direct_main_shared_branch(_):
    document = multilane_document()
    document["development_policy"] = {
        "mode": "direct_main",
        "branch": "main",
        "feature_branches": "optional",
        "pull_requests": "optional",
        "execution_leases": "disabled",
        "lane_path_ownership": "advisory",
    }
    document["task"].update({"branch": "main", "pr": None})
    document["parallel_lanes"][0]["task"].update({"branch": "main", "pr": None})
    return collect_errors(document)


@case("a parallel lane reusing the primary executor", expect="unique executor_id")
def lane_duplicate_executor(_):
    document = multilane_document()
    document["parallel_lanes"][0]["execution_lease"] = lease()
    return collect_errors(document)


@case("an integration owner that is not a lane", expect="must name a declared lane")
def lane_unknown_integration_owner(_):
    document = multilane_document()
    document["integration"]["owner_lane"] = "ghost"
    return collect_errors(document)


@case("an absolute scope is rejected", expect="not a portable repository-relative path")
def lane_absolute_scope(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["/contexts/chess/**"]
    return collect_errors(document)


@case("a Windows scope is rejected", expect="not a portable repository-relative path")
def lane_windows_scope(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["contexts\\chess\\**"]
    return collect_errors(document)


@case("a traversal scope is rejected", expect="traversal segment")
def lane_traversal_scope(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["contexts/../chess/**"]
    return collect_errors(document)


@case("a partial glob scope is rejected", expect="unsupported glob")
def lane_partial_glob(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["apps/api/chess*.ts"]
    return collect_errors(document)


@case("two lanes cannot own overlapping prefixes", expect="lane scopes overlap")
def lane_owned_overlap(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["contexts/electronics/solver/**"]
    return collect_errors(document)


@case("a lane cannot relabel a shared path as owned", expect="overlaps shared scope")
def lane_shared_overlap(_):
    document = multilane_document()
    document["parallel_lanes"][0]["owned_paths"] = ["docs/**"]
    return collect_errors(document)


@case("similarly named sibling scopes do not overlap", expect="")
def lane_sibling_prefixes(_):
    document = multilane_document()
    document["primary_lane"]["owned_paths"] = ["contexts/chess-live/**"]
    return collect_errors(document)


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
UNICODE_STATE = BASE_STATE + "# ── Каноническое состояние ──\n"


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


@case("the canonical copy preserves UTF-8 on every platform", expect="")
def state_unicode_untouched(_):
    errors, notes = state_file_case(UNICODE_STATE, None)
    assert any("byte for byte" in n for n in notes), notes
    return errors


@case("main moves on and the branch is merely behind", expect="")
def state_behind(_):
    errors, notes = state_file_case(BASE_STATE, None, advance_main=BASE_STATE + "  pr: 72\n")
    assert any("behind origin/main" in n for n in notes), notes
    return errors


@case("the state file is protected on every product lane", expect="modifies docs/execution/current.yaml")
def state_parallel_lane_edited(_):
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "repo"
        build_repo(root, main_state=BASE_STATE, branch_state=BASE_STATE + "  pr: 72\n")
        saved = cp.ROOT
        try:
            cp.bind_root(root)
            errors: list[str] = []
            notes: list[str] = []
            cp.check_state_file_is_canonical(
                [
                    {"branch": "agent/some-other-product"},
                    {"branch": "agent/r4-electronics-m1"},
                ],
                errors,
                notes,
            )
            return errors
        finally:
            cp.bind_root(saved)


# ── branch scope: committed, staged, unstaged and untracked ──────────────────


def build_scope_repo(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "docs/execution").mkdir(parents=True, exist_ok=True)
    (root / "contexts/chess").mkdir(parents=True, exist_ok=True)
    (root / "docs/execution/current.yaml").write_text("schema_version: 1.1.0\n", encoding="utf-8")
    (root / "contexts/chess/base.ts").write_text("export const base = 1;\n", encoding="utf-8")
    (root / "README.md").write_text("base\n", encoding="utf-8")
    git("init", "-q", "-b", "main", cwd=root)
    git("config", "user.email", "test@example.invalid", cwd=root)
    git("config", "user.name", "test", cwd=root)
    git("add", "-A", cwd=root)
    git("commit", "-q", "-m", "main", cwd=root)
    git("checkout", "-q", "-b", "agent/chess-r1-foundation", cwd=root)
    git("remote", "add", "origin", str(root), cwd=root)
    git("fetch", "-q", "origin", cwd=root)


def scope_lane(*, integration_owner: bool = False) -> dict:
    return {
        "id": "chess",
        "owned_paths": ["contexts/chess/**"],
        "shared_paths": ["package.json", "docs/execution/current.yaml"],
        "integration_owner": integration_owner,
        "scoped": True,
        "task": chess_task(),
    }


def branch_scope_case(change, *, integration_owner: bool = False):
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "repo"
        build_scope_repo(root)
        change(root)
        saved = cp.ROOT
        try:
            cp.bind_root(root)
            errors: list[str] = []
            notes: list[str] = []
            cp.check_lane_branch_scopes(
                [scope_lane(integration_owner=integration_owner)], errors, notes
            )
            return errors
        finally:
            cp.bind_root(saved)


def commit_path(root: Path, relative: str, content: str = "changed\n") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    git("add", relative, cwd=root)
    git("commit", "-q", "-m", f"change {relative}", cwd=root)


@case("a committed owned path is accepted", expect="")
def scope_committed_owned(_):
    return branch_scope_case(
        lambda root: commit_path(root, "contexts/chess/move.ts")
    )


@case("scope validation refreshes a stale remote-tracking ref", expect="")
def scope_refreshes_remote_ref(_):
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "repo"
        build_scope_repo(root)
        commit_path(root, "contexts/chess/move.ts")
        product_head = git("rev-parse", "HEAD", cwd=root).strip()
        git("checkout", "-q", "main", cwd=root)
        git("checkout", "-q", "-b", "governance", cwd=root)
        saved = cp.ROOT
        try:
            cp.bind_root(root)
            errors: list[str] = []
            notes: list[str] = []
            cp.check_lane_branch_scopes(
                [scope_lane()], errors, notes, require_remote=True
            )
            tracked = git(
                "rev-parse", "origin/agent/chess-r1-foundation", cwd=root
            ).strip()
            assert tracked == product_head, (tracked, product_head)
            assert any("refreshed" in note for note in notes), notes
            return errors
        finally:
            cp.bind_root(saved)


@case("a committed foreign path is rejected", expect="out-of-scope path README.md")
def scope_committed_foreign(_):
    return branch_scope_case(lambda root: commit_path(root, "README.md"))


@case("a committed foreign deletion is rejected", expect="out-of-scope path README.md")
def scope_deleted_foreign(_):
    def change(root: Path) -> None:
        (root / "README.md").unlink()
        git("add", "-A", cwd=root)
        git("commit", "-q", "-m", "delete foreign path", cwd=root)

    return branch_scope_case(change)


@case("a rename cannot move an owned file outside its lane", expect="out-of-scope path moved.ts")
def scope_rename_out(_):
    def change(root: Path) -> None:
        (root / "contexts/chess/base.ts").rename(root / "moved.ts")
        git("add", "-A", cwd=root)

    return branch_scope_case(change)


@case("a staged foreign path is rejected", expect="out-of-scope path staged.txt")
def scope_staged_foreign(_):
    def change(root: Path) -> None:
        (root / "staged.txt").write_text("staged\n", encoding="utf-8")
        git("add", "staged.txt", cwd=root)

    return branch_scope_case(change)


@case("an unstaged foreign path is rejected", expect="out-of-scope path README.md")
def scope_unstaged_foreign(_):
    def change(root: Path) -> None:
        (root / "README.md").write_text("unstaged\n", encoding="utf-8")

    return branch_scope_case(change)


@case("an untracked foreign path is rejected", expect="out-of-scope path untracked.txt")
def scope_untracked_foreign(_):
    def change(root: Path) -> None:
        (root / "untracked.txt").write_text("untracked\n", encoding="utf-8")

    return branch_scope_case(change)


@case("a non-owner cannot stage a shared path", expect="only integration owner")
def scope_shared_non_owner(_):
    def change(root: Path) -> None:
        (root / "package.json").write_text("{}\n", encoding="utf-8")
        git("add", "package.json", cwd=root)

    return branch_scope_case(change)


@case("the integration owner may stage a shared path", expect="")
def scope_shared_owner(_):
    def change(root: Path) -> None:
        (root / "package.json").write_text("{}\n", encoding="utf-8")
        git("add", "package.json", cwd=root)

    return branch_scope_case(change, integration_owner=True)


@case("even the integration owner cannot edit state on a product branch", expect="protected docs/execution/current.yaml")
def scope_state_always_protected(_):
    def change(root: Path) -> None:
        (root / "docs/execution/current.yaml").write_text(
            "schema_version: 1.1.0\nchanged: true\n", encoding="utf-8"
        )

    return branch_scope_case(change, integration_owner=True)


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
