# LRN-M1-002 — Execution Spec

**Task:** `LRN-M1-002`  
**Milestone:** `M1 — Universal Delivery`  
**Baseline SHA:** `b8f21534ff48f4ec532df3866c4677e1b2d2a63d`  
**Issue:** `#156`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Add one canonical, school-scoped `CourseEnrollment` membership row between the
existing `classroom_course_runs` CourseRun and the stable
`learner_identities.id`, with an idempotent `assigned → active → withdrawn`
lifecycle and no progress, completion or activity-runtime semantics.

## 2. Non-goals

- no second CourseRun table or CourseRun lifecycle rewrite;
- no `ActivityRun`, `ActivityParticipation`, audience engine, group, roster
  watcher, late-join propagation or course materialization;
- no enrollment progress, completion, grade, policy override or activity-level
  setting;
- no withdrawn reactivation/rejoin policy;
- no existing learner CourseRun reader or UI rewrite;
- no historical enrollment backfill;
- no HTTP endpoint or OpenAPI change;
- no production migration, backfill, deployment, feature switch or restart;
- no M1-003+, M2-M7 work.

## 3. Requirement IDs

```text
AUD-001 — assigned/active/withdrawn only; completion is not enrollment state
AUD-002 — explicit meaningful learner interaction may activate enrollment
AUD-003 — withdrawal preserves the enrollment history
IDN-003 — CourseEnrollment portion only; overall remains in_progress
DB-CON-005 — unique CourseRun + LearnerIdentity
DB-CON-007 — runtime row has derivable tenant/school lineage
ARCH-001 — remains in_progress
ARCH-002 — untouched
```

## 4. CURRENT evidence

### 4.1 Physical CourseRun

`migrations/0068_classroom_course_runs.sql` defines
`classroom_course_runs` as the CURRENT CourseRun: it pins one `course_version_id`
inside one `classroom_id`, records the assigning principal and stores the
existing `open|closed` compatibility lifecycle. The table has `(tenant_id,id)`
uniqueness and a composite `(tenant_id,classroom_id)` FK to `classrooms`.
`migrations/0075_course_lesson_blocks.sql` materializes its immutable course
lesson snapshot into `classroom_course_run_lessons`.

This is safe to reuse. Enrollment membership does not depend on changing the
CURRENT run status vocabulary. The TARGET run lifecycle remains later work and
must not be inferred in M1-002.

### 4.2 CURRENT learner access

- `classroom_course_runs_for_seat_v2` reads active StudentSeat classroom scope;
- `classroom_course_runs_for_account_v2` fans out over active account-linked
  seats;
- existing CourseRun visibility is class-wide and does not persist a historical
  per-learner membership snapshot;
- those readers remain byte-for-byte unchanged in this task.

### 4.3 Stable learner owner

`migrations/0086_learning_identity_foundation.sql` defines
`learner_identities` with `(tenant_id,school_id,id)` uniqueness and immutable
school lineage. `learner_identity_links` maps StudentSeat and school-scoped
Account subjects to that stable key. A seat link is unique per seat and an
account link is unique per `(school_id,account_id)`.

The M0 backfill in `migrations/0087_learning_additive_backfill.sql` converges
same-school linked seats/account evidence onto one learner identity. It does not
make StudentSeat or Account the historical owner.

### 4.4 Exact school proof

The enrollment row stores `tenant_id` and `school_id` and uses:

```text
(tenant_id, course_run_id) → classroom_course_runs
course_run.classroom_id → classrooms.school_id
(tenant_id, school_id, learner_identity_id) → learner_identities
```

A BEFORE INSERT/UPDATE guard derives the run classroom school and rejects any
stored school/tenant mismatch. Therefore a school-A run cannot reference a
school-B learner even if a caller supplies both UUIDs.

### 4.5 Audit convention

`migrations/0002_teacher_portal.sql` defines append-only, tenant-RLS
`audit_events`. It supports an optional legacy `actor_user_id`; the canonical
principal and fixed command source are therefore stored in `payload_json`
without creating a second audit system.

## 5. Existing contracts to reuse

