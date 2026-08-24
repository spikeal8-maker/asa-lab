# LRN-M0 — Canonical State/Result Resolver Contract

**Task:** `LRN-M0-004`  
**Status:** normative design; runtime not implemented  
**Baseline:** `879f659471709e36d6df6110ab6c0e0612a4c7c5`

## 1. Decision

ASA Learning SHALL have one server-side semantic resolver:

```text
resolveCanonicalLearningState(CanonicalLearningStateInput)
  -> CanonicalLearningState
```

Direct projects, course-generated projects and quizzes use different database
adapters only to assemble the input. They MUST NOT define separate workflow or
result semantics. Class Learning, assignment/course progress, Works, Review
Queue, Learner Results and the future Gradebook Matrix consume the same output.

This document is a design contract. No resolver, schema, backfill, endpoint or
UI is implemented by `LRN-M0-004`.

## 2. CURRENT facts that constrain the contract

- `migrations/0033_classroom_assignments.sql` stores mutable project progress in
  `classroom_assignment_work.project_id`, `started_at` and `submitted_at`.
- `migrations/0077_learning_assessment_foundation.sql` stores immutable project
  Submission evidence and constrains `learning_attempts.state` to exactly
  `in_progress | submitted | evaluating | accepted | changes_requested |
  incomplete | excused | invalidated`.
- No CURRENT Attempt state named `draft`, `waiting_review`, `completed`,
  `closed` or `expired` exists. Those names are TARGET semantics where stated
  by the Master Spec.
- Project submission normally creates an Attempt in `evaluating`, an immutable
  Submission and a needs-review Evaluation, then writes the legacy timestamp.
- `changes_requested` preserves Attempt/Submission/Evaluation history and clears
  the legacy timestamp.
- `migrations/0083_quiz_engine.sql` creates an `accepted` Attempt, Submission,
  automatic Evaluation, AssessmentResult and Gradebook pointer atomically.
- `gradebook_entries.assessment_result_id` and `accepted_attempt_id` are CURRENT
  mutable selected pointers. CURRENT has no AssessmentResultRevision or
  ResultSelectionPolicy runtime.
- `LRN_M0_STATUS_DIVERGENCE_REPORT.md` proves a real legacy `submitted_at` row
  without any Attempt. It cannot yield a truthful ProjectVersion, digest,
  request id, Submission or Result.
- `classroom_student_seats.status` is exactly `issued | active | suspended |
  removed`. CURRENT learner reads require `active`; the teacher Gradebook omits
  `removed`. Historical rows remain physically present.
- Accepted `ADR-LEARNER-IDENTITY-001` selects future
  `learner_identities.id`, but CURRENT runtime still owns provenance by seat,
  optional Account and Principal links.

## 3. Canonical output DTO

The normative transport-neutral DTO is:

```ts
type CanonicalWorkflowState =
  | 'not_applicable'
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'waiting_review'
  | 'changes_requested'
  | 'completed'
  | 'invalidated';

type CanonicalLearningFlag =
  | 'late'
  | 'excused'
  | 'revision_in_progress'
  | 'withdrawn'
  | 'after_due'
  | 'legacy_unresolved'
  | 'legacy_compatibility'
  | 'unselected_result'
  | 'visibility_restricted';

interface CanonicalSelectedResult {
  attemptId: string;
  resultRevisionId: string | null;
  compatibilityAssessmentResultId: string | null;
  rawPoints: number | null;
  maxPoints: number | null;
  percentageBasisPoints: number | null;
  displayGrade: string | null;
  completionValue: boolean | null;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused' | null;
  publishedAt: string;
}

interface CanonicalProvenance {
  identityAuthority:
    | 'learner_identity'
    | 'student_seat_compatibility'
    | 'unresolved';
  workflowAuthority:
    | 'activity_participation'
    | 'latest_attempt'
    | 'legacy_classroom_work'
    | 'course_progress_compatibility'
    | 'assignment_absence';
  resultAuthority:
    | 'canonical_result_selection'
    | 'gradebook_pointer_compatibility'
    | 'none';
  learnerId: string | null;
  seatId: string | null;
  activityRunId: string | null;
  classroomAssignmentId: string | null;
  workflowAttemptId: string | null;
  selectedAttemptId: string | null;
  sourcesRead: string[];
  conflicts: string[];
}

interface CanonicalVisibility {
  historyExists: boolean;
  authorizedTeacherHistory: 'visible' | 'restricted';
  learnerCurrentAccess: 'visible' | 'restricted';
  learnerMessageCode:
    | null
    | 'access_not_active'
    | 'access_suspended'
    | 'access_ended';
}

interface CanonicalLearningState {
  workflowState: CanonicalWorkflowState;
  selectedResult: CanonicalSelectedResult | null;
  flags: CanonicalLearningFlag[];
  provenance: CanonicalProvenance;
  visibility: CanonicalVisibility;
}
```

