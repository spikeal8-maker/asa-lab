# Карта качества ASA Lab

State source: `docs/execution/current.yaml`.

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`.

Test registries: `test-catalog.yaml`, `planned-test-catalog.yaml`,
`active-task-tests.yaml`; graph: `project-map.yaml`.

## Current task

Rendered from the control plane; `pnpm control-plane:check` fails if these
values drift from [`current.yaml`](../execution/current.yaml).

```text
TASK-ADMIN-AUTH-STABILITY-001  in_progress
current_focus                  TASK-ADMIN-AUTH-STABILITY-001
branch                         main
Issue                          #135
checkpoint                     execution_plan_published
execution_lease                codex-admin-auth-max
```

## Gate results on the branch head

```text
focused   Admin control plane                      NOT_RUN
browser   Admin control plane browser              NOT_RUN
general   ASA Lab Governance and Code Gates       NOT_RUN
```

The owner activated integrated Admin, durable-session and production MAX
stabilisation. Formal workflow results remain `NOT_RUN` until the focused and
general commands run on the exact revision; local partial checks do not replace
that evidence.

## Governance IDs

```text
TST-ARCH-001
TST-MAP-001
TST-CATALOG-001
TST-DEVELOPMENT-PROGRAM-001
```

## Focused owner-activated IDs

```text
TST-ADMIN-AUTH-MAX-CORE-001        NOT_RUN
TST-ADMIN-AUTH-MAX-E2E-001         NOT_RUN
TST-ADMIN-AUTH-MAX-PRODUCTION-001  NOT_RUN
```

## Required evidence

```text
durable session rotation and replay report
platform-admin authorization matrix
MAX validation, link, login and revoke report
admin desktop and mobile journey
production build revision and schema report
restart, reboot and public-route recovery report
console errors = 0
pageerror = 0
unexpected requestfailed = 0
HTTP 5xx = 0
```

The production evidence must identify one exact Git revision and schema. PASS
is a real exit 0; FAIL is an executed defect; BLOCKED is a missing isolated
environment; NOT_RUN means the focused command has not run.
