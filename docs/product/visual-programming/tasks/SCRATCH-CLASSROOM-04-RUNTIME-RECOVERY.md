# SCRATCH-CLASSROOM-04-RUNTIME-RECOVERY — Transient asset and capability recovery without F5

**Program:** #468  
**Issue:** #472  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Transient asset and capability recovery without F5.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.assets.read`, `blocks.runtime.session`, `blocks.runtime.capability`, `blocks.host.protocol`

## Expected boundary

`infra/scratch-editor/host/storage.js`, `apps/web/src/blocks/BlocksEditor.tsx`, runtime protocol/status and mapped tests as required.

## Acceptance

1. Retryable project-asset failure recovers with bounded backoff/jitter.
2. Integrity/auth failures remain fail-closed.
3. Transient capability refresh is retried before expiry.
4. Child token-refresh signal is a working recovery path.
5. Already loaded VM can continue local execution during short server outage.
6. No infinite retry/remount/F5 loop.
7. Class-wide retry amplification is bounded.

## Evidence

Browser fault injection: asset 503 once, runtime-session 503 once, short offline interval, hard 401/403 negatives; `pnpm gate:blocks`.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


