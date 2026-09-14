# Games R0 — agent guide

**Applies only when:** the owner explicitly assigns a Games R0 architecture task.  
**Prepared baseline:** `main@c9fbb773bc4b2c4e19c181ef586ee6300a9cfed6`  
**Runtime changes allowed by this guide:** no

This file is a compact task router, not live execution state. `docs/execution/current.yaml` remains the only source of active lane/task state.

## Work rule

Work on **one** `GP-R0-*` requirement only. Before editing, name the requirement ID and exact files you will inspect. Re-check GitHub `main` for facts that affect the decision.

Read:

- `R0_CURRENT_STATE_AUDIT.md`;
- the assigned section of `R0_ARCHITECTURE_FREEZE.md`;
- the matching row in `R0_TRACEABILITY.yaml`.

For `GP-R0-001`, also read `docs/agent/contracts/identity.yaml` and the current identity migrations/services cited by the audit.

Do not preload the old Games research branch.

## Hard stop

R0 does not permit creating/modifying:

- `games_*` SQL/runtime schema;
- generic Games controllers/services;
- WebSocket/realtime runtime;
- Checkers/Chess runtime behavior;
- production Compose/deployment;
- Redis/Kafka/Kubernetes/Agones dependencies.

If the decision appears to require implementation, document the future evidence needed and stop at the contract.

## Required evidence for one R0 item

The corresponding traceability row must contain:

- `decision`;
- evidence/source refs from current `main`;
- `negative_case`;
- `compatibility` consequence for existing games;
- `review_verdict`.

`state: accepted` is invalid unless `review_verdict: PASS` and those fields are non-null.

## Review

After a logically complete decision use `docs/agent/review-protocol.md`:

- architecture-only decision: `POST_STEP_REVIEW`;
- identity/RLS/security/state-machine boundary: also `CHALLENGE_REVIEW`.

Do not claim R0 complete until all seven `GP-R0-001..007` rows are accepted. Do not edit `docs/execution/current.yaml` merely to make this prepared package look active.
