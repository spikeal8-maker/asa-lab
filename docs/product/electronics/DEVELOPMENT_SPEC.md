# ASA Lab Electronics — Development Specification

This document defines **how Electronics is developed**, not what task is active.
The normative product behaviour remains in `README.md`; active execution remains only in `docs/execution/current.yaml`.

## 1. System layers

```text
Owner assets / component catalog
        |
CircuitDocument + versioned model identity
        |
Topology / netlist
        |
DeviceModel registry + solver/transient runtime
        |
Arduino runtime + canonical clock/peripheral runtime
        |
Stable ElectronicsEngine facade
        |
Dedicated simulation Worker
        |
ASA Lab host adapter / React workbench
        |
Persistence/API verification and delivery
```

Each layer owns one kind of truth. UI does not own physics. Persistence does not own computed results. Worker does not own a second engine. Assets do not own model equations.

## 2. Sources of truth

- `README.md` — normative Electronics product contract;
- `contracts/**` — machine-readable validation contracts;
- `COMPONENT_MAP.yaml` + `components/*.yaml` — maintenance routing/ownership only;
- `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` — dependency order/programme;
- task cards — one bounded executable slice;
- `docs/execution/current.yaml` — only active execution state;
- delivery evidence / Git history — historical evidence;
- `/api/version` + health endpoints — deployed revision/schema health.

No document may duplicate another layer's active state.

## 3. Development selection

Every owner request is routed before source reading.

### Selection decision

1. Identify visible/behavioural outcome in one sentence.
2. Resolve stable component ID(s) through `COMPONENT_MAP.yaml`.
3. Read one subsystem card and its prerequisites.
4. Check roadmap dependency gate.
5. Choose task kind: maintenance, implementation, design-decision, peripheral, deployment or governance.
6. Write expected paths/tests/acceptance/forbidden behaviour.
7. Only then inspect mapped source.

If the request cannot be represented by one bounded task, split it before implementation.

## 4. Editing rules

### Engine/solver edits

- no UI dependency in pure engine;
- no hidden component special-case when DeviceModel/profile can express behaviour;
- every semantic equation/tolerance change needs reference/golden evidence;
- no success with non-finite values or unsupported partial truth;
- deterministic ordering/digests remain explicit.

### Worker/controller edits

- same engine implementation as direct path;
- stale generation/session/document results rejected;
- heavy work bounded/coalesced;
- no silent synchronous heavy fallback;
- errors are typed/visible/fail-closed.

### Arduino/clock edits

- one canonical physical time;
- browser wall clock/UI timers cannot define circuit/peripheral truth;
- deterministic reset/state serialization;
- unsupported syntax/API must not partially execute;
- timing-sensitive peripheral work is blocked until required primitives exist.

### UI edits

- UI renders engine/model state and commands user intent;
- UI cannot synthesize current/voltage/temperature/damage;
- runtime controls should not create persisted project revisions unless product contract explicitly says so;
- large independent controls/concerns receive stable symbols/modules rather than growing one monolith.

### Asset edits

Protected owner SVG/audit assets are immutable unless an explicit owner-asset task authorises the exact replacement. No tracing/vectorisation/generated runtime artwork.

### Persistence edits

Unexpected schema/RLS/persistence changes escalate to a separate high/critical task. Product maintenance must not smuggle a persistence redesign into an unrelated fix.

## 5. Implementation workflow

```text
route request
→ declare task scope
→ verify prerequisites
→ read minimal mapped context
→ implement smallest coherent slice
→ focused tests
→ broader risk-required gates
→ bounded self-review
→ independent review when HIGH/CRITICAL
→ integrate exact reviewed content
→ STOP
```

The agent must not continue into a nearby issue simply because tools/context are already loaded.

## 6. Task splitting rules

Split before coding when:

- more than two primary component IDs are required;
- more than one architecture decision is unresolved;
- runtime semantics and UI redesign are mixed;
- solver/model semantics and new peripheral implementation are mixed;
- persistence/deployment appears inside an implementation slice;
- default file/context budget is exceeded without a direct dependency reason;
- acceptance would require multiple unrelated user journeys.

A split is a success condition, not a failure to finish.

## 7. Definition of acceptance

A slice is accepted only when:

- requested outcome is implemented;
- mapped invariants hold;
- focused tests prove the changed boundary;
- required golden/browser/repository gates pass for the exact content;
- routing docs match actual source/test ownership;
- self-review is PASS/PASS_WITH_RISK;
- required independent review is complete;
- no next milestone was started.

“Build passes” alone is not acceptance.

## 8. Code review contract

Reviewers receive minimal bounded context:

```text
one task card
final diff
mapped component entries
exact contract sections
exact test/evidence output
```

They verify scope, semantics, evidence and dependency compliance. They do not silently edit code while claiming independent review.

## 9. Integration contract

Before integrating:

- base/main movement and path overlaps are checked;
- exact reviewed content is preserved;
- if base changes touch dependencies, relevant gates rerun;
- plan/task status is not rewritten to match an accidental implementation;
- unresolved review defects block integration.

## 10. Deployment contract

Deployment is selected separately through `tasks/DEPLOYMENT_TASK_TEMPLATE.md`.

Required sequence:

```text
choose exact GitHub SHA
→ audit code/compose/env/schema delta
→ build candidate separately
→ test candidate stack where practical
→ prepare backup/rollback
→ switch services without destructive DB reset
→ verify health/version/schema/external user path
→ keep rollback until acceptance window closes
```

If `main` advances while the deployment gate runs, deploy the already-gated SHA; do not silently widen the release.

## 11. Documentation maintenance

`COMPONENT_MAP.yaml` stays compact. Subsystem cards hold implementation state/risk/ownership/source/test/dependencies. The normative README holds product behaviour. The roadmap holds dependency order. Task cards hold one executable slice.

If two documents disagree about the same responsibility, STOP and repair the canonical source instead of making the coding agent choose.

## 12. Token-efficiency rules

- never preload the 267 KB Electronics normative README;
- use exact headings/line ranges from mapped cards;
- do not read historical PRs/issues unless evidence is specifically needed;
- do not load future roadmap sections for ordinary maintenance;
- do not inspect all component assets/catalog rows for one component;
- after a slice, start the next task in a fresh bounded context.

## 13. Failure semantics for agents

Correct outputs include:

```text
BLOCKED_BY <prerequisite>
ROUTING_STALE
SCOPE_SPLIT_REQUIRED
DESIGN_DECISION_REQUIRED
INDEPENDENT_REVIEW_REQUIRED
DEPLOYMENT_TASK_REQUIRED
```

These are preferable to improvising around missing architecture.

## 14. Governance completion target

Electronics governance is considered healthy when a new agent can answer, without broad repository search:

- what component/subsystem owns the request;
- what it is allowed to edit;
- what prerequisite blocks it;
- what exact tests prove acceptance;
- when it must stop;
- what next task is merely available rather than authorised.