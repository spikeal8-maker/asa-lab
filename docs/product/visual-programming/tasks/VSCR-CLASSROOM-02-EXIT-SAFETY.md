# VSCR-CLASSROOM-02-EXIT-SAFETY — Controlled exit durability and pagehide local flush

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** card `VSCR-CLASSROOM-02-EXIT-SAFETY` starts only when `docs/execution/current.yaml.task.id` is exactly `TASK-VSCR-CLASSROOM-002`, `docs/execution/current.yaml.task.issue` is `470`, and `docs/execution/current.yaml.task.status` is exactly `in_progress`.
**Program:** #468  
**Issue:** #470

## Goal

Controlled exit durability and pagehide local flush.

## Why

Canonical rationale:

- `../SCRATCH_CLASSROOM_STABILIZATION_SPEC_V1.md`;
- `../../../architecture/ADR-VSCR-002-LOCAL-FIRST-CLASSROOM-RUNTIME.md`;
- capacity target C3000 / #477 / `docs/architecture/CAPACITY_AND_SLO.md`.

## Components

`blocks.project.load-save`, `blocks.project.recovery`, `blocks.host.protocol`

## Scope

`apps/web/src/blocks/**` and `infra/scratch-editor/host/{editor,main,recovery,protocol,status}.js` only as proven necessary.

## Acceptance

1. Dirty controlled ASA navigation waits for durable save.
2. Clean exit creates no redundant draft.
3. Pagehide/visibility makes pending local recovery immediately flushable before teardown.
4. Forced close + reopen restores unconfirmed work.
5. No false guarantee that arbitrary remote HTTP finishes after process termination.
6. Error/timeout exit is explicit and never reports false saved.

## Evidence

Browser tests for controlled navigation, dirty/new-media exit, server failure, pagehide before recovery debounce, forced-close + reopen.

## Independent review

Independent review must distinguish controlled navigation durability from forced-process-close recovery.

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
