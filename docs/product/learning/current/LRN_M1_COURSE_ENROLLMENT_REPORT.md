# LRN-M1-002 — CourseEnrollment Evidence Report

## TASK

`LRN-M1-002 — CourseEnrollment`, Issue `#156`, PR `#157`.

Baseline: `b8f21534ff48f4ec532df3866c4677e1b2d2a63d`.

## STATUS

Acceptance evidence is complete for the isolated CourseEnrollment primitive.
Owner acceptance remains pending. No production action is included or claimed.

## COURSEENROLLMENT MODEL

`course_enrollments` is one stable learner's membership in one concrete
CourseRun. Its owner key is `learner_identities.id`, never `seat_id` or
`account_id`.

It stores membership lineage, the three lifecycle timestamps, transition actor
provenance and fixed command sources. It intentionally has no progress,
completion, grade, attempt policy, due-date override, unlock or excusal fields.

## PHYSICAL COURSERUN REUSE

The implementation reuses `classroom_course_runs` from migration `0068`.
`classroom_course_run_lessons`, `course_versions` and all current course reader
functions remain unchanged. No parallel CourseRun table or runtime was created.

The CURRENT `open|closed` CourseRun lifecycle remains a compatibility contract.
The broader TARGET `active|closed|cancelled|archived` convergence is not needed
to represent enrollment membership and is outside M1-002.

## SCHOOL/LearnerIdentity LINEAGE

```text
course_enrollments.(tenant_id,course_run_id)
→ classroom_course_runs.(tenant_id,id)
→ classrooms.(tenant_id,id,school_id)

course_enrollments.(tenant_id,school_id,learner_identity_id)
→ learner_identities.(tenant_id,school_id,id)
```

The lineage trigger derives the CourseRun classroom school and rejects a stored
tenant/school mismatch before write. A direct cross-school INSERT is rejected in
the database, not merely by a controller. The row also exposes
`(tenant_id,school_id,id)` uniqueness for future school-scoped references.

## LIFECYCLE

Only these states are accepted:

```text
assigned
active
withdrawn
```

The database CHECK and transition trigger reject every other value and every
transition except `assigned → active`, `assigned → withdrawn`, and
`active → withdrawn`. Assignment identity/provenance is immutable. DELETE is
rejected so withdrawal cannot erase membership history.

## ACTIVATION

`course_enrollment_activate(actorPrincipalId,enrollmentId)` is an explicit
server-side command for a meaningful learner interaction. It does not run on a
GET, timer, page view, course completion or cron.

The command resolves the actor principal through an active StudentSeat or
school-scoped Account link to the enrollment's exact LearnerIdentity and
requires an active seat in the CourseRun classroom. A second activation returns
the same row and original `activated_at` without a second audit event.

No HTTP route invokes the command in M1-002. Future materialized learner actions
must pass the session-derived principal from the server; clients never receive
direct SQL access.

## WITHDRAWAL

`course_enrollment_withdraw` requires owner/co-teacher membership in the exact
CourseRun classroom and the active tenant. It transitions assigned or active to
withdrawn, retains `assigned_at` and any `activated_at`, and records
`withdrawn_at`. Repeated withdrawal returns the same row/timestamp. Withdrawn
reactivation is rejected; rejoin policy remains a future audience/lifecycle
decision.

## COMPLETION SEPARATION

Completion is absent from the status CHECK and the physical table. There is no
`completed`, `completed_at`, `progress_percent`, `final_grade`, `passed`,
`failed`, `excused` or activity override storage. Course completion remains a
future server-derived projection under M4.

## IDEMPOTENCY

UNIQUE `(course_run_id,learner_identity_id)` is the final source of truth.
Assign uses `INSERT ... ON CONFLICT DO NOTHING` and returns the existing row.
Retry never replaces a withdrawn enrollment or creates a second logical
membership.

## CONCURRENCY

Two simultaneous identical assign calls were executed through separate runtime
role connections. They returned the same enrollment ID; exactly one call
created the row and the database count remained one. Activation and withdrawal
lock the membership row before transition, so repeated/concurrent commands
observe one serialized lifecycle.

## EXISTING RUN COMPATIBILITY

The isolated regression captures `classroom_course_runs_for_seat_v2` before and
after enrollment assignment. CourseRun ID, Course ID, CourseVersion ID and
`open` status are unchanged. M0 canonical projections and M1-001 authoring
regressions also remain green.

## BACKFILL DECISION

No backfill. CURRENT CourseRun visibility is class-wide and derived from the
current active seat/account roster. It does not prove which learner was a
member at a historical time. Copying today's roster would fabricate historical
enrollment. Future audience/materialization tasks may create memberships only
from evidence present in their own transaction.

## RLS/SECURITY

- forced tenant RLS on `course_enrollments`;
- no direct table SELECT/INSERT/UPDATE/DELETE grant to `asalab_app`;
- only three narrow SECURITY DEFINER commands are executable by runtime;
- active tenant must match the stored CourseRun tenant;
- assign/withdraw require exact classroom owner/co-teacher membership;
- activation requires the actor's active seat/account provenance to resolve to
  the exact learner and exact classroom;
- outside teacher, learner self-assignment, learner withdrawal, foreign learner
  activation, suspended-seat activation, cross-school lineage and direct UUID
  enumeration are denied by integration evidence.

As with the repository's existing guarded-function pattern, the database actor
parameter is supplied from the already authenticated server session. No new
client-facing command or trust in a client-supplied tenant/school was added.

