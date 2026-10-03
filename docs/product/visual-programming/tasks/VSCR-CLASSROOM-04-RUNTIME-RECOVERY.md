# VSCR-CLASSROOM-04-RUNTIME-RECOVERY — Transient asset and capability recovery without F5

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-04-RUNTIME-RECOVERY` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #472

## Goal

Transient asset and capability recovery without F5.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target P1500 / #477.

## Components

`blocks.assets.read`, `blocks.runtime.session`, `blocks.runtime.capability`, `blocks.host.protocol`

## Scope

`infra/scratch-editor/host/storage.js`, `apps/web/src/blocks/BlocksEditor.tsx`, runtime protocol/status and mapped tests as required.

## Acceptance

1. Retryable project-asset failure recovers with bounded backoff/jitter.
2. Integrity/auth failures remain fail-closed.
3. Transient capability refresh retries before expiry.
4. Child token-refresh signal is a working recovery path.
5. Loaded VM continues local execution during short server outage.
6. No infinite retry/remount/F5 loop.
7. Class-wide retry amplification is bounded.

## Evidence

Fault injection: asset 503 once, runtime-session 503 once, short offline interval, hard 401/403 negatives; `pnpm gate:blocks`.

## Independent review

Independent review must inspect retry classification, token authority and class-wide retry-storm risk.

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
