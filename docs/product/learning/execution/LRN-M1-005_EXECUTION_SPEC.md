# LRN-M1-005 — Execution Spec

**Task:** `LRN-M1-005 — Audience: Whole Class + Named Learners`
**Milestone:** `M1 — Universal Delivery`
**Status:** DONE — owner accepted 2026-08-26; merged in PR #164
**Baseline SHA:** `4c729bcea80d077f23e98dc8bfd0833dd2127c16`
**Issue:** `#163`

## 1. Goal and boundary

Implement one school-safe audience contract for `whole_class -> dynamic` and
`named_learners -> snapshot`. A CourseRun audience materializes only
CourseEnrollments. A direct ActivityRun audience materializes only
ActivityParticipations. Course-sourced ActivityRuns cannot own an independent
audience; child materialization remains `LRN-M1-009`.

No ClassroomGroup, multi-class bulk, effective-settings resolver, Course block
materialization, Attempt/Submission/Result/Gradebook cutover, historical
audience backfill, UI redesign, production migration or deployment is allowed.

## 2. CURRENT architecture audit

### 2.1 Persisted lineage and target state

- `classroom_course_runs` is one-classroom scoped and accepts new enrollment
  only while `status='open'`; `closed` is terminal for M1-005 materialization.
- `course_enrollments` is unique by `(course_run_id, learner_identity_id)`, uses
  stable `learner_identities.id`, and permits `assigned -> active|withdrawn` or
  `active -> withdrawn`, never reactivation.
- `activity_runs` has exact tenant/school/classroom lineage. Only
  `source_kind='direct'`, `lifecycle_status='active'`, active classroom and open
  compatibility handout are audience-eligible. Future `opens_at` does not block
  assignment. Course-sourced Runs are rejected.
- `activity_participations` is unique by
  `(activity_run_id, learner_identity_id)`, has the same non-reactivating
  lifecycle, and existing learner activation still requires an active
  StudentSeat/access link.
- `learner_identities` is the immutable school learner key accepted by
  `ADR-LEARNER-IDENTITY-001`; `learner_identity_links` binds seats/accounts.

### 2.2 CURRENT classroom learner event map

| Learner event | Controller/runtime path | SQL writer | M1-005 integration |
| --- | --- | --- | --- |
| teacher creates one seat | `ClassroomsController` `POST :classroomId/seats` | `classroom_management_add_seat` | seat trigger; `issued` is assignment-eligible |
| teacher creates seats in batch | `POST :classroomId/seats/batch` | repeated `classroom_management_add_seat` calls | the same seat trigger, not controller-only wiring |
| seat first login | `ClassroomJoinController` seat sign-in | `classroom_student_seat_sign_in` changes `issued -> active` | idempotent trigger; no duplicate membership/audit |
| Account joins with code | `ClassroomJoinController` account join | `classroom_join_with_account` inserts an active seat or reopens its existing seat | the same trigger; stable identity is reused/created before sync |
| Account is linked on a seat | persisted `classroom_student_seats.account_id` update | current seat/link flows plus identity link guard | any seat UPDATE reaches the trigger; account link alone does not redefine assignment eligibility |
| teacher changes seat state | `PATCH :classroomId/seats/:seatId` | `classroom_management_update_seat` | `issued|active` eligible; `suspended` ends audience claims |
| teacher removes seat | `DELETE :classroomId/seats/:seatId` | `classroom_management_remove_seat` | `removed` ends audience claims |
| classroom archived/deleted | classroom status command | `classroom_management_set_status` suspends seats | per-seat trigger withdraws audience-owned rows |

Legacy definitions `classroom_teacher_add/update/remove_seat` are still present,
but current API uses the `classroom_management_*` replacements. A database
trigger on `classroom_student_seats`, rather than a controller callback, covers
both families, account join, login, direct SQL lifecycle transitions and future
writers. Current class roster readers treat every non-removed seat as visible;
assignment eligibility is narrower and explicit: `issued|active`. Access/start
eligibility remains `active` only.

## 3. Physical model

Migration `0095_learning_audiences.sql` will add:

1. `learning_audience_definitions`: immutable tenant/school/classroom and exact
   one-of CourseRun/ActivityRun target, `whole_class|named_learners`, enforced
   `dynamic|snapshot`, creator, request key/digest and active/end evidence. At
   most one canonical audience exists for a target Run.
2. `learning_audience_named_members`: exact LearnerIdentity membership,
   append-preserved add/remove actors, timestamps and request provenance.
3. `learning_audience_membership_claims`: exact audience-to-
   CourseEnrollment/ActivityParticipation satisfaction with
   `audience_owned|independent` ownership. An independent manual row is never
   stolen or withdrawn by audience removal.
