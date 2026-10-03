# VSCR-CLASSROOM-03-STUDENTSEAT-RESILIENCE — StudentSeat transient failure is not logout

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-03-STUDENTSEAT-RESILIENCE` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #471

## Goal

StudentSeat transient failure is not logout.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target P1500 / #477.

## Components

`blocks.runtime.session` plus shared identity/session boundary

## Scope

`apps/web/src/session-fetch.ts`, `apps/web/src/App.tsx`, mapped classroom/auth tests; API auth code only if proven required.

## Acceptance

1. Network/timeout/5xx session check preserves known StudentSeat and enters reconnecting.
2. Authoritative invalid session logs out.
3. StudentSeat 401 on generic project/runtime paths does not start Account refresh.
4. Account refresh failure cannot accidentally clear StudentSeat authority.
5. Cross-tab intentional logout remains correct.
6. Real revoke/expiry/class closure terminates access without endless reconnect.

## Evidence

Focused unit/browser regressions for transient failures, generic-path 401, real revoke and cross-tab logout.

## Independent review

Mandatory independent security review of the exact SHA. Do not weaken either Account or StudentSeat authority.

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
