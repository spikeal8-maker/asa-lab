# LRN-M1-003 — Persistent ActivityRun Evidence Report

## TASK

`LRN-M1-003 — Persistent ActivityRun`, Issue `#158`, PR `#159`.

Baseline: `5d5c53652af35a99f1b149775b712ac68d4baed0`.

## STATUS

Implementation evidence is in progress. No production action is included or
claimed.

## ACTIVITYRUN MODEL

`activity_runs` is one persistent executable assignment instance in one exact
classroom. It stores tenant/school/classroom lineage, one immutable canonical
LAV pin, direct/course provenance, existing handout provenance, stored
lifecycle, UTC dates, nullable explicit policy pins, creator/request provenance
and append-only transition evidence.

It has no learner identity, participation, Attempt, Submission, Result,
completion or grade fields.

## DIRECT/COURSE UNIFICATION

Both paths call `activity_run_create(...)` and insert the same table:

```text
canonical LAV + direct classroom handout
→ activity_runs(source_kind=direct)

canonical LAV + CourseRun assignment lesson/handout
→ activity_runs(source_kind=course, source_course_run_id=...)
```

There are no direct/course/quiz/project run tables and no branch-specific
lifecycle or policy columns. Source kind is provenance only.

## LAV PINNING

The Run has a composite tenant FK to `learning_activity_versions`. The lineage
trigger additionally requires:

- `canonical_contract_version=1`;
- root `reusable_authored_content=true`;
- exact creator/root owner match until M5 sharing exists;
- no row in `learning_migration_compatibility_activity_versions`.

Run identity and LAV ID are immutable. Publishing LAV v2 does not retarget a Run
that pins v1.

CURRENT LAV authoring is tenant-scoped and does not store a distinct school ID.
The Run's school is physically derived from its exact classroom; cross-tenant
LAVs and classroom/CourseRun school mismatches are rejected. A same-tenant
multi-school authored-content scope rule cannot be invented in M1-003 and
remains an explicit architecture gap.

## SOURCE PROVENANCE

`source_classroom_assignment_id` preserves the existing executable handout as a
compatibility adapter rather than creating a second assignment system.

For course source, `source_course_run_id` and
`source_course_lesson_id` must identify the exact CURRENT assignment lesson and
its same handout/classroom. The lesson ID is explicitly compatibility
provenance. It is not represented as future canonical
`sourceCourseBlockId`; that identity is deferred until M1-009 can prove an
executable CourseVersion block contract.

## COURSERUN PARENT BOUNDARY

M1-003 does not change CURRENT `classroom_course_runs.open|closed`.

- course Run creation requires an open exact parent;
- a closed CourseRun limits child base availability without mutating child
  evidence;
- a closed compatibility handout likewise limits availability;
- child explicit close remains stricter than an open parent;
- reopening the parent cannot reopen a closed/cancelled child.

Future CourseRun target lifecycle convergence remains separate work.

## LIFECYCLE

Stored values are exactly:

```text
active
closed
cancelled
archived
```

Allowed transitions are:

```text
active → closed
active → cancelled
closed → archived
```

Same-state retry is idempotent. Reopen and `cancelled → active` are rejected.
DELETE is rejected and transition timestamps are append-preserved.

## DERIVED AVAILABILITY

`activity_run_base_availability(actor, run, as_of)` uses an explicit timestamp
and derives only run-level base state:

- before `opens_at`: `scheduled`, cannot start/submit;
- normal window: `open`;
- after due: late flag plus explicit late-policy behavior;
- after `closes_at`: `closed_by_time`, cannot start/submit;
- stored close/cancel/archive overrides dates;
- closed parent/handout limits the child without rewriting it.

The function is currently teacher-authorized foundation evidence, not the final
learner-specific resolver.

## DATES

`opens_at`, `due_at` and `closes_at` are nullable UTC timestamps. DB CHECK and
the guarded command enforce every applicable pair of:

```text
opens_at <= due_at <= closes_at
```

No scheduler writes a derived status.

## LATE POLICY

The nullable explicit values are:

```text
allow_mark_late
block_at_due
allow_until_close
```

Late is returned as a boolean derived flag, never stored lifecycle. NULL remains
unresolved after due: start/submit booleans are NULL with
`policy_resolution_required=true`. M1-003 therefore does not hardcode the
Master default over an existing LAV snapshot.

## RUNTIME POLICY SNAPSHOT

The snapshot stores only Run-explicit values and a source entry for each value:

```json
{
  "contractVersion": 1,
  "explicit": { "attemptLimit": 3 },
  "sources": { "attemptLimit": "activity_run_explicit" }
}
```

DB validation rejects unknown keys, mismatched source/value keys and invalid
ranges. Missing values remain missing so M1-007 can later resolve:

```text
Participation > Run explicit > Course block > LAV default
```

## GRADING SCHEME PINNING

`grading_scheme_version_id` is nullable. When explicitly supplied it must be an
immutable version in the Run's exact tenant/school. The mutable
`classroom_grading_schemes` pointer is not called a school default and is not
automatically copied. NULL means no pinned display-grade conversion; there is
no `100`, five-point or other hidden fallback.

