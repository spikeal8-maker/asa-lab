# Карта качества ASA Lab

State source: `docs/execution/current.yaml`.

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`.

Test registries: `test-catalog.yaml`, `planned-test-catalog.yaml`,
`active-task-tests.yaml`; graph: `project-map.yaml`.

## Current task

Rendered from the control plane; `pnpm control-plane:check` fails if these
values drift from [`current.yaml`](../execution/current.yaml).

```text
TASK-3D-M0-001  in_progress
current_focus    TASK-3D-M0-001
branch           agent/three-d-m0
Issue            #94
checkpoint       foundation_vertical_slice
execution_lease  codex-three-d-m0
```

## Gate results on the branch head

```text
focused   3D M0 Focused                           NOT_RUN
general   ASA Lab Governance and Code Gates       NOT_RUN
```

The product branch currently contains only its initialization commit. Results
remain `NOT_RUN` until the foundation implementation exists on one exact SHA.

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## Focused owner-activated IDs

```text
TST-3D-M0-DOMAIN-001       NOT_RUN
TST-3D-M0-INTEGRATION-001  NOT_RUN
TST-3D-M0-LAZY-001         NOT_RUN
TST-3D-M0-E2E-001          NOT_RUN
```

## Required browser evidence

```text
three-d-desktop.png
three-d-tablet.png
three-d-mobile.png
save and reload the identical box scene
console errors = 0
pageerror = 0
unexpected requestfailed = 0
HTTP 5xx = 0
```

The bundle inventory must also prove that the normal Portal entry does not load
Three.js or future geometry WASM. PASS is a real exit 0; FAIL is an executed
defect; BLOCKED is a missing isolated environment; NOT_RUN means the focused
command has not run.
