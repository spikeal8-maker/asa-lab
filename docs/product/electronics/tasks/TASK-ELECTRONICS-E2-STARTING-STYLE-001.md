---
task_id: TASK-ELECTRONICS-E2-STARTING-STYLE-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Independent acceptance of TASK-ELECTRONICS-BROWSER-BASELINE-001 diagnosis
acceptance_boundary: slice
review: independent
---

# Await the running state before the E2 active-button style assertion

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Separate repair: [#509](https://github.com/spikeal8-maker/asa-lab/issues/509). The diagnosis in [#507](https://github.com/spikeal8-maker/asa-lab/issues/507) proved that the E2 browser test reads the simulation button style during `starting`, before its `running` class is present. This is independent of the rigid-board candidate [PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506).

## One user result

The browser acceptance check verifies the blue active simulation button when the simulation has actually reached `running`. It retains the exact background, text color and font-weight assertions; it no longer interprets a Stop label during `starting` as proof of a completed Worker result.

## Entry and bounded repair

Recover fresh `origin/main`, Electronics lane, #509, #507 evidence, PR #506 and other agents' unfinished work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-E2-STARTING-STYLE-001` before edits. Inspect attempt-2 trace from Electronics run `37506449432` and the exact E2/WorkbenchHeader/status/CSS path.

Change only the existing E2 browser test so a standard Playwright assertion waits for `data-simulation-status="running"` before the current strict computed-style checks. Do not increase timeouts, relax CSS values, change button/product behavior, add a sleep, edit Arduino or mix this change into PR #506. If a directed built-browser run reveals a product defect instead, stop and report evidence before expanding scope.

Run the E2 scenario alone in an isolated CI browser setup first. The existing workflow dispatch lacks a test filter; a bounded diagnostic CI route may be used if it is reviewed and does not leave an unintended change to the normal gate. Do not use the live installation or start a second local Compose stack. Then obtain exact-head focused, full Electronics browser and repository gates. A new independent reviewer must inspect the final SHA, actual diff, trace-based cause and GitHub CI. The controller integrates this repair separately, then continues the Arduino dependency and later resumes #505.

## Stop

The implementer reports one exact candidate SHA and STOP. The controller handles independent review, integration, closeout and the next selected program slice. No owner acceptance or deployment is implied.
