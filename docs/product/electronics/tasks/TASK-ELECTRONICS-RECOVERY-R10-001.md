---
task_id: TASK-ELECTRONICS-RECOVERY-R10-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-RECOVERY-R00-001
  - TASK-ELECTRONICS-GOVERNANCE-015
  - TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001
acceptance_boundary: slice
review: independent
---

# R10 — one asynchronous stopped preflight for diagnostics and LED preparation

Bounded owner assignment [#1111](https://github.com/spikeal8-maker/asa-lab/issues/1111),
parent programme #452 / registry #703. Basis: recovery specification v1.1 at
5e66430ae4d8e937aebc7c6cc85d7006b692e84c, sections 4–6, 11 and 13.
Only the controller selects this card in accepted main after sufficient R00
evidence and accepted hygiene checkpoint 007. This prepared card does not select
itself or permit a feature branch to select its own task.

## One visible result

With simulation stopped, the full editor must reuse one correct asynchronous
preflight for diagnostics and LED resources. Visual edits with unchanged
electrical input/programs do not run the solver again; physical changes and
Arduino source changes obtain current results without a synchronous render solve.
The unchanged R00 scenes and protocol demonstrate the measured effect. Do not
claim the complete R10–R12 smoothness budget or cold-load budget.

## Component, risk and exact reading

Primary component: `electronics.ui.workbench`. Necessary existing dependencies:
`electronics.worker.live-controller`, `electronics.worker.protocol`, and
`electronics.engine.public-api`. These dependencies are required to remove a
confirmed duplicate at the existing Worker boundary, not a new architecture.

Read the router, mapped entries in `components/ui-assets-persistence.yaml` and
`components/engine-worker-clock.yaml`, AGENT_GUIDE sections 2, 4.1, 5, 9–13,
DEVELOPMENT_SPEC sections 7.1 and 1.3, and the accepted R00 evidence/fixtures.
Inspect exactly:

- `apps/web/src/electronics/use-electronics-workbench.ts`: staticPreflightResult,
  stopped LED warmup, diagnosticResult, project-session effects and Start/Stop;
- `apps/web/src/electronics/live-simulation.ts`: calculateSimulationPreflight
  and stopped calculateLiveSimulation;
- `apps/web/src/electronics/live-simulation-worker-controller.ts`: established
  running source-only updates, canonical structure and generation lifecycle;
- `apps/web/src/electronics/simulation-worker-client.ts`,
  `simulation-worker-protocol.ts`, `simulation-worker-evaluator.ts`;
- `contexts/electronics/simulation.ts`, `engine.ts`, the simulationInputDigest
  declaration in `contexts/electronics/domain/simulation-input-digest.ts`, and
  simulationModelSetDigest / analyseCircuit in `contexts/electronics/domain/simulation.ts`;
- the three owner-named tests and the specific new regression boundaries below.

The repair preserves mathematical equations, clock, persistence, model identity
and direct/Worker result semantics. MEDIUM reflects controller plumbing under
those established contracts; independent review is explicitly mandatory for this
owner request. If mathematics, time or persistence must change, stop and return
the newly discovered scope to the controller.

## Expected author writes

Four product files:

1. `apps/web/src/electronics/use-electronics-workbench.ts`
2. `apps/web/src/electronics/stopped-simulation-preflight.ts`
3. `apps/web/src/electronics/simulation-worker-evaluator.ts`
4. `contexts/electronics/simulation.ts`

The new module is the stable key/cache/lifecycle boundary, avoiding growth of the
large hook. The domain facade change is only the public re-export of the existing
model-set digest; no model registry or digest rule changes. Existing running
controller and live-simulation functions remain read-only unless a precise
necessary extension is first coordinated with the controller.

Direct supporting tests and routes:

- `apps/web/src/electronics/testing/stopped-simulation-preflight.spec.ts`
- `apps/web/src/electronics/testing/simulation-worker.spec.ts`
- `apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts`
- `apps/web/src/electronics/testing/workbench-presentation.spec.ts`
- `e2e/electronics-simulation.spec.ts`
- `docs/product/electronics/generated/component-coverage.json`
- `docs/product/electronics/components/engine-worker-clock.yaml`
- `docs/product/electronics/components/ui-assets-persistence.yaml`
- `apps/web/src/electronics/testing/stopped-preflight.browser.mjs`
- `.github/workflows/electronics-recovery-performance.yml`
- `.github/workflows/electronics-r4-m1-focused.yml`
- `tools/electronics_r10_paired_diagnostic.py`
- `tools/test_ci_image_transport.py`
- `docs/product/electronics/evidence/recovery-r10-20261113.md`
- `docs/product/electronics/evidence/recovery-r10-raw.json`

The explicit exception to two focused test files is necessary: cache/generation,
actual Worker solver count/parity, and actual React session/pending lifecycle are
three distinct failure boundaries. The fourth test file updates the existing
presentation contract that literally required the removed duplicate preflight:
require the shared stopped hook and reject a direct preflight call instead,
preserving its other assertions. The controller coordinated this exact addition
after the first M1 run passed 1274 web tests and exposed only that obsolete
assertion; the path was clean in all four cloud worktrees and the read-only
D2-R2 checkout at the b318656e9d80ea8ddb40b06159f7c1352c799c7c main baseline.
The already selected full-editor harness is
needed for the owner's measured demonstration. Its measurement protocol and
fixtures remain frozen; only bounded R10 checks and paired comparison delivery
may be added. No test-only reimplementation of production lifecycle qualifies.
Controller owns current.yaml and this card.

The actual solver-count test may use one documented test-only per-line
`@nx/enforce-module-boundaries` exception for the source-domain spy import in
`simulation-worker.spec.ts`. A public-facade spy was verified not to observe the
engine-to-domain call; the source-module spy must retain a positive-control call
proving that coverage before the Worker assertion. This exception adds no
production import, new public API, dependency, global lint change or relaxed
result assertion.

## Bounded follow-up for an observed R4 risk

Candidate 8cb82d223f8077d7ecdec22e0e8cf3f4e825c294 produced two different R4
assertion failures in run 43356810979, shard s2: the millis paint-duty bound and
joint D2-D4 pre-H0 visibility. Independent raw review found correct physical
edges and loaded, dark LED assets; the joint observation involved residual
horizontal scrolling after code fill/close. Comparison with earlier runs did
not establish that these exact failures are independent of R10. They must not be
labelled a proven baseline defect or a passing browser qualification.

The controller therefore authorizes one narrow same-runner diagnostic in the
existing R4 workflow and its genuine `browser` job. The helper above is CI
orchestration, not product runtime. An opt-in `r10-paired-regression` dispatch
runs the two original named tests
from `e2e/electronics-ready-cadence.spec.ts` once on each exact before/after SHA,
using the existing R4 image-only Docker/PostgreSQL contract. Both phases must be
retained after a test assertion failure; setup/infrastructure failure is reported
separately. Assertions, tolerances, test source, build inputs and numeric stopped
measurement protocol remain unchanged. Record actual test counts, raw traces,
source/image/environment receipts and failures; a diagnostic does not replace
the strict R4 gate. No retry-until-green, local browser stack, production action
or new permanent installation is authorized. The ordinary strict qualification
and all previously registered profiles retain their required gates, defaults,
permissions and assertions.

The recovery workflow is not an authorized Docker proof context and remains
unchanged by this follow-up. Preserve `require_ci_amd64`,
`require_electronics_job`, their workflow/job allowlist and the original image,
revision and PostgreSQL proof. Do not replace those guards with a new guard,
spoof GitHub context or call unguarded helpers around the original CLI. The only
permitted change in `test_ci_image_transport.py` is an exact semantic-wiring
overlay and adversarial offline checks for the new opt-in scheduling. Existing
mandatory execution, unknown profiles, security drift and changed immutable
receipts must continue to fail validation.

This supporting addition closes a concrete regression question within the same
selected R10. It does not select R11 or another product repair. Fresh preflight
for the workflow/helper/card paths passed with no overlap or execution blocker;
accepted main b2e0e93a4ae31cce1b9cf286fe14eb62efdd9627 preserved the selected
R10 and added only the separate Robotics task. Independent review is required
before the controller dispatches the diagnostic control revision.

The same R4 run also exposed one directly related test-fixture defect in shard
s3, job 131661845482: the technical-fault test injected its one transport failure
into the first preflight of any Worker. The new stopped Worker legitimately
consumes that injection before Start. The controller authorizes a narrow change
to that test's injection targeting: arm and verify one failure of the running
Start preflight, retain the actual failed Worker for the stale-response check,
and preserve every technical-error, unsaved-document, restart and stale-response
assertion. Do not change product error handling or make the test pass without an
observed running fault. The full applicable browser gate must verify the repaired
test on the final candidate. This is a category-B fixture repair within R10, not
a waiver of a product failure or an extension into model-time work.

The engine subsystem card must add the existing public facade
`contexts/electronics/simulation.ts` to `electronics.engine.public-api.sources`,
as well as the new stopped-controller source/test routes. These are exact source
ownership additions within existing component IDs; COMPONENT_MAP needs no expansion.

## Required behaviour

- Remove heavy synchronous preflight from render/useMemo. No synchronous fallback
  if Worker fails or is unavailable.
- Determine whether LED resource preparation is needed before resource work.
  It must consume the same accepted result as diagnostics and never launch its
  own solver. Diagnostics may still require a result for S3 without separate LED.
- Key includes electrical input, canonical sources of every Arduino, installed
  model-set version, engine/protocol identity and a project-session token.
  Preserve simulationInputDigest semantics: source is intentionally excluded
  there because the existing running update contract depends on that rule.
- Match the established Arduino identification predicate, including variant ID.
  A selected-board-only source key is incorrect.
- Cache accepted results within a bounded lifecycle; coalesce duplicate requests
  and bound in-flight/pending work. Keep key generation much cheaper than solving.
- Reject stale generation/request/session responses, including A → B → A and
  Start/Stop. A previously accepted cache entry is different from an unfinished
  response belonging to an abandoned request. Clean up on project switch/unmount.
- Stopped diagnostics while pending must not fall back to old persisted
  diagnostics checked only with electrical digest. Preserve meaningful invalid,
  unsupported and nonconvergent results; cancellation is not a new-project error.
  A current Worker crash, timeout or protocol failure must end pending and be
  exposed as a technical error, separately from physical results. A stale failure
  must not replace the state of the current project/request.
- Keep stopped calculateLiveSimulation: its persisted-result projection does not
  run solver. Preserve running source-only updates and physical time unchanged.
- Worker preflight currently solves through analyseElectronicsSnapshot and then
  calculateSimulationPreflight. Remove that confirmed duplicate while retaining
  the complete SolveResult, including optional transient/controller fields.
  Metadata validation must not require a second heavy solve. Never replace the
  complete result with a facade projection missing optional fields.

## Focused evidence and acceptance

Start with the existing requested baseline tests, then new regression cases:

```bash
corepack pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-RECOVERY-R10-001
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run apps/web/src/electronics/testing/live-simulation.spec.ts apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts contexts/electronics/testing/simulation-input-digest.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run apps/web/src/electronics/testing/stopped-simulation-preflight.spec.ts apps/web/src/electronics/testing/simulation-worker.spec.ts apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts apps/web/src/electronics/testing/workbench-presentation.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true corepack pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true corepack pnpm gate:governance
```

Prove no new solve for pan/zoom, annotation, wire colour/vertices and non-electrical
movement; refresh for nominal, connectivity, model/profile version, physical LED
colour and a program on the second Arduino. Check equal numerical results for
wire recolouring and a changed LED current for physical colour change. Exercise
Undo/Redo, project A → B → A, stale resolve/reject, rapid Start/Stop, unmount,
pending source edits, cache reuse and unavailable Worker.

Assert the actual analyseCircuit call count, not only request/wrapper counts.
Compare the complete direct and Worker result on unchanged S3/S4, ordinary,
invalid, unsupported and transient cases. Retain existing Run source-only tests.
Run applicable fresh type/lint/build, routing/governance and required repository
CI on the final source. `gate:repository` runs through the existing required
General CI with PostgreSQL; preserve its remote checks. Use the existing R4
browser CI for the mapped Worker regression and the R00 paired workflow for
the stopped-editor demonstration. Report commands, actual results and any Nx cache use;
`NX_SKIP_NX_CACHE=true` is literal for all new owner evidence.

The required integration command is `NX_SKIP_NX_CACHE=true corepack pnpm gate:repository`.
Do not duplicate its whole execution locally when the existing CI supplies it;
a local Docker/database or remote-check skip is not a full repository PASS.

The unchanged product already has a separate failing running/optical qualification:
R4 run 43331205321, shard s2 / job 131578051695 at R00 harness commit 8ee433f41503fc47ea64bfaa61f5e63ded9c14d5
reports five failures, including Arduino Reset wall/model timing and joint-LED PNG
phase classification. The test and relevant product/domain Git objects are
identical to frozen cb15c700; this predates any R10 product write. Preserve that
baseline and classify actual candidate results; never call the full browser gate
PASS or relax its tolerances because stopped-editor measurements pass. Clock,
optical and classroom acceptance remain separate from this bounded repair.

Additional unchanged-baseline R4 observation: shard s1 / job131578051675 reports 1 failure and122 passes, e2e/electronics-interactions.spec.ts:971 long5000 acknowledged realtime, report.errors=[phase-duration-2] at1144. Test blob 6f35392b37478065d7a93378a02f594e0337c0ad is identical at cb15 and8ee. No R10 edits existed; preserve this separate running-time baseline, never claim full R4 PASS.

## Same-scene demonstration

Use the accepted R00 workflow/full SchematicEditor with real Worker/assets and
fixture API. This is an instrumented candidate in authorized isolated GitHub CI,
not asa-lab.ru deployment. Repeat frozen product baseline cb15c700253f26bf276ad69d5e45ca27c2306787
and final candidate sequentially on the same runner, using the identical scene
hashes, gesture protocol, panel geometry, viewport, scale and warmup.

Preserve every raw sample from three fixed 30-second passes of each of four
actions on S3/S4 with code closed/open. Report actual preflight/solver counts,
p50/p95/max applied-document and current-diagnostic latency, long-task count,
total/max duration and deadline overruns. Clearly label release latency for drag
and the real nominal gesture chosen in R00. Do not call DOM commit the exact
physical paint time. Record the same short visual replay and Rendering/Paint
trace separately from numeric runs. Save source/build/Worker/CSS/probe hashes,
environment receipts, raw data and artifact links in GitHub evidence.

An independent reviewer verifies the exact final source and measured evidence;
the controller then accepts the bounded repair. A commit alone or merely green
tests does not demonstrate improved editor responsiveness. If all permitted
full-editor environments are blocked, preserve a verified published candidate,
state demonstration BLOCKED with the concrete required action, and do not declare
the overall assignment complete.

## Boundary and stop

No R11, catalogue audit, potentiometer/PWM/Serial repair, solver equations,
model-time change, component artwork, user-data mutation, new permanent install,
production deployment or bulk old-branch cleanup. Existing accepted repairs and
other work remain intact. This is one production-changing slice after checkpoint
007. Author reports one final candidate and STOP; controller arranges independent
review/integration and the requested six-section owner report, then stops the programme.

## Controller final-convergence boundary

Immutable A `8cb82d223f8077d7ecdec22e0e8cf3f4e825c294` received independent
source and paired full-editor evidence PASS in run43356831692. Exact measurements,
including slower asynchronous diagnostic arrival and retained outliers, are in
`evidence/recovery-r10-20261113.md` and its raw-artifact index. Overall acceptance
remains pending the classified R4 checks and the final candidate.

Accepted main `c76b51e38af94a308b6fe9080d776d6ee6ada4b4` introduces four shared
compiled UI changes from foreign PR1098. The controller's one final R10 convergence
preserves them and the foreign toolbar assertions; the hook and fault-test hunks
merge without conflict. Re-run the addressed/M1 checks and existing CI on the
immutable combined source. Repeat the same paired protocol with c76 before that
source, because the A recording cannot stand in for changed compiled UI. No
new task, runtime redesign, tolerance change or production action is selected.
After the required evidence and independent final review, publish/integrate the
bounded result and STOP. R11 remains unselected.

## Exact generated browser-evidence fingerprint follow-up

On converged B `dfea2026d6dd2a1d5b2d0d2db43af97f4ddd5cf2`, R4 core
job131689214251 stopped before tests because the generated coverage evidence
retained the browser-test fingerprint from accepted main. The already reviewed
running-fault fixture changes that test source. The controller accepts the
author's read-only generator output and authorizes exactly one generated value:
`generatedFrom.browserEvidenceSha256`, from
`0ffeaa5ed1f22fabea3dd5c2fd23ac3425d7c455f398827e44ba7da08d6cc657` to
`be3c0fbdde904d7ba4b16061e1ee2fa3ca0ec20375cdc86fdd6c06ab3f32acdd`.
All 44 component rows, other fingerprints, summary and zero fatal contradictions
remain unchanged. This is a category-B evidence dependency, with no catalogue
review, model or runtime change. Fresh two-path preflight had zero overlaps and
blockers; the owner checkout path check was empty. Repeat the applicable gates
on the corrected exact source and independently verify B's compiled input
identity. The running c76-to-B measurement remains valid for its immutable source
and is not restarted for a generated test-evidence fingerprint.
