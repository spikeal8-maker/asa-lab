---
task_id: TASK-ELECTRONICS-EOPT3A-001
kind: design-decision
risk: high
semantic_change: yes
roadmap_slice: E-OPT-3A
prerequisites:
  - E-OPT-1 portable engine boundary accepted in main
  - E-OPT-2 dedicated Worker execution boundary accepted in main
acceptance_boundary: slice
review: independent
---

# E-OPT-3A — canonical clock and trace contract

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT3A-001` for the Electronics lane with `status: in_progress`.

## Question

What single deterministic physical-time contract must Electronics use for circuit physics,
Arduino execution, ordered input events, Worker horizons and committed results before any timed
public engine API is frozen?

## Component IDs

```text
electronics.clock.canonical
electronics.transient.runtime
electronics.worker.protocol
electronics.engine.public-api
```

## Decision criteria

The accepted contract must define, without implementing it:

```text
logical simulation time and units
requested horizon vs committed horizon
monotonicity and admissible same-time events
deterministic ordering for simultaneous input/runtime events
physics/Arduino event barriers and commit points
stale/cancelled horizon handling
pause/resume/reset semantics
presentation/display sampling vs physical time
trace/replay inputs required for deterministic reproduction
Worker request/result relationship to horizons
failure/yield semantics when a horizon cannot be fully committed
compatibility treatment for the existing provisional timed bridge
```

The contract must preserve the determinism/failure rules in `DEVELOPMENT_SPEC.md` and must not
make render cadence, wall-clock time or the current ~100 ms presentation loop authoritative.

## Minimal read set

```text
../START_HERE.md
../AGENT_GUIDE.md → §§6-10, 12-13 only
../DEVELOPMENT_SPEC.md → §§1.3, 7.1 and 8 only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-3 only
../components/engine-worker-clock.yaml → mapped components above only
./E-OPT-1E.md
contexts/electronics/domain/arduino-circuit-scheduler.ts
contexts/electronics/domain/simulation.ts
apps/web/src/electronics/live-simulation.ts
apps/web/src/electronics/live-simulation-worker-controller.ts
apps/web/src/electronics/simulation-worker-protocol.ts
apps/web/src/electronics/simulation-worker-evaluator.ts
apps/web/src/electronics/use-electronics-workbench.ts
```

Expand only when one unresolved semantic question cannot be answered from this set.

## Expected writes

```text
docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md
```

Optional bounded proof fixtures are allowed only if they characterize current behaviour and do not
change production runtime. No production `.ts/.tsx` implementation belongs in E-OPT-3A.

## Required decision

The contract must explicitly distinguish:

- physical/logical simulation time from UI/render/wall-clock time;
- requested horizon from the last fully committed horizon;
- input events from presentation sampling;
- committed state from provisional/in-flight Worker state;
- reset from pause/resume and from generation cancellation;
- canonical ordering from host arrival order when events share a timestamp;
- accepted completion from bounded yield/failure before a horizon.

It must also state which existing timed paths are provisional bridges to be migrated by E-OPT-3B/3C/3D.

## Acceptance

```text
1. One normative canonical clock/trace contract exists.
2. Time, horizon, barrier, event ordering and commit semantics are unambiguous.
3. Reset/pause/resume/cancellation/stale-result behaviour is explicit.
4. UI cadence is explicitly non-authoritative for physics.
5. Deterministic replay inputs and observable outputs are defined.
6. Existing E-OPT-1 public facade remains non-temporal.
7. No timed public API names are frozen in this task.
8. No production runtime behaviour changes.
9. Independent review completes with no unresolved semantic defect.
```

## Tests / gates

```text
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT3A-001
pnpm gate:governance
```

Any optional characterization fixture must run in the smallest relevant existing test target and must
not regenerate golden receipts.

## Explicitly not doing

```text
no engine timed API implementation
no scheduler/solver/runtime refactor
no Worker protocol redesign
no Arduino semantic change
no peripheral implementation
no UI cadence change
no deployment
```

## Stop

After the contract and independent review are accepted, report E-OPT-3B as owner-selectable and STOP.
Do not implement timed advance or migrate runtime/Worker scheduling in this task.
