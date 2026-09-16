# ASA Lab Electronics — Development Specification v2.1

Target architecture and acceptance contract; this document does not claim implementation
or freeze new API names. Normative product behaviour remains in `README.md` / `contracts/`.
[AGENT_GUIDE.md](AGENT_GUIDE.md) owns agent procedure, the [roadmap](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md)
owns delivery order, and only repository `docs/execution/current.yaml` owns active execution.

## 1. System layers

| Subsystem | Responsibility | Input → output | Must not own |
| --- | --- | --- | --- |
| Catalog / owner assets | Stable catalog/asset identity, provenance, terminals and presentation metadata | Approved owner identity + metadata → available/disabled catalog entry | Electrical results or replacement artwork |
| CircuitDocument | Versioned, serializable user intent and model identity | User edits / serialized document → validated document | Computed current, voltage, brightness or temperature as persisted truth |
| Topology / netlist | Deterministic electrical connectivity, including breadboard groups | Document connections/terminals → stable nets | Wire geometry as connectivity or model equations |
| DeviceModel / profiles | Model identity, supported parameters, constitutive behaviour | Terminal bindings + profile/state → model contributions/diagnostics | UI, global solver orchestration or ad hoc catalog-type dispatch |
| Solver | Bounded numerical solution and independent quality diagnostics | Netlist + model contributions → finite result / explicit physics status | React, persistence, scheduling or invented partial success |
| Transient state | Physical state evolution using the accepted clock contract | Initial state + accepted steps/events → committed physical state | Wall-clock timers or document edits for derived state |
| Arduino runtime | Declared educational language/device semantics and bounded execution | Program + versioned state + inputs/time → GPIO/events/state/diagnostics | UI cadence, autosave or a separate physics implementation |
| Canonical clock | Ordering, horizons, event barriers and reset/pause/resume semantics | Initial time/state + ordered event trace → committed horizons/frames | Host render frequency as physical time |
| Engine boundary | Intentional pure document/compile/solve/capability surface | Explicit inputs/versions → normalized results/descriptors | ASA host imports or hidden mutable global state |
| Simulation Worker | Execute the same engine with bounded work and isolated requests | Versioned session/generation requests → matched results or transport failures | Second solver, stale commits or silent heavy synchronous fallback |
| Host / React UI | Capture user intent and display committed results/diagnostics | Host actions + current committed result → document edits / presentation | Electrical calculations or converting errors to fabricated results |
| Persistence / server verification | Durable intent, revision-safe sync and same-core verification | Valid document + expected revision → durable revision/conflict; document → verification | Derived physics as canonical storage or blocking local solve on autosave |

