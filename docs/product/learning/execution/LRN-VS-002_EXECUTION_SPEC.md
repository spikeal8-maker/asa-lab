# LRN-VS-002 — Execution Spec

**Task:** `LRN-VS-002 — Learner Starts and Submits Project Assignment`
**Milestone:** `Visible Slice after M1 foundation`
**Status:** IN_REVIEW — local acceptance passed; owner acceptance pending
**Baseline SHA:** `b18cd9ba6092708c3961cdfd017c9c1e15191de3`
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Дать назначенному ученику возможность открыть direct project activity в существующем редакторе, получить ровно одну canonical Attempt для своей ActivityParticipation, сдать immutable ProjectVersion/Submission и увидеть устойчивое состояние «Сдано», одновременно показав преподавателю started/submitted counts.

## 2. Non-goals

`ClassroomGroup`, M1-006, multi-class, Course materialization, quiz runtime, teacher grading, Gradebook, rubrics, result UI, full effective-settings inspector и production deployment/migration.

## 3. Requirement IDs

```text
ATT-004 (visible-slice proof for direct project only)
AUD-204 (started Attempt continuation only; membership policy remains open)
MIG-003 (additive compatibility lineage)
```

## 4. CURRENT evidence

```text
apps/web/src/components/SeatAssignments.tsx
POST /api/class-join/me/assignments/:assignmentId/work
classroom_assignment_work_start(seat, assignment, project)
observed: project is linked and UI says «В работе», but no Attempt is created

POST /api/class-join/me/assignments/:assignmentId/submit
learning_project_submission_create(seat, assignment, request)
migrations/0077_learning_assessment_foundation.sql
observed: Attempt is created only on submit, has no ActivityParticipation FK,
state is immediately `evaluating`, and learner UI says «Ждёт проверки»

migrations/0089_learning_canonical_read_projection.sql
observed: canonical projection selects latest Attempt by legacy assignment+seat;
it cannot prove ActivityParticipation ownership

migrations/0094_activity_participations.sql
activity_participation_activate already proves learner identity, active seat,
school/class/run lineage, lifecycle, course enrollment and effective timing

migrations/0096_learning_direct_assignment.sql
VS-001 already creates ActivityRun, Audience and ActivityParticipation and denies
excluded named learners before a legacy work row can be inserted

e2e/artifacts/learning/vs-001/current-after-start.png
e2e/artifacts/learning/vs-001/current-after-submit.png
browser CURRENT evidence: start reaches «В работе»; submit becomes «Ждёт проверки»
```

The exact CURRENT break is the write boundary: `work_start` is legacy-only and `submission_create` invents an unlinked Attempt at submit time.

## 5. Existing contracts to reuse