`flags` is a set serialized in the order declared above. Unknown strings are a
contract error, not silently accepted extensions.

`compatibilityAssessmentResultId` exists because a CURRENT
`assessment_results.id` is not an AssessmentResultRevision. A compatibility
adapter MUST set `resultRevisionId = null`; it MUST NOT copy the CURRENT result
UUID into the revision field. A future canonical adapter does the inverse when
no compatibility result is involved.

`outcome` is retained because CURRENT explicitly distinguishes `passed`,
`failed`, `incomplete` and `excused`; it is pedagogical result data and MUST NOT
be encoded as Attempt workflow. `after_due` is retained from `GRD-005`: it means
the effective due time was crossed, while `late` means the applicable late
policy classified the submission as late. Both may be present.

The three additional diagnostic flags have bounded meanings:

- `legacy_unresolved`: legacy claims submission but immutable submission
  evidence is absent;
- `legacy_compatibility`: legacy data determined the output or contradicted the
  canonical source; a matching compatibility timestamp does not add noise;
- `unselected_result`: valid result evidence exists, but no valid selection may
  be emitted;
- `visibility_restricted`: history exists or assignment applies, but lifecycle
  prevents current learner access.

## 4. Resolver input and boundary

```ts
interface CanonicalLearningStateInput {
  scope: {
    tenantId: string;
    schoolId: string;
    classroomId: string;
    kind: 'direct_project' | 'course_project' | 'quiz';
    classroomAssignmentId: string | null;
    activityRunId: string | null;
  };
  identity: {
    learnerId: string | null;
    seatId: string | null;
    accountId: string | null;
    principalId: string | null;
    resolution: 'learner_identity' | 'seat_compatibility' | 'unresolved';
  };
  participation: null | {
    applicable: boolean;
    status: 'assigned' | 'active' | 'withdrawn';
    excused: boolean;
  };
  compatibilityAssignment: {
    applicableToSeat: boolean;
    legacyWork: null | {
      projectId: string;
      startedAt: string;
      submittedAt: string | null;
    };
    courseProgressPresent: boolean;
  };
  attempts: {
    latest: null | AttemptSnapshot;
    selectedAttemptExists: boolean;
  };
  resultSelection: {
    source: 'canonical' | 'gradebook_pointer' | 'none';
    selectedAttemptId: string | null;
    selectedRevision: ResultRevisionSnapshot | null;
    selectedCompatibilityResult: AssessmentResultSnapshot | null;
    validUnselectedResultCount: number;
    conflict: null | 'pointer_scope_mismatch' | 'attempt_result_mismatch' |
      'selected_attempt_missing' | 'selected_result_missing';
  };
  lifecycle: {
    seatStatus: 'issued' | 'active' | 'suspended' | 'removed' | 'absent';
    classroomAccess: 'active' | 'ended' | 'unknown';
  };
  timing: {
    effectiveDueAt: string | null;
  };
}
```

`AttemptSnapshot` carries the exact CURRENT or TARGET state, attempt number,
timestamps, and its Submission `late_state` when present. Result snapshots carry
only persisted evidence. All IDs and tenant/school/class relationships are
validated by the database reader before invoking the pure resolver. An
incoherent cross-tenant or cross-learner input returns a server contract error;
it does not become `invalidated` or a hidden cell.

