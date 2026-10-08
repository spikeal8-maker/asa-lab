---
task_id: TASK-ELECTRONICS-BROWSER-BASELINE-001
kind: analysis/inventory
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Candidate and independent review of TASK-ELECTRONICS-BREADBOARD-RIGID-MOVE-001
acceptance_boundary: slice
review: independent
---

# Diagnose two exact-head Electronics browser baseline failures

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Diagnostic task: [#507](https://github.com/spikeal8-maker/asa-lab/issues/507). It unblocks the browser evidence for [#505](https://github.com/spikeal8-maker/asa-lab/issues/505) without editing its candidate [PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506).

## One result

Classify the distinct failures in Electronics workflow `37506449432` attempts 1 and 2 on exact HEAD `350d2442d044d8992374ca4deef2758b6c95c61f`. Establish whether each is a production defect, test synchronisation defect, runner contention or another cause. Produce a reproducible, bounded repair plan for each proven cause. The new rigid-board test passed in both attempts and remains outside this diagnosis.

## Evidence-first diagnosis

Recover fresh `origin/main`, Electronics lane, #507, PR #506 and other agents' unfinished work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-BROWSER-BASELINE-001` before edits. Read the Electronics route, stabilization spec and this card.

Start with saved workflow logs, failure contexts, screenshots and browser trace recordings from both attempts. For Arduino Reset, map expected LED low state to actual worker requested/committed time, scheduler yields, runtime/clock state and test fixture. For E2, map the `simulationRunning`/`simulationStatus` transition, button class/style, rendered frames and test assertion. Inspect the first successful #505 browser candidate run as a comparison, but do not infer a fix merely from one green run.

Then run **directed scenarios only** with an explicit hypothesis and controlled setup. Record exact SHA, command, browser, fixture, observed state/timing and result. Do not rerun the whole suite hoping for green. Do not increase waits, weaken assertions or change product behavior without causal evidence.

## Boundary and handoff

This diagnostic slice changes no product code or #506 test. If one or both failures require repairs, define separate bounded repair(s) with their own scope, candidate SHA, focused/browser evidence and independent review. Keep Arduino and E2 changes out of PR #506. Do not touch solver physics, owner artwork, deployment, database, live school installation or unrelated cleanup.

## Acceptance

- Each failure has a source-and-trace-backed classification with a directed reproduction or a documented limit on reproduction. The evidence distinguishes observed behavior from inference.
- The report identifies the smallest repair and exact targeted regression for each confirmed cause, or explains why no repair is justified. Any required owner decision is explicit.
- `git diff --check`, relevant mapped checks and a new independent review verify this diagnostic result. The controller retains #505's acceptance blocker until its required full exact-head Electronics browser evidence is green and its reviewed PR is integrated.

## Stop

The diagnostic implementer investigates these two failures only, reports evidence and STOP. The controller separately selects any confirmed repair and later resumes #505. No next Electronics milestone starts from this card automatically.
