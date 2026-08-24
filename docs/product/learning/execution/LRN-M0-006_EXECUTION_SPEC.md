# LRN-M0-006 — Additive Backfill / Canonical Convergence

**Task:** `LRN-M0-006`  
**Milestone:** `M0 — State Convergence`  
**Status:** IMPLEMENTED — OFFICIAL CI PENDING
**Baseline SHA:** `9290ab18490f376460a3b5f396f8b8a4fd905488`  
**Issue:** `#147`  
**Pull request:** `#148` (draft until evidence is complete)  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

## 1. Goal

Add, without cutting over existing surfaces, the school-scoped learner mapping,
batch-attributable additive convergence operations and one pure canonical
state/result resolver required to make CURRENT learning evidence convergent on
isolated test data without fabricating historical submissions or grades.

## 2. Non-goals and hard boundaries

- no production migration, backfill, write, deployment or cutover;
- no UI/controller/Gradebook surface cutover (`LRN-M0-007`);
- no new HTTP endpoint and no broad OpenAPI debt repair;
- no `ActivityRun`, `ActivityParticipation`, `CourseEnrollment`, audience,
  group or other M1 entity;
- no result revision or Gradebook redesign;
- no destructive legacy delete and no mass rewrite of CURRENT Attempt states;
- no Project Principal ownership rewrite;
- no conversion of `excellent|good|progress|redo` to a grade;
- no guessed identity merge by name, handle or email;
- no activation of M0-007 or M1-M7.

## 3. Requirement IDs

```text
MIG-003 — exact immutable evidence only
MIG-005 — one canonical status/result semantic resolver foundation
MIG-007 — additive, attributable and reversible before cutover
IDN-001 — physical stable school learner key (implementation portion)
IDN-003 — one Account remains split by school
IDN-004 — persisted seat-to-Account continuity within one school
```

`MIG-005` remains `in_progress` after this task because no surface is switched;
surface authority belongs to M0-007. `IDN-001/003/004` may become proven only
for the physical mapping and tested linking invariants, not for future M1
runtime ownership.

## 4. CURRENT evidence and baseline

| Evidence | Proven fact used by this task |
|---|---|
| `migrations/0020_self_service_school.sql` | A school is physically `schools(tenant_id,id)` inside the existing tenant/workspace model. |
| `migrations/0021_classroom_roster_studentseat.sql` | A seat is class-scoped and keeps lifecycle `issued|active|suspended|removed`. |
| `migrations/0050_account_learners.sql` | `classroom_student_seats.account_id` is persisted authenticated continuity evidence; one Account may have seats in several classes. |
| `classrooms_tenant_id_school_id_fkey` in baseline test schema | Canonical physical school scope is `classrooms.(tenant_id,school_id) -> schools.(tenant_id,id)`; no second Organization/School model is permitted. |
| `migrations/0077_learning_assessment_foundation.sql` | CURRENT immutable chain is ActivityVersion → Attempt → Submission → Result, with seat provenance and mutable Gradebook pointer. |
| `migrations/0083_quiz_engine.sql` | Quiz reuses the same Attempt/Submission/Result/Gradebook tables. |
| `LRN_M0_LEGACY_DRY_RUN_REPORT.md` | Test snapshot: 2772 units, 79 legacy-unresolved, two exact canonical submission canaries; `auto_reconcilable` is not permission to create Attempts. |
| read-only baseline SQL on `asalab_test` | All 79 legacy-only submitted units with no Attempt have zero immutable ProjectVersions at/before their legacy timestamp; therefore baseline exact Attempt/Submission creations must be zero. |
| `ADR-LEARNER-IDENTITY-001.md` | Decision B requires `learner_identities.id`, school scope and persisted links. |
| `LRN_M0_CANONICAL_STATE_RESULT_RESOLVER.md` | Normative DTO, precedence, explicit `asOf`, legacy compatibility and pointer rules. |

Baseline validation before changes:

- official main workflow `32746154760`: governance/code/PostgreSQL-RLS PASS on
  baseline SHA;
- `pnpm db:migrate:check`: PASS, 84 migration files through `0085`;
- focused M0-005 tests: 2 files, 25 tests PASS;
- local full `gate:data` after uncached build: 148/151 files and 1029/1035
  tests passed; six pre-existing shared-database timeout failures occurred in
  course-outline, M0-005 dry-run and Admin/Auth suites. This is not a Learning
  PASS and is retained as baseline environment evidence.

