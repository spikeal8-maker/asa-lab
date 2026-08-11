# Карта качества ASA Lab

State source: `docs/execution/current.yaml`.

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`.

Test registries: `test-catalog.yaml`, `planned-test-catalog.yaml`,
`active-task-tests.yaml`; graph: `project-map.yaml`.

## Current task

Rendered from the control plane; `pnpm control-plane:check` fails if these
values drift from [`current.yaml`](../execution/current.yaml).

```text
TASK-CHECKERS-M1-001  in_progress
current_focus          TASK-CHECKERS-M1-001
branch                 agent/checkers-education-m1
Issue                  #98
checkpoint             market_and_product_contract
execution_lease        codex-checkers-m1
```

## Gate results on the branch head

```text
focused   Checkers M1 Focused                     NOT_RUN
general   ASA Lab Governance and Code Gates       NOT_RUN
```

The branch contains the market/product contract and activation transition.
Results remain `NOT_RUN` until the executable module and focused tests exist on
one exact SHA. The focused gate must not report PASS for placeholder tests.

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## Focused owner-activated IDs

```text
TST-CHECKERS-M1-RULES-001         NOT_RUN
TST-CHECKERS-M1-PROJECT-001       NOT_RUN
TST-CHECKERS-M1-LEARNING-001      NOT_RUN
TST-CHECKERS-M1-BOTS-001          NOT_RUN
TST-CHECKERS-M1-CLASS-SAFETY-001  NOT_RUN
TST-CHECKERS-M1-E2E-001           NOT_RUN
```

## Required evidence

```text
official Russian draughts-64 rule fixtures
deterministic replay and bot calibration report
student self-learning journey
teacher assignment and move-level evidence journey
safe class game with predefined reactions only
checkers-student-desktop.png
checkers-student-mobile.png
checkers-teacher-desktop.png
console errors = 0
pageerror = 0
unexpected requestfailed = 0
HTTP 5xx = 0
```

The bundle inventory must prove that Checkers loads only on its routes. PASS is
a real exit 0; FAIL is an executed defect; BLOCKED is a missing isolated
environment; NOT_RUN means the focused command has not run.
