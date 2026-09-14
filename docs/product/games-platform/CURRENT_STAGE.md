# Games — CURRENT_STAGE

**Stage:** R0 Architecture Freeze  
**Baseline:** `main@c9fbb773bc4b2c4e19c181ef586ee6300a9cfed6`  
**Runtime changes allowed:** no

## Agent instruction

Work on **one** `GP-R0-*` item only. Before editing, state the requirement ID and exact files you will inspect. Use GitHub `main` for repository facts.

Read first:

- `R0_CURRENT_STATE_AUDIT.md`;
- `R0_ARCHITECTURE_FREEZE.md`;
- `R0_TRACEABILITY.yaml`.

For `GP-R0-001`, additionally read `docs/agent/contracts/identity.yaml` and the exact current identity migrations/services cited by the audit.

Do not read the full old Games research branch by default.

## Hard stop

During R0 do not create or modify:

- `games_*` SQL/runtime schema;
- generic Games controllers/services;
- WebSocket/realtime runtime;
- Checkers/Chess runtime behavior;
- production Compose/deployment;
- Redis/Kafka/Kubernetes/Agones dependencies.

If a decision would require any of those to prove itself, record the needed future evidence and stop at the architecture contract.

## Completion

A requirement is done only when its row in `R0_TRACEABILITY.yaml` has:

- explicit decision;
- evidence/source refs;
- negative case;
- compatibility consequence;
- review verdict.

After each completed item run the repository review protocol. Do not advance to R1 until all seven R0 requirements are accepted.

## Routing note

The live execution manifest does not yet activate a Games implementation lane. Do not invent one or edit `docs/execution/current.yaml` as part of this preflight; lane activation and a machine-routed Games compact contract belong to the explicit start of implementation after R0 acceptance.