`LearningActivityVersion`, `ActivityRun`, `LearningAudience`, `ActivityParticipation`, `LearnerIdentity`, `classroom_assignment_work`, Project Core personal projects, immutable `project_versions`, `learning_attempts`, `learning_submissions`, canonical projection service and existing SeatAssignments/ClassroomAssignments UI.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
docs/product/learning/execution/LRN-M1-005_EXECUTION_SPEC.md
docs/product/learning/execution/LRN-VS-001_EXECUTION_SPEC.md
docs/product/learning/execution/LRN-VS-002_EXECUTION_SPEC.md
docs/project-map/project-map.yaml
migrations/0097_learning_direct_project_attempts.sql
apps/api/src/classroom-join.controller.ts
apps/api/src/classroom-join.controller.spec.ts
apps/web/src/api.ts
schemas/openapi.yaml
tests/courses/learning-direct-project-attempts.pg.spec.ts
e2e/learning-learner-submits-project-assignment.spec.ts
package.json
```

UI component changes are allowed only if browser evidence proves existing controls cannot meet the required idempotency/state wording.

## 7. Files explicitly out of scope

```text
contexts/three-d/**
electronics runtime/assets
Gradebook/review UI
Course Builder/materialization
quiz engine
production environment and production database
```

## 8. Database / migration

`0097_learning_direct_project_attempts.sql` is additive:

- nullable `learning_attempts.activity_participation_id` for coexistence with historical rows;
- tenant-scoped FK to `activity_participations`;
- partial unique index enforcing one non-terminal Attempt per participation;
- canonical direct-project start function that activates the exact participation, links the existing personal project and creates/reuses one `in_progress` Attempt;
- canonical direct-project submit function that freezes the exact project draft as a ProjectVersion, inserts one immutable Submission, transitions the same Attempt to `submitted`, and updates `classroom_assignment_work.submitted_at` only as compatibility projection;
- no guessed historical backfill and no default participation for legacy attempts;
- FORCE-RLS tables remain inaccessible directly to `asalab_app`; runtime uses narrow SECURITY DEFINER commands.

## 9. API / OpenAPI

Existing routes remain the product API:

```text
POST /api/class-join/me/assignments/{assignmentId}/work
body: { projectId }
response adds attemptId, participationId, state, reused

POST /api/class-join/me/assignments/{assignmentId}/submit
body: { submitted: true, clientRequestId }
response: exact attempt/submission/projectVersion receipt
```

Both routes derive seat/account/principal from authenticated sessions, return 404 for excluded or cross-class UUIDs, and use a separate legacy adapter only when no canonical direct ActivityRun exists. OpenAPI documents requests, receipts and authorization errors.

## 10. Transaction boundaries

Canonical start activation + compatibility work link + Attempt create/reuse are one DB transaction. Canonical submit locks participation/Attempt/work/draft, freezes ProjectVersion, inserts Submission, transitions Attempt and updates the legacy projection atomically.

## 11. Idempotency / concurrency

Concurrent start requests return the same non-terminal Attempt. The partial unique index is the final arbiter. Repeating the same submit `clientRequestId` returns the original receipt. A second distinct submit against an already submitted Attempt is rejected without a second ProjectVersion or Submission.

## 12. Authorization / RLS

Positive path requires the authenticated learner principal to resolve through an active learner identity link and an active seat in the exact run classroom. Direct UUID access by an excluded learner, another class/school, suspended/removed seat, withdrawn participation, closed assignment/run/classroom, or unavailable timing is denied. Runtime roles receive EXECUTE only, not table mutation rights.

## 13. Migration / compatibility

Historical attempts keep `activity_participation_id = NULL`. Legacy/course assignments continue through the unchanged legacy adapter. New VS-001 direct assignments must use participation-owned canonical functions; no inferred backfill is performed.

## 14. Feature flag / rollout

N/A — the cutover is selected by the presence of a canonical direct ActivityRun; legacy rows retain their separate adapter.

## 15. Rollback

Before production cutover, rollback is code-first: restore the controller to the legacy adapter. The nullable column/index/functions are additive and inert. Submitted immutable evidence is never deleted or rewritten. Production application is out of scope for this task.

## 16. Unit tests

```text
TST-VS002-API-001 canonical start maps receipt and errors
TST-VS002-API-002 canonical submit preserves caller clientRequestId
TST-VS002-API-003 non-canonical assignment uses the legacy adapter only
```

## 17. Integration tests

```text
TST-VS002-INT-001 assigned -> active and one in_progress Attempt
TST-VS002-INT-002 reload/retry reuses Attempt
TST-VS002-INT-003 submit freezes exact ProjectVersion and immutable Submission
TST-VS002-INT-004 duplicate request reuses receipt; distinct second submit creates nothing
TST-VS002-INT-005 excluded learner and cross-class/project UUIDs are denied
TST-VS002-INT-006 withdrawn/suspended/closed lifecycle cannot start or submit
TST-VS002-INT-007 runtime role cannot CRUD canonical tables directly
```

## 18. Browser E2E

Teacher assigns an existing canonical project activity; learner sees «Не начато», clicks «Открыть», real module editor appears, returns and sees «В работе / Открыть работу / Сдать», submits and persistently sees «Сдано / Работа сдана»; teacher sees `Работают: 1 · Сдали: 1`. Second scenario proves a third excluded learner cannot see, start or submit by direct UUID/API.

Artifacts: learner not-started, in-progress, submitted and teacher submitted.

## 19. Security negative tests

Named-audience exclusion, direct UUID start/submit, foreign project, cross-class seat, suspended/removed seat and withdrawn participation; plus direct runtime-role INSERT/UPDATE denial.

## 20. Performance considerations

Start/submit use indexed run→participation and assignment→seat lookups and lock one participation/attempt/work/draft. No class-wide scan is introduced on mutation paths.

## 21. Acceptance checklist

- [x] real editor opens from assigned activity
- [x] participation activates and one Attempt is created/reused
- [x] immutable exact ProjectVersion/Submission is produced idempotently
- [x] learner persistently sees «Сдано»
- [x] teacher sees started/submitted counts
- [x] excluded learner cannot read/start/submit
- [x] migrations fresh + repeat 0
- [x] OpenAPI
- [x] unit/integration/browser/security tests
- [x] VS-001 and M0 regressions
- [x] uncached repository gate
- [ ] official required CI gates and merge
- [x] ledger updated only for proven scope

## 22. Evidence

Baseline: `b18cd9ba6092708c3961cdfd017c9c1e15191de3`. Final validation was repeated
after fast-forward convergence with `origin/main` at
`afa9c20d4480961903ca4f5215633359d91b1368`.

```text
pnpm test:learning-vs-002                         PASS — 9 tests
pnpm test:learning-vs-001                         PASS — 7 tests
pnpm e2e:learning-vs-002                          PASS — 2 browser journeys
pnpm e2e:learning-vs-001                          PASS — 2 browser journeys
M0 canonical state/adapters/projection/PG suites PASS — 25 tests
M1-001..M1-005 focused regression suites         PASS — 64 tests
fresh isolated database                          PASS — 96 migrations
pnpm db:migrate:test (repeat)                     PASS — 0 applied
NX_SKIP_NX_CACHE=true pnpm gate:repository        PASS
  full Vitest                                    179 files / 1244 tests
  RLS                                             15 tests
  Nx lint/typecheck/build                         cache skipped
git diff --check                                  PASS
```

Browser evidence:

```text
e2e/artifacts/learning/vs-002/learner-not-started.png
e2e/artifacts/learning/vs-002/real-project-editor.png
e2e/artifacts/learning/vs-002/learner-in-progress.png
e2e/artifacts/learning/vs-002/learner-submitted.png
e2e/artifacts/learning/vs-002/teacher-submitted.png
e2e/artifacts/learning/vs-002/learner-excluded.png
```

The submitted learner surface says `Сдано · результат ещё не опубликован`; the
teacher surface says `Весь класс · Назначено: 2 · Работают: 1 · Сдали: 1`.
Production deployment and production migration remain explicitly outside this
task.
