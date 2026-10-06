---
task_id: TASK-ELECTRONICS-DEPENDENCY-BASELINE-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Independent shared baseline security failure reproduced on clean main while verifying TASK-ELECTRONICS-BREADBOARD-EXTRACTION-001
acceptance_boundary: slice
review: independent
---

# Restore the shared dependency security baseline

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Bounded baseline repair: [#502](https://github.com/spikeal8-maker/asa-lab/issues/502). This is an independent CI blocker for the pending rigid extraction candidate [#500](https://github.com/spikeal8-maker/asa-lab/issues/500), not part of its product diff.

## One result

The repository's frozen dependency graph no longer contains the five confirmed high/critical advisories for `source-map-js`, `nx` and `tinypool`, while the existing code, data and browser gates retain their intended behavior. No Electronics product code, pupil schematic, asset, deployment or database state changes.

## Entry evidence and bounded investigation

Recover fresh `origin/main`, the Electronics lane and current GitHub CI. On `main=57a794ea3a82870e32237f5c7e415e3ab9bb9769`, `pnpm security:dependencies` reproduced the exact five findings from #500 general CI; #501 changes no dependency manifest or lockfile. Read the authoritative advisories and package release/peer contracts. Before writing, run the read-only preflight for the selected task and check for overlapping package/lockfile edits in other worktrees and open PRs.

## Bounded repair

- Update only the affected direct/transitive dependency graph and frozen lockfile to compatible patched versions. Keep all Nx packages aligned; account for Vitest's supported worker pool and affected CI/helper worker-limit variables if a major Vitest update is necessary.
- If an existing test needs adaptation solely because its runner contract changed, keep that adaptation focused and explain it. Do not alter Electronics behavior, application runtime dependencies without evidence, unrelated tests, assets or other execution lanes.
- Do not deploy, update Docker, change working DB, network, auth or owner files. Do not merge old lockfile PRs as a shortcut.

## Acceptance

- Exact candidate dependency inventory reports no listed vulnerable versions; `pnpm security:dependencies` passes with no suppression or relaxed severity.
- `pnpm gate:repository`, impacted builds/tests and `git diff --check` have exact-head evidence. If local PostgreSQL is unavailable, report that limit and require the full GitHub gate. A new independent reviewer checks final SHA, actual diff and GitHub state.
- Integrate the accepted baseline and obtain exact-main general CI. Then return #500 to the Electronics lane for its final convergence, exact-head verification and closeout. #502 does not accept #500 on its behalf.

## Stop

The implementer repairs this one dependency baseline, self-reviews and reports the exact candidate SHA, then STOP. The controller independently checks it, assigns a new reviewer, integrates the accepted repair and resumes the pending Electronics slice under `AGENTS.md` §2.1.