```text
classroom_course_runs
classrooms
learner_identities
learner_identity_links
principals
classroom_memberships
legacy_user_account_links
audit_events
app.tenant_id transaction context
asalab_app narrow SECURITY DEFINER function pattern
```

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/project-map/PROJECT_MAP.md
docs/project-map/project-map.yaml
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/execution/LRN-M1-002_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M1_COURSE_ENROLLMENT_REPORT.md
migrations/0092_course_enrollments.sql
tests/courses/course-enrollments.pg.spec.ts
package.json
```

## 7. Files explicitly out of scope

```text
migrations/0001..0091
schemas/openapi.yaml
apps/api/**
apps/web/**
contexts/learning/**
existing CourseRun reader functions
production configuration and data
```

## 8. Database / migration

Migration `0092_course_enrollments.sql` is the next free number on the recorded
baseline and is additive.

`course_enrollments` contains:

- UUID key plus `tenant_id`, `school_id`, `course_run_id`,
  `learner_identity_id`;
- exactly `assigned|active|withdrawn`;
- `assigned_at`, nullable `activated_at`, nullable `withdrawn_at`;
- assigning, activating and withdrawing principal provenance where applicable;
- fixed operation source metadata and `created_at`, `updated_at`;
- composite run and learner FKs;
- UNIQUE `(course_run_id,learner_identity_id)` as the concurrency backstop;
- lifecycle/timestamp CHECKs;
- immutable lineage and transition guard; no hard delete;
- forced tenant RLS and no direct runtime role table grants.

No existing rows are updated and no historical rows are inserted.

## 9. API / OpenAPI

N/A — no HTTP route is needed for the storage/domain primitive. The migration
adds only narrow server-side database commands. `schemas/openapi.yaml` remains
unchanged, so no undocumented user-facing endpoint is introduced.

## 10. Transaction boundaries

Each assign, activate or withdraw function performs authorization, state change
and one append-only audit event in the caller transaction. Failure rolls back
all parts together.

## 11. Idempotency / concurrency

- assign uses INSERT ON CONFLICT against the run+learner UNIQUE constraint and
  returns the existing logical enrollment;
- concurrent identical assign calls produce one row;
- repeated active activation returns the same row without changing timestamps;
- repeated withdrawal returns the same withdrawn row;
- withdrawn enrollment is never reactivated or replaced;
- the same learner in another CourseRun receives a distinct enrollment.

## 12. Authorization / RLS

- assign and withdraw require a principal whose account has owner/co-teacher
  membership in the exact run classroom and whose active tenant matches;
- activation requires the actor principal's seat/account subject to resolve,
  in the run school, to the enrollment's stable learner identity;
- a learner cannot assign, withdraw, or activate another learner;
- outside-classroom teachers and direct UUID enumeration fail closed;
- client-supplied tenant/school values are not accepted by commands;
- cross-school lineage is rejected by the table guard and composite FK;
- `asalab_app` receives only function EXECUTE and no broad table mutation/read.

## 13. Migration / compatibility

Existing class-wide CourseRun semantics and all current readers remain intact.
There is no backfill because a snapshot of today's roster would fabricate past
membership. Future audience/materialization tasks may create enrollments only
from evidence available at their own transaction boundary.

## 14. Feature flag / rollout

N/A — additive unused primitive; no caller is switched and production action is
not authorized.

## 15. Rollback

Before adoption, callers can simply omit the new commands; all legacy readers
continue unchanged. The additive table must not be dropped after future runtime
references exist. No production rollback is exercised in this task.

## 16. Unit tests

N/A — the implementation is a PostgreSQL storage/authorization contract and is
proved by isolated integration tests.

## 17. Integration tests

```text
LRN-M1-002-I01 create assigned enrollment
LRN-M1-002-I02 create retry returns same enrollment
LRN-M1-002-I03 concurrent create leaves one row
LRN-M1-002-I04 assigned to active
LRN-M1-002-I05 repeated activation is idempotent
LRN-M1-002-I06 assigned to withdrawn
LRN-M1-002-I07 active to withdrawn
LRN-M1-002-I08 withdrawn row and timestamps remain
LRN-M1-002-I09 completion values/columns are absent
LRN-M1-002-I10 same run and learner is unique
LRN-M1-002-I11 same learner in different runs is separate
LRN-M1-002-I12 two same-school seats/account resolve to one enrollment
LRN-M1-002-I13 same account in two schools has separate identities
LRN-M1-002-I14 cross-school insert and command are rejected
LRN-M1-002-I15 outside teacher is rejected
LRN-M1-002-I16 learner cannot assign or withdraw
LRN-M1-002-I17 learner cannot activate another learner
LRN-M1-002-I18 asalab_app direct UUID read/mutation is denied
LRN-M1-002-I19 no ActivityRun/Participation rows are created
LRN-M1-002-I20 current CourseRun readers and references remain unchanged
LRN-M1-002-I21 audit events are append-only and emitted once per transition
LRN-M1-002-I22 withdrawn to active is rejected
LRN-M1-002-I23 migration fresh apply and repeat apply zero pending
LRN-M1-002-I24 M0 and M1-001 regressions remain green
```

## 18. Browser E2E

N/A — no UI or existing learner reader changes. Browser evidence would not add
proof beyond the exact isolated SQL lineage and authorization matrix.

## 19. Security negative tests

Cross-school learner, outside teacher, learner self-assignment, foreign learner
activation, learner withdrawal, direct table UUID enumeration, direct runtime
mutation and withdrawn reactivation all fail closed.

## 20. Performance considerations

Assign is one indexed run lookup, one learner lookup, one classroom membership
authorization and one UNIQUE insert. There is no roster scan or backfill.

## 21. Acceptance checklist

- [ ] existing CourseRun reused without reader rewrite
- [ ] stable LearnerIdentity FK and school lineage physically enforced
- [ ] assigned/active/withdrawn lifecycle only
- [ ] idempotent activation and withdrawal with history
- [ ] run+learner idempotency and concurrency
- [ ] no fabricated backfill
- [ ] narrow RLS/security commands and append-only audit
- [ ] migration fresh/repeat evidence
- [ ] at least twenty required scenarios
- [ ] prior M0/M1-001 regression
- [ ] ledger and final evidence report updated
- [ ] governance/repository gates

## 22. Evidence

Evidence will be consolidated in
`docs/product/learning/current/LRN_M1_COURSE_ENROLLMENT_REPORT.md`. No production
action is permitted or claimed.
