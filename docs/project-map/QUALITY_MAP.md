# Карта качества ASA Lab

Sources: `docs/delivery/EXECUTION_MANIFEST.yaml`, `test-catalog.yaml`,
`active-task-tests.yaml` and `project-map.yaml`.

## Current task

```text
TASK-ELECTRONICS-M1-001  in_review
current_focus             TASK-ELECTRONICS-M1-001
branch                    agent/r4-electronics-m1
Issue                     #63
checkpoint                m1_led_visual_corrective
sole_executor             coding_bot
assistant_role            read_only_reviewer
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
TST-R3A-MODULE-GATEWAY-001              PASS
TST-ELECTRONICS-ASSET-MANIFEST-001      PASS
TST-ELECTRONICS-TRANSPARENCY-001        PASS
TST-ELECTRONICS-PHYSICAL-SCALE-001      PASS
TST-ELECTRONICS-PIN-ANCHOR-001          PASS
TST-ELECTRONICS-STATE-FAMILIES-001      PASS
TST-ELECTRONICS-BREADBOARD-001          PASS
TST-ELECTRONICS-RESISTOR-VISUAL-001     PASS
TST-ELECTRONICS-COMPONENT-LIBRARY-001   PASS
TST-ELECTRONICS-M1-E2E-001              PASS
```

The canonical owner-catalog validator and focused
asset/state/breadboard/library tests run with common static CI. The full
repository matrix remains intentionally out of scope before owner acceptance.

## Required browser evidence

```text
electronics-empty.png
electronics-wired.png
electronics-running.png
electronics-resistance-changed.png
electronics-reverse-polarity.png
electronics-reload.png
console errors = 0
pageerror = 0
unexpected requestfailed = 0
HTTP 5xx = 0
```

Result semantics: PASS is a real exit 0; FAIL is an executed defect; BLOCKED is
a missing isolated environment; NOT_RUN means the focused command has not run.
