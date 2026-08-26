# LRN-VS-001 — Teacher Assigns Activity

**Task:** `LRN-VS-001 — Teacher Assigns Activity`  
**Milestone:** `Product-first visible slice`  
**Status:** ACTIVE  
**Baseline SHA:** `7bf948eef395fc8bc3ad6edb0fdd25a809217433`  
**Issue:** `#165`

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
