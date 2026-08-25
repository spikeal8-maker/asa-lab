# LRN-M0-007 — Surface Convergence Report

**Task:** `LRN-M0-007`  
**Baseline:** `7f185eadfdf03eb75d24acb4f1add0abefbae3f6`  
**Scope:** existing ASA Learning read surfaces only  
**Production:** `NOT DEPLOYED / MIGRATION NOT APPLIED / BACKFILL NOT RUN`

## Result

The existing direct-assignment, course-assignment, quiz, learner-result, class-progress and Gradebook readers now consume one batched server-side projection. That projection adapts CURRENT evidence and calls the accepted `resolveCanonicalLearningState(...)`; the browser translates the returned semantic DTO and does not select Attempts, Results or Gradebook pointers.

## Surfaces cut over

Learner surfaces:

- active-seat and linked-account assignments;
- course assignment lessons and course progress;
- quiz state;
- published Results, with current workflow kept separate from the selected result;
- assignment brief and attended-class progress.

Teacher surfaces:

- assignment list and per-learner progress;
- course-run aggregates;
- roster and learner-detail progress indicators;
- awaiting-review totals;
- existing Gradebook workflow/result cells.

No new product page, Gradebook Matrix, Course Builder, Works, Review Queue or Quiz Engine was created.

## Canonical service/projection

`LearningCanonicalProjectionService` is the single controller boundary. It batch-reads `learning_canonical_evidence_*`, chooses only the existing direct/course/quiz input adapter, calls the shared resolver, and returns:

```text
workflowState
selectedResult
flags
learnerMessageCode
```

Migration `0089_learning_canonical_read_projection.sql` adds only `STABLE SECURITY DEFINER` read functions. It creates no table, mutable evidence or backfill. The internal UUID-addressable function is revoked from `asalab_app`; authenticated teacher, seat and account wrappers are the only application entry points.

## Legacy-submitted regression

Fixture: the same seat and classroom assignment have `classroom_assignment_work.submitted_at`, with no canonical Attempt.

Canonical result:

```text
workflowState = submitted
selectedResult = null
flags = legacy_unresolved + legacy_compatibility
```

The learner sees `Сдано · результат ещё не опубликован`. Gradebook shows `Сдано`, never `Не начинал`. Only the authorized teacher sees `Историческая сдача: точное immutable evidence не восстановлено`. This row is not counted as `waiting_review`.

## Changes-requested regression

After an immutable submission is reviewed as `changes_requested` and legacy `submitted_at` is cleared, learner and teacher surfaces both show revision required. Neither surface falls back to `В работе` from the cleared legacy flag.

## Selected result consistency

Fixture: Attempt 1 is accepted and selected through the persisted `gradebook_entries` pointer; Attempt 2 is `in_progress`.

Canonical result:

```text
workflowState = in_progress
selectedResult = the persisted Attempt 1 result
flags includes revision_in_progress
```

Learner Results and teacher Gradebook both retain the published `80/100 · Зачёт` while showing the new work as in progress. An unpointed result is not guessed. A missing, mismatched or cross-scope pointer yields no selected result and an internal conflict instead of another grade source.

## Compatibility grading safety

Rows tagged by `learning_migration_compatibility_activity_versions` with `grading_semantics=unknown` and `reusable_authored_content=false` return null grade semantics. Structural `max_points=1` is not exposed as one point, a percentage, a pass threshold or reusable authored content. Browser regression D verifies that `1/1`, `60%`, `100%` and a computed fake grade do not appear.

## Direct/course/quiz consistency

Direct project, course-generated project and direct quiz evidence are classified in one SQL projection and passed through their existing adapters into the same resolver. Equivalent evidence produces the same semantic DTO; no project-, course-, quiz- or Gradebook-specific resolver was introduced.

## Lifecycle/history

Active seats may read current learner state through authenticated seat/account wrappers. Suspended and removed seats receive no current learner projection. Their historical work remains available to an owner/co-teacher through the teacher wrapper. Classroom end state similarly restricts current learner visibility without deleting historical evidence.

Native writers remain seat-compatible during M0. Existing `learner_identities` and active `learner_identity_links` are used when present; otherwise the adapter records `seat_compatibility`. No ActivityRun or ActivityParticipation was created.

## Feature flag/cutover

`LEARNING_CANONICAL_READS=canonical` (and the unset default) enables the canonical projection. `LEARNING_CANONICAL_READS=legacy` returns an empty canonical map, causing the unchanged legacy DTO fields/readers to drive the existing UI. The switch changes reads only.

