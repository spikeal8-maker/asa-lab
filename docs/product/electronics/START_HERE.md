# ASA Lab Electronics — START HERE FOR AGENTS

Compact router for Electronics/Arduino work. Product behaviour lives in `README.md`;
do not preload that full specification or the Electronics source/test trees.

> **Classroom stabilization 2.1:** owner programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452) is governed by [ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md](ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md). Weekly-log evidence is in [evidence/stabilization-20261001-weekly-log-findings.md](evidence/stabilization-20261001-weekly-log-findings.md). Prepared owner decisions include the 60-second autosave task [#459](https://github.com/spikeal8-maker/asa-lab/issues/459); classroom FRP/session/save load is tracked in [#460](https://github.com/spikeal8-maker/asa-lab/issues/460). These links do not override the active task in `current.yaml`.

## 1. Confirm the selected task

Follow root `AGENTS.md` and `START_HERE_FOR_AI.md`: run
`pnpm agent:preflight --scope electronics --check` as the single normal entry.
If preflight reports recovery, handoff, a blocker or a narrower diagnostic action, follow its
`SAFE_ACTION`; use `agent:recover` / `agent:context` only for that diagnostic follow-up.
Never start editing from an interrupted or unclassified diff.
The Electronics lane in `docs/execution/current.yaml` owns the active task;
neither this router nor roadmap readiness authorises the next task. `ARD-*` identifiers in
the normative README are requirement anchors only: never infer execution order or a next task
from their numbering.

Before executable work, run `pnpm validate:electronics-agent-docs --task <selected-id>`.
The explicit ID must match canonical `in_progress` selection and a valid concrete card.
If the lane is `in_review` or `blocked`, implementation stops: use the declared review/blocker
path only. A review-found code repair must be explicitly returned to an executable
`in_progress` scope before editing production runtime.

## 2. Route one bounded concern

Choose the task kind and resolve human keywords/component IDs in [COMPONENT_MAP.yaml](COMPONENT_MAP.yaml).

For owner-directed classroom stability repairs (missing images, stuck component bodies,
unexpected simulation stops, breadboard interaction), read the selected boundary in
[Stabilization specification v2](ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md) before unrelated cleanup.
Its published task cards still require formal selection in `current.yaml` before implementation.
Root `AGENTS.md` §2.1 governs continuation by an owner-authorized programme controller;
executor STOP does not end that programme or grant deployment/unspecified product decisions.

For cleanup, technical-debt reduction, decomposition, legacy retirement, test-output
hygiene or Electronics asset-packaging work, first confirm the selected task and then read
[Maintenance, Cleanup & Optimization Execution Specification](ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md)
at the exact `WP-*` section named by that task card. The specification describes the whole
programme but never activates a work package by itself.

| Task kind | Next document |
| --- | --- |
| `maintenance` / `repair` | Selected bounded card using [maintenance template](tasks/MAINTENANCE_TASK_TEMPLATE.md); ordinary cleanup/decomposition also reads the [hygiene contract](contracts/ENGINEERING_HYGIENE_CONTRACT.md) |
| cleanup / optimization programme | Selected concrete task card → exact `WP-*` in [maintenance execution specification](ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md) → [hygiene contract](contracts/ENGINEERING_HYGIENE_CONTRACT.md) when deletion/decomposition/legacy applies |
| `implementation` or `component/peripheral` | Selected concrete card and its exact [roadmap](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md) stage; [implementation template](tasks/IMPLEMENTATION_TASK_TEMPLATE.md) |
| `analysis/inventory` | Selected concrete inventory card; [read-only contract](AGENT_GUIDE.md#analysisinventory) |
| `design-decision` | Selected concrete card using [design template](tasks/DESIGN_TASK_TEMPLATE.md) |
| `deployment` | Separately selected card using [deployment template](tasks/DEPLOYMENT_TASK_TEMPLATE.md) |
| `plan/governance` | Owner-selected documentation/tooling scope and [document ownership](DEVELOPMENT_SPEC.md#11-documentation-maintenance); hygiene-policy/baseline work reads the [hygiene contract](contracts/ENGINEERING_HYGIENE_CONTRACT.md) |

Governance work audits named routing documents directly; it need not invent a runtime
component ID. Every product task needs an exact selected scope/card before coding.

## 3. Read only the mapped context

```text
this router → COMPONENT_MAP.yaml → one subsystem card / selected entry
→ one concrete task card → exact contracts → exact source symbols → focused tests
```

Read the applicable [AGENT_GUIDE](AGENT_GUIDE.md) sections: [scope/budgets](AGENT_GUIDE.md#2-one-concern-per-slice),
[risk](AGENT_GUIDE.md#5-risk-classes), [evidence](AGENT_GUIDE.md#11-tests-and-evidence),
[self-review](AGENT_GUIDE.md#12-bounded-self-review) and [independent review](AGENT_GUIDE.md#13-independent-review).
Special engine/clock/Worker rules are §§6–10. These rules are not duplicated here.
Subsystem dependencies permit one justified additional lookup, not whole-card recursive preload.
`sources` is exact-file context; `asset_roots` is directory ownership, never preload.

## 4. Stop boundary

Missing selected task, route, prerequisite or exact contract/source/test is a STOP;
use [failure semantics](DEVELOPMENT_SPEC.md#13-failure-semantics-for-agents).
Apply [AGENT_GUIDE §15](AGENT_GUIDE.md#15-stop-rule) after the selected acceptance.
Validate routing changes with `pnpm validate:electronics-agent-docs` and the declared gates.
Report `NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`; availability does not authorise implementation.
