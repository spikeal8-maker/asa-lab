# LRN-COURSE-01 — Э1: законченный курс

Owner authorization: 2026-09-10, all of Э1 under integrated specification V1.2.
Baseline: `b963ef828f0e10042adacba4199bba972526c0df`.
Status: IN_PROGRESS. No candidate or browser acceptance is claimed yet.

## Contract and checkpoints

Normative scope: [integrated spec §§4–7, 14–19, 25–30](../../ASA_INTEGRATED_IMPLEMENTATION_SPEC.md).
The existing Work Queue is the only delivery queue. Internal checkpoints do not
close Э1 or require new owner permission.

1. Synchronize canonical documents, then connect author library and course publication.
2. Converge direct and course assignment, audience, Account join and Seat access.
3. Effective class/individual conditions, exact save/submit, review, revision and selection.
4. Matrix, completion, events and notification preferences/reminders.
5. Integrated browser journeys, security, mixed-data and candidate gates.

## Targeted CURRENT

- 0091/0105 + LearningActivitiesController already authorize author-owned activity drafts and immutable publication.
- 0092–0097 provide enrollment, runs, audience, participation and direct project submission; reuse them.
- 0104/0106 and Result A supply independent teaching contexts and protected Seat credentials.
- CoursesPanel, ClassroomCourses, AssignmentLibraryPage and Gradebook are existing UI boundaries.

## Evidence and remaining work

All INT-E1-01–18 and PLAN4-E1-01–12 remain open until their concrete tests pass.
Required browser evidence includes author-only → teacher with same content IDs,
Account and Seat editing Electronics and 3D, exact submission A after draft B,
return → new Attempt, five selection policies, 30×10 matrix and notification mute.
Implementation changes will be listed here with their tests and transaction boundaries.

### Development receipts (not candidate acceptance)

- Author UI creates/publishes reusable canonical project materials with no SQL-created activity prerequisite.
  The two assignment browser cases passed at the earlier checkpoint (whole class / two named learners with third excluded).
- New course lessons pin LearningActivityVersion; course delivery creates existing ActivityRuns and inherited Participation from one parent Audience.
  `tests/courses/course-canonical-delivery.pg.spec.ts`: 2 PASS, including repeated material occurrences, request replay, late audience membership and foreign-seat denial.
- Exact submission uses the editor-confirmed draft revision. Revision conflict has no Submission side effect; duplicate request reuses exact ProjectVersion;
  later save does not mutate the submitted snapshot; suspended/foreign actor retry is denied.
- Existing assessment_results now supports append-only revisions. Completion/ungraded have no invented points/max;
  return grants exactly one extra attempt, linked revision attempt; correction preserves closure time.
  `tests/courses/learning-direct-project-attempts.pg.spec.ts`: 8 PASS (five graded selection policies included), latest run 2026-09-10.
- Real browser: 3D material author/publish → class/Seat → project edit/save → exact submit → return → second edited Attempt → accepted matrix cell:
  `e2e/learning-course-01.spec.ts --grep 'real 3D'`: 1 PASS (12.2s). It first exposed a stale teacher detail; fixed fresh cell open and 15-second matrix refresh, then rerun passed.
- API/Web build: 16 Nx build tasks executed with `NX_SKIP_NX_CACHE=true`, no cache, PASS before the subsequent operational-conditions edits.
- All schema experiments use disposable tmpfs PostgreSQL container `asa-learning-course01-test`, loopback 57576, database `asalab_course01_test`.
  Working PostgreSQL and permanent Compose installation were not modified. Fresh schema through 0118 and the 10 focused PG tests passed.

### Still open before full E1

Latest checkpoint, 2026-09-10 (not full acceptance):

- Canonical package synchronized; `control-plane:check` passed at this baseline; no candidate commit yet.
- 138 focused tests across 20 files passed before allowance addition. Subsequently 12 direct-project PG tests passed, including audited allowance/CAS/foreign denial/excuse.
- Disposable schema now through 0130. Incremental application passed. Fresh + repeat-zero must be repeated on the final migration set.
- Real browser Account course journeys passed separately for Electronics (12.2s) and 3D (11.1s): UI-authored private material/course, pending admission, staff approval, theory, saved project, exact submission, notification deep-link, review, completion 2/2.
- Real Seat journeys passed separately for 3D (14.6s) and Electronics (17.8s): save/reload, exact A unchanged after editing draft B, return/new Attempt/resubmit/accepted matrix result.
- Whole-class and named-two/excluded-third assignment browser regressions passed (3.9s/5.6s).
- 30×10 matrix, named exclusions, search and individual allowance passed up to viewport assertion. Mobile overflow found; fix is under retest. No mobile PASS claimed.
- OpenAPI started for conditions, allowances, review, exact Submission, notifications and join requests; `contracts:check` passed (77 paths). Course authoring/read-context/gradebook mappings still need completion.
- Current API/web compile and Vite build passed; these are focused development builds, not `gate:repository`.

Still required: author-only → teaching same IDs; graded/ungraded/scale UI cases; mute preferences browser; course notification withdrawal test;
selection/concurrency edge cases; mixed-data upgrade; final OpenAPI/ledger/project-map and repository gate.

Operational conditions UI/read projections and negative tests; Account approval path; notification persistence/preferences/class exceptions and server reminders;
canonical course completion and learner result projection; pinned grade scale UI/read; legacy review compatibility;
full Electronics/course/Account and 30×10/mobile browser coverage; expanded concurrency/security/upgrade cases;
OpenAPI, documentation/project-map/ledger reconciliation, full repository gate and exact candidate commit.
No full Э1, candidate, CI, owner acceptance or deployment is claimed from the receipts above.

Production deployment, production migrations and Э2–Э6 are not authorized by this task.
