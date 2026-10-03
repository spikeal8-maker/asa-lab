# SCRATCH-CLASSROOM-02-EXIT-SAFETY — Controlled exit durability and pagehide local flush

**Program:** #468  
**Issue:** #470  
**Status:** executable only when selected in `docs/execution/current.yaml`

## Goal

Controlled exit durability and pagehide local flush.

## Why

Canonical rationale:
- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`

## Components

`blocks.project.load-save`, `blocks.project.recovery`, `blocks.host.protocol`

## Expected boundary

`apps/web/src/blocks/**` and `infra/scratch-editor/host/{editor,main,recovery,protocol,status}.js` only as proven necessary.

## Acceptance

1. Dirty controlled ASA navigation waits for durable save.
2. Clean exit creates no redundant draft.
3. Pagehide/visibility makes pending local recovery immediately flushable before teardown.
4. Forced close + reopen restores unconfirmed work.
5. UI does not claim arbitrary remote HTTP is guaranteed after process termination.
6. Error/timeout exit is explicit and does not report false saved.

## Evidence

Browser tests: Home/Projects/navigation, dirty/new-media exit, server failure, pagehide before recovery debounce, forced-close + reopen.

## Forbidden

- no unrelated refactor or next package;
- no deploy/restart/live-school load;
- no authorization/integrity weakening;
- no stale historical branch as substitute for current-main implementation;
- verify fresh main and selected task before writes.


