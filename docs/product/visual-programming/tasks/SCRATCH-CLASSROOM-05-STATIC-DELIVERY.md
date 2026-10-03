# SCRATCH-CLASSROOM-05-STATIC-DELIVERY — Versioned immutable Scratch static delivery

**Program:** #468  
**Issue:** #473  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Versioned immutable Scratch static delivery.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.host.build`

## Expected boundary

`infra/scratch-editor/Dockerfile`, nginx/static host config, entry document and mapped build/browser tests.

## Acceptance

1. Core vendor bytes receive immutable version identity.
2. Immutable caching is used only for actually versioned bytes.
3. Entry/bootstrap stays revalidated.
4. A new Scratch build references a new vendor identity.
5. Warm reopen avoids unnecessary FRP revalidation for unchanged core bytes.
6. Private project/API responses never become public-cacheable.
7. Existing immutable /library-assets/** behavior is preserved unless evidence proves a defect.

## Evidence

Cold/warm before/after request count, bytes and latency; Docker/browser focused gates.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


