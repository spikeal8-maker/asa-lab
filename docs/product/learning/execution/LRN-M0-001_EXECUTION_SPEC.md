# LRN-M0-001 — Execution Spec

**Task:** `LRN-M0-001`  
**Milestone:** `M0`  
**Status:** `IN_PROGRESS — OWNER ACTIVATED`  
**Baseline SHA:** `cf43a359eb6c99b5dfdd5f30623cfa5e2a5a46ef`  
**Activation SHA:** `374c54f59d72abbfae143b445aa32ede643437da`  
**Master Spec:** `01_ASA_LEARNING_TECHNICAL_SPEC.md` from `ASA_LEARNING_AGENT_PACKAGE_V1.zip`  
**Work Queue:** `03_ASA_LEARNING_AGENT_WORK_QUEUE.md` from the same package

---

## 1. Goal

Build an evidence-backed map of the CURRENT ASA Lab learning architecture without changing product behavior or choosing the learner-identity architecture reserved for `ADR-LEARNER-IDENTITY-001`.

## 2. Non-goals

- no product code, UI, schema, migration, data, OpenAPI, ledger, or control-plane mutation;
- no new `LearnerIdentity` table or identity decision;
- no canonical resolver, backfill, cutover, redesign, M1 work, or milestone acceptance;
- no claim that TARGET requirements are CURRENT behavior.

## 3. Requirement IDs

```text
MIG-001
DB-000
IDN-002
```

These requirements are mapped by the audit. `IDN-002` exists in the supplied
Requirements Ledger. `MIG-001` and `DB-000` are defined by the Master Spec and
referenced by the Work Queue, but are absent from the supplied ledger; this
package inconsistency is evidence, not permission to invent ledger records.

## 4. CURRENT evidence

| Area | Evidence | Observed CURRENT behavior |
|---|---|---|
| Execution state | `docs/execution/current.yaml` | Primary task remains `TASK-ADMIN-AUTH-STABILITY-001`; owner activation adds parallel lane `learning` / wrapper `TASK-LEARNING-M0-001` for Work Queue item `LRN-M0-001`. |
| Governance validation | `pnpm control-plane:check` after activation | PASS; primary task remains Admin/Auth, lanes include `learning`, `blocking=0`. |
| Student identity | `migrations/0021_classroom_roster_studentseat.sql`, `0026_student_seat_principal.sql`, `0050_account_learners.sql`, `apps/api/src/seat-context.ts` | A learner may be an email-free `StudentSeat`, optionally linked to an Account; a lazily-created `Principal(kind=student_seat)` owns projects. |
| Course authoring/runtime | migrations `0059`, `0064`, `0067`, `0068`, `0070`, `0075`, `0076`; `apps/api/src/courses.controller.ts` | Editable course + immutable `course_versions`; classroom runtime is `classroom_course_runs` with frozen lessons and per-seat material completion. |
| Direct tasks | migrations `0033`, `0038`, `0058`; assignments/classrooms controllers | Teacher library items are handed out as `classroom_assignments`; per-seat project work is `classroom_assignment_work`. |
| Assessment foundation | migration `0077_learning_assessment_foundation.sql` | Immutable activity versions, submissions, evaluations and assessment results exist, but runtime is keyed directly by classroom assignment and seat. |
| Quiz engine | migration `0083_quiz_engine.sql`; learning controller | Versioned questions/keys/quizzes, deterministic autograding, direct quiz handout and grade publication exist. |
| Learner results | migration `0084_grade_scales_and_learner_results.sql`; class-join controller | Seat/account read functions expose selected gradebook results and optional class grading scheme labels. |
| Contract | `schemas/openapi.yaml` | The canonical OpenAPI documents identity/classroom/project APIs, but not the implemented course, assignment, quiz, attempt, result, or gradebook endpoints. |
| UI | `AssignmentLibraryPage`, `CoursesPanel`, `ClassroomLearning`, `ClassroomGradebook`, `LearningPage`, `SeatCourses`, `SeatQuizzes`, `SeatResults` | Author, classroom, learner, quiz, results and gradebook surfaces exist. |
| Tests | `tests/courses/*.pg.spec.ts`, controller specs, relevant Playwright specs | Focused SQL/controller tests cover course snapshots, project assessment and quiz autograding; course/assignment browser tests exist, but no canonical M0 state-convergence gate exists. |

