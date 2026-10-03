# VSCR-CLASSROOM-06-DB-PATH — Measure and reduce runtime asset DB amplification

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-06-DB-PATH` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #474

## Goal

Measure and reduce runtime asset DB amplification.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target P1500 / #477.

## Components

`blocks.assets.read`, `blocks.runtime.capability`, `blocks.runtime.session`

## Scope

Runtime request/authority/project/asset metadata sources selected only after baseline measurement.

## Acceptance

1. SQL/client operations per asset GET are measured.
2. Pool acquire/wait and authority/project/metadata stages are measured.
3. Duplicate equivalent request-scoped work is removed only where proven.
4. Full project load/validation is avoided only if the security contract permits it.
5. Tenant/principal/project/capability/asset ownership remains fail-closed.
6. Before/after p50/p95/p99 and pool wait/timeouts are recorded.
7. PostgreSQL pool size is not guessed before the after-state.

## Evidence

1/10/30-client profiling, negative authorization tests, focused API tests.

## Independent review

Mandatory independent security review of the exact SHA and before/after query path.

## Bounded self-review

Before PASS, verify:
- only this bounded result was implemented/reviewed;
- current-main behavior was reproduced or measured before claiming a fix;
- local-first Scratch runtime invariant is preserved;
- newest work cannot be silently lost;
- no security/tenant/project/integrity check was weakened;
- no live-school load, deploy or restart was performed without separate owner authorization;
- documentation and tests match the final exact SHA.

## Stop

STOP after this card's evidence/review. Do not auto-start the next classroom package.
