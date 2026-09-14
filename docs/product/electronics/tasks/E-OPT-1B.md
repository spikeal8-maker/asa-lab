---
task_id: TASK-ELECTRONICS-EOPT1B-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: E-OPT-1B
prerequisites:
  - E-OPT-1A inventory accepted in main at 7fb493d2351902a403a8cca8e4fed23ab506094d
acceptance_boundary: slice
review: independent
---

# E-OPT-1B — minimal non-temporal engine facade

## Goal

Add one intentional `@asa-lab/electronics/engine` boundary around the existing parse/compile/snapshot-analysis implementation without changing physics or time semantics.

## Component IDs

```text
electronics.engine.public-api
```

## Minimal read set

```text
../START_HERE.md
../COMPONENT_MAP.yaml
../components/engine-worker-clock.yaml → electronics.engine.public-api only
../ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md → E-OPT-1 only
../evidence/E-OPT-1A-PUBLIC-BOUNDARY-INVENTORY.md
contexts/electronics/package.json
contexts/electronics/domain/document.ts
contexts/electronics/domain/simulation.ts
```

## Expected write paths

```text
contexts/electronics/engine.ts
contexts/electronics/package.json
contexts/electronics/tsconfig.json
contexts/electronics/testing/engine-public-api.spec.ts
docs/product/electronics/components/engine-worker-clock.yaml
```

## Required result

The new engine subpath must expose only a small structural/non-temporal surface:

- document parse/validation;
- topology preparation summary;
- bounded snapshot analysis;
- engine contract/capability/version descriptor;
- boundary-owned input/output types needed by those operations.

It must delegate existing domain functions. Existing `@asa-lab/electronics` and `@asa-lab/electronics/simulation` compatibility surfaces remain unchanged in this slice.

## Explicitly not doing

```text
no Worker migration
no canonical clock or timed advance API
no transient continuation API
no Arduino scheduler/runtime refactor
no solver/DeviceModel refactor
no component/peripheral work
no UI migration
no deployment
```

## Acceptance

```text
1. @asa-lab/electronics/engine is an explicit package export.
2. Its public API contains no simulationTimeMs, transientState, controllerState, event horizon, pause/resume or scheduler contract.
3. Parse/prepare/analyse delegate current implementation and preserve shared deterministic result values.
4. Existing root and ./simulation export surfaces are not removed or redirected.
5. Focused facade tests pass and existing Electronics focused gate remains green.
6. No benchmark golden changes.
```

## Tests / gates

```text
pnpm exec vitest run contexts/electronics/testing/engine-public-api.spec.ts
pnpm nx run electronics:typecheck
pnpm nx run electronics:build
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT1B-001
pnpm gate:electronics-m1
pnpm gate:governance
```

## Forbidden

```text
no hidden solver special-case
no UI timer as physical time
no owner asset change
no next E-OPT slice
no deployment/restart
```

## Review

HIGH semantic public-boundary change requires independent review before acceptance.

## Stop

After acceptance report E-OPT-1C as owner-selectable and STOP. Do not start dependency-boundary work in the same slice.