## Rollback proof

Unit evidence proves both flag branches. Rollback requires setting `LEARNING_CANONICAL_READS=legacy` and restarting the application build. It does not delete or rewrite `classroom_assignment_work`, Attempts, Submissions, Results, Gradebook pointers or migration metadata.

## Browser evidence

Playwright passed the real learner/teacher journey and produced:

- `e2e/artifacts/learning/m0-007/regression-a-learner-submitted.png`;
- `e2e/artifacts/learning/m0-007/regression-a-teacher-gradebook.png`;
- `e2e/artifacts/learning/m0-007/regression-b-changes-requested.png`;
- `e2e/artifacts/learning/m0-007/regression-c-learner-result.png`;
- `e2e/artifacts/learning/m0-007/regression-c-teacher-result.png`;
- `e2e/artifacts/learning/m0-007/regression-d-unknown-grading.png`.

Command: `pnpm exec playwright test e2e/learning-surface-convergence.spec.ts` — `1 passed`.

## Performance

The isolated PostgreSQL fixture projects 30 learners × 100 assignments as 3,000 rows with one application query. Final recorded evidence: `queries=1`, `elapsedMs=76.5` in the focused run and `260.7` under the complete parallel test load. The controller does not issue a query per Gradebook cell.

## Security negative tests

- an outside teacher receives zero rows for the classroom;
- application role cannot execute the internal classroom/seat UUID function;
- learner wrappers derive seat/account scope server-side and return active seats only;
- suspended/removed learner access returns zero rows while authorized teacher history remains;
- cross-school learner links are rejected by physical constraints/RLS;
- cross-scope result selection fails closed in the shared resolver;
- learner DTO flags are allow-listed and omit compatibility diagnostic, provenance and migration metadata;
- no endpoint accepts client-supplied tenant, school or learner identity for this projection.

## OpenAPI

`schemas/openapi.yaml` now documents the touched learner/teacher read paths and `CanonicalLearningSurfaceState`, including workflow, selected result, learner-safe flags and teacher-only compatibility diagnostic. Unrelated historical OpenAPI debt was not expanded.

## Requirements status

- `MIG-001`: `proven` by converged existing surfaces and browser regression A;
- `MIG-005`: `proven` for CURRENT M0 readers;
- `ARCH-003`: `proven` for the existing Gradebook read projection;
- `GRD-002`, `GRD-005`: remain `in_progress`; M0 supplies compatibility evidence only, not the M3 Gradebook Matrix;
- `IDN-003`: remains `in_progress`.

## IDN-003 disposition

M0-007 proves a compatibility identity resolution boundary, not universal stable-key ownership. Full ownership by the ADR-selected learner key across new ActivityRun/ActivityParticipation writers belongs to M1. Closing IDN-003 here would overstate CURRENT.

## Validation evidence

- shared service/controller units: 4 files, 28 tests passed;
- PostgreSQL assessment/quiz/identity/projection: 4 files, 14 tests passed;
- 30 × 100 projection: 3,000 rows, one query, 76.5 ms focused / 260.7 ms under full-suite load;
- browser: 1 test passed, six screenshots;
- embedded migration apply/idempotence: passed;
- OpenAPI/JSON contracts: passed;
- fresh no-cache API and web builds: passed;
- `pnpm gate:code`: passed with Nx cache explicitly skipped (`compose:check` reported its documented local Docker skip);
- `pnpm gate:data`: passed on a freshly provisioned `asalab_test` (1,096 tests plus 15 RLS tests). The first run on an accumulated test database hit two unrelated five-second timeouts; both passed after the repository-supported isolated test reset.

Repository governance/code/data gates and official GitHub CI are recorded after the final evidence run and publication; this report must not be used to claim them before those receipts exist.

## Known gaps

- M0-008 owner activation and acceptance gate are not authorized yet.
- Legacy storage remains intentionally present behind the reversible reader cutover.
- Native universal ActivityRun/ActivityParticipation writers and complete stable learner-key ownership remain M1 scope.
- The new Gradebook Matrix remains M3 scope.
- Roadmap issue for M0-008: `LRN-M2-009` depends on a minimal M3 result projection while strict milestone gating places M3 after M2; the gate must resolve that sequencing conflict without implementing M2/M3 here.

## Production status

`NOT DEPLOYED`. Migration 0089 was applied only to embedded/isolated test databases. No production migration, convergence apply, backfill or runtime restart was performed.

## Next ready task

`LRN-M0-008 — M0 Acceptance Gate`, blocked until separate owner authorization. It is not activated by M0-007.
