# SCRATCH-CLASSROOM-06-DB-PATH — Measure and reduce runtime asset DB amplification

**Program:** #468  
**Issue:** #474  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Measure and reduce runtime asset DB amplification.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.assets.read`, `blocks.runtime.capability`, `blocks.runtime.session`

## Expected boundary

Runtime request/authority/project/asset metadata persistence sources selected only after baseline measurement.

## Acceptance

1. SQL/client operations per asset GET are measured.
2. Pool acquire/wait and authority/project/metadata stages are measured.
3. Duplicate equivalent request-scoped work is removed only where proven.
4. Full project load/validation is avoided only if the security contract permits it.
5. Tenant/principal/project/capability/asset ownership remains fail-closed.
6. Before/after p50/p95/p99 and pool wait/timeouts are recorded.
7. PostgreSQL pool size is not guessed before the after-state.

## Evidence

1/10/30-client profiling, negative authorization tests, focused API tests, independent security review.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


