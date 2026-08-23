# LRN-M0 CURRENT Learning Architecture

**Task:** `LRN-M0-001`  
**Status:** `EVIDENCE COMPLETE — FINAL GATES PENDING`  
**Evidence baseline:** `origin/main@cf43a359eb6c99b5dfdd5f30623cfa5e2a5a46ef`  
**Owner activation:** `main@374c54f59d72abbfae143b445aa32ede643437da`  
**Audit date:** `2026-08-24`  
**Scope:** CURRENT implementation evidence only. The package Master Spec is TARGET and is not evidence of shipped behavior.

## Executive finding

ASA Lab already contains substantial but non-converged learning functionality: course authoring and immutable publishing, classroom course copies, direct project assignments, versioned quizzes with automatic grading, immutable submission evidence, teacher review, learner-visible results and a class gradebook. It is not yet the TARGET canonical ASA Learning runtime.

Three independent state families coexist:

1. legacy classroom work (`classroom_assignments`, `classroom_assignment_work.submitted_at`);
2. course runtime (`classroom_course_runs`, frozen run lessons, lesson progress, generated classroom assignments);
3. assessment runtime (`learning_attempts`, submissions/evaluations/results, quiz-specific answer rows, mutable gradebook selection).

The repository control plane does not activate ASA Learning. `docs/execution/current.yaml` activates Admin/Auth work, `next_task` is null, and the project map still labels the general Learning Content, Assignments and Assessment contexts as planned. Meanwhile the code and migrations implement those capabilities. This is proven governance/documentation divergence, not permission to choose a replacement architecture.

## 1. Control-plane state

| Evidence | CURRENT fact |
|---|---|
| `docs/execution/current.yaml` | Primary `task.id=TASK-ADMIN-AUTH-STABILITY-001` remains `in_progress`; parallel lane `learning` activates wrapper `TASK-LEARNING-M0-001` for `LRN-M0-001`. |
| GitHub Issue #135 | Owner-activated Admin/Auth/MAX scope, not ASA Learning. |
| `pnpm control-plane:check` | PASS after activation; primary task remains Admin/Auth, lane list includes `learning`, and `blocking=0`. |
| `docs/project-map/project-map.yaml` | Before activation `CTX-CONTENT`, `CTX-ACTIVITIES`, `CTX-ASSESSMENT` were `planned` despite implemented code/schema; activation commit changes only these factual statuses/summaries and adds the M0 task/phase nodes. |
| `docs/testing/active-task-tests.yaml` | Only Admin/Auth/MAX gates are active; no M0 learning test profile. |

Conclusion: the owner transition makes `LRN-M0-001` executable without
replacing Admin/Auth. It does not activate `LRN-M0-002` or any M1-M7 work.

## 2. Entity and source-of-truth map

