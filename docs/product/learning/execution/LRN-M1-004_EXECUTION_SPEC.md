# LRN-M1-004 — Execution Spec

**Task:** `LRN-M1-004 — ActivityParticipation`
**Milestone:** `M1 — Universal Delivery`
**Status:** DONE — merged, owner acceptance pending
**Baseline SHA:** `558ef8c853e6d016267b9d6ee16a2b63d8d23c3c`
**Issue:** `#160`
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

## 1. Goal

Add one persistent, school-safe `ActivityParticipation` primitive connecting one
canonical `ActivityRun` to one stable `learner_identities.id`, with the exact
`assigned|active|withdrawn` lifecycle, orthogonal excused evidence and nullable
learner-specific override storage. It becomes the future ownership target for
Attempt without changing any CURRENT Attempt/Submission/Result reader or writer.

## 2. Non-goals

- no audience definition, whole-class/named/group materialization, roster watcher
  or late-join propagation;
- no Attempt creation, ownership FK, timer expiry mutation, Submission/Result
  migration, completion/grade/progress storage or Gradebook cutover;
- no CourseRun materialization, required course-block identity or removal of the
  M1-003 compatibility handout source;
- no HTTP/UI/OpenAPI change, backfill, production migration/deploy/restart;
- no M1-005+, M2-M7.

## 3. Requirement IDs

```text
AUD-101 — lifecycle (target: proven)
AUD-102 — completion projection contract (remains in_progress)
AUD-103 — excused override (target: proven)
AUD-104 — canonical fields/overrides (target: proven)
AUD-105 — override storage only; Attempt expiry hook remains in_progress
IDN-003 — Participation portion only; overall remains in_progress
ARCH-001 — remains in_progress
ARCH-002 — remains in_progress
RUN-106 — remains in_progress until M1-007
```

## 4. CURRENT architecture audit

| CURRENT evidence | Proven role | M1-004 disposition |
| --- | --- | --- |
| `learner_identities` / links (`0086`) | immutable school-scoped learner key with StudentSeat/Account authentication links | mandatory Participation owner; never seat/account/principal key |
| `course_enrollments` (`0092`) | stable learner membership in exact CourseRun | optional course provenance only; never synthesized for direct |
| `activity_runs` (`0093`) | exact school/classroom/LAV direct-or-course run | mandatory parent and only handout/course coupling boundary |
| `classroom_student_seats` | current classroom access evidence | server-side authorization/provenance only, not stored ownership or uniqueness |
| `principals` | account/student-seat actor authentication | actor provenance only |
| `learning_attempts` / submissions / results | CURRENT compatibility runtime | untouched; zero M1-004 rows created or rewritten |
| `audit_events` | existing append-only tenant audit | reused; no new audit subsystem |

The free migration number at baseline is `0094`. `activity_runs` has
`UNIQUE(tenant_id,id)` but not the composite school key needed for a physical
Participation FK; `0094` will add a supporting unique index on
`(tenant_id,school_id,id)` without changing Run behavior.

## 5. Canonical physical model

`activity_participations` stores:

```text
id, tenant_id, school_id
activity_run_id, learner_identity_id, source_course_enrollment_id?
status, assigned_at, activated_at?, withdrawn_at?
assigned_by_principal_id, activated_by_principal_id?, withdrawn_by_principal_id?
extra_attempts
time_limit_override_seconds?
opens_at_override?, due_at_override?, closes_at_override?
teacher_unlocked
excused, excused_reason?, excused_by_principal_id?, excused_at?
created_at, updated_at
```

It deliberately has no `seat_id`, `account_id`, `principal_id` learner owner,
`classroom_assignment_id`, completion, progress, grade, result, Attempt count,
remaining-attempt count or expiry.

Physical invariants:

- composite Run and LearnerIdentity FKs force identical tenant/school lineage;
- `UNIQUE(activity_run_id, learner_identity_id)` gives one logical row;
- direct Run requires NULL CourseEnrollment;
- supplied course enrollment must belong to the same learner and exact parent
  CourseRun; withdrawn enrollment cannot create or activate Participation;
- Participation identity/lineage and lifecycle evidence are immutable;
- hard delete and withdrawn reactivation are rejected.

## 6. Commands and transaction boundaries

- `activity_participation_assign`: teacher owner/co-teacher, exact active classroom
  StudentSeat link, same-school learner, optional exact CourseEnrollment; one
  transaction for uniqueness, row and `participation.assigned` audit.
- `activity_participation_activate`: learner principal must resolve through an
  active identity link and active seat in the exact classroom. It checks Run
  lifecycle, classroom/handout/current parent restriction and time availability
  server-side. It does not activate CourseEnrollment or create Attempt.
- `activity_participation_withdraw`: owner/co-teacher; assigned/active to
  withdrawn, append-preserved evidence and audit.
- `activity_participation_set_overrides`: owner/co-teacher; row lock, explicit
  state replacement, no-op retry without audit noise.
- `activity_participation_excuse`: owner/co-teacher; one-way false-to-true in
  M1-004, with optional reason and actor/time evidence. No unexcuse semantics are
  invented.
- optional completion-status read returns `not_available` while canonical
  Attempt/Result ownership is absent; it never infers completion from legacy rows.

## 7. Lifecycle and availability

