# VSCR-CLASSROOM-05-STATIC-DELIVERY — Versioned immutable Scratch static delivery

**Kind:** executable implementation slice  
**Risk:** medium  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-05-STATIC-DELIVERY` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #473

## Goal

Versioned immutable Scratch static delivery.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target P1500 / #477.

## Components

`blocks.host.build`

## Scope

`infra/scratch-editor/Dockerfile`, nginx/static host config, entry document and mapped build/browser tests.

## Acceptance

1. Core vendor bytes receive immutable version identity.
2. Immutable caching is used only for actually versioned bytes.
3. Entry/bootstrap stays revalidated.
4. New Scratch build references a new vendor identity.
5. Warm reopen avoids unnecessary FRP revalidation for unchanged core bytes.
6. Private project/API responses never become public-cacheable.
7. Existing immutable /library-assets/** behavior is preserved unless evidence proves a defect.

## Evidence

Cold/warm before/after request count, bytes and latency; Docker/browser focused gates.

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
