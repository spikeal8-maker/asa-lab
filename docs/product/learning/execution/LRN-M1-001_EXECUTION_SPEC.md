# LRN-M1-001 — Execution Spec

**Task:** `LRN-M1-001`  
**Milestone:** `M1 — Universal Delivery`  
**Status:** DONE — evidence complete; owner review pending
**Baseline SHA:** `24ff391386d3ea6acb99bcbb73a0542802a1f785`  
**Issue:** `#154`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Extend the existing `learning_activities → learning_activity_versions` pair so future teacher assignment, quiz, project, essay, file and manual definitions publish one immutable canonical content/policy snapshot without retargeting any existing runtime row.

## 2. Non-goals

- no `ActivityRun`, `ActivityParticipation`, `CourseEnrollment`, audience or group;
- no course materialization or Course Builder redesign;
- no new Quiz Engine, attempt/result/Gradebook redesign or M2/M3 work;
- no M5 sharing/capability implementation;
- no production migration, backfill, deployment, flag change or restart;
- no conversion of M0 compatibility versions into reusable content;
- no historical `activity_type`, `max_points` or runtime-reference rewrite.

## 3. Requirement IDs

```text
ARCH-001 — evidence/in_progress only; runtime proof requires later M1 tasks
ARCH-006 — published LearningActivityVersion immutability
VER-001 — LearningActivityVersion portion only; broad requirement stays in_progress
VER-002 — immutable policy snapshot portion
IDN-003 — disposition unchanged; not closed by this content task
```

## 4. CURRENT evidence

### 4.1 Definition map

| SOURCE | CURRENT OWNER | CURRENT VERSIONING | CURRENT RUNTIME REFERENCES | TARGET LearningActivity | TARGET LearningActivityVersion | MIGRATION / COMPATIBILITY | OLD REFERENCES PRESERVED |
|---|---|---|---|---|---|---|---|
| `teacher_assignments` (`0038`, `0058`, `0059`) | `owner_principal_id`; mutable visibility/archive on row | none; `teacher_assignment_save` mutates in place | direct `classroom_assignments.assignment_id`; copied snapshots inside published course outline | existing `learning_activities`, explicit source lineage only | new publish copies a draft snapshot; it never follows later assignment edits | no mass backfill or title/module matching; optional future canonical root points to exact source assignment ID | yes; existing handouts and course snapshots keep original references |
| `quiz_versions` + `quiz_version_questions` + `question_versions` (`0083`) | principal/school scope | immutable versions and question pins | `classroom_assignments.quiz_version_id`; attempts pin the legacy LAV created with the quiz | existing root created by quiz writer becomes canonical for new publishes | canonical LAV pins exact QuizVersion and owns new runtime-policy snapshot; existing QuizVersion policy fields remain immutable compatibility evidence | no UPDATE of existing quiz/LAV rows; new generic wrapper may pin an exact existing QuizVersion; current writer is converged additively | yes; existing quiz assignment and Attempt links do not move |
| direct project assignment | mutable `teacher_assignments`; learner project owned by learner principal | no assignment version; submitted `project_versions` are immutable evidence | `classroom_assignments.assignment_id`; `classroom_assignment_work.project_id`; M0 mapping/LAV; Attempt/Submission | new canonical root may carry exact teacher-assignment provenance | `kind=project`, module/instructions snapshot, optional proven starter version | learner submitted ProjectVersion is never used as authoring starter; no backfill | yes |
| course-generated project assignment | published `course_versions.outline` snapshot | CourseVersion freezes lesson/assignment copy | `classroom_course_run_lessons` + `classroom_assignments.course_run_id` | future course materialization will select/create canonical root; not done here | future exact LAV pin | no runtime retarget in M1-001 | yes |
| `project_versions` | project owner principal | immutable `(project_id, version_no)` with trigger | project submissions pin exact `project_version_id` | not a LearningActivity root | only a proven starter/reference checkpoint may be pinned; current learner submissions are not starter definitions | M1-001 accepts project authoring without starter; non-null starter is rejected until authoring provenance exists | yes |
| `learning_migration_compatibility_activity_versions` (`0088`) | migration batch, not author | immutable mapped LAV | M0 `classroom_activity_versions` and canonical read projection | never canonical authored root | never reusable/published/current draft | explicit exclusion in list/publish functions and tests | yes |
| `classroom_activity_versions` | classroom handout mapping | one frozen mapping per assignment | Attempts and M0 readers | none | existing exact LAV only | no update/backfill | yes |

