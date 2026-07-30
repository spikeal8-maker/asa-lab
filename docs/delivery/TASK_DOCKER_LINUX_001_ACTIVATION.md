# TASK-DOCKER-LINUX-001 — activation and bounded baseline preflight

Status: `active / in_progress / infrastructure-only / Draft PR #70`

This file is the task-specific normative clarification referenced by
`docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` for Issue #69.
It resolves the conflict reported on the Windows 11 / WSL2 workstation without
changing the frozen product delivery queue.

## Canonical identity

```text
task: TASK-DOCKER-LINUX-001
issue: #69
base: assistant/chess-online-core
branch: assistant/docker-linux-bootstrap
draft PR: #70
product focus frozen: TASK-ELECTRONICS-SLICE-001
```

`main`, Draft PR #66 and Draft PR #68 are not merged or rebased by this task.

## Why baseline corrections are authorized

The infrastructure manifest requires format, contract, lint, type, build and
unit gates to pass before Docker evidence can be accepted. The exact base-derived
branch currently contains pre-existing failures in those mandatory commands.
Leaving those failures untouched would make the infrastructure exit gate
impossible, while removing the commands would weaken the gate.

Therefore this task explicitly authorizes a bounded baseline-preflight stage.
It is not product development. It exists only to restore the already required
baseline commands to PASS before Docker runtime work.

The currently authorized failure classes are:

- existing ASA Chess unit-test failures;
- an existing opening-book TypeScript error;
- existing lint failures in the frozen Electronics slice;
- missing required contract markers in
  `docs/product/ASA_CHESS_PLATFORM_SPEC.md`;
- existing formatting drift in `packages/**` and `tools/**`.

Other baseline failures must first be recorded and checked against the manifest.
An unrelated failure does not automatically expand the scope.

## Mandatory correction rules

For every baseline correction the agent must:

1. Record the exact command and concise failure output before editing.
2. Confirm the failure exists before Docker runtime implementation changes.
3. Modify only paths allowed by the active infrastructure manifest.
4. Make the smallest change necessary to restore the documented behavior or
   existing executable contract.
5. Keep baseline corrections in clearly named `fix(baseline): ...` commits,
   separate from Docker implementation commits.
6. Rerun the focused command after the change.
7. Rerun the complete non-Docker baseline command matrix before starting Docker
   runtime work.
8. Report modified files and before/after results in Draft PR #70.

The agent must not:

- add a product capability, route, role, page or public workflow;
- add a new dependency merely to bypass a defect;
- add a new migration unless an already required executable contract proves it
  necessary and the owner explicitly approves that change;
- weaken or delete tests, assertions, lint rules, strict types, contract markers,
  architecture boundaries, RLS, tenant isolation, idempotency or security checks;
- mark the frozen Electronics task done or in review;
- use baseline correction as permission for unrelated refactoring.

If the intended behavior is ambiguous or conflicts with Product Blueprint,
Capability Map, an ADR, architecture baseline or an executable contract, stop and
report the exact conflict.

## Allowed-path clarification

The active manifest now permits the original Docker scope plus these baseline
prerequisite paths:

```text
packages/**
tools/**
docs/product/ASA_CHESS_PLATFORM_SPEC.md
apps/**
contexts/**
tests/**
e2e/**
```

`apps/**`, `contexts/**`, `tests/**` and `e2e/**` remain limited by the
`product_code_rule`: corrections only, no new product scope.

## Safe resume with existing local changes

The workstation currently has only these uncommitted generated changes:

```text
pnpm-lock.yaml
docs/project-map/nx-project-graph.json
```

Preserve them while synchronizing the new normative commits:

```bash
git status --short --branch
git stash push -m "TASK-DOCKER-LINUX-001 lock-and-graph pre-sync" -- \
  pnpm-lock.yaml docs/project-map/nx-project-graph.json
git fetch origin --prune
git pull --ff-only origin assistant/docker-linux-bootstrap
git stash pop
```

Do not use `git reset --hard` while these local changes are unstashed.

After synchronization, verify:

```bash
git rev-parse HEAD
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_delivery_program.py
python tools/validate_test_catalog.py
python tools/validate_architecture.py
python tools/validate_capability_map.py
```

Then commit the already generated lockfile and Nx graph as a dedicated commit if
their diffs are limited to dependency synchronization and graph regeneration.

## Execution order

```text
1. Preserve lockfile and Nx graph.
2. Pull the current remote branch.
3. Run governance validators.
4. Reproduce and record every mandatory baseline failure.
5. Apply bounded baseline corrections.
6. Obtain PASS for the complete non-Docker baseline matrix.
7. Implement Linux Dockerfiles and Compose profiles.
8. Prove database, migration, health, persistence and backup/restore behavior.
9. Run Chromium and responsive evidence gates.
10. Publish factual PASS/FAIL/BLOCKED/NOT_RUN results in Draft PR #70.
11. Stop for owner review; do not merge.
```

## Exit condition

This task remains `in_progress` and PR #70 remains Draft until all required
commands and artifacts in the infrastructure manifest are factually PASS.
`BLOCKED` and `NOT_RUN` do not close the task.
