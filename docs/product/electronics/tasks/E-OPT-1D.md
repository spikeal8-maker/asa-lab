---
task_id: TASK-ELECTRONICS-EOPT1D-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: E-OPT-1D
prerequisites:
  - E-OPT-1C dependency-boundary tests accepted in main
acceptance_boundary: slice
review: self
---

# E-OPT-1D — direct engine consumer contract

## Execution lock

Executable only when `docs/execution/current.yaml` selects exact task ID
`TASK-ELECTRONICS-EOPT1D-001` for the Electronics lane with `status: in_progress`.

## Goal

Prove the published `@asa-lab/electronics/engine` subpath can be consumed directly from
minimal Node and browser-facing test consumers for parse/validate, topology preparation,
snapshot analysis and capability/version discovery. No production behavior changes are allowed.

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
./E-OPT-1C.md
contexts/electronics/engine.ts
contexts/electronics/package.json
contexts/electronics/testing/engine-public-api.spec.ts
contexts/electronics/testing/engine-boundary.spec.ts
apps/api/package.json
apps/web/package.json
```

## Expected write paths

```text
contexts/electronics/testing/engine-consumer-contract.spec.ts
apps/web/src/electronics/testing/engine-browser-consumer.spec.ts
```

Do not edit production `.ts/.tsx` files in this slice.

## Required result

The tests must consume the real package subpath `@asa-lab/electronics/engine`, not internal
relative modules, and prove:

- descriptor/capabilities/version are readable;
- a valid document parses successfully;
- topology preparation succeeds;
- bounded snapshot analysis solves a small deterministic DC fixture;
- the same public surface is importable from a browser-facing consumer test;
- no timed advance, Worker host, clock or continuation-state API is introduced.

## Acceptance

```text
1. Node-facing consumer test imports @asa-lab/electronics/engine directly.
2. Browser-facing consumer test imports the same package subpath directly.
3. Both exercise the same stable non-temporal contract.
4. Existing public-api and dependency-boundary tests remain green.
5. Existing Electronics focused/browser gates remain green.
6. No production source or benchmark golden changes.
```

## Tests / gates

```text
pnpm exec vitest run contexts/electronics/testing/engine-consumer-contract.spec.ts
pnpm exec vitest run apps/web/src/electronics/testing/engine-browser-consumer.spec.ts
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-EOPT1D-001
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
no deployment
```

## Stop

After declared tests/gates pass, report E-OPT-1E as owner-selectable and STOP.
Do not start Worker convergence in the same slice.