Stored lifecycle is exactly `assigned|active|withdrawn`. `active→active` is an
idempotent retry. Only `assigned→active`, `assigned→withdrawn` and
`active→withdrawn` are allowed. `withdrawn→active` is forbidden pending audience
rejoin policy.

Activation requires:

- active Participation, Run/classroom access lineage and authenticated learner;
- Run lifecycle `active`;
- open compatibility handout and open CourseRun for course source;
- `opens_at` reached, `closes_at` not passed, and explicit late policy permitting
  work after due. A NULL late policy after due remains unresolved/denied.

`teacher_unlocked` is stored as a future authorization input. M1-004 does not
make it a lifecycle transition and does not let it bypass cancelled Run,
withdrawn Participation, cross-school checks or parent closure. Complete
effective semantics remain M1-007.

## 8. Override semantics

- `extra_attempts >= 0` is allowance only; no Attempt is created and no
  `attempts_remaining` truth is stored.
- time limit is nullable duration seconds, not client timer or `expires_at`.
- date fields are independent nullable overrides. Only pairs explicitly present
  on the row are checked for contradiction; due-only and other partial fallback
  shapes are valid.
- NULL means no Participation override. Lower-precedence Run/Course/LAV values
  are not copied.
- M2 hook contract: a later authorized change to Participation time limit may
  request audited extension of an active canonical Attempt expiry; it may never
  reduce expiry below current time. M1-004 does not implement or call that hook,
  so AUD-105 remains `in_progress`.

## 9. Completion and excused separation

No mutable completion fields exist. Completion remains:

```text
completionPolicy + canonical Attempt/Result history
```

Because that lineage is not cut over, M1-004 reports completion as
`not_available` and does not inspect legacy feedback/status flags.

`excused` is orthogonal boolean evidence with reason/actor/time. Excusing does
not change lifecycle and creates no Attempt, Result, grade or Gradebook row.

## 10. Security / RLS

- forced tenant RLS and no broad runtime table privileges;
- narrow SECURITY DEFINER commands only;
- teacher commands require exact owner/co-teacher Account membership;
- activation requires the exact learner identity through current active
  StudentSeat/Account provenance in the Run classroom;
- client supplies only IDs/override values; tenant/school are derived and
  composite FKs/triggers recheck lineage;
- direct UUID enumeration, cross-school, cross-class, foreign CourseEnrollment,
  learner self-assignment and outside-teacher mutation are denied.

## 11. Migration / rollback / rollout

`0094_activity_participations.sql` is additive and has no backfill. Existing
readers and writers do not consume it, so behavioral rollback before later
cutover is omission/non-use. No destructive down migration or production action
is part of this task.

## 12. Files expected to change

```text
docs/execution/current.yaml
docs/project-map/PROJECT_MAP.md
docs/project-map/project-map.yaml
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
docs/product/learning/execution/LRN-M1-004_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M1_ACTIVITY_PARTICIPATION_REPORT.md
migrations/0094_activity_participations.sql
tests/courses/activity-participations.pg.spec.ts
package.json
```

## 13. API / OpenAPI / browser

N/A: guarded DB/domain primitives only. No HTTP route, DTO, UI or current reader
changes, so OpenAPI and browser evidence remain N/A.

## 14. Required evidence matrix

The focused PostgreSQL suite must prove all owner-required scenarios 1–33:
direct/course creation, exact optional enrollment lineage, retry/concurrency,
two-Run independence, cross-school/class/enrollment negatives, all lifecycle
paths, preserved history, absence of completion fields, orthogonal excused,
no Result/grade creation, allowance/duration/partial-date semantics,
contradiction rejection, teacher-unlock non-bypass, zero Attempt creation, no
legacy handout column, authorization/RLS/audit negatives, M0/M1 regressions and
fresh migration plus repeat zero.

## 15. Acceptance checklist

- [x] one canonical school-safe ActivityParticipation table
- [x] stable LearnerIdentity ownership and exact Run lineage
- [x] optional coherent CourseEnrollment provenance
- [x] exact lifecycle and hard-delete protection
- [x] learner-authorized server-side activation
- [x] completion absent/not_available
- [x] excused orthogonal and audited
- [x] nullable learner-specific overrides with partial-date semantics
- [x] idempotent/concurrent assignment and audit dedupe
- [x] no Attempt/backfill/legacy handout coupling
- [x] least privilege and negative matrix
- [x] fresh 0094 apply and repeat zero
- [x] M0/M1-001/M1-002/M1-003 regressions
- [x] uncached repository and GitHub core gates
- [x] ledger updated without premature AUD-102/AUD-105 closure

## 16. Evidence

This execution-spec was created after CURRENT audit and before product
migration/test code. Migration `0094`, the 33-scenario mapped focused suite and
the task report now provide implementation evidence. Isolated fresh apply,
repeat-zero, M0/M1 regressions and uncached `gate:data` are green (`173` files,
`1198` tests plus `15` focused RLS tests). After the independent upstream
Electronics correction, the exact PR head
`f9f8fdd8842bd3322105525529fde509d95d418d` passed all three required GitHub
jobs in run `32943950373` and was normally merged as
`08221e9147c2bf87ce70f85b7b8babec1da28db8`. Owner acceptance remains pending.