## IDEMPOTENCY

Same actor/request plus identical semantic digest returns the same Run. Same key
with changed semantics returns `idempotency_conflict`. The exact compatibility
handout has a unique Run identity and identical source retries reuse it.

## CONCURRENCY

A handout-scoped transaction advisory lock serializes concurrent create. Unique
constraints on request identity, handout and exact course lesson remain the
physical duplicate guards. The integration test proves two simultaneous direct
creates result in one row.

## ACTIVITYPARTICIPATION NON-CREATION

No `activity_participations` table or learner row is created. ActivityRun is the
assignment instance; learner membership remains M1-004.

## ATTEMPT NON-CUTOVER

`learning_attempts`, `learning_submissions`, results and current assignment/seat
ownership are unchanged. No direct ActivityRun FK was added to Attempts and no
half-migrated runtime path exists.

## COURSEENROLLMENT COMPATIBILITY

Run creation neither reads nor writes learner population. CourseEnrollment row
counts remain unchanged; no roster enrollment or activation occurs.

`course_enrollment_activate()` remains unconnected. A future server-side
learner start command must first authorize effective CourseRun/ActivityRun
availability before calling activation; an active seat alone is insufficient.

## SECURITY

- only exact owner/co-teacher Account membership creates/transitions Runs;
- learner, outside teacher, foreign tenant/LAV and wrong-class parent are denied;
- private foreign-owner content is denied until M5 sharing;
- compatibility LAV and forged direct/course shapes are denied;
- tenant/school/classroom/source lineage has composite FK/trigger guards;
- runtime role has no direct table SELECT/INSERT/UPDATE/DELETE;
- only three narrow SECURITY DEFINER functions are executable;
- immutable pins and DELETE are rejected at DB boundary;
- existing append-only audit events record real create/transition once.

## MIGRATION

`0093_activity_runs.sql` is additive and performs no backfill or existing-row
UPDATE. Fresh/repeat evidence is recorded after final verification.

## OPENAPI

N/A. No HTTP endpoint, DTO or learner/teacher UI was added; OpenAPI is unchanged.

## REQUIREMENTS STATUS

### RUN-101 STORAGE PORTION

`proven` for the physical canonical ActivityRun contract.

### RUN-102 LIFECYCLE PORTION

`proven` for stored values, transition graph and evidence preservation.

### RUN-103 BASE AVAILABILITY PORTION

`in_progress` overall. Run-level explicit-as-of base availability is proven;
Participation overrides/effective learner access remain future.

### RUN-104 LATE POLICY PORTION

`in_progress` overall. Nullable explicit storage and base behavior are proven;
fallback/override resolution remains M1-007.

### RUN-105 RUNTIME NEUTRALITY PORTION

`in_progress` overall. Direct/course storage and commands are neutral; Attempt
APIs are not cut over.

### RUN-106 PRECEDENCE PORTION

`in_progress`. Run-explicit source provenance and unresolved NULL behavior are
proven; full Participation/Run/Course/LAV resolver remains M1-007.

### RUN-107 EVIDENCE/INSPECTOR PORTION

`in_progress`. Stored policy provenance exists; teacher effective-settings
inspector/explanation does not.

### VER-003 PORTION

`in_progress` overall. Exact LAV pinning is proven for new canonical Runs;
universal materialization is not.

### VER-004 REGRESSION

`in_progress` overall. New ActivityRuns survive later draft/version publication
without retargeting; old compatibility paths remain outside cutover.

## ARCH-001 STATUS

`in_progress`. Definition and ActivityRun storage are shared, but common
ActivityParticipation/Attempt runtime does not yet exist.

## ARCH-002 STATUS

`in_progress`. One physical canonical ActivityRun exists for both source kinds,
but CURRENT executable paths can still operate without it until later
materialization/cutover tasks.

## RUN-106 STATUS

`in_progress` until M1-007 implements and proves the complete effective-settings
resolver.

## TESTS

Focused suite currently passes `15/15` test cases covering the owner-required
27 scenario matrix. Final migration/regression/repository evidence will be added
after the evidence run.

## BROWSER EVIDENCE

N/A — no UI, route or current reader changed.

## KNOWN GAPS

- no ActivityParticipation/audience/group/late-join behavior;
- no learner-specific effective settings or inspector;
- no Attempt/Submission/Result ownership cutover;
- no canonical CourseVersion executable-block identity or materialization;
- no universal existing-assignment ActivityRun backfill;
- same-tenant multi-school authored LAV scope is not physically represented by
  M1-001 and was not guessed here;
- CURRENT CourseRun lifecycle remains `open|closed`;
- no HTTP/UI/read projection integration;
- no production rollout.

## PRODUCTION STATUS

`NOT DEPLOYED`. No production migration, backfill, feature switch, restart or
runtime cutover is authorized or performed.

## NEXT READY TASK

`LRN-M1-004 — ActivityParticipation` is the next Work Queue item only after
owner acceptance. It is not activated and no work on it has started.
