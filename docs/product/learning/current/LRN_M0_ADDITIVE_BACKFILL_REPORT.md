# ASA Learning M0 Additive Backfill Report

**Task:** `LRN-M0-006`  
**Baseline:** `9290ab18490f376460a3b5f396f8b8a4fd905488`  
**Environment:** isolated disposable PostgreSQL database
`asalab_learning_m0_006_test`  
**Explicit asOf:** `2026-08-24T17:00:00.000Z`  
**Production:** untouched

## Result

The additive identity/activity convergence completed against a clone of the
current isolated test population. Migrations advanced the disposable schema
from `0085` to `0087`. Legacy rows were retained, no grade was derived from
legacy feedback, and a repeated convergence run created zero duplicate rows.

The final CURRENT snapshot contains three existing exact Submission canaries.
The two accepted M0-005 canaries remain present; one additional exact canary was
created by later baseline integration-test execution before this task cloned
`asalab_test`. This is test-data drift, not fabricated historical evidence.
All three were mapped as existing evidence and no duplicate Attempt/Submission
was created.

## BEFORE / AFTER / DELTA

| Metric | BEFORE (0085) | AFTER (0087) | DELTA |
|---|---:|---:|---:|
| learning units scanned by M0-005 analyzer | 2775 | 2775 | 0 |
| physical learner identities | 0 | 289 | +289 |
| StudentSeat links | 0 | 289 | +289 |
| school-scoped Account links | 0 | 19 | +19 |
| assignment Activity mappings, whole isolated DB | 6 | 16479 | +16473 |
| mapped assignments represented in analyzer learning units | 6 | 2775 | +2769 |
| exact Attempts backfilled in current population | 0 | 0 | 0 |
| exact Submissions backfilled in current population | 0 | 0 | 0 |
| existing exact Submission canaries mapped | 3 | 3 | 0 duplicates |
| legacy unresolved | 79 | 79 | 0 |
| selection conflicts | 0 | 0 | 0 |
| feedback metadata preserved | 178 | 178 | 0 lost |
| feedback-to-grade conversions | 0 | 0 | 0 |
| second-run created rows | — | 0 | 0 duplicates |

`learner_identities=289` exceeds the analyzer's precomputed future seed count
for assignment/seat units because the physical migration correctly covers
persisted seats that currently have no assignment. The analyzer remains a
learning-unit classifier; the new tables cover the complete school seat set.

## Backfill operations

| Source | Operation | Result |
|---|---|---|
| persisted StudentSeat | seed/reuse deterministic school learner and seat link | 289 identities and 289 links |
| persisted seat Account link | attach one Account link per physical school | 19 links; no cross-school merge |
| persisted direct/course assignment without Activity mapping | create deterministic Activity, immutable Version and mapping | 16473 mappings; no learner Attempt |
| assigned/not_started learner unit | no Attempt/Submission operation | no fabricated work evidence |
| legacy submitted without exact ProjectVersion | diagnostic `legacy_unresolved` artifact only | all 79 remain submitted compatibility rows with null result |
| existing exact Attempt/Submission/ProjectVersion | map existing evidence | three canaries; zero duplicates |
| legacy feedback | preserve source metadata and provenance | 178 preserved; zero grades |

## Exact-evidence fixture proof

The focused PostgreSQL fixture separately proves both sides of MIG-003:

- a legacy work row with exactly one immutable ProjectVersion at/before its
  submitted timestamp, exact assignment/seat/learner/project owner lineage and
  no Attempt/Result conflict creates exactly one `submitted` Attempt and one
  Submission referencing that existing version;
- the otherwise equivalent row without an immutable ProjectVersion creates
  neither Attempt nor Submission and receives `legacy_unresolved` metadata;
- no Evaluation, AssessmentResult, Gradebook pointer, numeric grade or display
  grade is created by this operation.

The current population itself produced zero new Attempts/Submissions because
all 79 legacy-only rows failed the exact ProjectVersion precondition. This is
the required truthful outcome, not a failure to reduce the unresolved count.

## Physical learner identity model

