# Карта качества ASA Lab

State source: `docs/execution/current.yaml`.
Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`.
Test registries: `test-catalog.yaml`, `planned-test-catalog.yaml`,
`active-task-tests.yaml`; graph: `project-map.yaml`.

## Current task

Rendered from the control plane; `pnpm control-plane:check` fails if these
values drift from [`current.yaml`](../execution/current.yaml).

```text
TASK-ELECTRONICS-M1-001  in_progress
current_focus             TASK-ELECTRONICS-M1-001
branch                    agent/module-boundary-separation
Issue                     #63
checkpoint                post_merge_physical_alignment_corrective
execution_lease           assistant-stabilisation
```

## Gate results on the branch head

```text
focused   Electronics R4-M1 Focused             NOT_RUN
general   ASA Lab Governance and Code Gates     NOT_RUN
```

The corrective exact SHA does not exist yet. Results are recorded only after
the focused implementation and GitHub publication complete on one revision.

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## Focused owner-activated IDs

```text
TST-R3A-MODULE-GATEWAY-001              NOT_RUN
TST-ELECTRONICS-ASSET-MANIFEST-001      NOT_RUN
TST-ELECTRONICS-TRANSPARENCY-001        NOT_RUN
TST-ELECTRONICS-PHYSICAL-SCALE-001      NOT_RUN
TST-ELECTRONICS-PIN-ANCHOR-001          NOT_RUN
TST-ELECTRONICS-STATE-FAMILIES-001      NOT_RUN
TST-ELECTRONICS-BREADBOARD-001          NOT_RUN
TST-ELECTRONICS-RESISTOR-VISUAL-001     NOT_RUN
TST-ELECTRONICS-COMPONENT-LIBRARY-001   NOT_RUN
TST-ELECTRONICS-M1-E2E-001              NOT_RUN
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