| Entity / concern | CURRENT table(s) | CURRENT API / code | UI surface | CURRENT source of truth | Legacy/new | Known divergence from TARGET | Reuse candidate | Migration risk |
|---|---|---|---|---|---|---|---|---|
| Account learner | `classroom_student_seats.account_id` added by `0050_account_learners.sql` | `/api/class-join/account/*`; `classroom_account_seats(account_id)` | `AttendedClassesPage`, account mode of learner components | Seat row linked to Account | newer link over email-free seat | One Account can reach seats, but no decided stable logical learner key across historical seats/schools | Account/seat link and existing queries | High: merging identity keys could orphan or duplicate history |
| Email-free StudentSeat | `classroom_student_seats`, `classroom_student_sessions` (`0021`) | `/api/class-join/studentseat`, `/me`; `SeatContextUseCase` | `SeatClassPage` | session resolves seat; seat is class-scoped | established current model | TARGET identity ADR is not decided; seat is currently used directly on Attempt/Gradebook | StudentSeat and session boundary | High: seat removal/status and account linking affect history semantics |
| Principal | `principals(kind, account_id, seat_id)` (`0026`) | `student_seat_principal`, `principal_for_seat`; `SeatContext.principalId` | indirect | lazily-created `Principal(kind=student_seat)` owns learner projects | newer bridge onto Project Core | Current Principal is stable for one seat, not proven as cross-seat logical learner identity | Strong ADR candidate, not selected here | High: lazy creation and seat cardinality must be audited before choosing |
| Classroom membership | `classroom_memberships`, `classroom_student_seats` | `classroom_teacher_access`; classroom controllers | `ClassroomPage`, roster/team tabs | teacher authorization via membership; learner authorization via derived seat/account | established | Teacher membership and learner participation use different structures; TARGET `ActivityParticipation` absent | Reuse classroom and membership authorization | Medium/high for cross-school and co-teacher boundaries |
| Assignment definition | `teacher_assignments`, `assignment_folders` | `/api/assignments`; AssignmentsController | `AssignmentLibraryPage` bank | mutable teacher library row | legacy definition family | Not universally represented by `LearningActivityVersion`; lazily converted only on project submission | Reuse content and media assets | High: edits after handout and snapshot lineage differ by path |
| Direct assignment handout | `classroom_assignments` with exactly one of `assignment_id`, `course_run_id`, `quiz_version_id` | `/api/classrooms/:id/assignments`, course/quiz assign functions | `ClassroomLearning` assignments | handout row plus source-specific FK | shared compatibility hub | It is not a persistent generic `ActivityRun`; direct/course/quiz sources remain discriminated columns | Potential backfill source | Very high: central fan-in used by existing project/quiz/course readers |
| Per-seat project work | `classroom_assignment_work` | learner work/start/submit endpoints | learner assignment/project editor | mutable work row for project link; `submitted_at` compatibility flag | legacy with newer immutable shadow | `submitted_at` is still written/cleared while immutable Attempt chain also exists | Project link and ownership reuse | High: dual write creates status divergence risk |
| ProjectVersion | `project_versions` | Project Core; `learning_project_submission_create` inserts checkpoint | editor/version UI indirectly | immutable project snapshot referenced by learning submission | reused existing core | Good payload evidence, but only project submission path uses it | Strong reuse candidate | Medium: preserve exact historical version IDs |
| Course | `courses`, `course_sections`, `course_lessons` | `/api/courses*`; CoursesController | `CoursesPanel` | mutable authoring rows | newer | Course lessons support `material` or legacy assignment only; no canonical activity reference for quiz/project/essay/file/manual | Authoring shell and sharing | High: public/school/teacher visibility and copied content lineage |
| CourseVersion | `course_versions`, `course_version_media` | publish/catalogue functions | course editor/preview/catalogue | immutable JSON outline snapshot and media | newer | Snapshot is course-specific JSON rather than normalized activity-version graph; hash is `varchar(32)` while learning digests use SHA-256 length 64 | Preserve immutable versions/media | High: published versions must remain replayable |
| CourseRun | `classroom_course_runs`, `classroom_course_run_lessons` | `/api/classrooms/:id/course-runs`; seat/account course-run endpoints | `ClassroomCourses`, `SeatCourses` | frozen copy of CourseVersion outline per classroom | newer parallel runtime | No generic persistent `ActivityRun`; assignment lessons generate `classroom_assignments`, materials use separate completion table | Source for future additive run mapping | Very high: active learner progress and handouts depend on copied rows |
| Material progress | `classroom_course_lesson_progress` | progress-set functions/endpoints | `SeatCourses` | completion row per run/lesson/seat | course-specific runtime | Bypasses Attempt/Submission/Result chain by design | May remain completion projection if TARGET permits | Medium: must not fabricate Attempts for historical completion |
| LearningActivityVersion | `learning_activities`, `learning_activity_versions`, `classroom_activity_versions` (`0077`) | created lazily for project submission; eagerly for quiz | not directly visible | frozen activity version mapped to classroom assignment | newest assessment layer | Kinds differ from TARGET (`open_response`, `composite`; missing essay/file/manual); project definitions are created at first submission, not publication | Core entity likely reusable after spec-led convergence | Very high: lazy creation makes historical/backfill lineage non-uniform |
| Attempt | `learning_attempts` | project submit/review and quiz submit functions | gradebook/result surfaces | one row keyed by classroom assignment + seat + attempt number | newest assessment layer | No `ActivityRun` or `ActivityParticipation`; state includes pedagogical outcomes (`accepted`, `changes_requested`, `incomplete`, `excused`) that TARGET separates from technical Attempt state | Preserve rows as historical evidence | Very high: state reinterpretation must be additive, not destructive |
| Submission | `learning_submissions` | project/quiz submission functions | indirect | immutable row, one per Attempt, payload digest/manifest | newest | One table supports project/quiz by nullable project FKs; quiz payload embeds answers while `attempt_answers` also stores normalized responses | Strong immutable evidence source | High: never synthesize missing historical rows |
| Quiz definition | `question_bank_items`, `question_versions`, `question_answer_keys`, `quiz_versions`, mappings | `/api/classrooms/learning/questions|quizzes` | `ClassroomQuizzes` | immutable question/quiz version tables; keys isolated from learner DTO | newest | `attempt_limit`, time limit and feedback release live on `quiz_versions`; TARGET places runtime policy on ActivityRun and forbids source-specific parallel runtime | Questions, keys, deterministic grader | Very high: policy relocation must preserve old runs |
| Quiz attempt answers | `attempt_answers` | `quiz_submission_create` | `SeatQuizzes` | immutable normalized response and awarded points | newest quiz-specific evidence | Valid subtype evidence, but current submit path directly creates selected gradebook result | Preserve as quiz payload detail | Medium/high: answer-key privacy and release policy are critical |
| Evaluation | `learning_evaluations` | automatic quiz evaluation and teacher review | gradebook review | append-only evaluation rows | newest | Evaluations exist, but selection/revision model is incomplete | Reuse immutable evidence | Medium |
| Assessment result | `assessment_results` | quiz submit and teacher review | `SeatResults`, gradebook | immutable, unique one result per Attempt | newest | TARGET requires append-only `AssessmentResultRevision`; current unique `attempt_id` prevents corrected revisions for same Attempt | Preserve as revision-0 source only after approved design | Very high: correction/history cannot be modeled by update |
| Result selection / gradebook | `gradebook_entries`, `grade_change_events` | class gradebook/review/history endpoints | `ClassroomGradebook` | mutable row selects accepted attempt/result; append-only event snapshots log changes | newest projection | No explicit `ResultSelection`; gradebook row is both selection and projection, keyed by assignment+seat, not activity run/participation | Events and current selected pointer are migration inputs | Very high: changing selection semantics changes visible grades |
| Grading scheme | `grading_scheme_versions`, `classroom_grading_schemes` (`0084`) | grading scheme endpoints/functions | gradebook scale controls | immutable scheme version + mutable class pointer | newest | Class-scoped pointer exists, but target scale/context rules require later validation | Reuse versioned scale | Medium/high across schools and periods |
| Learner result read model | `learning_results_for_seat/account` | `/api/class-join/me|account/results` | `SeatResults` | reads current `gradebook_entries` pointer and assessment result | newest projection | No separate `LearnerResultProjection`; Account history is union of currently active linked seats | Query is evidence for current behavior, not target resolver | High: removed/suspended seats and relinking can hide history |

