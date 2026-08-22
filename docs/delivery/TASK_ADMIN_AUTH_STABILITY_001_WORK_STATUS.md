# TASK-ADMIN-AUTH-STABILITY-001 work status

State source: `docs/execution/current.yaml`

Programme source: `docs/delivery/EXECUTION_MANIFEST.yaml`

Execution plan: `docs/execution/ADMIN_AUTH_MAX_EXECUTION_PLAN.md`

Owner scope: Issue #135

Rendered from the control plane; `pnpm control-plane:check` fails on drift.

```text
task: TASK-ADMIN-AUTH-STABILITY-001
branch: main
status: in_progress
checkpoint: production_restart_verified_max_secret_pending
execution: direct_main
```

## Required result

The existing ASA Lab application keeps its integrated Admin access after access
token expiry, reports the exact running build and database schema, offers MAX
verification after one authenticated day, and recovers the same revision after
a supervised restart. It must not create a second Admin service or disturb the
existing FRP route.

## Current evidence

Build identity, rotating refresh sessions, owner-admin startup preflight and the
MAX verification lifecycle and user/admin revoke controls are deployed; the
revoke path is verified against real PostgreSQL and preserves password sessions.
Production reports the exact Git revision and schema, and the local supervisor
has recovered the API after a forced child-process failure. A newly generated
MAX secret, Russian-network owner check and owner acceptance are still pending,
so the task remains `in_progress`.
