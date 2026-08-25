# LRN-M0-007 — Surface Convergence

**Task:** `LRN-M0-007`  
**Milestone:** `M0 — State Convergence`  
**Status:** IN_PROGRESS  
**Baseline SHA:** `7f185eadfdf03eb75d24acb4f1add0abefbae3f6`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

## 1. Goal

Move the existing learner and teacher assignment, course, quiz, result and Gradebook read surfaces to one batched server-side semantic authority, `resolveCanonicalLearningState(...)`, while preserving a reversible legacy reader path.

## 2. Non-goals

- No M0-008 or M1-M7 work.
- No production deploy, migration apply or backfill.
- No new Gradebook, Course Builder, Works, Review Queue or Quiz Engine.
- No ActivityRun/ActivityParticipation creation and no destructive legacy cleanup.
- No conversion of legacy feedback or migration placeholders into grades.

## 3. Requirement IDs

```text
MIG-001
MIG-005
ARCH-003
GRD-002 (M0 compatibility evidence only)
GRD-005 (M0 compatibility evidence only)
IDN-003 (compatibility disposition only; not closed)
```

## 4. CURRENT evidence

- `contexts/learning/domain/canonical-learning-state.ts` is the accepted semantic resolver and direct/course/quiz adapters; no controller imports it at baseline.
- `apps/api/src/classroom-join.controller.ts` maps learner assignment/course status from `submitted_at`, quiz from latest Attempt/Result, and learner Results from Gradebook-selected rows.
- `apps/api/src/learning-assessments.controller.ts` maps Gradebook `NULL attempt_state` to `not_started` and selects the grade via `gradebook_entries`.
- `apps/api/src/classrooms.controller.ts` uses legacy `awaiting_review` counters and project rows derived from `classroom_assignment_work`.
- `apps/api/src/courses.controller.ts` exposes teacher course progress from legacy work rows.
- `apps/web/src/components/SeatAssignments.tsx`, `SeatCourses.tsx`, `ClassroomAssignments.tsx`, `ClassroomCourses.tsx`, `ClassroomGradebook.tsx`, `AssignmentBrief.tsx`, `SeatResults.tsx`, `apps/web/src/pages/AttendedClassesPage.tsx` and `ClassroomStudentPage.tsx` independently interpret legacy fields.
- `docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md` proves a legacy submitted row can be `Сдано` on learner surfaces and `Не начинал` in Gradebook.
- migrations `0077`, `0083`, `0084`, `0086`, `0087`, `0088` define assessment, quiz, result-selection, learner mapping and compatibility metadata.

## 5. Existing contracts to reuse

