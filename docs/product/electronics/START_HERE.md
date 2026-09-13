# ASA Lab Electronics — START HERE FOR AGENTS

Compact router for Electronics/Arduino work. Product behaviour lives in `README.md`;
do not preload that full specification or the Electronics source/test trees.

## 1. Confirm the selected task

Follow root `AGENTS.md` and `START_HERE_FOR_AI.md`: fetch/check Git, run
`pnpm agent:recover --scope electronics --check`, then
`pnpm agent:context --scope electronics`. Classify an interrupted diff before editing.
The Electronics lane in `docs/execution/current.yaml` owns the active task;
neither this router nor roadmap readiness authorises the next task.

Before executable work, run `pnpm validate:electronics-agent-docs --task <selected-id>`.
The explicit ID must match canonical `in_progress` selection and a valid concrete card.

## 2. Route one bounded concern

Choose the task kind and resolve human keywords/component IDs in [COMPONENT_MAP.yaml](COMPONENT_MAP.yaml).

| Task kind | Next document |
| --- | --- |
| `maintenance` / `repair` | Selected bounded card using [maintenance template](tasks/MAINTENANCE_TASK_TEMPLATE.md) |
| `implementation` or `component/peripheral` | Selected concrete card and its exact [roadmap](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md) stage; [implementation template](tasks/IMPLEMENTATION_TASK_TEMPLATE.md) |
| `design-decision` | Selected concrete card using [design template](tasks/DESIGN_TASK_TEMPLATE.md) |
| `deployment` | Separately selected card using [deployment template](tasks/DEPLOYMENT_TASK_TEMPLATE.md) |
| `plan/governance` | Owner-selected documentation/tooling scope and [document ownership](DEVELOPMENT_SPEC.md#11-documentation-maintenance) |

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
