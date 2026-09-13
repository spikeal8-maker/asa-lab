# ASA Lab — GitHub-first development protocol

## Purpose

GitHub is the canonical development state. A developer workstation is an optional short-lived runner, not a second source of truth.

This protocol applies to long-running agent work and is mandatory for Scratch/Visual Programming work.

## Source of truth

Canonical state lives in GitHub:

- `main` and feature branch commit SHAs;
- `docs/execution/current.yaml`;
- committed source, tests and documentation;
- pull requests and reviews;
- exact-SHA GitHub Actions evidence.

Do not rely on an unpushed local commit, worktree, terminal session, Docker image or chat memory as project state.

After a tool/session failure, recover from GitHub first: `main SHA → current task → PR/branch HEAD → divergence → exact-SHA CI`.

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