The [roadmap](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#4-e-opt-1--portable-engine-boundary)
separates structural/non-temporal portability from later timed APIs. E-OPT-1A is inventory only.

### 1.1 Engine portability boundary

The same public engine surface must support browser main-thread, Web Worker, Node/test
and future standalone consumers. Its dependency closure must not require React, Vite-specific
globals, DOM, ASA auth, API client, database or portal store. Host adapters supply persistence,
transport and presentation outside that closure; all simulation inputs/state are explicit.
Dependency tests and direct consumer fixtures prove this property, not successful bundling alone.
Timed method names and semantics remain provisional until the roadmap's canonical-clock decision.

### 1.2 Independent version domains and capabilities

| Domain | Compatibility decision |
| --- | --- |
| CircuitDocument schema/version | Parse, validate and preserve user intent on round-trip; reject incompatible input before destructive rewrite |
| Engine revision | Identify the executable semantics used for result/replay/parity evidence |
| Worker protocol version | Negotiate/validate transport envelopes before executing or accepting results |
| Arduino runtime/state version | Identify execution semantics and serializable state compatibility; explicit migration/rejection for incompatible restore |
| Model/profile identity and version | Resolve supported component physics/parameters and reference fixtures |
| Capability descriptor schema | Interpret machine-readable support information independently of the versions it reports |

One `version` field must not stand for several independent contracts. This requirement does
not introduce fields or migrations now. Compatibility changes require the matching product contract.
Unknown document fields require a proven preserving parse/edit/serialize path or rejection,
as defined by [CircuitDocument](README.md#5-circuitdocument).

Engine/runtime capability discovery must expose supported document versions, component/model
IDs and profiles, Arduino commands/runtime features, timing primitives and engine/runtime versions.
The Worker adapter additionally exposes its protocol compatibility. Consumers check descriptors
before activation; absence is unsupported capability, never permission for silent fallback.
Descriptor support claims must correspond to executable model/runtime and reference coverage.

### 1.3 Determinism and execution failures

Equal canonical document + engine revision + model/profile versions + runtime/state version
+ initial state + ordered input-event trace + requested logical horizon must yield byte-equivalent
normalized committed simulation results. Normalization excludes transport IDs, wall-clock timings
and presentation sampling; it must not erase electrical values or failure diagnostics to obtain parity.
Terminal ordering is character-wise, independent of locale. UI render rate and host stalls may
delay delivery but must not change simulation truth. Direct, Worker and server consumers use the
same engine/models; timed replay follows the accepted canonical clock, never independent timers.

| Class | Required observable handling |
| --- | --- |
| `unsupported` | Missing model/topology capability; no fabricated electrical result for the remaining circuit |
| `invalid` | Invalid document/topology/input; explicit diagnostics, no successful physics result |
| `nonconvergent` | Numerical acceptance failed; expose diagnostics without promoting an unconverged iterate to success |
| Runtime fault | Execution/budget/state fault; report separately, withhold an uncommitted runtime step |
| Worker transport failure | Protocol mismatch, crash or timeout; explicit host failure, no invented physics or silent main-thread heavy solve |
| Stale result | Session/generation/document/horizon mismatch; discard, never commit into current state |
| Cancelled generation | Discontinued work cannot commit; bounded queue/coalescing prevents obsolete work accumulating |

These classes describe architecture, not a new shared status enum. Preserve the normative
[`SolveResult.status`](README.md#11-результат-симуляции): `solved|invalid|unsupported|nonconvergent`.
Runtime/transport/cancellation states remain distinct from physics status and from device health,
damage and presentation state. A failed device with a supported post-failure model can coexist
with a solved circuit. The UI may label a retained last committed frame as stale; it cannot
present it as a new successful result for the failing request.

### 1.4 Component and peripheral extension contract

A supported component requires catalog identity + terminals + DeviceModel/profile identity
+ optional transient/runtime adapter + UI/help + focused tests and analytical/reference fixture.
Adding only SVG, only an `if (type === ...)` solver branch, UI without model identity or runtime
behaviour without capability declaration is insufficient. Model registry/profile extension is
the default; any unavoidable solver change needs its own physical justification and evidence.
Missing confirmed owner SVG keeps the catalog entry disabled/missing under root asset policy;
missing electrical model keeps simulation unsupported. Existing owner artwork is never substituted.

Arduino/peripheral support additionally declares electrical identity, runtime API, accepted
clock/timing dependencies, state serialization where required, machine capability, reference fixture,
UI/help and owner asset identity where applicable. Each peripheral uses canonical events/barriers;
it cannot add an independent timer path. Timing-sensitive support remains blocked until its
roadmap prerequisites are accepted. Reset and replay fixtures must cover runtime/physical state
without converting runtime controls into collaborative document intent.

## 2. Sources of truth

See the single ownership table in [§11](#11-documentation-maintenance).
GitHub repository content is sufficient to understand the task; local recovery output is
a fresh workspace observation, not a second execution database. Git history/delivery
evidence records historical proof. Deployment checks observe the exact running revision
and readiness separately; Git push/merge cannot prove them.

## 3. Development selection

Selection is defined by [START_HERE §§1–3](START_HERE.md#1-confirm-the-selected-task)
and [AGENT_GUIDE §§2–4](AGENT_GUIDE.md#2-one-concern-per-slice), using canonical `current.yaml`.
A feature branch inherits the selection accepted on `main`; it cannot select a task itself.
Future cards describe scope, not authorization. Selection/routing failures use §13.

## 4. Editing rules

Edits preserve the layer responsibilities in §1 and the selected product contracts.
Apply [AGENT_GUIDE §§6–10](AGENT_GUIDE.md#6-electronics-invariants) for invariants,
clock/Arduino, solver/model, Worker and ownership changes. Root asset/data restrictions apply.
No implementation slice changes roadmap dependencies to justify an expanded diff.

## 5. Implementation workflow

Use root [AGENT_CHANGE_WORKFLOW](../../delivery/AGENT_CHANGE_WORKFLOW.md) for recovery,
bounded edits, exact staging, commit/push and exact-SHA CI.
Electronics evidence/review requirements come from [AGENT_GUIDE §§11–13](AGENT_GUIDE.md#11-tests-and-evidence).
Integration (§9) and deployment (§10) are separate contracts.

## 6. Task splitting rules

Apply [AGENT_GUIDE §2](AGENT_GUIDE.md#2-one-concern-per-slice) budgets.
Split unresolved independent architecture decisions or unrelated acceptance outcomes.
Record any justified budget extension in the selected card before editing.

## 7. Definition of acceptance

A reviewable slice has the requested outcome, preserved mapped invariants, exact-content
evidence from all declared gates, current routing and completed required self/independent review.
Report residual risks and the STOP boundary. Build alone is not acceptance; green CI is
not owner acceptance, and a red repository gate prevents a release-candidate claim.

### 7.1 Architecture acceptance evidence

| Property | Required proof at the relevant roadmap acceptance boundary |
| --- | --- |
| Pure engine and portable adapters | Import-boundary checks plus browser/Node consumer fixtures without forbidden host dependencies (§1.1) |
| Document and persistence separation | Intent round-trip/version checks, revision/conflict/autosave fixtures; local solve completes independently of save; runtime controls do not create shared intent |
| Physical/model correctness | Deterministic netlist including breadboards, finite solved values, KCL/ideal-source/power diagnostics, analytical/reference fixtures and fail-closed negative corpus |
| Clock/runtime determinism | Reset, pause/resume and event-trace replay across varied UI cadence/stalls at identical logical horizons (§1.3) |
| Worker execution isolation | Direct/Worker parity, version/session/generation rejection, cancellation/crash/timeout fixtures, bounded heavy work (one in-flight by default), and a browser journey proving a real Worker |
| Capability/extension integrity | Descriptor-to-model/runtime/reference coverage; unsupported capability cannot be activated by UI fallback (§1.4) |
| UI ownership | UI renders committed engine state and separate fault channels; presentation must not derive electrical truth |

These proofs are stage-dependent targets, not gates for every documentation/maintenance slice.
Existing evidence cannot establish new semantics merely because an unchanged build passes.

### 7.2 Performance acceptance

Budget categories are main-thread blocking, Worker latency, cold editor load, bundle size,
retained memory, simulation throughput and event-queue bounds. Thresholds and measurement
conditions belong to versioned benchmark contracts/tests, not arbitrary numbers in this document.
Regression acceptance compares the changed candidate with that baseline under the same corpus,
environment and cold/warm conditions; record versions and actual uncached work. Improving one
category does not justify unmeasured regression or changed simulation semantics in another.

### 7.3 Executable portability proof

At E-OPT-8 acceptance a standalone consumer must boot, load/validate a document, solve through
the public engine, run a real Worker, execute one declared Arduino example, use an in-memory
persistence adapter and expose public capability/version information. It requires no ASA portal
internals/auth/API/database, and direct/Worker results retain parity. A package import alone
does not satisfy portability. The runnable example and reproducible commands generate `PORTING.md`
covering public API, Worker integration, document compatibility, model extension, host adapter and
supported runtime baseline; the roadmap owns prerequisites and scheduling of this proof.

## 8. Code review contract

Use [AGENT_GUIDE §13](AGENT_GUIDE.md#13-independent-review) for the semantic review decision
and bounded reviewer input. Reviewers assess scope, semantics, evidence and dependencies;
they do not silently edit the code while claiming independent review.

## 9. Integration contract

Check base/main movement and overlapping paths; preserve exact reviewed content.
Rerun relevant gates if convergence changes dependencies. Unresolved required review defects
block integration. Merge needs owner authorization and does not authorize deployment.

## 10. Deployment contract

Select deployment separately through [DEPLOYMENT_TASK_TEMPLATE](tasks/DEPLOYMENT_TASK_TEMPLATE.md).
Its accepted input is an immutable, already gated GitHub SHA; its output is verified
health/version/schema/user-flow evidence or rollback. Follow
[AGENT_GUIDE §14](AGENT_GUIDE.md#14-deployment-discipline) and the root delivery workflow.
A moving `main` cannot silently replace the selected release.

## 11. Documentation maintenance

| Canonical owner | Responsibility |
| --- | --- |
| `docs/execution/current.yaml` | Selected active task, status, checkpoint and execution records |
| `README.md` / `contracts/` | Normative product behaviour / machine-readable product contracts |
| `START_HERE.md` | Compact entry route, task kind and next document |
| `AGENT_GUIDE.md` | Detailed Electronics agent behaviour, budgets, semantic risk, review and STOP |
| `DEVELOPMENT_SPEC.md` | Architecture boundaries, compatibility, determinism/failures, extension and performance/portability acceptance |
| `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` | Roadmap stages, dependencies, prerequisites and milestone boundaries |
| `COMPONENT_MAP.yaml` / subsystem cards | Stable IDs, keywords, ownership/risk, exact contracts/source/symbol/test routes and dependencies |
| `tasks/` | One bounded slice per concrete card; templates define required fields |
| `contracts/ENGINEERING_HYGIENE_CONTRACT.md` | Mandatory hygiene cadence, lifecycle classes, deletion proof and large-source review rules |
| `evidence/hygiene-baseline.yaml` | Machine-readable reviewed large-source/legacy/documentation debt baseline; never live execution state |

Cards never store programme progress, live task/SHA/CI/deployment state or `implementation_state`.
Readiness is assessed from roadmap prerequisites and acceptance evidence, not inferred from
source filenames. When ownership changes, update the affected routes in the same slice and
run `pnpm validate:electronics-agent-docs`. Repair contradictions at their canonical owner.

### 11.1 Engineering hygiene and legacy retirement

Apply the [Engineering Hygiene and Legacy Retirement Contract](contracts/ENGINEERING_HYGIENE_CONTRACT.md). A checkpoint becomes due after every three accepted production-changing slices (`implementation`, `component/peripheral`, plus `maintenance`/`repair` that changed tracked production source) or before transition between major E-OPT stages, whichever occurs first; canonical replacement of a provisional path can force an earlier checkpoint.

A due checkpoint is fail-closed for another production-changing slice except a bounded repair required to restore governance/gates. The checkpoint classifies active legacy bridges, compatibility shims, generated/history/protected material, dead-orphan candidates and decomposition candidates.

Deletion requires evidence that runtime/import/export/persistence/contract dependencies are absent or migrated, protected ownership does not apply, replacement coverage exists when needed and required tests/gates pass after removal. File age, naming or a local absence of imports is never sufficient proof.

Production sources above the contract threshold are review triggers, not automatic split targets. Growth beyond the reviewed baseline threshold requires a new selected hygiene review; decomposition follows cohesive responsibility and must not manufacture arbitrary helper fragments.

The machine baseline is `evidence/hygiene-baseline.yaml`. It records debt/classification only and must not duplicate active task, SHA, CI or deployment state.

## 12. Token-efficiency rules

Default context is the [compact route](START_HERE.md#3-read-only-the-mapped-context).
Budgets and expansion reasons belong to [AGENT_GUIDE §§1–2](AGENT_GUIDE.md#1-progressive-disclosure).
The normative README, historical evidence and future stages are read only by exact need.

## 13. Failure semantics for agents

| Output | Meaning / next action |
| --- | --- |
| `BLOCKED_BY <prerequisite>` | Required selection/acceptance is absent; no implementation |
| `ROUTING_STALE` | Exact route/anchor/source/test is missing; repair routing within authorized scope |
| `SCOPE_SPLIT_REQUIRED` | Scope cannot meet one bounded acceptance; split before coding |
| `DESIGN_DECISION_REQUIRED` | Record unresolved semantics for a separately selected design task |
| `INDEPENDENT_REVIEW_REQUIRED` | Required semantic or milestone review remains incomplete |
| `DEPLOYMENT_TASK_REQUIRED` | Live switch requires separately selected deployment scope |

## 14. Governance completion target

A new agent can identify canonical selection, component owner, precise permitted scope,
prerequisites, contracts/symbols/tests, semantic review and STOP without reading the full
repository or using a particular Windows checkout. A next available task stays owner-selectable.
