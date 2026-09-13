# E-OPT-1A — current public boundary inventory

- **Execution task ID:** `TASK-ELECTRONICS-EOPT1A-001`
- **Kind:** design/analysis prerequisite
- **Risk:** medium (high-risk area, but this slice is read-only for product/runtime code)
- **Semantic change:** `no`
- **Roadmap slice:** `E-OPT-1A`

## Execution lock

This card is executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT1A-001` for the Electronics lane with `status: in_progress`.
Roadmap readiness or this file existing is not permission to start.

## Goal

Produce a reproducible inventory of the current Electronics public export surface and its
actual dependency/consumer graph so E-OPT-1B can define a smaller stable non-temporal facade
without guessing or changing runtime behaviour.

## Component IDs

```text
electronics.engine.public-api
```

Do not broaden to clock/peripherals/solver hardening unless the inventory records them only as
existing dependencies or consumers.

## Minimal read set

```text
../START_HERE.md
../COMPONENT_MAP.yaml
../components/engine-worker-clock.yaml → electronics.engine.public-api only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-1 only
contexts/electronics/package.json
contexts/electronics/project.json
contexts/electronics/index.ts
contexts/electronics/module.ts
contexts/electronics/domain/document.ts
contexts/electronics/domain/simulation.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
```

A repository-wide search is allowed only for import/consumer discovery of the Electronics
package/public symbols. Record the query/pattern; do not turn the search into broad code reading.

## Expected write paths

```text
docs/product/electronics/evidence/E-OPT-1A-PUBLIC-BOUNDARY-INVENTORY.md
```

The task may update `components/engine-worker-clock.yaml` only if the inventory proves an
existing routing/source/test entry is factually wrong. No production source/test file may be
modified in E-OPT-1A.

## Inventory output

The evidence must identify:

1. every export group currently exposed from `contexts/electronics/index.ts`;
2. which exports are candidate stable facade vs internal/model-specific leakage;
3. direct consumers/import paths inside ASA Lab;
4. whether any public-engine path imports React, Web UI, API, PostgreSQL or portal concerns;
5. current Worker entry points that bypass or duplicate the intended engine boundary;
6. existing non-temporal input/output types and unresolved facade candidates for E-OPT-1B;
   no API design decision or time-semantics freeze;
7. actual package/export configuration, Worker evaluator and server-verification consumers,
   existing pure boundary and any host/UI coupling, with exact symbols and import edges.

## Acceptance

```text
A. inventory is complete enough to explain current public surface and direct consumers;
B. findings cite exact files/symbols rather than broad directories;
C. E-OPT-1B can be scoped from evidence without reopening the whole Electronics tree;
D. no runtime/solver/Arduino/Worker behaviour changed;
E. no canonical timed API was designed or promised;
F. pnpm validate:electronics-agent-docs passes;
G. pnpm gate:governance passes.
```

## Explicitly not doing

```text
no production refactor
no export removal/addition
no Worker implementation change
no canonical clock design
no advanceTo/reset/pause API design
no sensor/peripheral work
no deployment
```

## Review

Under [AGENT_GUIDE §13](../AGENT_GUIDE.md#13-independent-review), this non-semantic
inventory needs bounded self-review plus the declared routing/governance validation;
the area's risk does not automatically require a second-agent review.
If the inventory needs a semantic design decision, record the open question and STOP
for a separately selected design/implementation task. Integrated E-OPT-1 acceptance
and later HIGH semantic/timing changes require independent review.

## Stop

After the inventory evidence and declared gates pass, report E-OPT-1B as owner-selectable and
**STOP**. Do not begin facade implementation in the same context.
