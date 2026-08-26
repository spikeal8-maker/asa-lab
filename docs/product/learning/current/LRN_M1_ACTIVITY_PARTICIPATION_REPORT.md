# LRN-M1-004 — ActivityParticipation Report

**Task:** `LRN-M1-004 — ActivityParticipation`  
**Baseline:** `558ef8c853e6d016267b9d6ee16a2b63d8d23c3c`  
**Issue / PR:** `#160` / `#161`  
**Result:** evidence-complete implementation candidate; owner acceptance pending

## ACTIVITYPARTICIPATION MODEL

Migration `0094_activity_participations.sql` adds one additive canonical table.
One row is one stable learner's participation in one ActivityRun. Stored status
is constrained to `assigned|active|withdrawn`; the row has no mutable
completion, progress, grade, result, remaining-attempt or expiry truth.

## ACTIVITYRUN/LearnerIdentity LINEAGE

Both parents are referenced with `(tenant_id, school_id, id)` composite foreign
keys. This physically proves:

```text
ActivityRun.school_id == ActivityParticipation.school_id
ActivityParticipation.school_id == LearnerIdentity.school_id
```

The learner owner is exactly `learner_identities.id`. StudentSeat, Account and
Principal remain current authentication/provenance evidence and are not stored
as learner ownership or uniqueness keys.

## COURSEENROLLMENT LINK

`source_course_enrollment_id` is nullable. Direct runs reject it. When supplied
for a course run it must reference the same tenant, school and learner and the
exact parent CourseRun. Withdrawn enrollment cannot create Participation;
activation requires the exact enrollment to be active. No fake direct
CourseEnrollment is created.

## LIFECYCLE

Allowed transitions are `assigned→active`, `assigned→withdrawn` and
`active→withdrawn`. Active retry is idempotent. Withdrawn reactivation and hard
delete are rejected. Learner activation resolves an active identity link and
active exact-class seat, then checks ActivityRun, classroom, compatibility
handout, optional CourseRun and server time availability. M1-004 does not invent
the future "started Attempt may finish" policy.

## COMPLETION SEPARATION

Completion fields do not exist. The guarded read returns `not_available` with
reason `canonical_attempt_result_lineage_not_available`. Future completion must
be projected from immutable completion policy plus canonical Attempt/Result
history. Legacy feedback/status is not used as a substitute.

## EXCUSED OVERRIDE

`excused` is orthogonal to lifecycle and records reason, principal and time.
The M1-004 command is one-way because no normative unexcuse semantics have been
approved. It appends one audit event and creates no Attempt, Result, grade or
Gradebook entry.

## OVERRIDES

Participation stores only learner-specific `extra_attempts`, nullable
`time_limit_override_seconds`, nullable opens/due/closes overrides and
`teacher_unlocked`. It does not copy Run/Course/LAV defaults. `extra_attempts`
is a non-negative allowance; no Attempt or mutable remaining count is created.
Time limit is a duration and does not create `expires_at`.

## DATE OVERRIDE SEMANTICS

NULL means no Participation override. Partial shapes such as due-only are
valid; only pairs explicitly present on the row are checked for contradiction.
Full effective fallback and precedence remain M1-007.

## TEACHER UNLOCK

The boolean is stored as a future authorization input, not a lifecycle state.
M1-004 does not let it activate a Participation or bypass a cancelled Run,
withdrawal, tenant/school lineage or parent closure. Exact effective semantics
remain M1-007.

## IDEMPOTENCY

`UNIQUE(activity_run_id, learner_identity_id)` plus conflict-safe assign returns
the same logical row. An identical retry adds no audit event; a retry with
different CourseEnrollment provenance returns `idempotency_conflict`.

## CONCURRENCY

Two concurrent identical assignments converge through the same unique index to
one row. Focused PostgreSQL evidence verifies one created and one reused result.

## AUDIT

Existing append-only `audit_events` is reused. Real state changes emit exactly:

```text
participation.assigned
participation.activated
participation.withdrawn
participation.override_changed
participation.excused
```

Payloads carry the actor Principal and command/source evidence. Idempotent
retries do not add audit noise.

## ATTEMPT NON-CUTOVER

Migration 0094 adds no Participation FK to existing Attempts, changes no
Attempt/Submission/Result reader or writer and performs no backfill. Focused
tests prove assign/override/excuse create zero Attempts and no Result/grade.
AUD-105's future active-Attempt expiry-extension hook remains unimplemented.

## LEGACY HANDOUT DECOUPLING