## 3. Current data lineage by vertical path

### Direct project assignment

```text
teacher_assignments
→ classroom_assignments(assignment_id)
→ classroom_assignment_work(seat_id, project_id, mutable submitted_at)
→ project_versions checkpoint
→ learning_activity_versions created lazily if mapping absent
→ learning_attempts(seat_id, classroom_assignment_id)
→ learning_submissions(project_version_id)
→ learning_evaluations
→ assessment_results (after accepted/incomplete/excused review)
→ gradebook_entries mutable selected pointer
→ grade_change_events
→ classroom gradebook / learner results
```

### Direct quiz

```text
question_bank_items / question_versions / private question_answer_keys
→ quiz_versions (contains attempt/time/release policy)
→ learning_activity_versions
→ classroom_assignments(quiz_version_id)
→ learning_attempts(seat_id, classroom_assignment_id, state=accepted)
→ attempt_answers + learning_submissions(payload kind quiz)
→ learning_evaluations automatic
→ assessment_results
→ gradebook_entries selected pointer + grade_change_events
→ classroom gradebook / learner results
```

### Course

```text
courses + mutable sections/lessons
→ immutable course_versions JSON snapshot
→ classroom_course_runs + frozen classroom_course_run_lessons
→ material lesson: classroom_course_lesson_progress only
→ assignment lesson: generated classroom_assignments(course_run_id)
→ then direct project assignment chain
```

No evidence was found for persistent canonical `ActivityRun`, `ActivityParticipation`, `AssessmentResultRevision`, `ResultSelection`, or `LearnerResultProjection` entities in CURRENT.

## 4. API and OpenAPI convergence

Implemented controllers expose substantial learning behavior:

- course authoring/publish/catalogue/share and classroom course-run endpoints in `courses.controller.ts`;
- question bank, quiz creation/assignment, gradebook, grading scheme, history and review in `learning-assessments.controller.ts`;
- seat/account courses, quizzes, results, progress and submissions in `classroom-join.controller.ts`;
- direct assignment library and classroom handout endpoints in assignments/classrooms controllers.

