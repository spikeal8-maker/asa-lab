# LRN-M0-003 — CURRENT Status Divergence Report

**Outcome:** `PROVEN`  
**Baseline SHA:** `57a3dfa3dd392253d2c0c7b4e20f9411bf2fedcb`  
**Governance activation SHA:** `e17d406`  
**Scope:** CURRENT code, schema, existing tests and non-mutating local data
diagnostics. No TARGET LearnerIdentity runtime exists.

## Conclusion

The observed contradiction is proven for one CURRENT local development data
pair with the same `seat_id`, `classroom_assignment_id` and classroom:

```text
Surface A calls classroom_assignments_for_seat(seat_id)
→ reads classroom_assignment_work.submitted_at
→ submitted_at is non-null
→ learner UI renders "Сдано"

Surface B calls classroom_gradebook_list(account_id, classroom_id)
→ searches learning_attempts by the same assignment_id + seat_id
→ no Attempt exists
→ API fallback maps NULL attempt_state to not_started
→ Gradebook UI renders "Не начинал"

Cause = a legacy submitted flag exists without canonical Attempt/Submission
evidence, while the two readers have no shared status resolver.
```

The read-only aggregate diagnostic found exactly one such pair. Direct calls of
both reader functions for that pair returned `submitted_at IS NOT NULL` on the
legacy reader and `attempt_id IS NULL` on the Gradebook reader. The row is a
direct project assignment, belongs to an active email-free seat with a seat
Principal, and is visible to both learner and teacher projections. No UUID,
label, credential or personal content was emitted.

## Evidence boundary

- Repository evidence is from the baseline descendant used by draft PR #141.
- Local runtime `/health/ready` reported schema version 85 and deployment
  revision `241574df17c70dbe1dfdd800c5a38b3186bea05a`.
- `asalab_dev` diagnostics used `BEGIN READ ONLY` and `ROLLBACK`.
- Existing integration tests used only the isolated `asalab_test` database.
  `pnpm db:test:provision` brought that test database to the repository schema;
  it did not mutate `asalab_dev` or production.
- This is local CURRENT evidence, not production population evidence.

## ROOT CAUSE

Migration `0033_classroom_assignments.sql` introduced mutable
`classroom_assignment_work.submitted_at` and the still-present
`classroom_assignment_work_submit` function. Migration
`0077_learning_assessment_foundation.sql` introduced immutable Attempt and
Submission evidence and explicitly demoted the legacy timestamp to a
compatibility write. It did not backfill pre-existing submitted rows and did not
replace the legacy readers.

CURRENT therefore has no single status authority:

1. legacy assignment, course, roster, progress and review-count readers use
   `classroom_assignment_work.submitted_at`;
2. Gradebook uses the latest `learning_attempts` row for workflow and a mutable
   `gradebook_entries` pointer for the published result;
3. quiz surfaces use their latest Attempt/Result chain;
4. learner results exist only when a Gradebook pointer exists and the seat is
   active.

The live mismatch is a historical legacy-only row. The repository contains no
safe rule that can derive its exact frozen ProjectVersion, Submission digest,
request id or Attempt number from `submitted_at` alone.

## STATE SOURCE A

`classroom_assignment_work.submitted_at` is source A.

- Learner endpoint: `GET /api/class-join/me/assignments` calls
  `classroom_assignments_for_seat(seat_id)` in
  `apps/api/src/classroom-join.controller.ts`.
- Linked-account endpoint: `GET /api/class-join/account/assignments` calls
  `classroom_assignments_for_account(account_id)`, which delegates per active
  seat to `classroom_assignments_for_seat`.
- Teacher progress endpoint:
  `GET /api/classrooms/{classroomId}/assignments/{assignmentId}/progress` calls
  `classroom_assignment_progress`.
- Learner UI `SeatAssignments` and `AttendedClassesPage` render non-null
  `submittedAt` as `Сдано` and enable the `На проверке` label.
- Teacher UI `ClassroomAssignments` and `ClassroomCourses` render non-null
  `submittedAt` as `Сдано`.
- Legacy `awaiting_review` is true when `submitted_at IS NOT NULL` and no
  `project_feedback.updated_at >= submitted_at` exists. It feeds
  `/api/classrooms/awaiting-review`, class progress/roster and the individual
  learner page.

## STATE SOURCE B

The latest `learning_attempts` row is workflow source B; the mutable
`gradebook_entries` row selects the published `assessment_results` row.

- Endpoint: `GET /api/classrooms/{classroomId}/gradebook` calls
  `classroom_gradebook_list(account_id, classroom_id)`.
- SQL chooses the latest Attempt by descending `attempt_number` for each
  `(classroom_assignment_id, seat_id)`.
- If no Attempt exists, the controller maps null `attempt_state` to
  `not_started`.