Participation is clean of legacy handout identity: it has no
`classroom_assignment_id` and refers only to ActivityRun. M1-003's required
compatibility handout source is not copied or widened. Removing/relaxing that
ActivityRun dependency remains M1-009.

## MULTI-SCHOOL SAFETY

Composite foreign keys reject cross-school ownership physically. Commands
derive tenant/school/classroom from the Run, never accept client-supplied
lineage, and verify teacher or owning learner access server-side. The known
canonical LAV authoring school-scope gap remains tracked for M1-009/M5 and is
not disguised by Participation.

## BACKFILL DECISION

No backfill. Current roster membership does not prove historical participation;
M1-005/M1-006 must materialize rows only from explicit audience semantics.

## RLS/SECURITY

Forced tenant RLS is enabled; `asalab_app` has no table SELECT/INSERT/UPDATE/
DELETE privilege. Narrow SECURITY DEFINER functions enforce owner/co-teacher or
owning learner authorization. Tests deny outside teacher, learner self-assign,
foreign learner, wrong classroom, wrong CourseEnrollment, direct-plus-enrollment,
UUID enumeration and withdrawn reactivation.

## MIGRATION

`0094_activity_participations.sql` is additive. Isolated `asalab_test` was reset
and all migrations applied successfully; an immediate guarded repeat applied
zero migrations. No production database was accessed.

## OPENAPI

N/A. No HTTP route, DTO or UI contract changed.

## Acceptance evidence matrix

| Required scenario | Evidence |
| --- | --- |
| 1–5 direct/course/exact enrollment/retry/concurrency/two Runs | focused tests 1–2 |
| 6–9 cross-school/wrong learner or Run enrollment/direct rejection | focused tests 2 and 9 plus composite FK |
| 10–15 lifecycle/retry/withdraw/history | focused test 3 plus lifecycle constraints/trigger |
| 16–18 completion absent, excused orthogonal, no result/grade | focused tests 6–7 |
| 19–23 overrides/duration/due-only/contradiction/unlock non-bypass | focused tests 5 and 8 |
| 24–28 zero Attempt/no handout column/auth/RLS/audit dedupe | focused tests 5, 7, 9 and 10 |
| 29 M1-001 | `pnpm test:learning-m1-001` — 15 passed |
| 30 M1-002 | `pnpm test:learning-m1-002` — 15 passed after replacing its obsolete table-absence assertion with zero-auto-materialization |
| 31 M1-003 | `pnpm test:learning-m1-003` — 15 passed after the same milestone-aware assertion update |
| 32 M0 canonical surfaces | 20 focused projection/identity/adapter tests passed |
| 33 fresh migration + repeat zero | isolated reset PASS; guarded repeat `Applied 0 migration(s)` |

## Requirement status

**AUD-101 STATUS:** proven — physical lifecycle constraint, transition guard and
focused lifecycle/immutability evidence.  
**AUD-102 STATUS:** in_progress — contract is preserved and honest
`not_available` exists, but canonical Attempt/Result completion projection is
not implemented.  
**AUD-103 STATUS:** proven — orthogonal one-way excused evidence, authorization,
audit and result/grade neutrality.  
**AUD-104 STATUS:** proven — canonical learner-specific fields, nullable
overrides, lineage and authorization implemented.  
**AUD-105 STATUS:** in_progress — storage/audit exists; active Attempt expiry
extension integration does not.  
**IDN-003 PORTION:** ActivityParticipation ownership portion proven; overall
requirement remains in_progress until Attempt/Result ownership converges.  
**ARCH-001 STATUS:** in_progress. The shared ActivityRun/Participation foundation
exists, but universal Attempt ownership is absent.  
**ARCH-002 STATUS:** in_progress until audience materialization and executable
path cutover.  
**RUN-106 STATUS:** in_progress until M1-007 computes full precedence.

## KNOWN GAPS

- no audience definition, group/whole-class materialization or late-join policy;
- no canonical Attempt ownership, expiry extension, completion or Result cutover;
- no full Participation > Run > Course block > LAV precedence resolver;
- ActivityRun still requires compatibility handout provenance;
- LAV authoring school scope remains unresolved inside a tenant;
- no production migration, deployment, feature flag or browser surface.

## PRODUCTION STATUS

Not deployed and not migrated in production. Evidence uses only the isolated
`asalab_test` database. Migration application requires a separately authorized
production action and the repository's three-part environment guard.

## NEXT READY TASK

`LRN-M1-005 — AudienceDefinition`, but it is not activated. Stop after M1-004.