The domain mapping is pure and UI-independent. Compatibility readers may remain
SQL functions/adapters for:

- assignment applicability and `classroom_assignment_work`;
- course lesson-to-assignment materialization/progress;
- latest `learning_attempts` plus immutable Submission;
- `gradebook_entries` plus `assessment_results`;
- CURRENT seat/account/principal lineage and lifecycle.

Controllers batch-read scoped inputs, call the same resolver, then shape page
pagination. They MUST NOT remap states, select a different result or interpret
legacy timestamps. UI may translate labels but MUST NOT infer semantics from
nulls. Review Queue filters `waiting_review`; Works and Matrix filter the same
DTO without re-resolving it.

## 5. Deterministic precedence

Precedence means a higher authority decides its semantic dimension; it does not
erase lower-source provenance.

| Order | Source | Exact rule |
|---:|---|---|
| 1 | ActivityParticipation / assignment applicability | A canonical participation decides assigned vs never assigned. During compatibility, a scoped classroom assignment applicable to the seat substitutes only for applicability. If neither exists, `not_applicable`. Withdrawn does not erase history; it adds `withdrawn`. |
| 2 | latest canonical Attempt | If an Attempt exists, its workflow mapping always wins over legacy work/course flags. Attempt choice is highest `attemptNumber`; TARGET readers additionally validate participation lineage. |
| 3 | canonical selection or CURRENT Gradebook pointer | This independently chooses `selectedResult`; it never overwrites latest Attempt workflow. Canonical selection wins when present. Otherwise one valid CURRENT pointer may be adapted. |
| 4 | legacy classroom work | Used for workflow only when no Attempt exists. Submitted legacy work becomes truthful `submitted`, never `not_started`; started work becomes `in_progress`. |
| 5 | course progress compatibility | It only locates the same course-generated assignment/work evidence. It cannot override an Attempt or create a second course workflow. |
| 6 | seat/classroom lifecycle | Determines access visibility and `withdrawn`/`visibility_restricted`; it never deletes or rewrites workflow/result history. |

Conflict decisions are fixed:

- Attempt and legacy disagree: Attempt wins; provenance records the conflict.
- No Attempt plus legacy submitted: `submitted`, `selectedResult = null`, flags
  include `legacy_unresolved` and `legacy_compatibility`.
- No Attempt plus legacy started: `in_progress`, flag
  `legacy_compatibility`.
- Result exists without a valid selection: result is not guessed;
  `selectedResult = null`, flag `unselected_result`.
- Valid pointer selects an older Attempt while a newer Attempt is active: keep
  the older selected result, use the newer Attempt workflow and add
  `revision_in_progress`.
- A pointer whose Attempt/Result/scope lineage is inconsistent is not emitted;
  it produces `unselected_result` and a provenance conflict.
- Lifecycle restriction wins only for access. Authorized teacher history remains
  visible when learner current access is restricted.

## 6. CURRENT Attempt mapping

| Exact CURRENT `learning_attempts.state` | Canonical workflow | Result/flags rule |
|---|---|---|
| `in_progress` | `in_progress` | selected older result remains; add `revision_in_progress` if it belongs to an older Attempt |
| `submitted` | `submitted` | result independent; no result is fabricated |
| `evaluating` | `waiting_review` | selected older result remains; a result for this Attempt appears only through valid selection |
| `accepted` | `completed` | pedagogical `passed|failed` comes from selected result, not workflow |
| `changes_requested` | `changes_requested` | immutable old Submission remains; cleared legacy timestamp cannot demote state |
| `incomplete` | `completed` | selected result retains `outcome=incomplete`; never infer zero points |
| `excused` | `completed` | add `excused`; selected result may carry `outcome=excused` |
| `invalidated` | `invalidated` | an invalidated Attempt cannot itself supply a selected result; an independently valid older selection may remain |

There is no CURRENT `draft`. Unknown CURRENT state is a resolver contract error
and must be reported, not mapped to `not_started`.

For future TARGET Attempts, `closed` maps to `completed` when canonical result/
completion evidence closes the work, `expired` maps to `completed` with its
persisted outcome/completion projection, and TARGET `submitted`/`evaluating` map
as above. Exact TARGET implementation remains a later task.

