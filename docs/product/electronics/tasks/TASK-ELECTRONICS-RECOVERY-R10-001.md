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
- `docs/product/electronics/components/engine-worker-clock.yaml`
- `docs/product/electronics/components/ui-assets-persistence.yaml`
- `apps/web/src/electronics/testing/stopped-preflight.browser.mjs`
- `.github/workflows/electronics-recovery-performance.yml`
- `docs/product/electronics/evidence/recovery-r10-20261113.md`
- `docs/product/electronics/evidence/recovery-r10-raw.json`

The explicit exception to two focused test files is necessary: cache/generation,
actual Worker solver count/parity, and actual React session/pending lifecycle are
three distinct failure boundaries. The already selected full-editor harness is
needed for the owner's measured demonstration. Its measurement protocol and
fixtures remain frozen; only bounded R10 checks and paired comparison delivery
may be added. No test-only reimplementation of production lifecycle qualifies.
Controller owns current.yaml and this card.

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
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run apps/web/src/electronics/testing/stopped-simulation-preflight.spec.ts apps/web/src/electronics/testing/simulation-worker.spec.ts apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts --maxWorkers=1
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
