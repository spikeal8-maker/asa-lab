# Карта качества ASA Lab

State source: `docs/execution/current.yaml`.
Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`.
Test registries: `test-catalog.yaml`, `planned-test-catalog.yaml`,
`active-task-tests.yaml`; graph: `project-map.yaml`.

## Current task

Rendered from the control plane; `pnpm control-plane:check` fails if these
values drift from [`current.yaml`](../execution/current.yaml).

```text
TASK-ELECTRONICS-M1-001  in_review
current_focus             TASK-ELECTRONICS-M1-001
branch                    agent/r4-electronics-m1
Issue                     #63
checkpoint                phase_6_return_to_review
execution_lease           unassigned
```

## Gate results on the branch head

```text
focused   Electronics R4-M1 Focused             PASS
general   ASA Lab Governance and Code Gates     FAIL
```

The general gate fails on a stale LED expectation in
`tests/portal/projects-api.spec.ts`; a fix is prepared on
`chore/control-plane-recovery`. Until it passes, no release-candidate claim is
valid regardless of the focused result.

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