## 7. Result-selection compatibility

1. Validate that selection, Attempt, Result and assignment/participation belong
   to the same tenant, school learner and activity.
2. If a canonical `ActivityResultSelection` and latest non-superseded revision
   exist, emit that revision.
3. Otherwise, if a CURRENT `gradebook_entries` pointer pair is valid, emit its
   `assessment_results` row with `resultRevisionId = null` and
   `compatibilityAssessmentResultId = result.id`.
4. If result evidence exists but selection is absent or invalid, emit no result
   and add `unselected_result`. M0-004 does not silently apply a future `best`,
   `latest` or `latest_accepted` policy to CURRENT rows.
5. Workflow always comes from the latest Attempt, not selected Attempt.

Required overlay:

```json
{
  "workflowState": "in_progress",
  "selectedResult": {
    "attemptId": "attempt-1",
    "resultRevisionId": null,
    "compatibilityAssessmentResultId": "result-1",
    "displayGrade": "4"
  },
  "flags": ["revision_in_progress"]
}
```

This represents Attempt #1 accepted/grade 4 plus Attempt #2 in progress. A valid
older pointer is not a conflict merely because it is older. It becomes a
selection conflict only if the pointer is missing, broken or violates lineage.

## 8. Legacy-only and changes-requested rules

For `classroom_assignment_work.submitted_at IS NOT NULL` with no Attempt:

```text
workflowState = submitted
selectedResult = null
flags = [legacy_unresolved, legacy_compatibility] (+ timing/lifecycle flags)
workflowAuthority = legacy_classroom_work
```

`submitted_at` is truthful proof that the legacy system recorded submission,
but insufficient immutable content evidence. No fake Attempt, Submission,
ProjectVersion, digest, request id or Result may be created.

Authorized teachers see a diagnostic equivalent to:

```text
Legacy submission recorded; immutable submission evidence is unresolved.
```

Learners see only product semantics:

```text
Сдано. Результат пока не опубликован.
```

They do not see migration/table terminology or a false `На проверке` promise,
because no canonical manual-review Evaluation is proven.

For a real Attempt in `changes_requested`, that Attempt wins even when legacy
`submitted_at` was cleared or is stale. The immutable Submission remains in
provenance, workflow is `changes_requested`, and learner UI may render
`Нужны исправления`; it must not collapse the row to ordinary `В работе`.

## 9. Lifecycle visibility

History existence and current access are separate dimensions:

| Lifecycle | History | Authorized teacher history | Learner current access | Required flags |
|---|---|---|---|---|
| active seat + active classroom access | retained | visible | visible | none from lifecycle |
| issued/not activated | retained if any | visible | restricted | `visibility_restricted` |
| suspended seat | retained | visible | restricted (`access_suspended`) | `visibility_restricted` |
| removed seat | retained | visible | restricted (`access_ended`) | `withdrawn`, `visibility_restricted` |
| learner left classroom / ended participation | retained | visible | restricted (`access_ended`) | `withdrawn`, `visibility_restricted` |
| no authorized teacher scope | retained | restricted | independently evaluated | no DTO may bypass controller authorization |

Teacher visibility means an already authorized teacher may request historical
class evidence; it does not grant access by UUID. Learner access requires a
server-resolved active seat/account-school link. RLS and controller capability
checks run before/around the resolver. Removed/suspended lifecycle cannot erase
Attempt, Submission, Result or Gradebook history.

## 10. Learner identity compatibility

The semantic DTO never uses Account, seat or Principal as the stable learner
owner. During compatibility:

```text
identity.resolution = seat_compatibility
provenance.learnerId = null
provenance.seatId = CURRENT seat_id
```

After the authorized identity mapping/backfill:

```text
identity.resolution = learner_identity
provenance.learnerId = learner_identities.id
provenance.seatId = optional historical provenance
```

All workflow/result/flag/visibility rules remain byte-semantically unchanged.
An unresolved or cross-school identity link is a reader error or M0-005
`identity_unresolved` classification; it is never solved by Account email,
display label or Principal ownership. Project Principal remains artifact-owner
provenance and is not rewritten as learner identity.