```text
learner_identities.id
  scoped by existing schools(tenant_id,id)

learner_identity_links
  student_seat -> exactly one learner for all time
  (school_id, account_id) -> at most one learner within that school
```

The physical mapping is existing
`classroom_student_seats(tenant_id,classroom_id)` →
`classrooms(tenant_id,id,school_id)` → `schools(tenant_id,id)`. No parallel
School, Organization or authentication system was added. One Account can link
to different learner IDs in different schools. Suspension/removal does not
delete identity or history. Project Principal ownership is unchanged.

## Migration batch model

`learning_migration_batches` stores the school, batch key, operation, mode,
source report digest, explicit `asOf`, state and lifecycle timestamps.
`learning_migration_artifacts` records artifact/source IDs, operation type,
automatic/manual mode, redacted persisted evidence and disabled state. Normal
future product writes can leave migration attribution null.

The runtime role has no direct table privileges and no EXECUTE privilege on
apply/rollback/report procedures. Procedures are owner-only,
`SECURITY DEFINER`, fixed-search-path functions. All new tables use forced RLS;
seat/school and Attempt/learner triggers reject incoherent physical lineage.

## Idempotency, concurrency and rollback

- repeated full-population apply: `created=0` for identities, links,
  Activities, Versions, mappings, Attempts and Submissions;
- concurrent identical fixture calls serialize through a school/batch advisory
  lock and database uniqueness; one call performs the insert and the other
  creates no duplicates;
- rollback marks only its batch/artifacts disabled, deactivates only batch-owned
  identity links/identities, removes only safe unreferenced batch mappings, and
  deletes zero immutable Attempts/Submissions;
- rerun after rollback restores the same deterministic learner IDs and produces
  no second historical evidence row;
- legacy assignments/work/feedback and unrelated/native evidence remain.

## Canonical resolver and adapters

One pure resolver is implemented at
`contexts/learning/domain/canonical-learning-state.ts`:

```text
direct project adapter ┐
course project adapter ├─> resolveCanonicalLearningState(input with explicit asOf)
quiz adapter           ┘
```

Equivalent direct/course/quiz inputs produce identical workflow/result/flag
semantics. The resolver preserves an older valid Gradebook selection during a
new in-progress revision, never selects an unpointed result, keeps
`changes_requested`, separates lifecycle visibility from history, and fails
closed for unknown access, invalid time or unresolved identity.

No controller or UI consumes the resolver yet. That remains M0-007.

## Security evidence

Focused negative tests prove:

- `asalab_app` cannot enumerate or mutate learner identities, links, batches or
  artifacts by UUID;
- it cannot invoke migration procedures;
- it remains non-superuser and without `BYPASSRLS`;
- a seat from another tenant/school cannot link to the learner UUID;
- same Account in two schools resolves to two learner IDs;
- two conflicting persisted seat identities are not guessed/merged;
- suspended and removed seats retain mappings/history.

## Evidence files and commands

Redacted generated reports were kept outside Git under the local temp evidence
directory. The committed report contains only aggregate counts.

```text
pnpm learning:migration:dry-run (0085 pre-report)
node tools/migrate.mjs --apply (two migrations, disposable DB)
node tools/learning-additive-backfill.mjs (first run + idempotent second run)
pnpm learning:migration:dry-run (0087 post-report)
pnpm vitest run tests/courses/learning-additive-backfill.pg.spec.ts
                 tests/courses/learning-identity-rls.pg.spec.ts
pnpm vitest run contexts/learning/testing/canonical-learning-state.spec.ts
                 tests/courses/learning-canonical-adapters.spec.ts
```

## Known gaps

- M0-007 must switch authorized teacher/learner surfaces to the canonical
  resolver and prove browser agreement; M0-006 performs no cutover.
- CURRENT native writers still create seat-owned Attempts; only the additive
  learner FK and compatibility adapter foundation exist here.
- Batch-disabled immutable exact evidence remains physically retained by
  design; canonical migration authority ignores it, and no production apply has
  occurred.
- `MIG-005`, `MIG-001` and Gradebook projection convergence remain
  `in_progress` until surface convergence/acceptance.
