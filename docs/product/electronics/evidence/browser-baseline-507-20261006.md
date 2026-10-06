# #507 — exact-head browser baseline diagnosis

Scope: diagnostic only for [#507](https://github.com/spikeal8-maker/asa-lab/issues/507), blocking [#505 / PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506). Candidate HEAD `350d2442d044d8992374ca4deef2758b6c95c61f`; [Electronics run 37506449432](https://github.com/spikeal8-maker/asa-lab/actions/runs/37506449432), attempts 1 and 2. The added rigid-board scenario passed in both attempts. This note does not claim product acceptance or a green browser gate.

Saved local evidence, downloaded from that GitHub run: `C:\Users\spike\.codex\temp\electronics-507\attempt1\trace.zip`, `attempt1\error-context.md`, `attempt2\trace.zip`, and `attempt2\error-context.md`. The failed browser jobs are `112418752966` (attempt 1) and `112425881424` (attempt 2); their short failed-step logs are available from the run above. The trace archives are untracked evidence and are not repackaged in this documentation commit.

## Arduino Reset, attempt 1

**Observed:** `e2e/electronics-simulation.spec.ts:2218` failed in `expectArduinoBrightness(page, 'low', 'before Reset')`, before any Reset click. For the 60-second wall-clock poll, the trace records 60 successive `data-led-brightness=70` reads after the first HIGH observation. The failure diagnostic records one worker, generation 1, no LED diagnostic, a lit LED image, and five consecutive `yielded` advances: requested horizon 36,400,400 µs; committed horizon 25,749,000 → 26,773,000 µs over approximately 2.1 seconds. The toolbar still displayed the last published 15.0001-second result. The worker was progressing, not visibly faulted or stalled.

**Source-backed mechanism:** This fixture holds D13 HIGH for 20,000 ms of model time and then LOW. Its ordinary LED selects the electrothermal scheduler profile. `arduino-circuit-scheduler.ts` uses a fixed 1,000 µs physics barrier and at most 256 clock events per advance. `live-simulation-worker-controller.ts` resumes a `yielded` target and intentionally calls `onResult`/`onCommittedHorizon` only on `ready`, preserving the rule against presenting an incomplete requested horizon. Thus committed calculation can pass the HIGH/LOW transition while the visible LED retains an earlier complete result until the requested target finishes. At failure the target was still 9,627,400 µs ahead of committed work. This explains why the 60-second visual poll failed. The evidence does **not** establish why this CI attempt processed model time more slowly than a prior passing run, or whether the same lag affects a learner's device.

**User-visible consequence under the observed load:** the editor continued to show a lit LED and older simulation time after calculation had passed the programmed LOW transition. This is meaningful staleness if it occurs during a lesson. The trace establishes that consequence in this CI scenario; classroom frequency and severity remain unmeasured.

**Classification:** pre-existing browser baseline performance/observation limit, unrelated to #506. Neither a broken Reset nor a stuck worker is demonstrated. Do not lengthen the poll or lower the physics resolution as a diagnostic shortcut.

**Directed next check:** on isolated CI, run only this Arduino Reset browser scenario with the same fixture and record every Worker response's `metrics.computeMs`, requested/committed horizons, `executionStatus`, and every UI `onResult` timestamp. Compare a single-scenario run with an intentionally loaded runner while keeping assertions unchanged. If lag is intrinsic, bound a separate product cadence/performance repair without changing solver physics or publishing partial horizons. If it is only runner contention, design a test fixture/synchronization repair that still proves HIGH → LOW before and after Reset, and one new generation. A browser run remains necessary; the local worktree has no authorized isolated API/PostgreSQL stand.

## E2 running button, attempt 2

**Observed:** the trace after Start shows `class="workbench-pill simulate"`, `data-simulation-status="starting"`, `aria-pressed="true"`, and the Stop label. It remains `starting` after the test's two animation frames. The test then reads a white computed background, while it expects `rgb(234, 245, 252)`.

**Proven cause:** `WorkbenchHeader.tsx` sets the Stop label and `aria-pressed` from `simulationRunning`, but adds the `running` class from `simulationStatus === 'running'`. `use-workbench-project-state.ts` sets `simulationRunning=true` and status `starting` on click; `use-electronics-workbench.ts` calls `confirmSimulationStarted()` only after the first Worker result. `workbench.css` applies the blue active style to `.workbench-pill.simulate.running`. The E2 test waits for the Stop label and pressed attribute, then assumes two animation frames imply a Worker result. The trace proves that assumption false. This is a test synchronization defect; it does not show missing styling during the actual `running` state.

**Smallest separate repair:** in the existing E2 scenario, wait for `data-simulation-status="running"` with the standard Playwright assertion, then check the same computed background, color, and weight without increasing a timeout or weakening the style assertions. Run only E2 in an isolated built browser first, and retain the full exact-head gate for #505 acceptance.

## Verification and limits

- `pnpm agent:preflight --scope electronics --check`: `SAFE_TO_START`, selected #507, no dirty overlaps.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-BROWSER-BASELINE-001`: 84/84 routing tests and selected card PASS after installing exact locked dependencies.
- Directed controller tests: `resumes yielded canonical work without publishing a partial horizon` and `finishes a yielded target before chasing newer host horizons`: 2/2 PASS.
- Directed timed-engine yield/resume test: 1/1 PASS.
- `pnpm gate:governance`: PASS. `pnpm exec prettier --check` on this note: PASS. `git diff --check`: PASS.
- No product or #506 file changed; no local stack, deployment, database, or whole browser suite was started. The existing `workflow_dispatch` has no test filter and would rerun the full suite, so browser diagnosis of Arduino remains a separate controlled CI step.

Later remote `main` moved to `da50f239f0d5301c525e4eee08e3fcb1ea204c0c` via Learning-only files; the Electronics diagnostic code was inspected at selected main `c04d61b71f45b49471aecaf3ce376d13afa7f76b`, while the original failures are from the exact PR HEAD above.