## AUDIT EVIDENCE

The existing append-only `audit_events` table records exactly one event for
each real transition:

```text
course_enrollment.assigned
course_enrollment.activated
course_enrollment.withdrawn
```

Retries emit no duplicate audit record. Payload contains the canonical actor
principal and fixed source. Teacher audit attribution uses the exact
`classroom_memberships.user_id` row that authorized the command, never an
ambiguous legacy account link; learner activation keeps nullable
`actor_user_id` and records the canonical principal in payload. Audit UPDATE
remains rejected by the existing immutable trigger. No second audit system was
created.

## MIGRATION

`migrations/0092_course_enrollments.sql` was selected after confirming `0091`
was the highest Learning migration and `0090` was already used by another lane.

Final isolated evidence uses `asalab_test` on local port `5433`:

```text
pnpm db:test:provision --reset
→ test database dropped/created
→ Applied 91 migration files through 0092
→ db:migrate PASS

pnpm db:migrate
→ Applied 0 migration(s)
→ db:migrate PASS

pnpm db:migrate:check
→ validated migrations through 0092
→ PASS
```

No development or production database was migrated.

## OPENAPI

N/A. No HTTP endpoint or DTO was added, so `schemas/openapi.yaml` is unchanged.

## TESTS

Focused command:

```text
pnpm test:learning-m1-002
→ 1 file, 15 tests passed
```

Those tests prove at least the following 24 required scenarios:

1. create assigned enrollment;
2. retry returns the same enrollment;
3. concurrent create produces one row;
4. assigned to active;
5. activation retry preserves timestamp;
6. assigned to withdrawn;
7. active to withdrawn;
8. withdrawn row/history preserved;
9. withdrawn reactivation rejected;
10. hard delete rejected;
11. completion/grade/progress fields absent;
12. same run+learner unique;
13. same learner across runs is separate;
14. two same-school seats/account converge on one identity/enrollment;
15. one Account across schools has separate learner identities;
16. cross-school command rejected;
17. cross-school direct insert physically rejected;
18. outside teacher rejected;
19. learner self-assignment rejected;
20. learner withdrawal rejected;
21. foreign learner activation rejected;
22. suspended-seat activation rejected;
23. runtime direct UUID read/mutation denied;
24. no ActivityRun/ActivityParticipation runtime created;
25. current CourseRun reader projection unchanged;
26. audit events append once per real transition.

Regression command:

```text
pnpm vitest run \
  tests/courses/learning-identity-rls.pg.spec.ts \
  tests/courses/learning-additive-backfill.pg.spec.ts \
  tests/courses/learning-surface-convergence.pg.spec.ts \
  tests/courses/learning-activity-version-convergence.pg.spec.ts \
  apps/api/src/learning-activities.controller.spec.ts
→ 5 files, 35 tests passed
```

Final repository evidence:

```text
NX_SKIP_NX_CACHE=true pnpm gate:repository
→ gate:governance PASS
→ gate:code PASS
→ gate:data PASS
→ full Vitest: 170 files, 1162 tests passed
→ RLS: 1 file, 15 tests passed
→ gate:repository PASS
```

Nx explicitly reported `Cache: Skipped (--skip-nx-cache)` for lint, typecheck
and build, so those tasks executed anew. `compose:check` performed static checks
but reported `SKIPPED` for rendered Docker validation because Docker CLI is not
installed on this host; the repository gate treats that condition as a truthful
skip, not a Docker PASS.

## BROWSER EVIDENCE

N/A. This task changes no UI, HTTP route or existing learner reader. Exact SQL
lineage, function authorization and runtime-role tests are stronger evidence for
this storage-only task.

## SECURITY EVIDENCE

The focused PostgreSQL suite exercises the negative matrix through the actual
restricted `asalab_app` role and direct database constraints. It is not a mock.

## AUD-001 STATUS

`proven` — DB status/lifecycle constraints allow only assigned, active and
withdrawn; completion is physically separate.

## AUD-002 STATUS

`proven` — an explicit guarded meaningful-interaction command performs an
idempotent assigned-to-active transition.

## AUD-003 STATUS

`proven` — withdrawal retains the row, assignment history and any activation
history; DELETE is rejected.

## IDN-003 PORTION

`CourseEnrollment portion: proven` — the FK owner is
`learner_identities.id` with exact school lineage.

`IDN-003 overall: in_progress` — universal ActivityParticipation, Attempt and
Result ownership is not completed by this task.

## ARCH-001 STATUS

`in_progress`, unchanged. CourseEnrollment does not complete shared persistent
runtime convergence.

## ARCH-002 STATUS

`target`, unchanged. No ActivityRun was created.

## KNOWN GAPS

- no canonical ActivityRun or ActivityParticipation yet;
- no whole-class, group, named snapshot or late-join audience behavior;
- no withdrawn rejoin/reactivation policy;
- no current CourseRun reader cutover to enrollment;
- no course materialization or Course completion projection;
- CURRENT CourseRun status vocabulary remains `open|closed`;
- no historical enrollment backfill because evidence is insufficient;
- no production rollout.

## PRODUCTION STATUS

`NOT DEPLOYED`. No production migration, backfill, feature switch, service
restart or runtime cutover occurred.

## NEXT READY TASK

`LRN-M1-003 — Persistent ActivityRun` is the next Work Queue item after owner
acceptance, but it is not activated and no work on it has started.
