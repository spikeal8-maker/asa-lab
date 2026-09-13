# ASA Lab Electronics — Development Specification

Technical development contract. Behavioural agent policy is owned by [AGENT_GUIDE.md](AGENT_GUIDE.md);
active execution is owned only by repository `docs/execution/current.yaml`.

## 1. System layers

| Layer | Responsibility |
| --- | --- |
| Owner assets / catalog | Artwork provenance, catalog identity and presentation metadata |
| CircuitDocument | Versioned user intent and model identity; not computed electrical truth |
| Topology / netlist | Electrical connectivity independent of wire drawing geometry |
| DeviceModel / solver / transient | Physical models, numerical results and quality diagnostics |
| Arduino / clock | Deterministic educational runtime and physical-time orchestration |
| Engine boundary | Pure document/compile/solve/capability contract for consumers |
| Simulation Worker | Bounded execution of the same engine, protocol/session isolation |
| Host / React workbench | User intent and rendering of engine results |
| Persistence / API verification | Durable intent; server verification reuses the same core/models |

This is a responsibility model, not a claim that every target boundary is implemented.
The [roadmap](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#4-e-opt-1--portable-engine-boundary)
separates the non-temporal engine boundary from the later canonical timed API.

## 2. Sources of truth

See the single ownership table in [§11](#11-documentation-maintenance).
GitHub repository content is sufficient to understand the task; local recovery output is
a fresh workspace observation, not a second execution database. Git history/delivery
evidence records historical proof. Deployment checks observe the exact running revision
and readiness separately; Git push/merge cannot prove them.

## 3. Development selection

1. Read the selected Electronics task/status from canonical execution state via `agent:context`.
2. Classify the requested outcome using [START_HERE](START_HERE.md#2-route-one-bounded-concern).
3. Resolve component IDs and only the required subsystem entries.
4. Check the exact roadmap prerequisite for new capability; maintenance does not activate a milestone.
5. Match the selected concrete card/scope: goal, task risk, semantic flag, reads/writes,
   exclusions, acceptance, evidence, review and STOP.
6. Read mapped contracts/source/tests. If selection or routing fails, use §13.

A feature branch inherits execution selection accepted on `main`; it cannot select a task
by editing its own `current.yaml`. Future task cards describe scope, not current authorization.

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
| `DEVELOPMENT_SPEC.md` | Layers, development selection, editing/integration/deployment contracts and acceptance |
| `ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` | Roadmap stages, dependencies, prerequisites and milestone boundaries |
| `COMPONENT_MAP.yaml` / subsystem cards | Stable IDs, keywords, ownership/risk, exact contracts/source/symbol/test routes and dependencies |
| `tasks/` | One bounded slice per concrete card; templates define required fields |

Cards never store programme progress, live task/SHA/CI/deployment state or `implementation_state`.
Readiness is assessed from roadmap prerequisites and acceptance evidence, not inferred from
source filenames. When ownership changes, update the affected routes in the same slice and
run `pnpm validate:electronics-agent-docs`. Repair contradictions at their canonical owner.

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