## 11. Source matrix

`—` means no persisted source. `old` means a valid selected result for an older
Attempt. Visibility assumes an authorized teacher.

| # | Scenario | Legacy | Latest Attempt | Result / pointer | Lifecycle | workflowState | selectedResult | flags | Teacher | Learner |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | no work / no Attempt, assigned | — | — | — | active | `not_started` | null | — | visible | visible |
| 2 | project started legacy-only | started | — | — | active | `in_progress` | null | `legacy_compatibility` | visible | visible |
| 3 | legacy submitted / no Attempt | submitted | — | — | active | `submitted` | null | `legacy_unresolved`, `legacy_compatibility` | visible + diagnostic | visible, generic submitted message |
| 4 | Attempt in progress | any | `in_progress` | — | active | `in_progress` | null | conflict only in provenance | visible | visible |
| 5 | Attempt evaluating | submitted/missing | `evaluating` | — | active | `waiting_review` | null | — | visible | visible |
| 6 | accepted Attempt + selected result | submitted/missing | `accepted` | valid current pointer | active | `completed` | selected | — | visible | visible |
| 7 | changes requested, old immutable Submission | timestamp cleared | `changes_requested` | optional old selection | active | `changes_requested` | selected or null | — | visible | visible |
| 8 | previous selected result + new Attempt | any | `in_progress` #2 | old #1 selected | active | `in_progress` | old selected | `revision_in_progress` | visible | visible |
| 9 | Result exists, pointer absent | any | terminal | unselected result | active | mapped Attempt state | null | `unselected_result` | visible + diagnostic | visible without grade |
| 10 | pointer to older Attempt | any | newer terminal/active | valid old pointer | active | mapped latest state | old selected | `revision_in_progress` only if newer Attempt active | visible | visible |
| 11 | direct quiz accepted | none | `accepted` | valid quiz pointer | active | `completed` | selected | `late`/`after_due` only if evidenced | visible | visible |
| 12 | course-generated project | course work | mapped exact Attempt or none | independent | active | same rules as direct project | selected or null | source-dependent only | visible | visible |
| 13 | suspended seat with history | any | any | any valid selection | suspended | evidence-derived | selected if valid | `visibility_restricted` | visible | restricted |
| 14 | removed seat with history | any | any | any valid selection | removed | evidence-derived | selected if valid | `withdrawn`, `visibility_restricted` | visible | restricted |
| 15 | CURRENT Attempt excused | any | `excused` | valid result optional | active | `completed` | selected or null | `excused` | visible | visible |
| 16 | invalidated | ignored | `invalidated` | none or valid older selection | any | `invalidated` | older selected or null | lifecycle flags as applicable | visible | lifecycle-dependent |

If there is no assignment/participation for the learner, scenario 1 is instead
`not_applicable`. Applicability is resolved before absence of work.
An excused participation with no Attempt retains the evidence-derived base
workflow (`not_started` when assigned) and adds `excused`; the override does not
fabricate completed work.

## 12. Direct/course/quiz unification

| Path | Adapter-specific input | Shared semantic output |
|---|---|---|
| direct project | direct `classroom_assignments` row, optional legacy work, project Attempt chain | canonical DTO |
| course-generated project | course lesson locates generated classroom assignment, then the same work/Attempt chain | canonical DTO |
| direct quiz | quiz assignment and automatic Attempt/Submission/Result chain; no legacy work | canonical DTO |

Course provenance may set `workflowAuthority=course_progress_compatibility` only
when it supplies legacy-only progress. Once an Attempt exists, all three paths
use `latest_attempt`. Quiz automatic acceptance maps to `completed`; it does not
get a quiz-specific workflow enum.

## 13. M0-005 classification contract

M0-005 assigns exactly one primary classification per
`(school, learner provenance, activity assignment)` using this priority:

1. `identity_unresolved`: tenant/school/seat lineage is inconsistent or two
   logical learners cannot be reconciled without guessing. Absence of the future
   table alone is not sufficient when a seat can seed one identity losslessly.
