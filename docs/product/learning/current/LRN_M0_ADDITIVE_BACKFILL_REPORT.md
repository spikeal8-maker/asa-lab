# ASA Learning M0 Additive Backfill Report

**Task:** `LRN-M0-006`

**Baseline:** `9290ab18490f376460a3b5f396f8b8a4fd905488`

**Environment:** isolated disposable PostgreSQL database
`asalab_learning_m0_006_test`

**Explicit asOf:** `2026-08-24T17:00:00.000Z`

**Production:** untouched

## Revised acceptance result

Owner review rejected three semantics in the first `0087` implementation:
inferred `100/60` grading, timestamp-only ProjectVersion reconstruction and the
claim that disabling artifacts behaviorally rolls immutable synthetic evidence
back for CURRENT readers. Those claims are withdrawn.

Published `0086/0087` checksums are unchanged. Corrective migration `0088` is
now authoritative: compatibility ActivityVersions are explicitly ungraded and
non-reusable, every legacy-only submission stays unresolved, and the procedure
cannot run without an isolated-test session attestation. Production convergence
remains prohibited until M0-007 reader cutover is separately accepted.

## Original population evidence

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
| legacy submitted without persisted canonical Submission linkage | diagnostic `legacy_unresolved` artifact only | all 79 remain submitted compatibility rows with null result |
| existing exact Attempt/Submission/ProjectVersion | map existing evidence | three canaries; zero duplicates |
| legacy feedback | preserve source metadata and provenance | 178 preserved; zero grades |

## Submission-linkage proof

The corrected PostgreSQL fixtures prove MIG-003 fail-closed:

- a legacy work row with exactly one immutable ProjectVersion before its
  submitted timestamp, matching project ownership and complete tenant lineage
  still creates neither Attempt nor Submission because no persisted linkage
  proves those exact bytes were submitted;
- the equivalent cross-tenant Account-owned project case also remains
  `legacy_unresolved`;
- a row without any immutable ProjectVersion has the same unresolved outcome;
- no Evaluation, AssessmentResult, Gradebook pointer, numeric grade or display
  grade is created by this operation.

The current population itself produced zero new Attempts/Submissions because
all 79 legacy-only rows lacked persisted canonical Submission linkage. A
timestamp is never promoted to exact evidence.

## Migration compatibility content

Generated assignment snapshots are registered in
`learning_migration_compatibility_activity_versions` with:

```text
grading_semantics = unknown
reusable_authored_content = false
```

The underlying CURRENT schema requires positive `max_points`, so the structural
value is `1`; it is not a scale. `scoring_policy.kind` is
`migration_compatibility`, includes `gradingSemantics=unknown` and contains no
`passThreshold`. The registry explicitly excludes these versions from the
canonical reusable-authored-content contract; M0-007 readers must enforce that
classification when surfaces are cut over.

If 0087 was previously executed and persisted one of its deterministic
compatibility ActivityVersions with inferred manual 100/60 policy, 0088 aborts
transactionally. Those immutable rows are not relabeled as trustworthy or
rewritten in place; that database requires an explicit reader-aware replacement
mapping/remediation before 0088 can install.
The guard follows retained `map_activity_version` migration artifacts, not only
the live classroom mapping, so an immutable compatibility version orphaned by
an 0087 rollback is blocked as well.

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

`learning_submissions.project_tenant_id` preserves the separate lineage of an
Account-owned personal project when its classroom assignment belongs to another
tenant. The classroom tenant remains on Attempt/Submission; the project tenant,
project and immutable ProjectVersion are checked together. A focused PostgreSQL
fixture proves this cross-tenant exact-evidence path.

## Migration batch model

`learning_migration_batches` stores the school, batch key, operation, mode,
source report digest, explicit `asOf`, state and lifecycle timestamps.
`learning_migration_artifacts` records artifact/source IDs, operation type,
automatic/manual mode, redacted persisted evidence and disabled state. Normal
future product writes can leave migration attribution null.