`schemas/openapi.yaml` at the baseline contains classroom identity/roster/team
and project contracts but omits the following implemented learning endpoint
families. Paths below use OpenAPI parameter notation; controller source uses
NestJS `:parameter` notation.

### Course, sharing and catalogue endpoints absent from OpenAPI

```text
GET|POST   /api/courses
POST       /api/courses/demo
PATCH|DELETE /api/courses/{courseId}
POST       /api/courses/{courseId}/publish
GET        /api/courses/{courseId}/items
PUT        /api/courses/{courseId}/items/{assignmentId}
POST       /api/courses/{courseId}/items/{assignmentId}/move
GET        /api/courses/{courseId}/outline
POST       /api/courses/{courseId}/sections
PATCH      /api/courses/{courseId}/sections/{sectionId}
POST       /api/courses/{courseId}/sections/{sectionId}/move
DELETE     /api/courses/{courseId}/sections/{sectionId}
POST       /api/courses/{courseId}/lessons
PATCH      /api/courses/{courseId}/lessons/{lessonId}
POST       /api/courses/{courseId}/lessons/{lessonId}/move
DELETE     /api/courses/{courseId}/lessons/{lessonId}
GET|POST   /api/classrooms/{classroomId}/course-runs
POST       /api/classrooms/{classroomId}/course-runs/{runId}/status
PUT        /api/sharing/{kind}/{subjectId}/visibility
GET|POST   /api/sharing/{kind}/{subjectId}
DELETE     /api/sharing/{kind}/{subjectId}/{accountId}
GET        /api/catalogue
GET        /api/catalogue/courses/{courseId}
POST       /api/catalogue/{kind}/{subjectId}/take
```

### Assignment-library and classroom-handout endpoints absent from OpenAPI

```text
GET|POST   /api/assignments
PATCH|DELETE /api/assignments/{assignmentId}
PUT|GET    /api/assignments/{assignmentId}/sample
GET|POST   /api/assignments/folders
PATCH|DELETE /api/assignments/folders/{folderId}
PUT        /api/assignments/{assignmentId}/folder
PUT        /api/assignments/{assignmentId}/archived
POST       /api/assignments/{assignmentId}/copy
POST       /api/assignments/{assignmentId}/images
GET        /api/assignments/{assignmentId}/images/{imageId}
GET        /api/assignments/{assignmentId}/classrooms
PUT        /api/assignments/{assignmentId}/classrooms/{classroomId}
GET|POST   /api/classrooms/{classroomId}/assignments
POST       /api/classrooms/{classroomId}/assignments/{assignmentId}/status
DELETE     /api/classrooms/{classroomId}/assignments/{assignmentId}
GET        /api/classrooms/{classroomId}/assignments/{assignmentId}/progress
```

### Quiz, assessment, result and gradebook endpoints absent from OpenAPI

```text
GET|POST   /api/classrooms/learning/questions
GET|POST   /api/classrooms/learning/quizzes
POST       /api/classrooms/{classroomId}/quizzes
GET        /api/classrooms/{classroomId}/gradebook
GET|POST   /api/classrooms/{classroomId}/grading-scheme
GET        /api/classrooms/{classroomId}/gradebook/{assignmentId}/{seatId}/history
POST       /api/classrooms/{classroomId}/attempts/{attemptId}/review
GET        /api/class-join/me/quizzes
POST       /api/class-join/me/quizzes/{assignmentId}/submit
GET        /api/class-join/account/quizzes
GET        /api/class-join/me/results
GET        /api/class-join/account/results
```

### Learner course/work endpoints absent from OpenAPI

```text
GET        /api/class-join/me/assignment-counts
POST       /api/class-join/account
GET        /api/class-join/account/classes
GET        /api/class-join/account/assignments
GET        /api/class-join/account/course-runs
POST       /api/class-join/account/course-runs/{runId}/lessons/{lessonId}/progress
GET        /api/class-join/me/assignments
GET        /api/class-join/me/course-runs
POST       /api/class-join/me/course-runs/{runId}/lessons/{lessonId}/progress
GET        /api/class-join/course-runs/{runId}/lessons/{lessonId}/sample
POST       /api/class-join/me/assignments/{assignmentId}/work
POST       /api/class-join/me/assignments/{assignmentId}/submit
```

Therefore:

```text
CURRENT runtime API exists
CURRENT canonical OpenAPI coverage does not
```

