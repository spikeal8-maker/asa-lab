# SCRATCH-CLASSROOM-08-CLASS30 — Isolated CLASS-30 Scratch acceptance

**Program:** #468  
**Issue:** #476  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Isolated CLASS-30 Scratch acceptance.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks` integrated product; acceptance/evidence task

## Expected boundary

Load/browser harness and CI artifacts only. Any reproduced product defect becomes its own bounded repair task.

## Acceptance

1. 30 independent StudentSeat sessions/cookies.
2. Barrier cold open and warm reopen.
3. Sprite/library interaction.
4. Minute remote save + new costume/sound.
5. Capability rotation.
6. Controlled exit and forced-close recovery.
7. Transient session/runtime-session/asset fault recovery.
8. True revoke negative case.
9. 0 unexpected logout and 0 project loss.
10. No supported-load Scratch container restart or pg-pool timeout.
11. Warm cache effect and retry amplification are measured.

## Evidence

Isolated environment only. Record exact revision/environment and request/byte/latency/DB/transport metrics. After PASS: P1500 #477, then mixed #460.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


