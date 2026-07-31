# Карта качества ASA Lab

Sources: `docs/delivery/EXECUTION_MANIFEST.yaml`, `test-catalog.yaml`,
`active-task-tests.yaml` and `project-map.yaml`.

## Current task

```text
TASK-ELECTRONICS-M1-001  in_progress
current_focus             TASK-ELECTRONICS-M1-001
branch                    agent/r4-electronics-m1
Issue                     #63
```

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## Focused owner-activated IDs

```text
TST-R3A-MODULE-GATEWAY-001
TST-ELECTRONICS-M1-DOMAIN-001
TST-ELECTRONICS-M1-EDITOR-001
TST-ELECTRONICS-M1-PERSISTENCE-001
TST-ELECTRONICS-M1-E2E-001
```

The current Electronics results are currently `NOT_RUN` until implementation
reaches each focused gate. The full repository matrix is intentionally not run
before owner visual acceptance.

## Required browser evidence

```text
empty.png
components.png
wired.png
running.png
diagnostic.png
reload.png
console errors = 0
pageerror = 0
unexpected requestfailed = 0
```

Result semantics: PASS is a real exit 0; FAIL is an executed defect; BLOCKED is
a missing isolated environment; NOT_RUN means the focused command has not run.
