# E1 Rollout Compatibility — Challenge Review

Date: 2026-09-12
Scope: `TASK-LRN-COURSE-001`, L3 deployment/database contract.

## Problem

E1 introduced two non-additive runtime transitions:

- exact project submission changed from a four-argument DB command to a five-argument command with `expectedRevision`;
- Account class admission changed from immediate membership creation to request/teacher approval.

Applying those migrations before the new API previously broke the old API. Deploying the new API before the migrations also could not work.

## Required deployment contract

The supported rollout is DB-first:

1. apply the additive/bridge database chain;
2. keep old API instances safe while they drain;
3. start the new API/UI only when runtime schema readiness matches;
4. remove compatibility bridges only in a later cleanup migration after old instances are confirmed drained.

## Submission bridge

`0110_learning_exact_project_submission.sql` now retains both signatures during rollout.

- Five-argument command remains the canonical exact-revision contract.
- Four-argument command reads the current server draft revision and delegates to the five-argument command.
- The delegated command still checks the revision under its normal locking/validation path, so a concurrent edit produces `project_revision_conflict`; the bridge is not an exact-revision bypass.
- Both signatures are executable by `asalab_app` only for the drain window.

Regression evidence on a fresh 0134 database proves:

- a stale explicit five-argument revision is rejected;
- the old four-argument call succeeds using the current server revision;
- immutable submission evidence records that exact revision and frozen document;
- suspended learners remain forbidden through both signatures.

## Account admission bridge

`0119_classroom_account_join_approval.sql` now preserves the old materializer under the private name `classroom_account_join_materialize_internal`.

The old public name `classroom_join_with_account` is a non-mutating compatibility reader:

- a new Account receives no row and no seat is created;
- an already-approved active learner receives the existing seat idempotently;
- a suspended learner receives no row;
- only the teacher approval command can call the private materializer.

## App-first protection

The API readiness endpoint compares the runtime schema version with `ASA_EXPECTED_SCHEMA_VERSION`.

A new regression test proves:

- image expects schema `134`;
- database reports schema `133`;
- `/health/ready` returns HTTP 503 with `synchronized=false`.

`pnpm compose:check` passes and verifies the expected schema value is preserved through supported compose/release profiles.

## Hidden-contract scan

All E1 `REVOKE ... FROM asalab_app` statements in migrations `0107`–`0134` were scanned.

No remaining revoked helper is called directly from `apps/`. The additional revoked functions are internal SQL helpers consumed through SECURITY DEFINER product commands/readers. The two rollout-sensitive external contracts were the project submission signature and Account join flow addressed above.

## Evidence

- fresh database: 133 migrations applied, migration container exit 0;
- all 25 workspace projects built successfully;
- direct project / Account admission + mixed-data upgrade: 17/17 PASS;
- health + classroom join API unit tests: 18/18 PASS;
- `pnpm compose:check`: PASS;
- `pnpm db:migrate:check`: PASS.

## Constraints

This bridge is intentionally temporary.

- Do not deploy the new application before the database bridge chain.
- Do not revoke the four-argument submit signature during the same rollout.
- Do not restore immediate Account admission for compatibility.
- Cleanup of legacy signatures belongs to a later migration after old API instances are verified drained.

## Verdict

POST_STEP_REVIEW: PASS

CHALLENGE_REVIEW: PASS

The DB/API rollout-compatibility blocker is closed for E1 implementation. This does not mark E1 complete; remaining product acceptance gaps are handled separately.