- `resolveCanonicalLearningState`, `adaptDirectProjectCanonicalInput`, `adaptCourseProjectCanonicalInput`, `adaptQuizCanonicalInput`.
- `classrooms`, `classroom_student_seats`, `classroom_assignments`, `classroom_assignment_work`.
- `learner_identities`, `learner_identity_links` where present; seat compatibility otherwise.
- `learning_attempts`, `learning_submissions`, `assessment_results`, `gradebook_entries`.
- Existing controllers, DTOs and pages; canonical fields are additive.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/learning/execution/LRN-M0-007_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_SURFACE_CONVERGENCE_REPORT.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/project-map/project-map.yaml (only factual M0 wording if still audit-only)
apps/api/src/learning-canonical-projection.service.ts
apps/api/src/learning-canonical-projection.service.spec.ts
apps/api/package.json
apps/api/src/classroom-join.controller.ts
apps/api/src/classroom-join.controller.spec.ts
apps/api/src/classrooms.controller.ts
apps/api/src/courses.controller.ts
apps/api/src/courses.controller.spec.ts
apps/api/src/learning-assessments.controller.ts
apps/api/src/learning-assessments.controller.spec.ts
apps/web/src/api.ts
apps/web/src/learning/canonical-learning-presentation.ts
existing affected learner/teacher components
migrations/0089_learning_canonical_read_projection.sql
schemas/openapi.yaml
tests/courses/learning-surface-convergence.pg.spec.ts
e2e/learning-surface-convergence.spec.ts
e2e/artifacts/learning/**
pnpm-lock.yaml
```

## 7. Files explicitly out of scope

```text
new tables, mutable backfill or destructive migrations
contexts/identity/**
new ActivityRun/ActivityParticipation runtime
new product pages/navigation
Admin/Auth, Electronics, 3D, Chess and Projects product code
production configuration and data
```

## 8. Database / migration

`migrations/0089_learning_canonical_read_projection.sql` adds read-only, `STABLE SECURITY DEFINER` evidence functions for authenticated teacher, seat-session and linked-account readers. The functions batch the existing legacy work, latest Attempt, persisted Gradebook pointer, selected Result, identity lineage and compatibility grading metadata. They add no table, column, index or data mutation. Direct internal evidence access is revoked; only guarded wrappers are executable by `asalab_app`. Production apply remains prohibited.

## 9. API / OpenAPI

Existing endpoints remain. Add an additive canonical semantic object where required:

```text
canonicalState: {
  workflowState,
  selectedResult,
  flags,
  learnerMessageCode
}
```

Internal provenance and compatibility diagnostics are excluded from learner DTOs. Teacher DTOs may include a localized `compatibilityDiagnostic` only for `legacy_unresolved`. Existing legacy fields remain for rollback. OpenAPI adds the touched learning paths and the additive `CanonicalLearningSurfaceState` contract; unrelated baseline contract debt remains out of scope.

## 10. Transaction boundaries

Read-only projection calls run as one statement against a single snapshot. Migration DDL is transactional under the repository migrator; no product write transaction is added.

## 11. Idempotency / concurrency

Projection is pure for explicit `asOf` and stable database evidence. Repeated reads do not mutate data. Latest Attempt ordering remains `(attempt_number DESC)` and result selection remains the persisted valid Gradebook pointer only.

## 12. Authorization / RLS

- Learner seat/account scope is derived from authenticated session/controller rows, never accepted from a request body.
- Teacher projection validates teacher access to the classroom before returning history.
- Every row must retain tenant/school/classroom lineage; cross-school pointers fail closed.
- Suspended/removed seats retain history but receive no current learner access.
- Learner DTOs never expose migration tables, flags wording or internal provenance.

## 13. Migration / compatibility

Legacy storage and fields remain readable. Migration compatibility ActivityVersions with `grading_semantics=unknown` and `reusable_authored_content=false` never supply learner-facing max points, percentage or grade semantics.

## 14. Feature flag / rollout

Environment variable `LEARNING_CANONICAL_READS` selects `canonical` or `legacy`; default is `canonical` for repository runtime and tests. The explicit legacy branch preserves the baseline DTO derivation for rollback. The flag changes reads only and never historical evidence.

## 15. Rollback

Set `LEARNING_CANONICAL_READS=legacy` and restart the API/web build. Controllers return baseline-compatible legacy interpretations; no table/column/evidence rollback is needed. M0-007 does not delete legacy readers or storage.

## 16. Unit tests

```text
LRN-M0-007-U01 legacy submitted/no Attempt => submitted + legacy flags, not waiting_review
LRN-M0-007-U02 changes_requested beats cleared legacy timestamp
LRN-M0-007-U03 accepted result pointer survives new in_progress revision
LRN-M0-007-U04 missing/broken/cross-scope pointer => no selectedResult
LRN-M0-007-U05 compatibility max_points=1 never yields grade semantics
LRN-M0-007-U06 direct/course/quiz equivalent input => equal semantic output
LRN-M0-007-U07 learner projection redacts diagnostics/provenance
LRN-M0-007-U08 legacy cutover branch remains selectable
```

## 17. Integration tests

```text
LRN-M0-007-I01 legacy submitted/no Attempt converges learner + teacher Gradebook
LRN-M0-007-I02 assigned/no work => not_started
LRN-M0-007-I03 changes_requested with cleared legacy timestamp
LRN-M0-007-I04 evaluating => waiting_review
LRN-M0-007-I05 accepted + selected result
LRN-M0-007-I06 old selected result + new in_progress => revision_in_progress
LRN-M0-007-I07 result without pointer and broken/cross-scope pointer fail closed
LRN-M0-007-I08 direct quiz and course-generated project share semantics
LRN-M0-007-I09 suspended/removed lifecycle preserves teacher history, denies learner access
LRN-M0-007-I10 same pair through two surfaces returns equal semantics
```

## 18. Browser E2E

- Regression A: learner shows `Сдано` / unpublished result; teacher Gradebook shows submitted, never `Не начинал`.
- Regression B: learner and teacher show revision requested, not ordinary work.
- Regression C: both show the same previous published grade plus revision in progress.
- Regression D: compatibility unknown grading never shows fake 1 point, 100, 60% or computed grade.
- Save screenshots under `e2e/artifacts/learning/`.

## 19. Security negative tests

```text
learner A cannot resolve learner B
teacher outside class cannot resolve state
cross-school learner/result IDs rejected
suspended/removed learner cannot regain current access
client tenant/school/learner identity is not trusted
compatibility diagnostic is teacher-only
learner receives no migration metadata
```

## 20. Performance considerations

For 30 learners × 100 assignments, canonical evidence is fetched in a fixed number of batch queries, not per cell. Record query count and elapsed time in an isolated database performance test.

## 21. Acceptance checklist

- [ ] M0-006 owner acceptance recorded
- [ ] one shared semantic resolver used by relevant CURRENT surfaces
- [ ] legacy submitted / not-started regression closed
- [ ] changes-requested regression closed
- [ ] selected result consistent across learner/teacher
- [ ] compatibility grading placeholder hidden
- [ ] direct/course/quiz consistent
- [ ] lifecycle/history split proven
- [ ] reversible feature cutover and rollback proven
- [ ] unit/integration/PostgreSQL/RLS tests pass
- [ ] browser regressions and screenshots pass
- [ ] 30 × 100 projection has no N+1
- [ ] contracts/control-plane/governance/code/data gates pass
- [ ] official CI green
- [ ] ledger and factual project-map updated

## 22. Evidence

Pending implementation. Production status must remain `NOT DEPLOYED / NOT APPLIED` unless separately authorized.
