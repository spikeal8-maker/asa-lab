# LRN-M1-005 — Audience Report

**Task:** `LRN-M1-005 — Audience: Whole Class + Named Learners`
**Baseline:** `4c729bcea80d077f23e98dc8bfd0833dd2127c16`
**Result:** evidence-complete locally; publication evidence is recorded in the
task handoff after the exact GitHub SHA completes required workflows.

## AUDIENCE MODEL

Migration `0095_learning_audiences.sql` adds one canonical model shared by
CourseRun and direct ActivityRun: immutable audience definitions, durable
operations, end-dated named members, and membership claims. There is no quiz,
project, course, or activity-specific audience engine.

## TARGET KINDS

- `course_run` targets one `classroom_course_runs.id` and materializes
  `course_enrollments`.
- `activity_run` targets one direct `activity_runs.id` and materializes
  `activity_participations`.
- Target columns are mutually exclusive. One target has at most one canonical
  audience. One audience cannot span classrooms.

## WHOLE-CLASS DYNAMIC

`whole_class` is valid only with `dynamic`. Initial membership is the exact
current assignment-eligible classroom roster, deduplicated by
`learner_identities.id`. A durable trigger on `classroom_student_seats` covers
all current seat/join/link writers and materializes later eligible learners.

## NAMED SNAPSHOT

`named_learners` is valid only with `snapshot`. Members store exact
`learner_identities.id`, not seat/account/principal/display data. Later class
joins do not change the snapshot. Add/remove is an explicit guarded operation;
removal end-dates evidence and re-add after withdrawal returns
`rejoin_requires_explicit_policy`.

## INITIAL MATERIALIZATION

Audience definition, initial operation, named members, assigned target rows,
claims, and audit evidence commit in one transaction. Invalid named input
leaves no audience or partial membership. Retry with the same semantic digest
returns the same audience.

## NEW LEARNER SYNC

An `issued` or `active` seat event resolves/reuses one school-scoped stable
LearnerIdentity and performs set-based sync across every active whole-class
audience in that classroom. Operation and membership uniqueness suppress
duplicate rows and duplicate audit noise across issue, activation, account
link, retry, and concurrent delivery.

## LEARNER LEAVE

When the last eligible seat for the logical learner leaves the classroom,
audience-owned CourseEnrollment/ActivityParticipation rows become `withdrawn`
with source `classroom_membership_ended`. Rows, claims, identity, operation, and
audit history remain. Independent manual memberships remain assigned/active.

## REJOIN POLICY

No withdrawn row is reactivated and no duplicate is created. Re-entry records
the deterministic result `rejoin_requires_explicit_policy`. A new Run or a
future separately approved rejoin policy is required.

## COURSEENROLLMENT MATERIALIZATION

CourseRun audience creates/reuses exactly one CourseEnrollment per stable
learner with status `assigned` and audience source
`whole_class_dynamic|named_snapshot`. It creates no child ActivityRun or
ActivityParticipation.

## ACTIVITYPARTICIPATION MATERIALIZATION

Direct ActivityRun audience creates/reuses exactly one ActivityParticipation
per stable learner with status `assigned`. It creates no Attempt, Submission,
AssessmentResult, or Gradebook row. Future `opens_at` does not block assignment;
closed/cancelled/archived targets do.

## COURSE ACTIVITY INHERITANCE BOUNDARY

A course-sourced ActivityRun rejects an independent audience with
`course_activity_inherits_course_audience`. CourseEnrollment-to-child
materialization remains `LRN-M1-009`; M1-005 does not pre-implement it.

## AUDIENCE PROVENANCE

`learning_audience_membership_claims` links the exact audience, learner,
materialization operation, and CourseEnrollment or ActivityParticipation.
Audience-generated target rows use server-selected canonical sources. Clients
cannot submit tenant, school, classroom, assignment source, or withdrawal
source values.

## MANUAL/AUDIENCE OVERLAP

If a teacher assignment already satisfies the target membership, the audience
records an `independent` claim without rewriting `teacher_command` provenance.
Named removal or classroom leave ends the claim but does not withdraw that
manual membership.

## ELIGIBILITY / SEAT STATUS

Assignment eligibility is `issued|active`; access/start eligibility remains
`active`. `suspended|removed` is excluded from new materialization. Multiple
eligible seats for one logical learner remain one membership.

## IDEMPOTENCY

Request IDs are scoped to actor/tenant and bound to a SHA-256 semantic digest.
Same key plus same digest reuses the result; changed semantics returns
`idempotency_conflict`. Operation/request and target membership uniqueness are
enforced in PostgreSQL.

## CONCURRENCY

Transaction advisory locks serialize create-by-request and create-by-target.
DB unique constraints and conflict-safe set inserts guarantee one audience,
one claim, and one target membership. Concurrent named retries and repeated
seat events converge deterministically.

## PARTIAL FAILURE RECOVERY

Creation is atomic, so a failed learner validation or statement rolls back the
definition and materialization together. A same-key retry can then complete.
There is no transient in-memory correctness dependency and no correctness-only
cron.

## AUDIT

The existing append-only `audit_events` stream records `audience.created`,
`audience.named_member_added`, `audience.named_member_removed`,
`audience.dynamic_learner_materialized`, and `audience.learner_withdrawn` with
audience, learner, operation, target/membership, ownership, and seat provenance.
Idempotent retries do not duplicate events.

## PERFORMANCE

Final focused evidence on local isolated PostgreSQL:

- 30 learners -> one direct whole-class target: `15.4 ms`, 30 rows, one client
  statement for the measured audience operation;
