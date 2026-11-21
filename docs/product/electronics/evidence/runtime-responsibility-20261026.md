# Accepted Arduino runtime responsibility review — 26 October 2026

Bounded documentation review for TASK-ELECTRONICS-RUNTIME-RESPONSIBILITY-001
(#778), ENGINEERING_HYGIENE_CONTRACT §§6/8 and repository policy L2. This is
frozen evidence, not execution state. Authoring baseline: `2266dbde0e704c923a444466e5f78458592f01de`;
accepted executable target: `5f57d0716e8bb2b923cc0ace69c78e7c014d4643`.
No production source, assets, dependencies, generated output or runtime state is
changed by this review. No deployment, SaveCAS, owner or release acceptance.

## Window, identities and growth

Git object bytes, not Windows newline-expanded filesystem sizes:

| Accepted boundary | Runtime bytes | Runtime Git blob | Increment |
| --- | ---: | --- | ---: |
| Before do #771: `2d84c7bd97346e2e00bc4f3ac547ea41f65066c5` | 113516 | `3218460dc22168c7338e6f68ee2a440d84f601e1` | baseline |
| do #771: `6fabd5ab2ee511499e48a64479d4d89b18124249` | 115791 | `87bbabee4eb9d05e3a206cb0ffdd57b3a3c747ab` | +2275 |
| increment/replay #773: `6048f07682e38163415ce3b2dc4cd81472ad8a18` | 126988 | `6c84e8d905d376dbb88dd056a9b2785129ef97cc` | +11197 |
| seeded random #775: `5f57d0716e8bb2b923cc0ace69c78e7c014d4643` | 127658 | `c25786f81d8580caffe6deab0445d339870f06ee` | +670 |

New private helper `contexts/electronics/domain/arduino-random.ts`: 3530 bytes,
blob `7e007a85b5ecdf60617469c632c7cc538eebad11`. It contains new licensed
PRNG code, not relocated legacy functions. Runtime window growth is 14142 bytes
(12.46%); 7124 bytes of the difference from historical reviewed 106392 precede
this window. Historical review growth is 21266 bytes (19.99%); its integer guard
127670 left only 12 bytes. This review therefore assesses responsibilities rather
than treating spare bytes as permission for another language feature.

The window contains three accepted runtime slices. Repository high-risk L2 is due
after two; Electronics contract checkpoint maximum remains three. The stricter
L2 cadence was overdue at this review. This bounded runtime review does not reset
other Electronics/E-OPT lanes or pretend to audit the whole programme. Historical
641 evidence and its pending integration/state are preserved. No prior review is
relabelled as acceptance of these new features.

## Responsibility and architecture assessment

`arduino-program-runtime.ts` still owns one source-to-resumable-program boundary:
comment/token/source-offset handling; typed lexical scopes and expressions;
control-flow preparation; source diagnostics and compilation cache; continuation
validation; ordered peripheral dispatch and event publication; owned/direct
execution and horizon/budget progression. These responsibilities are coupled,
but they are not a solver, scheduler, renderer or HTTP/persistence implementation.
It remains a **decomposition-candidate**, not a newly small/canonical-only file.

771 adds post-test loop compilation to the existing branch/jump instruction
representation. Body scope exits, nearest-loop break and continue-to-condition
remain part of compiler correctness. 773 adds typed increment evaluation and an
optional pending-expression journal: completed subtree values/effects survive
pulseIn/ultrasonic waits exactly once. The journal is validated against source
fingerprint, phase, program counter, token streams, parent frontier, typed finite
values and bounded entries; replay also checks the current compiled instruction.
This is the dominant growth, not duplicate loop execution. 775 adds optional
per-board PRNG state and reuses that journal for random calls across waits.

The helper owns only uint32 state validation, seed conversion/zero semantics and
the pinned AVR-libc recurrence/bounds. Its three exports have actual runtime
imports/call sites (state validation, expression draw, statement seed), no package
public export and no external dependency. Typed arithmetic remains in
`arduino-values.ts`; Serial, waveform and pulse contracts remain in their existing
modules. No second parser/runtime, V2 route, feature flag, debug UI or copied old
implementation was added. Inspection of the bounded diff and fresh existing lint/
type/build evidence found no justified dead-code deletion. This is not a global
unused-asset/dead-code proof; no deletion is authorized or performed.

Future extraction must separate a cohesive compiler/source-location boundary or
validated evaluation-journal boundary with explicit interfaces, rather than split
by size. It must preserve instruction identities, exact old return/state/events,
source invalidation, JSON resumes, evaluation order, branch scopes, finite typed
values and budget-independent results. Extracting replay without continuation
validation would break its safety boundary. No extraction is performed here.

Runtime state version7, `arduino-v1-` source fingerprint algorithm and both clock
profiles remain unchanged. `advanceArduinoRuntime` still explicitly selects
`legacy-ms-v1`; `arduino-model.ts` and `solver.ts` remain actual callers. This
active bridge has **not** met retirement conditions. Keep the exact existing
baseline retirement requirement for canonical-profile convergence and proof of
zero production/public/evidence dependencies. No clock quantum, solver physics,
Worker protocol, cadence or timeout change is hidden in this review.

## Scoped L2 inventory and delivery cost

Largest tracked Electronics production sources at target (bytes):

| Path | Bytes |
| --- | ---: |
| `contexts/electronics/domain/solver.ts` | 213561 |
| `apps/web/src/electronics/workbench.css` | 136438 |
| `apps/web/src/electronics/use-electronics-workbench.ts` | 135624 |
| `contexts/electronics/domain/arduino-program-runtime.ts` | 127658 |
| `apps/web/src/electronics/WorkbenchSidebars.tsx` | 113843 |
| `apps/web/src/electronics/ProductionComponentVisual.tsx` | 90084 |
| `contexts/electronics/domain/arduino-circuit-scheduler.ts` | 74165 |
| `apps/web/src/electronics/WorkbenchStage.tsx` | 65218 |

Inventory is not reclassification of other baseline entries. Largest tracked
Electronics assets include owner-audit breadboard-small.svg 2208229,
owner-audit manifest 2168073, component-database/catalog.json 1010509,
owner-catalog manifest 988637, owner-audit Uno SVG 901166, PSU SVG 800847,
Servo SVG 492352 and owner-supplied potentiometer SVG 466807 bytes. All remain
untouched; protected artwork and untracked/ignored owner ZIP/screenshots/backups
are not cleanup candidates. No asset was added or removed in the runtime window.

Committed generated `docs/product/electronics/generated/component-coverage.json`
is 31454 bytes, owned by `tools/generate-electronics-component-coverage.mjs`
(`--write`); component-information validation rejects stale output. Benchmark
fixture `contexts/electronics/testing/fixtures/benchmark-golden.v2.json` is owned
by `tools/update-electronics-benchmark-golden.mjs --accept`. Neither is changed.
Build dist and native test-results are generated evidence, not new tracked source;
there is no new runtime code generator or committed build output in this window.

No package manifest/lockfile, portal route/module registration or Worker client
entry changed across the window. Existing module isolation and Worker boundary
are retained: `simulation-worker-client.ts` constructs the module Worker from
`simulation.worker.ts`, which imports the evaluator; the PRNG helper is a private
static dependency inside runtime, not a new eager application entry. No new
heavy dependency, duplicate route or cross-domain import was introduced. Lazy
boundaries are unchanged by the diff; this is not a new network waterfall audit.

Accepted pre771 scoped build reported editor 221950/222000 and Arduino 1999915/
2000000 bytes; 771 reported 1999898, 773 reported 1999964, and 775 reported 1999967.
Window Arduino delta is +52 bytes (0.0026%); schematic delta 0. Final Arduino room
is 33 bytes and schematic 50. Shared/initial entry source was not changed;
773 integration recorded initial JS/CSS 548231/600000. No new initial-chunk receipt
is claimed for 775. Tiny remaining chunk headroom is a concrete constraint for the
next UI/runtime slice, not authorization to raise limits or import deferred
cleanup 25c / tooltip 3e. No build rerun is necessary for these documentation changes.

## Functional evidence reused and findings

Accepted source receipts in current.yaml and seeded-random-775-20261026.md:

- 771 fresh 2153 tests,71 uncached Nx tasks, independent 142 focused plus 32
  adversarial and 24 old byte-exact cases; original 450372-byte complete-state/
  event oracle and 546 old continuations; actual Worker 1440/390.
- 773 repaired accepted 6048: fresh 2268 tests,71 uncached tasks; NEW independent 90
  focused with 10 adversarial/forged-journal checks and actual Chromium Worker
 1440/390. Rejected 7ab wait-side-effect candidate is preserved as failed history,
  not reused as PASS. Final six executable files equal reviewed 6b6684cd.
- 775 accepted 5f57: fresh 2292 tests (1213 core+1079 web),71 uncached tasks,
  types/build and fixed caps PASS; independent 188 focused/5600 BigInt reference
  draws/112 seeds and 9 malformed-state cases. Actual browser Worker/controller
 1440/390 proves generated Blockly, inclusive bounds, detached no-draw,
  JSON/budget-one/direct parity, independent boards and lifecycle/source edits.
  Complete old nonrandom state/events/resume hash remains
  `67f230cb0174dc9b275f44b27b850cc113572b3dc69c7582329ed45688b9ebd5`.

These receipts are reused for unchanged executable blobs, not new full-gate,
installed, physical-time or SaveCAS acceptance. Source review confirms no solver
changes in the runtime window; existing focused suite remains the regression
boundary for physics, not a new broad classroom real-time qualification.

| Finding | Decision / residual |
| --- | --- |
| Runtime growth review nearly exhausted | Reviewed actual boundary; update only runtime reviewed_bytes to 127658 with this rationale. Retain decomposition-candidate. |
| Compiler/evaluator/continuation coupling | WARNING, retained debt; future responsibility extraction requires separately selected semantic-parity evidence. No cleanup now. |
| L2 high-risk cadence overdue; full cross-lane checkpoint not proved | WARNING recorded; this local window review does not reset unrelated counters or #641/E-OPT acceptance. Controller must apply stricter cadence on subsequent slices. |
| Legacy clock callers active | Retain bridge and unchanged retirement condition; no retirement claim. |
| Fixed bundle headroom 33/50 bytes | WARNING; every subsequent feature must pass existing caps. No cap waiver/deferred candidate integration. |
| New orphan route/dependency/generated output or proven dead code | None identified in bounded diff; no removal. Global absence not claimed. |

Verdict: **WARNING — bounded runtime responsibility/growth review is coherent,
with explicit retained debt; independent exact-SHA approval still required**.
No newly discovered product BLOCK is asserted. This verdict neither accepts the
whole programme nor resolves any unrelated blocker. The review changes only the
runtime baseline entry, this evidence and the selected card. Author freezes one commit for NEW independent review and stops.

## Documentation validation receipt

`pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-RUNTIME-RESPONSIBILITY-001`:
PASS,114/114 validator tests,0 failed/skipped; routing PASS,30 components,4 cards,
132 task cards, selected task matched. Duration79311ms.
`pnpm control-plane:check`: PASS, canonical selection present. `git diff --check`:
PASS. No fresh production/full2292, build or native test was represented as run.

Scoped preflight reported WAITING_HANDOFF only for two pre-existing foreign dirty
workflow paths in D13/teacher worktrees; zero dirty-in-scope/shared paths and
control-plane PASS. Controller explicitly confirmed these nonintersecting paths
do not block the three authorized docs. All foreign files remain untouched.
