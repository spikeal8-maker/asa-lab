# Electronics Web agent routing

For changes under `apps/web/src/electronics/**`, begin at `docs/product/electronics/START_HERE.md`, not by scanning this directory.

Resolve the request in `docs/product/electronics/COMPONENT_MAP.yaml` and read one mapped subsystem card. The full normative Electronics README is not default context.

Rules:

- UI renders engine/model truth; it does not invent current, voltage, damage or physical time.
- Heavy running simulation stays behind the dedicated Worker boundary.
- Do not add a silent synchronous heavy-solver fallback.
- React timers/presentation cadence do not define physical simulation time.
- Runtime controls should not become persisted project edits unless the product contract explicitly requires it.
- Protected owner assets are not redrawn/traced/replaced.
- Persistence/autosave changes are HIGH risk and must preserve local-solve-before-autosave ordering.
- One bounded task only; no automatic next milestone or deployment.

Use the task templates in `docs/product/electronics/tasks/`, run mapped focused evidence, perform bounded self-review, then STOP.