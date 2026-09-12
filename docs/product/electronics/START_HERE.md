# ASA Lab Electronics — START HERE FOR AGENTS

This file is the mandatory first read for any Electronics/Arduino change.
It exists to keep agent context small and to prevent milestone skipping.

## 1. Default rule

Do **not** begin by reading the full `docs/product/electronics/README.md`.
It is the normative product specification and is intentionally large.
Start from this router, then `COMPONENT_MAP.yaml`, then one subsystem card.
Open only exact mapped sections of the normative README/contracts when the card requires them.

## 2. Route the request before reading code

Classify the owner request as exactly one of:

- `maintenance` — bounded change to an already implemented concern;
- `implementation` — one selected roadmap/task slice;
- `design-decision` — one prerequisite/architecture decision, no following implementation;
- `component/peripheral` — one supported component capability after prerequisites are accepted;
- `deployment` — integration/release action only, never product development;
- `plan/governance` — documentation/control repair only, no runtime implementation.

Then resolve one or more stable IDs through `COMPONENT_MAP.yaml`.
If no ID matches, **STOP** and repair routing before broad source search.

## 3. Minimal context path

```text
START_HERE.md
→ COMPONENT_MAP.yaml
→ one referenced components/*.yaml card
→ one concrete task card/template
→ exact contract/README sections named by the card
→ mapped source files
→ mapped focused tests
```

Expand one dependency hop only when a concrete unresolved dependency requires it.
Record the dependency reason before reading additional subsystems.

## 4. Context budgets

Ordinary maintenance should normally fit in:

```text
1 router + component map
1 subsystem card
0–1 exact contract/README sections
1–5 production files
1–2 focused test files
```

A milestone slice should normally fit in:

```text
1 selected task card
1–2 component IDs/cards
1 accepted prerequisite interface
≤10 production files unless the task explicitly authorises more
focused evidence only
```

If the task cannot fit this budget, **STOP and split the task**. Do not solve token pressure by loading the whole Electronics tree.

## 5. Execution lock

A roadmap item being documented does not authorise its implementation.
Before editing product code, the selected task must define:

```text
GOAL
COMPONENT IDS
RISK
PREREQUISITES
EXPECTED WRITE PATHS
FORBIDDEN PATHS/BEHAVIOUR
ACCEPTANCE
TESTS/GATES
STOP CONDITION
```

Current execution state remains owned only by `docs/execution/current.yaml`.
Never edit the plan to justify code already being written.

## 6. Plan discipline

The canonical optimization/development order is in `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md`.
Dependency edges are hard gates. An agent may not skip a prerequisite because a later task looks easier.
If reality contradicts the plan, create/perform a bounded `design-decision` or `plan/governance` repair and **STOP**.

Never begin the next milestone automatically after completing the current one.

## 7. Critical Electronics stop conditions

STOP before coding when any of these is true:

- no component ID/routing entry matches the request;
- the request spans more subsystems than the selected task declares;
- a prerequisite roadmap gate is not accepted;
- solver/Arduino semantics would change during a UI-only task;
- a new sensor/peripheral needs timing support that canonical clock/runtime does not yet expose;
- a new component would require hidden solver special-casing instead of an accepted DeviceModel/profile path;
- a protected owner SVG/asset would have to be redrawn, traced, rasterised or replaced;
- persistence/schema/RLS/deployment would need to change unexpectedly;
- another agent has overlapping unintegrated edits;
- acceptance cannot be proven with the declared focused gate.

## 8. Deployment is separate

Git commit/push/merge is **not deployment**.
Deployment requires its own task card and gate, with exact target SHA, backup/rollback, compose/env audit, schema check and post-deploy verification.
Never run `git pull && docker compose up` as a continuation of an implementation task.

## 9. Completion rule

After tests/evidence, perform the bounded self-review from `AGENT_GUIDE.md`, report `NEXT_ALLOWED_TASK`, then **STOP**.
`NEXT_ALLOWED_TASK` is owner-selectable information, not permission to start it.