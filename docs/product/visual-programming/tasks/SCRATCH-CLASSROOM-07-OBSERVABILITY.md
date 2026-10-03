# SCRATCH-CLASSROOM-07-OBSERVABILITY — Privacy-safe Scratch classroom telemetry

**Program:** #468  
**Issue:** #475  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Privacy-safe Scratch classroom telemetry.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.host.protocol` plus runtime/persistence observability surfaces

## Expected boundary

Existing observability/event infrastructure and the smallest required Scratch/browser integration.

## Acceptance

1. Correlate open/ready/fatal/remount.
2. Record retry/final failure class, token refresh, remote save/conflict, local recovery and StudentSeat reconnect state.
3. Use random client-instance/correlation IDs suitable for incident reconstruction.
4. Never log class codes, passwords, cookies, bearer/runtime tokens or raw student secrets.
5. Telemetry failure cannot break editor/save/auth.
6. Evidence distinguishes cold/warm/static/save/network failure traffic.

## Evidence

Unit validation of event/redaction shape plus browser incident scenario.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


