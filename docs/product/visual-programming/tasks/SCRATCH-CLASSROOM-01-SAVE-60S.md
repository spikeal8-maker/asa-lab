# SCRATCH-CLASSROOM-01-SAVE-60S — Minute remote autosave with fast local recovery

**Program:** #468  
**Issue:** #469  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Minute remote autosave with fast local recovery.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.project.autosave`, `blocks.project.recovery`, `blocks.host.storage-adapter`

## Expected boundary

`infra/scratch-editor/host/editor.js`, `recovery.js`, `storage.js` and mapped tests/contracts.

## Acceptance

1. Current 5–8 s remote save stream is removed.
2. Later edits do not starve the selected checkpoint.
3. Newest generation is saved; one remote save is in flight.
4. Fast IndexedDB recovery remains independent of remote cadence.
5. Unchanged fingerprint/assets stay no-op.
6. Save failure/backoff/conflict cannot create a request storm or silent overwrite.
7. P1500 load shaping preserves minute-scale durability and newest-state semantics.

## Evidence

Fake-time/unit tests plus shipping browser save/reopen/new-media/failure evidence; `pnpm gate:blocks`; independent review because persistence is HIGH risk.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