The detailed evidence map is `docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md`.

## 5. Existing contracts to reuse

Audit-only reuse candidates, not architectural decisions:

```text
Principal / StudentSeat / Account link
Classroom and classroom_memberships
Project / ProjectVersion
Course / CourseVersion / classroom_course_runs
learning_activities / learning_activity_versions
learning_attempts / learning_submissions / learning_evaluations
assessment_results / gradebook_entries / grade_change_events
question bank and quiz version tables
existing tenant RLS and SECURITY DEFINER function boundaries
existing focused SQL, controller and Playwright tests
```

## 6. Exact files to change

Prepared audit materials only:

```text
docs/product/learning/execution/LRN-M0-001_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
```

These files are the only Learning-lane deliverables for `LRN-M0-001`.

## 7. Files explicitly out of scope

```text
docs/execution/current.yaml
docs/project-map/**
docs/delivery/**
schemas/openapi.yaml
migrations/**
apps/api/**
apps/web/**
tests/**
e2e/**
02_ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
```

## 8. Database / migration

N/A — Work Queue defines `LRN-M0-001` as audit/no product mutation and explicitly forbids migrations.

## 9. API / OpenAPI

N/A — the audit records exact OpenAPI drift but this audit-only task does not repair it.

## 10. Transaction boundaries

N/A — no runtime write is introduced.

## 11. Idempotency / concurrency

N/A — no runtime operation is introduced. Evidence is pinned to one immutable Git SHA.

## 12. Authorization / RLS

The audit maps existing positive and negative boundaries: teacher membership checks, seat-derived identity, Account-to-seat lookup, tenant RLS, answer-key isolation, and `SECURITY DEFINER` functions. No policy is changed and no adequacy claim is made without negative execution evidence.

## 13. Migration / compatibility

The audit identifies coexistence between legacy mutable facts (`classroom_assignment_work.submitted_at`), newer immutable evidence (`learning_attempts`/`learning_submissions`), mutable projections (`gradebook_entries`), and direct course/quiz handouts. Cutover design belongs to later M0 tasks.

## 14. Feature flag / rollout

N/A — documentation-only M0 audit; no runtime rollout or feature flag.

## 15. Rollback

Revert the audit-document commit and the separate governance activation commit.
No product or database rollback is required.

## 16. Unit tests

```text
N/A
Audit-only task; no unit behavior changed.
```

## 17. Integration tests

```text
CTRL-M0-001
pnpm control-plane:check
expected: PASS and no ASA Learning activation on the pinned baseline
```

Existing learning integration suites are inventoried, not reinterpreted as a
new canonical-runtime acceptance gate for this audit-only task.

## 18. Browser E2E

N/A — no UI change. Existing `courses-sharing`, `assignment-library`, and classroom journeys are catalogued only; historical screenshots are not fabricated as current evidence.

## 19. Security negative tests

N/A for execution — no product mutation and task is not active. The audit identifies required future negative cases: direct foreign seat/attempt UUID, cross-class teacher access, cross-school content access, learner answer-key access, and Account/Seat history continuity.

## 20. Performance considerations

N/A — static architecture audit with no runtime code path.

## 21. Acceptance checklist

- [x] CURRENT identity/classroom model inspected
- [x] CURRENT course/direct assignment/project/quiz/assessment/result/gradebook paths mapped
- [x] relevant migrations, API controllers, UI surfaces, OpenAPI, tests and E2E inventoried
- [x] TARGET separated from CURRENT and unknowns listed
- [x] owner activation of M0
- [x] task is active in a separate parallel lane while Admin/Auth remains primary
- [ ] requirement IDs closed in the ledger
- [ ] task-specific acceptance evidence approved
- [ ] repository gates required by an active task
- [ ] committed final SHA

## 22. Evidence

```text
baseline/final SHA: cf43a359eb6c99b5dfdd5f30623cfa5e2a5a46ef (no commit)
command: git fetch origin --prune
command: pnpm control-plane:check
result: PASS; activeTask=TASK-ADMIN-AUTH-STABILITY-001; blocking=0
browser artifacts: none created; UI unchanged
migration evidence: source inspection only; no migration run or creation
activation SHA: 374c54f59d72abbfae143b445aa32ede643437da
known gap: final governance/documentation gates and commit evidence pending
```
