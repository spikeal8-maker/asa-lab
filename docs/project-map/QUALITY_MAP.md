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
TST-ELECTRONICS-ASSET-MANIFEST-001
TST-ELECTRONICS-TRANSPARENCY-001
TST-ELECTRONICS-PHYSICAL-SCALE-001
TST-ELECTRONICS-PIN-ANCHOR-001
TST-ELECTRONICS-STATE-FAMILIES-001
TST-ELECTRONICS-BREADBOARD-001
TST-ELECTRONICS-RESISTOR-VISUAL-001
TST-ELECTRONICS-COMPONENT-LIBRARY-001
TST-ELECTRONICS-M1-E2E-001
```

The production-vector commands and owner-reference presentation tests run as
one focused asset/state/breadboard/library suite. The full repository matrix
remains intentionally out of scope before owner visual acceptance.

## Required browser evidence

```text
editor-idle-clean.png
library-basic-three-columns.png
library-basic-exact-order.png
component-hover-terminal.png
wiring-mode-terminals.png
component-selected.png
breadboard-placement-clean.png
library-disabled-components.png
owner-reference-vs-current.png
console errors = 0
pageerror = 0
unexpected requestfailed = 0
HTTP 5xx = 0
```

Result semantics: PASS is a real exit 0; FAIL is an executed defect; BLOCKED is
a missing isolated environment; NOT_RUN means the focused command has not run.