- `ClassroomGradebook` renders `not_started` as `Не начинал` and `evaluating`
  as `Ждёт проверки`.
- Result fields do not come from the latest Attempt directly. They come from
  `gradebook_entries.assessment_result_id` joined to `assessment_results`.

## WHY THEY DIVERGE

The legacy write and canonical write are synchronized only by supported new
project submission/review functions, not by a constraint or shared resolver:

- `learning_project_submission_create` atomically creates a frozen
  ProjectVersion, Attempt, Submission and needs-review Evaluation, then writes
  the compatibility timestamp.
- `learning_attempt_review(..., 'changes_requested', ...)` retains immutable
  Attempt/Submission/Evaluation evidence but clears the compatibility
  timestamp.
- `classroom_assignment_work_submit` remains executable by the runtime role and
  can change the legacy timestamp without creating any Attempt or Submission;
  no CURRENT controller calls it.
- pre-0077 submitted rows were not backfilled by migration 0077.
- no database constraint requires equivalence between the two families.

Thus each surface is internally deterministic, but their source families are
not equivalent.

## Exact surface map

| Surface / UI state | Endpoint | SQL reader | Table/field source | Condition | Conflict winner |
|---|---|---|---|---|---|
| Learner direct assignment: `Не начато` | `/api/class-join/me/assignments` or `/account/assignments` | `classroom_assignments_for_seat` / `_for_account` | work left join | no `project_id`, no `submitted_at` | legacy work row |
| Learner direct assignment: `В работе` | same | same | `classroom_assignment_work.project_id` | project exists, `submitted_at` null | `submitted_at` first, then `project_id` |
| Learner direct assignment: `Сдано` / `На проверке` | same | same | `classroom_assignment_work.submitted_at` | non-null | legacy timestamp overrides project state |
| Teacher assignment/course progress: `Не открывал` | assignment progress endpoint | `classroom_assignment_progress` | work left join | no `started_at` and no `submitted_at` | legacy work row |
| Teacher assignment/course progress: working | same | same | `started_at` | non-null, submitted null | submitted first, then started |
| Teacher assignment/course progress: submitted | same | same | `submitted_at` | non-null | legacy timestamp |
| Legacy waiting-review badges | `/api/classrooms/awaiting-review`, class progress/roster/student | `classroom_awaiting_review_total`, `classroom_management_roster`, `classroom_seat_projects` | work timestamp + feedback timestamp | submitted and no feedback at/after submission | legacy timestamps |
| Gradebook: `not_started` | `/api/classrooms/{id}/gradebook` | `classroom_gradebook_list` | latest Attempt left join | no Attempt; controller fallback | absence of Attempt |
| Gradebook: submitted/waiting/reviewed | same | same | latest `learning_attempts.state` | exact Attempt state; CURRENT project submit creates `evaluating` | latest attempt number |
| Gradebook result | same | same | `gradebook_entries.assessment_result_id` | pointer exists | mutable Gradebook pointer, not arbitrary/latest Result |
| Learner quiz state/result | `/api/class-join/me/quizzes` or `/account/quizzes` | `quiz_assignments_for_seat` / `_for_account` | latest Attempt + Result for that Attempt | no Attempt yields null latest state/result; submit creates accepted/result | latest Attempt |
| Learner published results | `/api/class-join/me/results` or `/account/results` | `learning_results_for_seat` / `_for_account` | Gradebook pointer | pointer exists and seat active | Gradebook selection only |
| Learner course practice | `/api/class-join/me/course-runs` or `/account/course-runs` | `classroom_course_runs_for_seat_v2` / `_for_account_v2` | course lesson + legacy work | assignment lesson uses project/submitted timestamps | legacy work timestamp |
| Teacher course aggregate | `/api/classrooms/{id}/course-runs` | `classroom_course_runs_for_teacher_v2` | counts over legacy work | submitted count means non-null legacy timestamp | legacy work timestamp |

There is no CURRENT enum value named `waiting_review`. The visible legacy
waiting condition is a derived boolean; the Gradebook equivalent label is
rendered from Attempt state `evaluating`. The TARGET Master Spec names the
canonical state `waiting_review`, but TARGET is not reported as CURRENT.

## Three CURRENT state families

### 1. Legacy classroom work

Direct teacher assignments materialize `classroom_assignments.assignment_id`
and optionally a `classroom_assignment_work` row per seat. Status is derived
from `project_id`, `started_at`, `submitted_at` and feedback time. It does not
join Attempt, Submission, Result or Gradebook.

### 2. Course runtime

Assigning a course creates `classroom_course_runs` and, for every practice
lesson, a `classroom_assignments` row with `course_run_id` and
`assignment_id IS NULL`. Course learner/teacher projections read the same
legacy work fields as direct projects. `learning_project_submission_create`
accepts both direct and course-generated assignments and lazily creates the
activity-version mapping, but no migration constraint forces older course work
through that function.