### 4.2 Exact CURRENT values and population paths

`0077` allows `project`, `quiz`, `open_response`, `composite`. Repository writers actually create only `project` (`learning_project_submission_create`, M0 compatibility convergence) and `quiz` (`quiz_version_create`). No repository writer or fixture creates `open_response` or `composite`; therefore neither value receives a silent canonical mapping.

| CURRENT value | Policy |
|---|---|
| `project` | canonical `project` only for a newly published canonical row with explicit provenance |
| `quiz` | canonical `quiz` only for a newly published canonical row pinning an exact QuizVersion |
| `open_response` | compatibility-only preservation; no automatic `essay` rewrite |
| `composite` | unsupported/unresolved for canonical publish |

Fresh-database population is empty until fixtures/writers run. Existing database population is not inferred from schema and is not required for production because this task performs no production read/backfill.

### 4.3 Existing writers/readers

- assignment writers/readers: `AssignmentsController` → `teacher_assignment_save/list`, classroom handout functions, course snapshot/materialization functions;
- quiz writers/readers: `LearningAssessmentsController` → `question_version_create`, `quiz_version_create/list`, `classroom_quiz_assign`; learner quiz functions;
- project runtime writer: `learning_project_submission_create` lazily creates legacy LAV when a handout lacks a mapping;
- M0 canonical readers: `learning_canonical_evidence_*` plus `LearningCanonicalProjectionService`;
- no CURRENT `/api/learning/activities` HTTP writer/reader exists in OpenAPI.

## 5. Existing contracts to reuse

- tables `learning_activities`, `learning_activity_versions`;
- immutable trigger `learning_immutable_row`;
- `learning_author_can_use_tenant` authorization helper;
- immutable `quiz_versions`, `question_versions`, `project_versions`;
- principal/tenant/session educator boundary used by `LearningAssessmentsController`;
- M0 compatibility registry and canonical projection;
- standard PostgreSQL RLS, `SECURITY DEFINER`, explicit revoke/grant pattern.