## 5. Existing contracts to reuse

- existing `tenants`, `schools`, `classrooms`, `classroom_student_seats`,
  `accounts` and `principals` stay authoritative in their domains;
- existing `(tenant_id, school_id)` and `(tenant_id, classroom_id)` composite
  lineage is reused;
- `classroom_student_seats.account_id` is the only automatic same-human
  continuity evidence; labels/handles/email are excluded;
- `classroom_activity_versions` remains the one assignment-to-version mapping;
- `learning_attempts`, `learning_submissions`, `assessment_results` and
  `gradebook_entries` remain the single runtime family;
- existing Project/ProjectVersion IDs and Project ownership are never changed;
- CURRENT Gradebook pointer remains compatibility result selection;
- M0-005 analyzer remains the mandatory preflight and is extended to accept
  the new known schema versions without weakening checksum validation.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/execution/LRN-M0-006_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_ADDITIVE_BACKFILL_REPORT.md
migrations/0086_learning_identity_foundation.sql
migrations/0087_learning_additive_backfill.sql
tools/learning-migration-dry-run.mjs
tools/learning-additive-backfill.mjs
contexts/learning/package.json
contexts/learning/project.json
contexts/learning/tsconfig.json
contexts/learning/index.ts
contexts/learning/domain/canonical-learning-state.ts
contexts/learning/testing/canonical-learning-state.spec.ts
tests/courses/learning-additive-backfill.pg.spec.ts
tests/courses/learning-canonical-adapters.spec.ts
tests/courses/learning-identity-rls.pg.spec.ts
```

`pnpm-lock.yaml` changes only if workspace importer discovery requires it.

## 7. Files explicitly out of scope

```text
schemas/openapi.yaml
apps/api/src/**
apps/web/src/**
existing migrations 0001..0085
Project Principal ownership and project_versions contents
Gradebook UI/read functions
M1-M7 runtime entities
production checkout, database, supervisor and deployment configuration
```

## 8. Database / migration

### 8.1 Physical school mapping

```text
logical school scope
  = existing classrooms.tenant_id + classrooms.school_id
  -> existing schools(tenant_id,id)

seat scope
  = classroom_student_seats(tenant_id,classroom_id)
  -> classrooms(tenant_id,id)
  -> the same classrooms.school_id
```

No new school/workspace/organization table is created.

### 8.2 Migration `0086_learning_identity_foundation.sql`

It is one transaction under the existing migration runner and contains only
additive schema, policies and guarded functions.

#### `learning_migration_batches`

```sql
id uuid PRIMARY KEY,
tenant_id uuid NOT NULL REFERENCES tenants(id),
school_id uuid NOT NULL,
batch_key varchar(160) NOT NULL,
operation_kind varchar(48) NOT NULL CHECK
  (operation_kind IN ('m0_identity_activity_convergence')),
mode varchar(16) NOT NULL CHECK (mode IN ('automatic','manual')),
state varchar(16) NOT NULL CHECK (state IN ('active','disabled','rolled_back')),
source_snapshot_digest varchar(64) NOT NULL CHECK (sha256 hex),
as_of timestamptz NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
completed_at timestamptz,
disabled_at timestamptz,
UNIQUE (tenant_id,id),
UNIQUE (tenant_id,school_id,batch_key),
FOREIGN KEY (tenant_id,school_id) REFERENCES schools(tenant_id,id),
CHECK ((state='active' AND disabled_at IS NULL) OR
       (state<>'active' AND disabled_at IS NOT NULL))
```

Indexes: `(tenant_id,school_id,state,created_at DESC)`.

#### `learner_identities`

```sql
id uuid PRIMARY KEY,
tenant_id uuid NOT NULL REFERENCES tenants(id),
school_id uuid NOT NULL,
state varchar(16) NOT NULL CHECK (state IN ('active','inactive')),
created_by_batch_id uuid,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (tenant_id,id),
UNIQUE (tenant_id,school_id,id),
FOREIGN KEY (tenant_id,school_id) REFERENCES schools(tenant_id,id),
FOREIGN KEY (tenant_id,created_by_batch_id)
  REFERENCES learning_migration_batches(tenant_id,id)
```

`id`, `tenant_id` and `school_id` are immutable through a trigger. Lifecycle
updates never delete academic history.

#### `learner_identity_links`

```sql
id uuid PRIMARY KEY,
tenant_id uuid NOT NULL,
school_id uuid NOT NULL,
learner_identity_id uuid NOT NULL,
link_kind varchar(16) NOT NULL CHECK (link_kind IN ('student_seat','account')),
seat_id uuid,
account_id uuid,
status varchar(16) NOT NULL CHECK (status IN ('active','inactive')),
created_by_batch_id uuid,
created_at timestamptz NOT NULL DEFAULT now(),
disabled_at timestamptz,
UNIQUE (tenant_id,id),
FOREIGN KEY (tenant_id,school_id,learner_identity_id)
  REFERENCES learner_identities(tenant_id,school_id,id),
FOREIGN KEY (seat_id) REFERENCES classroom_student_seats(id),
FOREIGN KEY (account_id) REFERENCES accounts(id),
FOREIGN KEY (tenant_id,created_by_batch_id)
  REFERENCES learning_migration_batches(tenant_id,id),
CHECK ((link_kind='student_seat' AND seat_id IS NOT NULL AND account_id IS NULL)
    OR (link_kind='account' AND account_id IS NOT NULL AND seat_id IS NULL)),
CHECK ((status='active' AND disabled_at IS NULL)
    OR (status='inactive' AND disabled_at IS NOT NULL))
```

Required uniqueness:

```sql
UNIQUE (seat_id) WHERE seat_id IS NOT NULL;
UNIQUE (school_id,account_id) WHERE account_id IS NOT NULL;
```

An insert/update trigger verifies that a seat's classroom resolves to the exact
same `(tenant_id,school_id)` and that an account link cannot cross school. The
second rule is backed by the unique school/account link plus persisted
seat/account evidence in the only writer; an Account in another school creates
a different learner row.

#### `learning_migration_artifacts`

```sql
id uuid PRIMARY KEY,
tenant_id uuid NOT NULL,
school_id uuid NOT NULL,
batch_id uuid NOT NULL,
artifact_kind varchar(32) NOT NULL CHECK (artifact_kind IN
  ('learner_identity','identity_link','learning_activity',
   'activity_version','activity_mapping','attempt','submission',
   'existing_exact_submission','legacy_unresolved','legacy_feedback')),
artifact_id uuid,
source_table varchar(64) NOT NULL,
source_id uuid NOT NULL,
operation_type varchar(48) NOT NULL,
operation_mode varchar(16) NOT NULL CHECK (operation_mode IN ('automatic','manual')),
source_evidence jsonb NOT NULL CHECK (jsonb_typeof(source_evidence)='object'),
created_at timestamptz NOT NULL DEFAULT now(),
disabled_at timestamptz,
UNIQUE (tenant_id,id),
UNIQUE (batch_id,artifact_kind,source_table,source_id,operation_type),
FOREIGN KEY (tenant_id,school_id,batch_id)
  REFERENCES learning_migration_batches(tenant_id,school_id,id)
```

The source JSON contains only persisted IDs/timestamps/classification, never
names, handles, email, project content or credentials.

#### Compatibility columns

```sql
ALTER TABLE learning_attempts
  ADD COLUMN learner_identity_id uuid NULL;
ALTER TABLE learning_attempts
  ADD FOREIGN KEY (tenant_id,learner_identity_id)
  REFERENCES learner_identities(tenant_id,id);
```

A trigger additionally verifies Attempt classroom school equals learner school.
Existing Attempts remain null and unchanged. No CURRENT writer is changed in
M0-006; adapters resolve existing ownership through the seat link. A future
native write may populate the stable key without migration-batch semantics.

### 8.3 Migration `0087_learning_additive_backfill.sql`

This migration defines, but never invokes, owner-only procedures:

```text
learning_m0_convergence_apply(batchKey, schoolId, sourceDigest, asOf)
learning_m0_convergence_rollback(batchId)
learning_m0_convergence_report(batchId)
```

All are `SECURITY DEFINER SET search_path = pg_catalog, pg_temp`; every table is
schema-qualified. `PUBLIC` and `asalab_app` receive no EXECUTE. The migration
owner is the only caller used by the isolated tool.

`apply` takes a transaction-scoped advisory lock derived from school + batch
key. It either creates the deterministic batch or locks/reuses the same batch;
a disabled/rolled-back batch is reactivated. It then performs:

| Source shape | Allowed operation | Created/mapped entity | Why safe | Rollback | Canonical outcome |
|---|---|---|---|---|---|
| any persisted seat in school | deterministic identity + seat link | one `learner_identity`, one seat link | seat/class/school FKs are exact | links/identity deactivated if batch-owned | stable learner provenance; workflow unchanged |
| persisted `seat.account_id`, no conflict | attach/reuse same school Account link | one account link per school | only persisted authenticated link; no label/email guess | batch link deactivated | same learner across classes in school |
| same Account in another school | separate identity/link | independent school learner | school is in deterministic seed and FK | independently reversible | no cross-school merge |
| assignment missing activity mapping | deterministic Activity/Version/Mapping from persisted assignment/course source | mapping only, no Attempt | assignment lineage is exact; one mapping PK | batch mapping removed; immutable orphan version retained and disabled in provenance | assigned unit remains not_started without fake work |
| legacy submitted + no direct exact ProjectVersion | diagnostic artifact only | `legacy_unresolved` artifact | immutable content is absent | diagnostic disabled | `submitted`, null result, legacy flags |
| legacy submitted + exactly one immutable ProjectVersion at/before submit, exact project/owner/school lineage, no Attempt/result/pointer conflict | deterministic Attempt #1 and Submission to that exact existing version | Attempt + Submission only; no Result/grade | all mandatory IDs/timestamp/digest derive from immutable persisted evidence | artifacts disabled; no legacy row deleted | `submitted`, no selected result |
| existing exact Attempt/Submission (the two M0-005 canaries) | map existing evidence to identity/provenance | artifact record only | duplicate Submission is forbidden and unnecessary | artifact disabled | same canonical state, legacy no longer authoritative when batch active |
| legacy feedback with exact work lineage | record metadata provenance only | no grade/result | badge remains original metadata | artifact disabled | workflow/result unchanged |
| ambiguous/orphan feedback | preserve source and diagnostic count | no target evidence | target is not guessed | N/A | unchanged |

Exact historical backfill preconditions are conjunctive:

1. exact school/tenant/assignment/seat/learner link;
2. mapped immutable ActivityVersion;
3. legacy work has persisted `submitted_at` and project ID;
4. exactly one existing immutable ProjectVersion for that exact project with
   `created_at <= submitted_at`;
5. ProjectVersion/Project tenant and ID agree;
6. Project owner equals persisted seat Principal or persisted Account Principal;
7. no Attempt for assignment+seat, no Submission, Result or Gradebook pointer;
8. deterministic attempt number is 1 and unique constraint accepts it;
9. deterministic client request ID/source-work unique artifact is absent;
10. persisted due time determines late state; no wall clock is used.

If any condition fails, only `legacy_unresolved` diagnostic metadata is written.
No ProjectVersion, mutable draft snapshot, Evaluation, Result, grade or feedback
conversion is created. On the baseline test snapshot condition 4 fails for all
79 legacy-only submissions, so exact Attempt/Submission delta is expected 0.

### 8.4 Determinism and constraints

UUIDs use one migration-owned immutable SHA-256 namespace function with RFC-4122
version/variant bits over stable persisted keys. Deterministic keys plus table
uniqueness are the second line of defense; `INSERT ... ON CONFLICT` is not the
only protection. Concurrent calls serialize per school/batch and all uniqueness
constraints remain authoritative.

### 8.5 RLS, grants and ownership

All four new tables:

- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`;
- `REVOKE ALL ... FROM PUBLIC, asalab_app`;
- tenant RLS policy is defense-in-depth for the owner/test policy role, not a
  grant of broad tenant read access;
- no sequence grants are needed (UUID keys);
- no app function accepts trusted tenant/school/learner/batch authority;
- migration functions are owner-only and fixed-search-path;
- runtime roles cannot enumerate, read or mutate identities or batches.

The future M0-007 reader must add scoped server functions; M0-006 deliberately
does not create an under-authorized client read path.

## 9. API / OpenAPI

`N/A — no HTTP endpoint or HTTP schema changes. schemas/openapi.yaml is not
modified.`

## 10. Transaction boundaries

- one migration file = one transaction under `tools/migrate.mjs`;
- one school convergence apply = one transaction plus advisory lock;
- batch row, identities, links, activity mappings and artifacts commit together;
- one rollback = one transaction that locks batch, disables its artifacts and
  reverses only safe batch-created mappings/links;
- analyzer pre-report is a separate repeatable-read read-only transaction and
  must complete before apply.

## 11. Idempotency / concurrency

First apply may create deterministic rows. Second apply with the same key,
source digest and `asOf` must return `created=0`, change no immutable evidence
and produce the same canonical classifications. Reusing a batch key with a
different digest or `asOf` is a hard error.

Concurrent identical apply calls are serialized and converge to the same IDs.
Conflicting school/account/seat lineage fails closed and creates a diagnostic,
not a duplicate identity. Unique indexes protect seat, school+Account, activity
mapping, attempt number, submission-per-attempt, client request and artifact
source identity.

## 12. Authorization / RLS negative matrix

Required tests:

| Case | Expected |
|---|---|
| foreign tenant learner UUID | no row / permission denied |
| same Account linked across different schools | two learner IDs; no cross-school FK/merge |
| seat from classroom A linked to learner in school B | trigger/constraint failure |
| direct UUID enumeration as `asalab_app` | permission denied |
| learner tries to read another learner | no executable client path + direct table denial |
| teacher outside classroom/school | no executable client path + direct table denial |
| runtime role mutates identity or invokes backfill | permission denied |
| runtime supplies batch/tenant/school authority | no granted function accepts it |

## 13. Migration / compatibility

Legacy rows remain. Existing runtime reads remain authoritative until M0-007.
Identity/activity mappings and resolver are foundation only. Existing Attempts
are resolved through seat compatibility; no historical state is rewritten.
Batch-created mappings become visible to the new adapter only while batch state
is active. Legacy-unresolved semantics remain exactly:

```text
workflowState = submitted
selectedResult = null
flags = legacy_unresolved + legacy_compatibility
```

## 14. Feature flag / rollout

`N/A — no product read path is switched. Batch state is a migration safety
control, not a user feature flag.`

## 15. Roll forward, rollback and rerun

### Roll forward

1. run M0-005 analyzer on a disposable/test DB and save pre-report;
2. apply 0086/0087 schema to that database;
3. invoke the owner-only tool with explicit test environment, batch key,
   source digest and `asOf`;
4. run report and canonical consistency tests.

### Rollback

`learning_m0_convergence_rollback` locks the batch, marks it `rolled_back`,
sets artifact `disabled_at`, deactivates only batch-owned identity links and
identities that have no independent/native link, and removes only
batch-created `classroom_activity_versions` mappings that no Attempt references.
Immutable Activity/Version or exact Submission evidence is never deleted;
disabled provenance prevents it becoming canonical migration authority. Legacy
rows and unrelated/native evidence remain unchanged.

### Re-run after rollback

Applying the same batch key/digest/`asOf` reactivates/recreates the same
deterministic IDs and mappings. It must not create a second learner, Attempt,
Submission or provenance row. A different source digest requires a new key.

## 16. Canonical resolver implementation

One pure function lives at:

```text
contexts/learning/domain/canonical-learning-state.ts
resolveCanonicalLearningState(input)
```

It implements the M0-004 DTO and precedence exactly, accepts explicit `asOf`,
never reads wall clock, keeps valid older Gradebook selection with
`revision_in_progress`, does not auto-select unpointed results, and throws a
typed contract error on invalid time, unknown state, unresolved identity or
incoherent lineage.

Three adapters only assemble/validate the same semantic input:

```text
adaptDirectProjectCanonicalInput
adaptCourseProjectCanonicalInput
adaptQuizCanonicalInput
  -> resolveCanonicalLearningState
```

They may differ in provenance source names, never in workflow/result/flag rules.

## 17. Unit tests

```text
LRN-M0-006-U01 explicit asOf and deterministic flag order
LRN-M0-006-U02 assigned/no evidence => not_started, no Attempt
LRN-M0-006-U03 legacy submitted/no exact evidence => submitted + legacy flags
LRN-M0-006-U04 changes_requested remains changes_requested
LRN-M0-006-U05 valid old selected result + new in_progress => revision_in_progress
LRN-M0-006-U06 result without pointer => unselected_result, null selectedResult
LRN-M0-006-U07 invalidated Attempt never auto-selects itself
LRN-M0-006-U08 suspended/removed lifecycle preserves history and restricts access
LRN-M0-006-U09 unknown state/time/identity fails closed
LRN-M0-006-U10 direct/course/quiz equivalent evidence has equal semantics
```

## 18. Integration / migration tests

```text
LRN-M0-006-I01 email-free seat seeds one learner
LRN-M0-006-I02 seat later linked Account retains learner
LRN-M0-006-I03 one Account/two classes/same school => one learner
LRN-M0-006-I04 same Account/two schools => two learners
LRN-M0-006-I05 ambiguous/conflicting identity remains unresolved
LRN-M0-006-I06 baseline legacy submitted/no ProjectVersion remains unresolved
LRN-M0-006-I07 synthetic exact immutable ProjectVersion case backfills once
LRN-M0-006-I08 existing two exact canaries map and create no duplicate
LRN-M0-006-I09 second apply creates zero duplicates
LRN-M0-006-I10 concurrent apply creates zero duplicates
LRN-M0-006-I11 rollback touches only batch artifacts
LRN-M0-006-I12 rerun after rollback restores deterministic IDs
LRN-M0-006-I13 legacy feedback count preserved and grade conversions = 0
LRN-M0-006-I14 valid selection/pointer not changed
LRN-M0-006-I15 suspended/removed identity/history retained
LRN-M0-006-I16 migration checksum and analyzer repeatability
```

All write tests use a disposable `*_test` database. No local-dev write is
needed. Before every backfill execution the M0-005 analyzer runs and its
redacted deterministic report is saved outside Git or as an approved redacted
artifact.

## 19. Browser E2E

`N/A — no UI/controller/read surface changes. M0-007 owns browser cutover.
Exact domain/query/data-lineage tests are sufficient for M0-006.`

## 20. Performance and observability

- set-based identity/activity operations, no per-row application loop;
- indexes cover school/state, seat, school+Account and batch source lookup;
- advisory lock scope is one school/batch, not the whole database;
- report records BEFORE/AFTER/DELTA, elapsed time and deterministic counts;
- source evidence is redacted IDs/counts only.

## 21. Deployment preflight

Repository `.github/workflows/spec-validation.yml` runs migrations only against
an isolated ephemeral PostgreSQL container and has read-only GitHub permissions;
it has no deploy job. The external `Assolab Production Supervisor` launcher
starts the fixed existing checkout and contains no `git fetch`, `git pull` or
migration command. Therefore merging Git does not itself mutate production.
Production remains on its current checkout/schema until a separate owner-
authorized operator action. This task must not invoke that action.

## 22. Required gates

```text
pnpm db:migrate:check
focused canonical resolver tests
focused additive backfill/RLS/rollback tests
M0-005 analyzer repeatability before and after
pnpm contracts:check
pnpm control-plane:check
pnpm gate:governance
NX_SKIP_NX_CACHE=true pnpm gate:code
pnpm gate:data
official GitHub PostgreSQL tests and RLS job
git diff --check
```

## 23. Acceptance checklist

- [x] M0-005 accepted and only M0-006 active
- [x] physical school learner model and exact constraints implemented
- [x] migration batches/artifacts persistent and app-inaccessible
- [x] ordinary assigned/not_started units create no Attempt
- [x] exact-evidence gate creates/matches only truthful immutable evidence
- [x] all baseline legacy-unresolved rows remain truthful
- [x] feedback-to-grade conversions equal zero
- [x] pure resolver and three adapters implemented once
- [x] idempotency and concurrent uniqueness proven in DB
- [x] rollback and deterministic rerun proven
- [x] RLS/security negative matrix PASS
- [x] BEFORE/AFTER/DELTA report published
- [ ] migrations/checksums, focused and full gates complete
- [ ] official PostgreSQL/RLS CI PASS
- [x] production untouched
- [x] ledger updated only to the evidence actually proven
- [x] stop without M0-007

## 24. Evidence (fill after implementation)

```text
final SHA: pending publication
migration evidence: 0086/0087 applied in disposable asalab_learning_m0_006_test; checksums valid; second run created zero rows
focused tests: PASS — 7 files / 54 tests, including PostgreSQL, RLS, rollback, rerun, adapters and resolver
full gates: contracts/control-plane/governance/gate:code PASS uncached; gate:data 1056/1061 tests PASS with five 5-second timeout failures, all M0-006 tests PASS; four affected files repeated serially with 28/29 PASS and the remaining pre-existing Admin/Auth query PASS at 7.1 seconds under a 20-second diagnostic timeout
official CI: pending
browser: N/A — no surface change
production: untouched
known gaps: M0-007 surface convergence remains separately blocked; local full gate is not claimed PASS because the repository-wide 5-second timeout gate remained red
```