The runtime role has no direct table privileges, including on the compatibility
registry, and no EXECUTE privilege on
apply/rollback/report procedures. Procedures are owner-only,
`SECURITY DEFINER`, fixed-search-path functions. All new tables use forced RLS;
seat/school and Attempt/learner triggers reject incoherent physical lineage.

## Idempotency, concurrency and rollback

- repeated full-population apply: `created=0` for identities, links,
  Activities, Versions, mappings, Attempts and Submissions;
- a complete rerun reports physical BEFORE equal to AFTER instead of presenting
  the existing identity/link population as newly created;
- a pre-report from a different `_test` database is rejected by database
  fingerprint before any migration operation runs;
- concurrent identical fixture calls serialize through a school/batch advisory
  lock and database uniqueness; one call performs the insert and the other
  creates no duplicates;
- rollback marks only its batch/artifacts disabled, deactivates only batch-owned
  identity links/identities, removes only safe unreferenced batch mappings, and
  deletes zero immutable Attempts/Submissions;
- M0-006 creates no legacy Attempt/Submission at all: behavioral rollback
  against CURRENT readers is not claimed, and production backfill is forbidden
  until M0-007 cutover;
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
- direct convergence without isolated-test session attestation is rejected;
- `--apply` ignores generic `DATABASE_URL` and requires a dedicated URL, exact
  database name and exact `APPLY:<name>` confirmation before connecting.
- the migration Compose container does not receive generic `DATABASE_URL`;
  migration, role provisioning and optional dev seed share the attested
  `MIGRATION_DATABASE_URL` only. Compose validation injects deliberately
  different generic/dedicated URLs and fails if the generic value leaks in.
- a pre-existing bootstrap `.env` that lacks any non-empty dedicated migration
  URL/name/confirmation stops before Compose with an actionable upgrade error;
  base Compose also has no migration URL/password fallback. Empty direct-
  Compose values reach the fail-closed runner and are rejected before connect;
  explicit test/staging overlays remain renderable.
- dev API/Vite child-process builders strip all `MIGRATION_*` attestations, so
  an admin migration credential loaded from `.env.local` cannot reach runtime
  children.

## Corrected acceptance evidence

Fresh disposable database: `asalab_learning_m0_006_acceptance_test`.

```text
schema migration: 0001..0088 PASS
focused migration/RLS/tooling/resolver/compatibility: 10 files, 72 tests PASS
full data gate: 155 files / 1069 tests PASS; focused RLS 15/15 PASS
uncached code gate: PASS; Nx cache skipped
fixture convergence: identities 22 -> 28; mappings 14 -> 14
legacy unresolved after: 6
legacy Attempts created: 0
legacy Submissions created: 0
grade conversions: 0
second-run creations: 0
productionTouched: false
```

## Evidence files and commands

Redacted generated reports were kept outside Git under the local temp evidence
directory. The committed report contains only aggregate counts.

```text
pnpm learning:migration:dry-run (0085 pre-report)
node tools/migrate.mjs --apply (explicit URL/name/confirmation, disposable DB)
node tools/learning-additive-backfill.mjs (first run + idempotent second run)
pnpm learning:migration:dry-run (0088 post-report)
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
- M0-006 intentionally has no legacy Attempt/Submission production backfill;
  an accepted submission-linkage contract and CURRENT-reader cutover are still
  required before such a migration can be reconsidered.
- Schema-only migrations were inadvertently applied once to local
  `asalab_dev` while diagnosing review feedback because the migration runner
  previously read `DATABASE_URL`; no convergence/backfill procedure ran there.
  Production was untouched. The corrected runner never treats `DATABASE_URL`
  as an apply target, the migration container does not receive it, and three
  matching target attestations are required.
- Any database where 0087 already materialized inferred 100/60 compatibility
  versions is deliberately blocked by 0088 pending immutable-version,
  reader-aware remediation; automatic in-place mutation is not permitted.
- `MIG-005`, `MIG-001` and Gradebook projection convergence remain
  `in_progress` until surface convergence/acceptance.
