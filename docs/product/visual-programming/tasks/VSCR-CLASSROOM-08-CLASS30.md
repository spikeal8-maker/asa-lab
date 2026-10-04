# VSCR-CLASSROOM-08-CLASS30 — Isolated CLASS-30 Scratch acceptance

**Kind:** acceptance/review slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-08-CLASS30` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #476

## Goal

Isolated CLASS-30 Scratch acceptance.

## Why

Canonical rationale:

- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target C3000 / #477 / `docs/architecture/CAPACITY_AND_SLO.md`.

## Components

`blocks` integrated product; acceptance/evidence task

## Scope

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

Isolated environment only. Record exact revision/environment and request/byte/latency/DB/transport metrics. After PASS, CLASS-30 evidence may feed both platform C3000 #477 and mixed classroom #460; #460 is an independent follow-up and does not wait for full C3000 evidence.

## Independent review

Independent reviewer validates the exact harness/result provenance and must not repair product code inside this acceptance slice.

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