This audit records the gap only. Repair belongs to an activated atomic task and must be delivered with authorization/error/idempotency schemas, not by adding decorative summaries.

## 5. UI surface map

| Actor | Surface | CURRENT purpose |
|---|---|---|
| Teacher author | `AssignmentLibraryPage` tabs: courses/bank/catalogue; `CoursesPanel` | create/edit/publish/share/copy courses and reusable tasks |
| Teacher in class | `ClassroomLearning` tabs: courses/assignments/quizzes; `ClassroomCourses`; `ClassroomQuizzes` | assign published course versions, direct tasks and quizzes |
| Teacher assessment | `ClassroomGradebook` under Classroom `Журнал` | see latest attempts/results, manually review project attempts, configure grade scale, inspect history |
| Account learner | `LearningPage` / `AttendedClassesPage(mode=learning)` | aggregate courses, results and quizzes from linked active seats |
| Seat learner | `SeatClassPage` | open course materials/projects, view results, take quizzes |

The surface exists, but this task performs no browser claim about production behavior. Existing repository PNGs and old E2E artifacts are historical files, not current run evidence.

## 6. Test coverage map

| Layer | Existing evidence | What it proves | What it does not prove |
|---|---|---|---|
| PostgreSQL | `course-outline.pg.spec.ts` | publish/freeze/copy/course-run outline and media behavior | canonical cross-path ActivityRun/Participation convergence |
| PostgreSQL | `learning-assessment.pg.spec.ts` | project snapshot → immutable attempt/submission → teacher result → gradebook path | revisions, selection resolver, cross-seat identity continuity |
| PostgreSQL | `quiz-engine.pg.spec.ts` | answer-key privacy, deterministic grading, grade publication | run-scoped policy, correction revisions, unified course/direct runtime |
| Controller | course, assessment, class-join specs | request validation and current SQL mapping for representative flows | full OpenAPI conformance (learning paths are absent from schema) |
| Browser | `courses-sharing.spec.ts`, `assignment-library.spec.ts` | course authoring/sharing and task library paths in those test fixtures | learner quiz/gradebook end-to-end chain and current production deployment |
| Browser | classroom management/lifecycle specs | class/seat lifecycle and teacher/learner project interaction | multi-school negative matrix and canonical result selection |

There is no active `LRN-M0-001` test catalog entry or focused learning convergence gate in `docs/testing/active-task-tests.yaml`.

## 7. Proven divergences and risks

### P0 — Identity strategy is unresolved

CURRENT has three identifiers with different scopes: Account, class-scoped StudentSeat and seat-scoped Principal. Attempts/results/gradebook use `seat_id`; projects use `principal_id`; Account learner reads union active linked seats. Selecting one as stable learner key requires `ADR-LEARNER-IDENTITY-001`. No new identity table is justified by this audit.

### P0 — No universal delivery runtime

`classroom_assignments` is a three-way source switch, course materials have their own progress runtime, and quizzes/direct projects bind Attempt directly to assignment+seat. TARGET's generic `ActivityRun`/`ActivityParticipation` chain does not exist.

### P0 — Result history is not TARGET revision/selection

`assessment_results` is immutable but unique per Attempt. `gradebook_entries` mutably points at a selected Attempt/result and `grade_change_events` logs snapshots. This is not an append-only result revision plus explicit selection model.

### P0 — Dual status facts exist

Project submission writes immutable Attempt/Submission evidence and also updates `classroom_assignment_work.submitted_at`; requesting changes clears the legacy timestamp. Course material completion is a third state mechanism. M0-003 must reproduce exact contradictions before any resolver is designed.

### P1 — Quiz runtime policy is stored on content version

`quiz_versions` stores attempt limit, time limit, pass threshold and feedback release. TARGET separates immutable content from run policy. Moving these fields without preserving historical semantics is unsafe.

### P1 — OpenAPI is materially incomplete

Implemented learning APIs have no canonical contract in `schemas/openapi.yaml`. Client code currently acts as an informal contract.

### P1 — Governance state disagrees with code state

Project map calls content/assignments/assessment planned while migrations/controllers/UI/tests exist. The map cannot be treated as CURRENT implementation truth; code, migration and tests establish CURRENT.

## 8. Unknowns that require later evidence

