# VSCR-CLASSROOM-01-SAVE-60S — Minute remote autosave with fast local recovery

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-CLASSROOM-01-SAVE-60S` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.  
**Program:** #468  
**Issue:** #469

## Goal

Minute remote autosave with fast local recovery.

## Why

Canonical rationale:

- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target P1500 / #477.

## Components

`blocks.project.autosave`, `blocks.project.recovery`, `blocks.host.storage-adapter`

## Scope

Primary production paths: `infra/scratch-editor/host/editor.js`, `recovery.js`, `storage.js`; mapped tests/contracts only.

## Acceptance

1. Current 5–8 s remote save stream is removed.
2. Later edits do not starve the selected checkpoint.
3. Newest generation is saved; one remote save is in flight.
4. Fast IndexedDB recovery remains independent of remote cadence.
5. Unchanged fingerprint/assets stay no-op.
6. Failure/backoff/conflict cannot create a request storm or silent overwrite.
7. P1500 load shaping preserves minute-scale durability and newest-state semantics.

## Evidence

Fake-time/unit plus shipping browser save/reopen/new-media/failure evidence; `pnpm gate:blocks`.

## Independent review

Independent review must inspect generation ordering, failure/retry/conflict semantics and local-vs-remote durability.

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
