# ASA Lab — GitHub-first development protocol

## Purpose

GitHub is the canonical development state. A developer workstation is an optional short-lived runner, not a second source of truth.

This protocol is mandatory for **all ASA Lab bots and all technical changes**, including small fixes and host/service configuration, not only long-running or Scratch tasks.

## Source of truth

Canonical state lives in GitHub:

- `main` and feature branch commit SHAs;
- `docs/execution/current.yaml`;
- committed source, tests and documentation;
- pull requests and reviews;
- exact-SHA GitHub Actions evidence.

Do not rely on an unpushed local commit, worktree, terminal session, Docker image or chat memory as project state.

After a tool/session failure, recover from GitHub first: `main SHA → current task → PR/branch HEAD → divergence → exact-SHA CI`.

## Reproducible operations

1. **Before** changing code, Docker/Compose, 1Panel, systemd, scheduler, FRP/VPN,
   MCP, ports, backup jobs or workstation settings, identify the canonical host
   and a versioned recipe in `main`. If absent, add the idempotent script,
   declarative config/template or replayable API steps with verification and
   recovery procedure. A manual UI/SSH change alone is not completion.
2. **Apply** the approved revision through safe tooling; read back the actual
   state and check for configuration drift. Report GitHub `main` SHA, exact CI,
   installed runtime SHA and proof that a clean host can reproduce the setup.
3. **Exception:** emergency fixes are provisional; record the non-secret action
   and recovery evidence in an Issue and reconcile it with GitHub in the same
   task. Never claim `DONE` when an untracked host-only change remains.
4. Keep real secrets, private `.env`, PostgreSQL/MinIO data and archives **out
   of GitHub**. Commit safe templates and recovery steps; keep confidential
   material in separately protected, independently restorable stores.
5. Update the **owning file** instead of adding a new manual for every change.

## Write model

Prefer GitHub-backed branch/commit state as early as practical. Important work must not exist only on one workstation for an extended period.

One selected slice has one authoring context. Multiple bots must not concurrently edit the same slice/branch unless explicitly coordinated.

Recommended roles:

1. **Author agent** — only writer for the selected bounded slice.
2. **Independent reviewer agent/human** — read-only review of exact final SHA for HIGH/CRITICAL slices; never edits while claiming independence.
3. **CI runner** — GitHub Actions is authoritative for production Docker/browser/data evidence.
4. **Local runner** — optional formatter, unit test, typecheck and short focused checks only.

## Local-computer policy

Use the workstation only when it shortens the feedback loop safely:

- formatting;
- unit tests;
- typecheck/lint;
- small focused gates;
- narrow source inspection.

Do not use the workstation as canonical state storage. Avoid complex PowerShell one-liners, long-lived unpushed commits and unnecessary worktrees.

For Scratch, do not use the local Docker Desktop for the pinned production Scratch/Terser build when the machine cannot provide reliable memory. Production Docker and cross-origin Chromium evidence belong in GitHub Actions.

## CI policy

Use the cheapest valid evidence first:

`unit/typecheck → focused gate → focused browser/Docker → repository gate`.

Do not rerun a heavy job without a new code change or a concrete infrastructure-retry reason.

Inspect failures as: `workflow → job → step → short log fragment`; full logs are last resort.

A failure in another module is not permission to repair that module inside the current slice.

## Scratch build optimisation

The pinned upstream Scratch build is immutable for a fixed upstream SHA and build recipe. Prefer reusing a cached/base build artifact or image across host/protocol/product-control slices.

Rebuild the full upstream production bundle when the upstream pin, Scratch build recipe, dependency lock affecting it, or Docker build inputs change. Otherwise, host-level validation should reuse the immutable base where CI infrastructure supports it.

This optimisation must preserve reproducibility: the reused artifact must be identified by exact upstream/build-input digest and full reproducible build evidence must remain available.

## Integration cycle

For a feature branch:

`known main → bounded implementation → quick local checks → push → focused CI → self-review → one final convergence → final focused/general evidence → independent review/owner acceptance if required → merge/report → STOP`.

Do not chase every unrelated `main` commit while implementation is in progress.

## Time accounting

Estimate work in **active engineering hours**, separately from CI/reviewer waiting time. Do not count repeated baseline repairs, cancelled workflows or avoidable environment recovery as product-development scope.

Every estimate should state which product checkpoint it reaches: first visible editor, durable save/load, M1 complete, or production activation.
