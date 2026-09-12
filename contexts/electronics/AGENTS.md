# Electronics domain agent routing

Before editing anything under `contexts/electronics/**`:

1. Read `docs/product/electronics/START_HERE.md`.
2. Resolve the request through `docs/product/electronics/COMPONENT_MAP.yaml`.
3. Open only the referenced subsystem card and exact mapped contracts/source/tests.
4. Check `docs/product/electronics/ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md` prerequisites before milestone work.
5. Use one bounded task template from `docs/product/electronics/tasks/`.

Do not preload the full Electronics normative README. Do not start the next roadmap slice automatically.

Solver/model/clock/Arduino semantic changes are HIGH risk by default and require deterministic/golden evidence plus independent review before acceptance.

A missing prerequisite produces `BLOCKED_BY <task>`; it does not authorise a workaround scheduler, UI timer or hidden solver special-case.

After acceptance evidence and bounded self-review, STOP.