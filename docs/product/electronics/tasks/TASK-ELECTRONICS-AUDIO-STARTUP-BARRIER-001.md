---
task_id: TASK-ELECTRONICS-AUDIO-STARTUP-BARRIER-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Accepted zero-horizon startup and observation cadence contracts remain unchanged.
acceptance_boundary: slice
review: independent
---

# E12: optional audio must not hold electrical startup

Bounded [552](https://github.com/spikeal8-maker/asa-lab/issues/552), programme #452, owner E12 LED delay after Run. This bounded slice removes only the demonstrated conditional pre-Worker audio barrier. It does not accept every E12 school incident or repeat #513/#516.

## One pupil result

A genuine Run gesture starts the canonical electrical Worker even if native optional AudioContext.resume stays pending or rejects. Complete ready results remain the only electrical publication authority. Normal native tone, Stop/noTone and project persistence still work.

## Component and risk

Primary component: electronics.ui.workbench, components/ui-assets-persistence.yaml. High semantic startup-boundary risk; independent exact-SHA review is required. Layout impact: none (no DOM/CSS/text/layout change).

## Entry and exact sources

Canonical selected lane/task must already exist on main. Run pnpm agent:preflight --scope electronics-startup --check and pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-AUDIO-STARTUP-BARRIER-001 before writes. Preserve all held candidates, foreign dirty work and school installation.

Read START_HERE.md, COMPONENT_MAP.yaml, components/ui-assets-persistence.yaml; owner priority specification E12 and K4 startup timing; README MATH-8 audio; AGENT_GUIDE sections 2,5,6,11,12,13. Exact production sources: use-piezo-audio.ts; read-only caller use-electronics-workbench.ts:toggleSimulationWithAudio, use-workbench-project-state.ts:toggleSimulation, live-simulation-worker-controller.ts startup/ready boundary.

## Expected write paths / budget

- apps/web/src/electronics/use-piezo-audio.ts (only production file)
- apps/web/src/electronics/testing/piezo-audio.spec.ts (new focused mounted regression)
- e2e/electronics-startup-audio.spec.ts (new exact built pupil journey)
- docs/product/electronics/components/ui-assets-persistence.yaml (add exact hook/test mappings)
- package.json (append the new browser file to both existing Electronics scripts only)
- .github/workflows/electronics-r4-m1-focused.yml (append new browser path filter only if required)

No caller/controller/solver/Arduino/physics/recovery/product-schema change, dependency/lockfile update, cleanup or protected artwork. Exceeding this exact budget requires controller coordination, not silent expansion.

## Minimal mechanism

Keep unlockPiezoAudio's public Promise<void> API and native AudioContext creation/resume inside the real button gesture. Request native resume synchronously but handle its asynchronous rejection locally without making its settling a prerequisite for the electrical start. Preserve synchronous constructor/resume failure handling and native tone graph/state behavior. Pending optional audio must not introduce a new startup timeout or fabricated electrical result. Late audio completion cannot resurrect a stopped, unmounted or replaced project's voices.

## Required evidence

1. One focused mounted test of actual useElectronicsWorkbench, real usePiezoAudio, controller/evaluator and whole schema4 document. jsdom substitutes only transport and native audio boundary, not audio hook/physics. Pending native resume: actual preflight/ready and running precede release; rejection and synchronous failure do not block; late completion after Stop/unmount does not resurrect sound. Keep whole document/revision unchanged by runtime actions. This is controlled conditional regression, not proof of a natural school cause.
2. Identical before/after production-browser test and fixtures on fixed dependencies. First natural native gesture characterization records context creation/state/resume, Worker request/response, requested/committed horizons, ready/yielded, computeMs, DOM LED publication and rAF/native PNG. No fake Worker/result or audio autoplay flag. Native already-running/no resume must be reported honestly.
3. Simple DC LED, Arduino immediate HIGH and separate intentional delay control. Prove complete ready finite/quality data before LED; intentional delay remains a model-time event, not a startup defect. Keep assets/loading separate from compute/audio. No original bitwise-program acceptance claim.
4. Native tone(1000) and Stop/noTone: preserve native oscillator/gain/destination; parallel passive native analyser with original PCM windows, context progression/sample rate and independently measured frequency/energy. Headless digital PCM is not school speaker audibility. No synthetic waveform or audio replacement.
5. Native Run/Stop changes do not save. One deliberate pupil parameter edit then one explicit full-document Save/CAS revision+1 and cookies-only fresh reopen preserve the complete document, all wires, Arduino source/state and authorization. Finally retain raw observations, whole documents, original traces/PNGs and failure evidence.
6. Exact final SHA focused pnpm gate:electronics-m1, full canonical pnpm gate:electronics-m1:browser and repository gate in CI, NX_SKIP_NX_CACHE=true and fresh counts; independent reviewer checks actual source/GitHub/original evidence. The author does not declare final acceptance from local tests or its own report.

## Limitations and STOP

School cause/frequency and original incident fixture remain unproved; T3 actual school device, class evidence and physical audio are pending. Do not deploy, restart containers, change DB/network/backups, increase timeout, lower physical accuracy, publish yielded/incomplete as ready, repair #548 or alter #525/#546/#537 candidates. One unpublished bounded candidate plus focused checks/self-review/report to controller, then STOP. No push/convergence/CI dispatch without controller coordination. NEXT_ALLOWED_TASK: STOP.