### 3. Assessment runtime

Project submission creates an Attempt/Submission and needs-review Evaluation;
teacher acceptance creates AssessmentResult and upserts the Gradebook pointer.
Quiz assignment creates a `classroom_assignments` row with `quiz_version_id`,
pre-maps an ActivityVersion, and quiz submission atomically creates Attempt,
Submission, Evaluation, AssessmentResult and Gradebook selection. Quiz does not
create `classroom_assignment_work`.

## Required scenario results

| Scenario | Result | Exact finding |
|---|---|---|
| Direct project assignment | `PROVEN` | Local dev has one legacy submitted row with no Attempt. Legacy reader returns submitted; Gradebook reader returns no Attempt and API maps it to `not_started`. |
| Course-generated assignment | traced; no local conflicting row | It has `course_run_id`, no teacher assignment id, and course surfaces read legacy work. New submissions share `learning_project_submission_create`; existing course test proves handout materialization and course readers. |
| Direct quiz | no legacy conflict in supported path | Quiz surface and Gradebook both use Attempt/Result. Submission creates the full assessment chain and no legacy work row. Existing integration test proves this. |
| Learner result read model | pointer-gated | `learning_results_for_seat` starts at `gradebook_entries`; a Result without the selected pointer is invisible. Seat must be active. |
| Gradebook read model | mixed source | Latest Attempt supplies workflow; Gradebook pointer supplies result. Missing Attempt maps to `not_started`. |
| Legacy `submitted_at`, no Attempt | `PROVEN`, count 1 in local dev | Exact root-cause pair; direct project, active email-free seat, seat Principal present, both projections visible. |
| Attempt/Submission, legacy flag absent | deterministic supported transition | `changes_requested` clears legacy timestamp while immutable Attempt/Submission remain. Legacy learner surface becomes `В работе`; Gradebook remains `На доработке`. Local dev count is 0. |
| Result exists, Gradebook pointer absent | not present in local dev | Current project-review and quiz-submit functions insert Result and pointer in one transaction. A manually/historically unselected Result would be absent from learner results. Runtime role has no direct table DML grant. |
| Result exists, pointer selects another Result | supported selection shape | Every accepted later attempt upserts the one Gradebook row, so old immutable Results remain history while readers select the pointer. Local dev count is 0; this is selection semantics, not fabricated evidence. |
| Suspended seat with history | visibility divergence by definition | Teacher Gradebook includes `seat.status <> 'removed'`, so suspended is visible. Learner assignments/quizzes/courses/results require active seat, so suspended is hidden from learner surfaces. Local dev has 0 such Gradebook rows. |
| Removed seat with history | hidden from both current primary reads | Teacher Gradebook and progress exclude removed; learner result requires active. Historical rows remain in tables but disappear from these projections. Local dev has 0 such Gradebook rows. |

## Identity provenance used for CURRENT trace

No `learner_identities` table was queried or assumed. The conflict pair is
owned in CURRENT by `learning_attempts.seat_id` when an Attempt exists, and by
`classroom_assignment_work.seat_id` for the legacy-only row. The seat resolves
to its classroom/tenant and to a seat Principal used for Project ownership. Its
`account_id` is null, so an Account-based key cannot reconstruct this history.
This matches accepted ADR option B without implementing it.

## AFFECTED SURFACES

- learner Learning page and seat class page (`SeatAssignments`);
- linked-account attended classes assignment list;
- teacher direct-assignment progress;
- teacher course lesson progress and course aggregate counts;
- teacher dashboard/roster/student waiting-review badges;
- teacher Gradebook workflow cells;
- learner Results visibility when selection or seat status differs.

Quiz cards are not affected by the proven legacy-only row because they do not
read `classroom_assignment_work`. They remain affected by future resolver
convergence because their state names and result selection still form a
separate projection.

## AFFECTED DATA SHAPES

- `(classroom_assignment_id, seat_id)` legacy work pair;
- optional `classroom_activity_versions` mapping;
- immutable `learning_attempts` and `learning_submissions` lineage;
- immutable `learning_evaluations` and `assessment_results` evidence;
- mutable one-row `(classroom_assignment_id, seat_id)` Gradebook selection;
- course lesson mapping via `classroom_course_run_lessons`;
- quiz mapping via `quiz_version_id` and ActivityVersion;
- current identity provenance via seat, optional Account and Principal;
- seat lifecycle state controlling projection visibility.

## Source precedence under conflict

There is no repository-wide winner. Each surface wins locally:

1. assignment/course/legacy review surfaces: legacy timestamp wins;
2. Gradebook workflow: latest Attempt wins; no Attempt becomes `not_started`;
3. Gradebook/learner result: Gradebook pointer wins over other Results;
4. quiz card: latest Attempt and its Result win;
5. lifecycle visibility: active-only learner filters and non-removed teacher
   filters can override the existence of historical evidence.

## CAN BE AUTO-RECONCILED: partially

The analyzer can deterministically classify pairs and can preserve already
complete assessment chains. It cannot convert the proven legacy-only timestamp
into a canonical submitted Attempt automatically: exact ProjectVersion,
Submission digest, request id and immutable submission time/evidence are not
all proven. Per `MIG-003`, that row must be reported as `legacy_unresolved`, not
fabricated. Selection-pointer mismatches can be classified automatically, but
choosing a winner requires the M0-004 resolver contract.

## RISKS FOR M0-004

- A resolver must accept stable logical learner identity as TARGET while still
  resolving CURRENT seat provenance during compatibility.
- It must define separate workflow, selected result and flags; one enum cannot
  encode legacy waiting, Attempt state, result selection and visibility.
- It must define precedence for legacy-only, changes-requested, unselected
  Result, suspended and removed-seat cases.
- It must cover direct projects, course practices and quizzes without separate
  runtime resolvers.
- It must not treat `project_feedback` as a school grade or rewrite Project
  Principal ownership.
- It must define whether historical teacher access can see removed-seat results
  without granting the learner current access.

## RISKS FOR M0-005

- The local dev population proves at least one `legacy_unresolved` submission.
- Dry-run must report direct/course/quiz kind, seat/account/principal provenance,
  exact ProjectVersion recoverability and selected-result consistency.
- Backfill must never infer immutable evidence from `submitted_at` alone.
- Repeated analysis must be read-only and idempotent.
- Removed/suspended rows must be counted even when current UI readers hide them.
- Result-without-pointer and pointer-to-other-result require separate counts;
  they are not the same error.
- Production population remains unknown until the separately authorized dry-run
  is executed in its permitted environment.

## API contract observation

The traced runtime endpoints exist in controllers and web clients, but none of
the searched learning/classroom paths above is present in
`schemas/openapi.yaml`. M0-003 records this fact only. OpenAPI convergence is
explicitly outside this task.

## Diagnostic and test evidence

Read-only `asalab_dev` aggregate:

```text
legacy_submitted_without_attempt=1
submission_without_legacy_submitted=0
project_submission_without_legacy_submitted=0
result_without_grade_pointer=0
historical_result_not_selected=0
grade_rows_suspended_seat=0
grade_rows_removed_seat=0
latest_changes_requested=0
```

Exact reader comparison for the one mismatch pair:

```text
mismatch_pairs=1
learner_function_submitted=1
gradebook_function_no_attempt=1
exact_conflict=1
```

Existing isolated PostgreSQL fixtures after successful provisioning:

```text
direct_project: Attempt=1 Submission=1 Evaluation=1 Result=1 Gradebook=1 legacy_flag=1
quiz:           Attempt=1 Submission=1 Evaluation=1 Result=1 Gradebook=1 legacy_flag=0
```

Commands and outcomes:

```text
pnpm db:test:provision
→ PASS; 23 pending migrations applied only to asalab_test

pnpm exec vitest run tests/courses/learning-assessment.pg.spec.ts tests/courses/quiz-engine.pg.spec.ts
→ PASS; 2 files, 2 tests

pnpm exec vitest run tests/courses/course-outline.pg.spec.ts
→ PASS; 1 file, 4 tests

pnpm exec vitest run apps/api/src/learning-assessments.controller.spec.ts apps/api/src/courses.controller.spec.ts
→ PASS; 2 files, 16 tests

pnpm exec vitest run apps/api/src/classroom-join.controller.spec.ts
→ PASS after cached dependency builds; 1 file, 6 tests
```

Preliminary setup runs are not hidden: the first focused PostgreSQL run failed
before collection because the identity build artifact was absent; after that
artifact was restored, the second run failed because `asalab_test` had not yet
received migrations 0077/0083. Provisioning the isolated test database resolved
the setup drift and the unchanged tests passed.

## Remaining unknowns

- Production counts and exact affected records are unknown; no production data
  diagnostic was authorized or performed.
- The recoverability of the one local legacy-only ProjectVersion is unresolved
  until M0-005 dry-run evidence.
- Exact canonical precedence and DTO are intentionally unresolved until
  owner-authorized M0-004.
- Stable LearnerIdentity mapping is accepted TARGET architecture but is not
  CURRENT runtime.

## Task boundary

This report proves `MIG-001` investigation evidence but does not resolve or
migrate the contradiction, so `MIG-001` remains `in_progress`. It documents the
`MIG-005` target boundary but does not implement it. No migration, backfill,
resolver, OpenAPI, runtime, UI, LearnerIdentity or Gradebook change is included.