No second activity/content root or policy table will be created.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/ASA_LEARNING_TECHNICAL_SPEC.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
docs/product/learning/execution/LRN-M1-001_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M1_ACTIVITY_VERSION_CONVERGENCE_REPORT.md
docs/project-map/PROJECT_MAP.md
docs/project-map/project-map.yaml
migrations/0091_learning_activity_version_convergence.sql
apps/api/src/learning-activities.controller.ts
apps/api/src/learning-activities.controller.spec.ts
apps/api/src/app.module.ts
schemas/openapi.yaml
tests/courses/learning-activity-version-convergence.pg.spec.ts
package.json
```

## 7. Files explicitly out of scope

```text
migrations/0001..0089 (checksum immutable)
apps/web/**
ActivityRun/CourseEnrollment/ActivityParticipation code
Gradebook/Attempt/Result runtime code except read-only regression tests
production configuration and data
```

## 8. Database / migration

Migration: `0091_learning_activity_version_convergence.sql`, one transaction through the existing migration runner. Number `0091` is required because current `origin/main` added `0090_project_draft_idempotency.sql` while this task was in flight.

### 8.1 Existing root extension

`learning_activities` gains:

- `visibility_policy varchar(16) NOT NULL DEFAULT 'private'` CHECK `private|school`;
- `authoring_origin varchar(32) NOT NULL DEFAULT 'legacy_runtime'` CHECK `legacy_runtime|canonical|teacher_assignment|quiz_version`;
- `reusable_authored_content boolean NOT NULL DEFAULT false`;
- `draft_revision integer` CHECK positive;
- `draft_payload jsonb` CHECK object;
- `current_published_version_id uuid` composite FK `(tenant_id,id)` after version columns exist;
- `source_teacher_assignment_id uuid` FK, unique when present;
- root invariant: canonical reusable roots have non-null draft revision/payload; legacy roots remain non-reusable.

The existing activity type CHECK is expanded additively to retain `open_response|composite` and allow `project|quiz|essay|file|manual`. Existing rows are not updated.

### 8.2 Existing version extension

`learning_activity_versions`:

- `max_points` becomes nullable; CHECK becomes `NULL OR > 0`;
- adds nullable `canonical_kind`, `result_mode`, `policy_snapshot`, `quiz_version_id`, `starter_project_version_id`, `provenance`, `source_draft_revision`, `publication_request_id`, `published_by_principal_id`, `canonical_contract_version`;
- partial unique `(activity_id, source_draft_revision)` for canonical rows;
- partial unique `(activity_id, publication_request_id)` for retry;
- FKs are tenant-scoped where composite keys exist;
- canonical CHECK requires exact fields and:
  - `graded` → `max_points > 0`;
  - `ungraded|completion` → `max_points IS NULL`;
  - `quiz` → exact `quiz_version_id`;
  - `project` → non-empty `module_key`;
  - policy/provenance JSON objects;
- old rows have `canonical_contract_version IS NULL` and retain every legacy value.

The existing immutable UPDATE/DELETE trigger remains the enforcement boundary.

### 8.3 Functions

- deterministic digest helper over canonical JSONB;
- create/replace draft function, owner + tenant checked;
- publish function with activity-scoped transaction advisory lock;
- list/detail/version read functions restricted to author-owned reusable roots;
- no compatibility LAV/root can enter reusable results; an independently
  provenanced exact teacher-owned QuizVersion may be wrapped without reusing
  the compatibility LAV;
- non-null starter ProjectVersion fails closed until authoring/reference provenance can be proven.

### 8.4 Backfill and rollback

Backfill: none. Existing rows retain types, max points, quiz policy fields and runtime references.

Rollback before adoption: switch callers away from the new API and leave additive nullable columns/functions. Schema is not destructively reversed while canonical versions may reference it.

## 9. API / OpenAPI

```text
GET  /api/learning/activities
POST /api/learning/activities
GET  /api/learning/activities/{activityId}
PUT  /api/learning/activities/{activityId}/draft
POST /api/learning/activities/{activityId}/publish
GET  /api/learning/activities/{activityId}/versions
```

All routes require an educator session. Create/draft validate canonical kind, result mode, references, max points and policy object. Publish requires `expectedRevision` and `requestId`; conflicts return canonical error codes. The same change set updates `schemas/openapi.yaml`.

No learner execution endpoint is added. API/domain support is not a claim of UI or runtime support.

## 10. Transaction boundaries

Draft replacement is one root UPDATE with optimistic revision. Publication locks one activity, validates the exact draft/reference ownership, inserts one immutable version and updates only the root's current-version pointer atomically.

## 11. Idempotency / concurrency

- same `(activity_id, publication_request_id)` returns the same version;
- same source draft revision returns the already published version;
- activity advisory lock serializes version-number allocation;
- DB unique constraints are the final duplicate guard;
- stale `expectedRevision` returns `revision_conflict`;
- digest is SHA-256 of PostgreSQL canonical JSONB text with all snapshot fields and exact references.

## 12. Authorization / RLS

- root/version RLS remains forced tenant isolation;
- app role retains no direct table mutation grant;
- only owner principal with valid tenant lineage can mutate a draft or publish;
- published version direct UUID UPDATE/DELETE is rejected by trigger even for a table owner test connection;
- list/detail functions exclude M0 compatibility versions and non-reusable roots;
- learner HTTP session fails educator capability check;
- no M5 cross-owner grant model is implemented.

## 13. Migration / compatibility

- direct assignment, course-generated assignment, quiz assignment, Attempt and Submission FKs are captured before/after migration and must remain byte-equal;
- M0 registry rows stay `grading_semantics=unknown`, `reusable_authored_content=false`;
- `open_response` and `composite` stay legacy values;
- existing QuizVersion policy columns remain unchanged and remain compatibility authority for existing runtime; a new canonical LAV snapshot is authority only for future ActivityRun;
- no title/module/name merge.

## 14. Feature flag / rollout

N/A for production: no deployment is authorized. New routes are additive and no current caller is switched.

## 15. Rollback

Disable/unroute the additive API before any future ActivityRun adoption. Existing readers continue using old references. Never delete published versions or rewrite references as rollback.

## 16. Unit tests

```text
LRN-M1-001-U01 controller validation for five kinds and three result modes
LRN-M1-001-U02 learner/non-educator rejected
LRN-M1-001-U03 SQL error mapping and wire DTO
```

## 17. Integration tests

```text
LRN-M1-001-I01 canonical project v1 publish
LRN-M1-001-I02 canonical quiz v1 pins exact QuizVersion and LAV policies
LRN-M1-001-I03 edit draft + publish v2 leaves v1 and reference unchanged
LRN-M1-001-I04 existing QuizVersion compatibility policies unchanged
LRN-M1-001-I05 ungraded has NULL max_points
LRN-M1-001-I06 completion has NULL max_points
LRN-M1-001-I07 graded rejects absent/non-positive max_points
LRN-M1-001-I08 M0 compatibility version remains non-reusable
LRN-M1-001-I09 direct published-version UUID update denied
LRN-M1-001-I10 publish retry returns one version
LRN-M1-001-I11 concurrent publish produces one version number for one draft
LRN-M1-001-I12 cross-owner/cross-school mutation denied
LRN-M1-001-I13 essay/file/manual schema representation only
LRN-M1-001-I14 old direct/course/quiz/Attempt/Submission references unchanged
LRN-M1-001-I15 open_response/composite are not silently mapped
```

## 18. Browser E2E

N/A — this task adds no UI and switches no user journey. Existing M0 surface browser test is a regression gate if the stack is available.

## 19. Security negative tests

- owner B cannot draft/publish owner A content;
- principal outside tenant cannot create school content;
- app/learner cannot mutate authoring through HTTP;
- compatibility activity is absent from reusable list;
- published UUID update/delete fails;
- unproven starter project reference fails closed.

## 20. Performance considerations

List queries use owner/reusable/archive index. Publication is one root-scoped lock and bounded version lookup; no classroom/learner scan or backfill occurs.

## 21. Acceptance checklist

- [x] M0 owner acceptance and only M1-001 activation recorded
- [x] normative root/version responsibility corrected
- [x] CURRENT definition and kind map proven
- [x] additive migration 0091
- [x] five canonical kinds represented
- [x] three result modes enforced without fabricated scale
- [x] immutable policy snapshot
- [x] quiz/project exact-reference rules
- [x] M0 compatibility isolation
- [x] old runtime references unchanged
- [x] publish idempotency and concurrency
- [x] RLS/security negative matrix
- [x] OpenAPI exact
- [x] unit/integration tests
- [x] migration repeatability
- [x] repository gates with cache disabled
- [x] ledger and final report updated

## 22. Evidence

Evidence is consolidated in
`docs/product/learning/current/LRN_M1_ACTIVITY_VERSION_CONVERGENCE_REPORT.md`.
No production action was performed.