4. `learning_audience_operations`: durable idempotency and event provenance for
   initial materialization, dynamic learner materialization, named add/remove,
   classroom membership end and deterministic rejoin rejection.

Audience-created target rows use server-selected assignment sources
`whole_class_dynamic` or `named_snapshot`; withdrawal sources are
`classroom_membership_ended` or `named_member_removed`. Clients never supply a
source value.

## 4. Stable learner creation/reuse

The seat trigger resolves exact classroom school scope, then:

1. reuses the seat's active LearnerIdentity link;
2. otherwise reuses an active same-school Account link when the seat already
   has an Account;
3. otherwise creates one active LearnerIdentity plus a seat link;
4. adds the same-school Account link when coherent and absent.

All choices are protected by existing unique indexes and row locks. A conflict
between pre-existing seat/account identities is fail-closed and is never merged
silently.

## 5. Materialization and ownership rules

Audience creation and initial materialization are one transaction. Eligible
learners are derived set-wise from `issued|active` seats, joined through active
identity links and deduplicated by `learner_identities.id`.

- CourseRun target inserts/reuses `CourseEnrollment(status='assigned')` only.
- direct ActivityRun inserts/reuses `ActivityParticipation(status='assigned')`
  only and creates no Attempt/Result/Gradebook row.
- newly inserted membership gets an `audience_owned` claim;
- a pre-existing manual membership gets an `independent` claim and retains its
  immutable manual assignment provenance;
- claim uniqueness and target membership uniqueness prevent duplicates under
  retry/concurrency.

Named creation validates the exact requested set before any insert. A later
unrelated join is ignored. Named add/remove are explicit teacher commands with
request/digest idempotency and append-preserved evidence. Re-add after removal
returns `rejoin_requires_explicit_policy`.

## 6. Dynamic sync, leave and rejoin

The durable seat trigger calls one set-based reconciliation routine. A first
eligible logical learner is materialized exactly once across every active
whole-class audience in that classroom. Repeated issue/activation/link/update
events reuse operation and claim rows without audit noise.

When the last `issued|active` seat for a logical learner in the classroom ends,
audience-owned memberships are transitioned to `withdrawn`; independent manual
memberships remain. Claims and target rows are never deleted. Attempts are not
modified. If the learner later becomes eligible again, a withdrawn membership
is not reactivated or duplicated; the durable result is
`rejoin_requires_explicit_policy`.

## 7. Transactions, recovery and performance

Creation, operation evidence, set-based target insert, claims and audit events
commit atomically. Any statement failure rolls back the full operation; retry
with the same request/digest converges to the same audience. The same key with a
changed digest returns `idempotency_conflict`.

The 30-learner initial fixture and one-learner/100-dynamic-target fixture execute
inside a constant number of SQL statements; no API/PLpgSQL per-learner query
loop is permitted. Tests record elapsed time and created/reused row counts.

## 8. Security and audit

Tables are forced-RLS with no broad `asalab_app` CRUD. SECURITY DEFINER commands
derive tenant/school/classroom and teacher user from an Account Principal with
owner/co-teacher membership. Internal sync is not granted to `asalab_app`.
Negative tests cover learner mutation, outside teacher, cross-school/class/run,
wrong target kind, course-sourced ActivityRun, suspended/removed learner,
client source spoofing, UUID enumeration and direct runtime table CRUD.

Existing `audit_events` records `audience.created`, named add/remove, dynamic
materialization and learner withdrawal with exact audience, learner, operation,
target and source provenance. Idempotent retries create no duplicate events.

## 9. API / OpenAPI

N/A for M1-005: guarded storage/domain primitives plus database-level classroom
lifecycle integration only. No HTTP endpoint, DTO or UI reader is added, so an
OpenAPI change would advertise an unimplemented surface.

## 10. Requirements disposition

- `AUD-201`: in_progress; whole-class/named portion proven, group deferred.
- `AUD-202`: in_progress; whole-class dynamic/named snapshot proven, group deferred.
- `AUD-203`: may become proven after exact late-join evidence.
- `AUD-204`: in_progress; withdrawal is implemented but started-Attempt continuation is M2.
- `AUD-205`: target/in_progress; group and Attempt semantics are out of scope.
- `AUD-206`: may become proven after explicit audited deterministic named mutations.
- `ARCH-001`, `ARCH-002`, `IDN-003`: remain in_progress.
- `RUN-005`: remains target.

## 11. Acceptance evidence

The focused PostgreSQL suite maps all 47 owner-required scenarios, including
fresh migration/repeat-zero, M0 and M1-001..004 regressions, concurrency,
manual overlap, leave/rejoin, RLS, 30 learners and 100 dynamic targets. Final
acceptance additionally requires `git diff --check`, contracts, control-plane,
governance, uncached repository gate and all three official GitHub required
jobs on the exact merge result.