1. Production database row counts and the exact population of legacy-only versus immutable evidence rows were not queried; destructive or privacy-sensitive data inspection is outside this inactive task.
2. Whether every historical StudentSeat has a Principal, or only seats that opened project paths, is unknown because creation is lazy.
3. Whether Account linking ever consolidates multiple seats for the same child across classes/schools is not specified by CURRENT code evidence.
4. Exact contradictory UI states must be reproduced in `LRN-M0-003`; this audit does not label a hypothesized state bug as reproduced.
5. `course_versions.content_hash` and learning SHA-256 digests use different stored widths/algorithms; equivalence is not established.
6. Production deployment of migrations `0077`, `0083`, `0084` is not proven by their presence in Git.
7. Existing cross-school RLS and `SECURITY DEFINER` functions require a dedicated negative matrix; source inspection alone is not operational security evidence.
8. Current browser artifacts do not prove the baseline SHA or production URL.
9. The supplied Work Queue assigns `MIG-001` and `DB-000` to LRN-M0-001,
   but the supplied Requirements Ledger contains neither ID. `IDN-002` exists.
   Repairing that package-level ledger inconsistency requires an explicit spec
   correction; this audit does not silently create missing master records.

## 9. Minimal next decision boundary

After `LRN-M0-001` is accepted and recorded DONE, `LRN-M0-002 — Learner
Identity ADR` is the next Work Queue task. It must choose exactly one stable
learner-key strategy or prove why a mapping is required. This audit does not
make that decision, and the next task requires a new owner confirmation.

## 10. Audit file inventory

Primary evidence read for this audit:

```text
AGENTS.md
START_HERE_FOR_AI.md
docs/execution/current.yaml
docs/project-map/infrastructure-focus.yaml
docs/project-map/PROJECT_MAP.md
docs/project-map/project-map.yaml
docs/delivery/EXECUTION_MANIFEST.yaml (learning/classroom references)
docs/testing/active-task-tests.yaml
schemas/openapi.yaml (all 1,752 lines)
migrations/0021_classroom_roster_studentseat.sql
migrations/0026_student_seat_principal.sql
migrations/0033_classroom_assignments.sql
migrations/0038_assignment_library.sql
migrations/0050_account_learners.sql
migrations/0058_assignment_bank.sql
migrations/0059_courses_and_sharing.sql
migrations/0064_course_outline.sql
migrations/0067_course_versions.sql
migrations/0068_classroom_course_runs.sql
migrations/0069_course_run_assignment_order.sql
migrations/0070_course_lesson_progress.sql
migrations/0075_course_lesson_blocks.sql
migrations/0076_course_catalogue_hardening.sql
migrations/0077_learning_assessment_foundation.sql
migrations/0079_learning_sha256_compatibility.sql
migrations/0083_quiz_engine.sql
migrations/0084_grade_scales_and_learner_results.sql
apps/api/src/seat-context.ts
apps/api/src/assignments.controller.ts
apps/api/src/classrooms.controller.ts
apps/api/src/courses.controller.ts
apps/api/src/learning-assessments.controller.ts
apps/api/src/classroom-join.controller.ts
apps/web/src/api.ts
apps/web/src/pages/AssignmentLibraryPage.tsx
apps/web/src/pages/ClassroomPage.tsx
apps/web/src/pages/LearningPage.tsx
apps/web/src/pages/SeatClassPage.tsx
apps/web/src/components/CoursesPanel.tsx
apps/web/src/components/ClassroomLearning.tsx
apps/web/src/components/ClassroomCourses.tsx
apps/web/src/components/ClassroomQuizzes.tsx
apps/web/src/components/ClassroomGradebook.tsx
apps/web/src/components/SeatCourses.tsx
apps/web/src/components/SeatQuizzes.tsx
apps/web/src/components/SeatResults.tsx
tests/courses/course-outline.pg.spec.ts
tests/courses/learning-assessment.pg.spec.ts
tests/courses/quiz-engine.pg.spec.ts
apps/api/src/courses.controller.spec.ts
apps/api/src/learning-assessments.controller.spec.ts
apps/api/src/classroom-join.controller.spec.ts
e2e/courses-sharing.spec.ts
e2e/assignment-library.spec.ts
e2e/classroom-management.spec.ts
e2e/classroom-lifecycle.spec.ts
```

## 11. Status boundary

```text
Audit material: PREPARED
Owner activation: PRESENT (parallel learning lane)
Product mutation: NONE
Migration/OpenAPI mutation: NONE
Ledger update: NONE
Commit/push/deploy: NONE
LRN-M0-001: EVIDENCE COMPLETE; FINAL GATES/COMMIT PENDING
```
