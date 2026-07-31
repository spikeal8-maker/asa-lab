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
```

The current audit commands run as one focused asset-foundation suite. The full
repository matrix and the Electronics solver/editor gates remain intentionally
out of scope before owner visual acceptance.

## Required browser evidence

```text
complete-owner-contact-sheet.png
battery-holder-family.png
led-state-family.png
breadboard-inventory.png
console errors = 0
pageerror = 0
unexpected requestfailed = 0
```

Result semantics: PASS is a real exit 0; FAIL is an executed defect; BLOCKED is
a missing isolated environment; NOT_RUN means the focused command has not run.
