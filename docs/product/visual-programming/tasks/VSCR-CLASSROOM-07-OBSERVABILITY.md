# VSCR-CLASSROOM-07-OBSERVABILITY — Privacy-safe Scratch classroom telemetry

**Kind:** executable implementation slice  
**Risk:** medium  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-07-OBSERVABILITY` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #475

## Goal

Privacy-safe Scratch classroom telemetry.

## Why

Canonical rationale:

- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target C3000 / #477 / `docs/architecture/CAPACITY_AND_SLO.md`.

## Components

`blocks.host.protocol` plus runtime/persistence observability surfaces

## Scope

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
