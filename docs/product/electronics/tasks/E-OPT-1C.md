---
task_id: TASK-ELECTRONICS-EOPT1C-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: E-OPT-1C
prerequisites:
  - E-OPT-1B non-temporal engine facade accepted in main
acceptance_boundary: slice
review: self
---

# E-OPT-1C — engine dependency-boundary tests

## Execution lock

This card is executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT1C-001` for the Electronics lane with `status: in_progress`.
The roadmap or this file existing is not permission to start.

## Goal

Add bounded tests proving that `@asa-lab/electronics/engine` remains a portable non-temporal
boundary and does not pull Web, React, API, PostgreSQL, portal or deployment concerns.
No production behaviour changes are allowed in this slice.

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
./E-OPT-1B.md
contexts/electronics/engine.ts
contexts/electronics/package.json
contexts/electronics/tsconfig.json
contexts/electronics/testing/engine-public-api.spec.ts
```

## Expected write paths

```text
contexts/electronics/testing/engine-boundary.spec.ts
docs/product/electronics/components/engine-worker-clock.yaml
```

The component card may be updated only to route the new boundary test.
Do not edit production `.ts/.tsx` files in this slice.

## Required result

Tests must prove the engine entry point and its dependency closure do not import or require:

- React or React DOM;
- `apps/web` or browser UI modules;
- `apps/api` or Nest application modules;
- PostgreSQL/database/migration code;
- portal/application shell state;
- Worker host/controller implementation;
- canonical clock/timed advance contracts not yet accepted by E-OPT-3.

The test should inspect the real entry point/dependency graph rather than rely only on string checks
against the package name.

## Acceptance

```text
1. Boundary test imports/resolves the real @asa-lab/electronics/engine entry point.
2. Its transitive production dependency closure stays inside the allowed Electronics engine/domain boundary.
3. React/Web/API/DB/portal/Worker-host dependencies fail the test if introduced.
4. Existing engine public-api tests remain green.
5. Existing Electronics focused gate remains green.
6. No production source or benchmark golden changes.
```

## Tests / gates

```text
pnpm exec vitest run contexts/electronics/testing/engine-boundary.spec.ts
pnpm exec vitest run contexts/electronics/testing/engine-public-api.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT1C-001
pnpm gate:electronics-m1
pnpm gate:governance
```

## Explicitly not doing

```text
no engine facade redesign
no Worker migration
no canonical clock work
no solver/DeviceModel refactor
no Arduino runtime work
no component/peripheral work
no UI work
no deployment
```

## Stop

After declared tests/gates pass, report E-OPT-1D as owner-selectable and STOP.
Do not start the minimal consumer contract in the same slice.