2. `legacy_unresolved`: legacy `submitted_at` exists without an immutable
   Attempt/Submission chain, or another legacy claim would require fabricated
   evidence.
3. `selection_conflict`: result evidence exists but the pointer is absent,
   broken, cross-scope, Attempt/Result-inconsistent, or multiple candidate
   selections cannot be resolved by an already persisted policy.
4. `visibility_only`: evidence and selection are coherent; the only difference
   between surfaces is active/suspended/removed/ended access filtering.
5. `auto_reconcilable`: legacy and assessment sources can be mapped
   deterministically using persisted IDs/evidence, without inventing immutable
   content, identity or grades; a repeat run produces the same plan.
6. `clean_canonical`: stable learner, participation, Attempt/evidence,
   selection and visibility inputs already satisfy the canonical contract and
   no legacy source is authoritative.

The classifications are mutually exclusive by priority. The dry-run may also
report secondary facts, but MUST NOT downgrade `legacy_unresolved` to
`auto_reconcilable` merely because a timestamp exists. It must report direct,
course and quiz kind and retain aggregate counts for every primary class.

## 14. Future test design

### Unit fixtures for the pure resolver

Every source-matrix row is table-driven. Mandatory regressions:

```text
RES-UNIT-001 legacy submitted + no Attempt -> submitted/null/legacy_unresolved
RES-UNIT-002 changes_requested + legacy timestamp cleared -> changes_requested
RES-UNIT-003 old selected result + new active Attempt -> result + in_progress + revision flag
RES-UNIT-004 removed seat + historical result -> result retained, learner restricted
RES-UNIT-005 course project uses identical project mapping
RES-UNIT-006 quiz accepted uses completed with selected result
RES-UNIT-007 result without pointer -> null + unselected_result
RES-UNIT-008 unknown Attempt state -> contract error, never not_started
```

### Integration fixtures for adapters/controllers

```text
RES-INT-001 batch reader returns the same DTO through Class Learning and Gradebook
RES-INT-002 direct and course project with equal evidence normalize equally
RES-INT-003 quiz and project accepted results share selectedResult semantics
RES-INT-004 Gradebook pointer to older Attempt preserves old grade during revision
RES-INT-005 suspended/removed learner cannot use current learner endpoint
RES-INT-006 authorized teacher can read scoped historical evidence after removal
RES-INT-007 cross-school learner/seat/result IDs fail before resolver invocation
RES-INT-008 compatibility/current and future learner identity inputs yield equal semantic fields
```

Gradebook batch tests must cover at least `30 × 100` cells without N+1 reads.
Browser tests belong to the future consumer/cutover task, not this design task.

## 15. Requirement consequences

| Requirement | M0-004 consequence | Status after this task |
|---|---|---|
| `ARCH-003` | Gradebook is a consumer projection, never independent grade storage | design evidence only / in progress |
| `MIG-005` | exact precedence removes parallel UI authority after accepted cutover | design evidence only / in progress |
| `GRD-002` | exact canonical inputs and one resolver boundary defined | design evidence only / in progress |
| `GRD-005` | workflow, selected result and flags are orthogonal | design evidence only / in progress |
| `IDN-001` | input accepts future stable learner while preserving seat provenance | compatibility design only / in progress |
| `IDN-003` | future stable key changes input authority, not output semantics | compatibility design only / in progress |

Nothing above marks migration, runtime identity, Gradebook, API or UI as
implemented.

## 16. Unresolved risks

- Production population counts remain unknown until separately authorized
  M0-005 diagnostics.
- CURRENT pointer writes are atomic in supported paths, but historical/manual
  inconsistencies need dry-run measurement.
- The exact physical schema and RLS for LearnerIdentity remain outside this
  task despite the accepted ADR.
- TARGET `closed`/`expired` Attempt implementation and completion projection
  need later execution specs; this design fixes their semantic boundary only.
- A future endpoint must batch source reads consistently; mixed-revision reads
  could otherwise create a transient conflict even with a pure resolver.
- Teacher historical access for removed learners requires an explicit scoped
  reader because CURRENT Gradebook filters removed seats. This is a later
  runtime/security change, not granted by this contract.