- one new learner -> 100 active direct targets: `31.5 ms`, 100 rows, one client
  statement for the measured seat operation.

Both paths are set-based and below the 5,000 ms acceptance ceiling. Timing is
environment evidence, not a production SLA.

## RLS/SECURITY

All four new tables use forced RLS and grant no broad `asalab_app` CRUD.
Guarded SECURITY DEFINER commands derive tenant/school/classroom and require an
Account Principal with owner/co-teacher membership. Tests reject learner and
outside-teacher mutation, cross-class/cross-school named learners, tenant-context
spoofing, course-child audience, closed targets, direct table writes, internal
sync execution, and unauthorized diagnostics/UUID enumeration.

## MIGRATION

`0095_learning_audiences.sql` is additive. Fresh isolated `asalab_test` apply:
94 migration files applied successfully; immediate guarded repeat: 0 applied.
No historical audience backfill is present or executed. Production application
is not authorized and was not performed.

## OPENAPI

N/A. M1-005 adds guarded database/domain primitives and a database lifecycle
hook only. It adds no HTTP endpoint, DTO, UI reader, or undocumented API.

## REQUIREMENT STATUS

- **AUD-201 STATUS:** `in_progress`; whole-class and named learners are proven,
  ClassroomGroup remains M1-006.
- **AUD-202 STATUS:** `in_progress`; whole-class dynamic and named snapshot are
  proven, group dynamic remains M1-006.
- **AUD-203 STATUS:** `proven`; a new eligible learner is materialized exactly
  once for active whole-class CourseRun/direct ActivityRun targets.
- **AUD-204 STATUS:** `in_progress`; leave withdrawal/history is proven, but
  started Attempt continuation remains M2.
- **AUD-205 STATUS:** `in_progress`; independent claim preservation is proven,
  while group-removal and active-Attempt semantics remain future scope.
- **AUD-206 STATUS:** `proven`; named mutations are explicit, audited,
  idempotent, end-dated, and deterministic.
- **ARCH-001 STATUS:** `in_progress`; common Attempt ownership is not cut over.
- **ARCH-002 STATUS:** `in_progress`; ClassroomGroup, course-child
  materialization, and executable-path cutover remain incomplete.
- **IDN-003 STATUS:** `in_progress`; enrollment/participation use stable learner
  identity, while Attempt/Result ownership remains incomplete.

## ACCEPTANCE EVIDENCE MAP

| # | Required scenario | Exact evidence |
| ---: | --- | --- |
| 1-2 | direct whole class; initial materialization | focused test `materializes direct whole-class learners set-wise...` |
| 3-5 | CourseRun whole class; enrollments only; no children | focused test `materializes CourseEnrollment only...` |
| 6 | named direct exact set | focused test `keeps named snapshot exact...` |
| 7 | named CourseRun exact set | the same focused test, CourseRun assertion |
| 8 | named ignores later join | the same focused test, later unrelated learner assertion |
| 9-10 | dynamic late join once; repeated events | CourseRun dynamic test with concurrent activation and account update |
| 11 | duplicate seats/links deduplicate | concurrent-create/duplicate-logical-seat test |
| 12-13 | issued included; suspended/removed excluded | direct whole-class test |
| 14-16 | closed Activity/Course rejected; future opens allowed | security test plus direct whole-class future-open fixture |
| 17-18 | assigned status; course child rejected | direct/CourseRun tests plus security test |
| 19-22 | one audience, immutability, invalid mode pairs | target/type/mode/idempotency test |
| 23-24 | named add/remove audited | named snapshot test |
| 25-27 | manual not stolen; manual survives; owned withdraws | manual-overlap and named snapshot tests |
| 28-30 | class leave withdraws/preserves; rejoin rejected | direct and CourseRun leave/rejoin assertions |
| 31 | no Attempts/Results/Gradebook | exact ActivityRun assignment-lineage counts in direct whole-class test |
| 32 | concurrent audience create | concurrent-create test |
| 33 | concurrent/repeated dynamic sync | concurrent seat activation plus uniqueness/audit assertions |
| 34 | partial failure retry | invalid named atomic rollback followed by valid same-key create |
| 35-38 | cross-school/outside/learner/table CRUD security | focused security negative matrix |
| 39-40 | 30 learners; one learner/100 targets | focused performance test |
| 41 | M1-001 regression | `pnpm test:learning-m1-001`: 15/15 |
| 42 | M1-002 regression | `pnpm test:learning-m1-002`: 15/15 |
| 43 | M1-003 regression | `pnpm test:learning-m1-003`: 15/15 |
| 44 | M1-004 regression | `pnpm test:learning-m1-004`: 10/10 |
| 45 | M0 canonical regressions | canonical adapters/projection/surface suites: 12/12 |
| 46 | fresh migration apply | isolated reset plus 94 migrations applied |
| 47 | migration repeat | immediate guarded repeat: 0 migrations applied |

Relevant classroom join controller tests also pass 6/6. Focused M1-005 passes
8/8 after all suites share the same isolated database.

## KNOWN GAPS

ClassroomGroup/dynamic groups (M1-006), effective settings (M1-007), multi-class
bulk (M1-008), course-child materialization (M1-009), Attempt continuation and
teacher invalidation (M2), API/UI commands, and any historical audience
backfill are intentionally absent. No evidence in this report claims them.

## PRODUCTION STATUS

Not deployed. No production migration, backfill, restart, feature flag, or
runtime mutation was performed or authorized.

## NEXT READY TASK

`LRN-M1-006 — ClassroomGroup` is the next queue item, but it is **not active**
and must not begin without a separate owner authorization.
