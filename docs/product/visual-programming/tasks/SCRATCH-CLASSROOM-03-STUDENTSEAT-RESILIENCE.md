# SCRATCH-CLASSROOM-03-STUDENTSEAT-RESILIENCE — StudentSeat transient failure is not logout

**Program:** #468  
**Issue:** #471  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

StudentSeat transient failure is not logout.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.runtime.session` plus shared identity/session boundary

## Expected boundary

`apps/web/src/session-fetch.ts`, `apps/web/src/App.tsx`, mapped classroom/auth tests; API auth code only if proven required.

## Acceptance

1. Network/timeout/5xx session check preserves known StudentSeat and enters reconnecting.
2. Authoritative invalid session logs out.
3. StudentSeat 401 on generic project/runtime paths does not start Account refresh.
4. Account refresh failure cannot accidentally clear StudentSeat authority.
5. Cross-tab intentional logout remains correct.
6. Real revoke/expiry/class closure terminates access without endless reconnect.

## Evidence

Focused unit/browser regressions plus independent security review of the exact SHA.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.

Cross-boundary HIGH risk: do not make Account or StudentSeat authentication less strict.
