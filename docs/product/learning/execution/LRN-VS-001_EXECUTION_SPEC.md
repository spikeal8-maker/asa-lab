# LRN-VS-001 — Teacher Assigns Activity

**Task:** `LRN-VS-001 — Teacher Assigns Activity`
**Milestone:** `Product-first visible slice`
**Status:** DONE — owner accepted 2026-08-26; merged in PR #166
**Baseline SHA:** `7bf948eef395fc8bc3ad6edb0fdd25a809217433`
**Issue:** `#165`
**Merge SHA:** `ac465ecd0c73cab216bbd4a27e6f1527fc130646`

## Goal

В существующей вкладке класса преподаватель выбирает опубликованную canonical
LearningActivity, адресует её всему классу или конкретным ученикам и задаёт
срок; адресаты видят это задание в существующем learner interface.

## Reused contracts

`LearningActivityVersion -> classroom_assignments compatibility handout ->
ActivityRun -> Audience -> ActivityParticipation -> LearnerIdentity`.
Существующие roster, teacher assignment list и seat/account assignment surfaces
остаются UI/read entry points; новой assignment-системы не создаётся.

## Changes

- `0096_learning_direct_assignment.sql`: одна idempotent/atomic direct-assignment
  command и audience-aware legacy compatibility reads;
- classroom API + OpenAPI: activity picker and assign command;
- compact teacher dialog and existing learner cards;
- focused PostgreSQL/controller/UI tests and two real Playwright journeys.

## Non-goals

ClassroomGroup, M1-006, multi-class, settings inspector, Course materialization,
Gradebook, Attempt/Submission, quiz delivery and production deployment.

## Transaction, authorization, rollback

Handout, ActivityRun and Audience materialization commit in one database
transaction through one SECURITY DEFINER command guarded by teacher membership,
tenant/school lineage, activity ownership and idempotency request digest.
Named requests accept current classroom seat IDs and resolve them to stable
LearnerIdentity inside the command. Invalid/cross-class inputs write nothing.
Rollback is code rollback before production deployment; migration is additive
and legacy rows without an ActivityRun keep their current visibility.

## Acceptance evidence required

- whole class: teacher assigns, learner sees `Не начато`, due date and `Открыть`,
  teacher sees the assigned row;
- named: exactly two selected learners see the row and a third does not;
- fresh migrations + repeat 0, security negatives, focused tests;
- Playwright screenshots for teacher and learner surfaces;
- one uncached `pnpm gate:repository` immediately before merge.

## Acceptance evidence

- Playwright: 2/2 required journeys passed, including whole-class delivery and
  exact two-of-three named delivery;
- focused API/PostgreSQL: 7/7 tests passed; M1-001..005 regression coverage is
  included in the full repository run;
- migrations: all 95 migrations applied to fresh `asalab_test`, immediate
  repeat applied 0;
- uncached repository gate: 177/177 test files and 1235/1235 tests passed, plus
  15/15 RLS checks; Nx lint, typecheck and build reported cache skipped;
- GitHub main workflow on the PR head: Governance, Code and PostgreSQL/RLS
  passed. The unrelated 3D browser job was not changed or used as Learning
  evidence.
