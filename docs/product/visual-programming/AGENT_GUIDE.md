# Scratch agent guide — reference

Start with [README.md](README.md). This guide is reference material for ownership
or review questions; it is not an additional mandatory reading step.
Root [AGENTS.md](../../../AGENTS.md) owns Git, protected data, ports and gates.

## Ownership

Read the selected component entry before editing:

| Ownership         | Rule                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `asa`             | Change ASA code within the requested scope.                         |
| `infrastructure`  | Preserve the reviewed build pin and deployment boundary.            |
| `upstream_config` | Use supported upstream configuration.                               |
| `upstream_patch`  | Only an already reviewed exact patch; a new patch needs a decision. |
| `cross_boundary`  | Inspect the direct dependency and require security review.          |
| `shared_existing` | Reuse existing ASA capability; do not clone a backend.              |

Do not invent a component for an incidental wrapper. When actual paths change,
update the owning entry. Shared/large sources name the relevant symbols. A stale
route is repaired alongside the requested change; it does not create a milestone.
Split code only when responsibilities or navigation impede development, not to
meet a line count. Editor/storage composition belongs outside the protocol bridge.

**Global review authority:** `docs/agent/review-protocol.md`. Run `POST_STEP_REVIEW`
for completed changes and independent `CHALLENGE_REVIEW` for high/critical changes.
Scratch ownership rules refine these checks without replacing them.

## Bounded review

Use the requested scope, final diff, mapped contract and actual test evidence.
Check that accepted security/persistence guarantees remain intact, dependencies
stay scoped, routing points to real paths, and the next task has not started.

Low/medium risk changes use self-review and focused evidence. High/critical trust,
storage or persistence changes also require an independent reviewer. The reviewer
must not be the authoring context and must not edit the reviewed code. Review only
the relevant boundaries and the exact diff; do not reread the entire project.
Repair findings within the authorized scope and repeat the affected checks/review.

Report actual tests and residual risks. Local checks, exact-SHA CI, deployment and
owner acceptance are distinct. Read the root
[change workflow](../../delivery/AGENT_CHANGE_WORKFLOW.md) when publishing.
