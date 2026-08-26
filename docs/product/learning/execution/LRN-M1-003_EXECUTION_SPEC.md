# LRN-M1-003 — Execution Spec

**Task:** `LRN-M1-003 — Persistent ActivityRun`  
**Milestone:** `M1 — Universal Delivery`  
**Status:** ACCEPTANCE EVIDENCE COMPLETE; PUBLICATION PENDING
**Baseline SHA:** `5d5c53652af35a99f1b149775b712ac68d4baed0`  
**Issue:** `#158`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Add one persistent, classroom-scoped `ActivityRun` storage/domain primitive
that pins one canonical immutable `LearningActivityVersion` and represents both
direct and course activity delivery through provenance, without creating learner
participation or changing the existing Attempt/read runtimes.

## 2. Non-goals

- no `ActivityParticipation`, learner rows, audience, group or late-join logic;
- no Attempt/Submission/Result ownership or reader cutover;
- no CourseRun materialization and no roster/CourseEnrollment mutation;
- no CourseRun lifecycle rewrite or existing handout rewrite;
- no learner UI, Gradebook change, M0 projection cutover or new HTTP endpoint;
- no historical ActivityRun backfill;
- no M1-004+, M2-M7, production migration, deployment, flag or restart.

## 3. Requirement IDs

```text
ARCH-001 (remains in_progress)
ARCH-002 (canonical storage portion only; overall remains in_progress)
RUN-101
RUN-102
RUN-103 (run-level base portion only)
RUN-104 (nullable explicit storage/base portion only)
RUN-105 (direct/course storage neutrality only; overall remains in_progress)
RUN-106 (run-explicit provenance foundation only; overall remains in_progress)
RUN-107 (stored evidence foundation only; inspector remains future)
VER-003 (ActivityRun pin portion)
VER-004 (run isolation regression)
IDN-003 (unchanged in_progress)
```

## 4. CURRENT evidence

| CURRENT row/family | Evidence | Actual role | M1-003 disposition |
| --- | --- | --- | --- |
| `learning_activities` | `0077`, additive canonical columns/functions in `0091` | definition root; canonical roots have `reusable_authored_content=true` | reuse as the only root |
| `learning_activity_versions` | `0077`, `0091` | immutable definition version; canonical publish rows use `canonical_contract_version=1` | exact immutable FK pinned by every new Run |
| `learning_migration_compatibility_activity_versions` | `0088`; exclusions in `0091`; M0 projection in `0089` | historical compatibility marker with `grading_semantics=unknown`, `reusable_authored_content=false` | creation rejects marked versions and never treats them as authored content |
| `classroom_activity_versions` | `0077` | compatibility link from existing classroom handout to frozen LAV | unchanged; no new writer |
| `classroom_assignments` | `0033`, course source columns in `0068` | CURRENT executable handout identity used by work/readers | retained as exact compatibility provenance; no competing handout table |
| `classroom_assignment_work` | `0033` | legacy learner work/start/submission flags | unchanged |
| `classroom_course_runs` | `0068` | persistent CURRENT CourseRun pinned to CourseVersion, lifecycle `open|closed` | reused as course parent; no enum rewrite |
| `classroom_course_run_lessons` | `0068`, blocks in `0075` | immutable per-run lesson snapshot; assignment lesson points to existing handout | optional CURRENT compatibility provenance, not claimed as canonical CourseVersion block identity |
| `course_versions` | `0067` | immutable course snapshot | unchanged; CourseRun remains its pin |
| `quiz_versions` | `0083`, canonical LAV convergence in `0091` | immutable quiz content; LAV owns future runtime policy | unchanged |
| `grading_scheme_versions` | `0084` | immutable school-scoped display-grade conversion | optional exact Run pin only when explicitly supplied and same-school |
| `classroom_grading_schemes` | `0084` | mutable classroom pointer | not called a school default and not auto-pinned |
| `learning_attempts` | `0077`; quiz extensions in `0083` | CURRENT assignment/seat/LAV runtime | unchanged; no half-migrated ActivityRun FK |
| `course_enrollments` | `0092` | stable learner membership in CourseRun | unchanged; Run creation is population-independent |
| canonical M0 projections | `0089`, API projection service and M0 tests | compatibility resolver over CURRENT assignment/attempt/result sources | unchanged |

CURRENT authored LAV lineage is tenant-scoped but does not store a distinct
`school_id`. M1-003 therefore proves LAV tenant lineage plus target school from
the exact classroom. It does not fabricate historical/authored school lineage or
silently redesign M1-001. A same-tenant multi-school authored-content scope rule
remains a documented future architecture gap; cross-tenant/school UUIDs and all
classroom/CourseRun school mismatches are physically rejected now.

## 5. Existing contracts to reuse

- `learning_activities` and `learning_activity_versions` from M1-001;
- `classrooms`, `classroom_memberships` and exact teacher Account principal;
- `classroom_assignments` as compatibility handout provenance;
- `classroom_course_runs` and `classroom_course_run_lessons` as course provenance;
- `grading_scheme_versions` only as an explicit immutable pin;
- existing append-only `audit_events`;
- existing restricted `asalab_app` integration-test boundary.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/project-map/PROJECT_MAP.md
docs/project-map/project-map.yaml
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
docs/product/learning/execution/LRN-M1-003_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M1_ACTIVITY_RUN_REPORT.md
migrations/0093_activity_runs.sql
tests/courses/activity-runs.pg.spec.ts
package.json
```

## 7. Files explicitly out of scope

```text
apps/web/**
schemas/openapi.yaml
learning_attempts / learning_submissions / results migrations
course_enrollments runtime functions
M0 canonical reader/controller implementation
production configuration and deployment files
```

## 8. Database / migration

`migrations/0093_activity_runs.sql` is the first free number at the baseline.

The additive `activity_runs` table stores:

- tenant/school/classroom lineage;
- exact LAV pin;
- `source_kind=direct|course`;
- exact existing handout provenance;
- nullable CourseRun and CURRENT run-lesson compatibility provenance;
- `active|closed|cancelled|archived` lifecycle and transition timestamps;
- nullable UTC `opens_at`, `due_at`, `closes_at` with chronology CHECK;
- nullable explicit `late_policy`;
- nullable explicit same-school `grading_scheme_version_id`;
- policy snapshot containing only Run-explicit values plus source provenance;
- creator, request identity/digest and creation timestamp.

Composite FKs and a lineage trigger prove that one Run belongs to one
classroom/school, that course parent/lesson/handout match that classroom, and
that the LAV is tenant-consistent. Run identity, LAV pin, source provenance,
dates/policy pins, creator and creation time are immutable. DELETE is rejected.

The migration performs no UPDATE/backfill of existing rows.

## 9. API / OpenAPI

N/A — M1-003 is a storage/domain primitive invoked only by guarded PostgreSQL
commands. No HTTP route or DTO is added, so OpenAPI remains unchanged.

## 10. Transaction boundaries

Create, lineage validation, idempotency resolution and audit append occur in one
transaction/function call. Lifecycle transition and its audit append occur in
one locked-row transaction/function call.

## 11. Idempotency / concurrency

- the same `(tenant, actor, creation_request_id)` and semantic digest returns the
  same Run;
- reusing the key with different semantics returns `idempotency_conflict`;
- one exact compatibility handout may identify only one ActivityRun;
- source-scoped advisory locking plus DB uniqueness makes concurrent create one
  row;
- course retry uses the exact existing CourseRun lesson/handout identity;
- future canonical `sourceCourseBlockId` uniqueness is deferred to M1-009 because
  CURRENT CourseVersion has no proven executable-block identity.

## 12. Authorization / RLS

- only an Account principal with exact owner/co-teacher classroom membership may
  create or transition a Run;
- new Runs accept only canonical, reusable LAV contract version 1 owned by that
  principal; M5 sharing is not inferred;
- tenant and school are derived server-side from the handout/classroom;
- course parent, lesson and handout must match the same class;
- compatibility LAVs are rejected;
- runtime role receives no unrestricted table DML/read and only narrow functions;
- UUID-only cross-tenant, cross-class, cross-school and cross-owner access fails.

## 13. Migration / compatibility

Existing assignments, CourseRuns, attempts, results and projections coexist
unchanged. New Runs point to exact existing handouts as compatibility provenance.
No existing executable path is switched, so rollback is removal/non-use of the
new unconsumed primitive before any later cutover.

## 14. Feature flag / rollout

N/A — no product reader or UI consumes the primitive and no production action is
authorized.

## 15. Rollback

Before M1-004/cutover, product behavior is unchanged. A release may omit the
additive migration/code. Production down-migration is not authored or executed;
historical rows must never be destructively removed by this task.

## 16. Unit tests

The base-availability function is exercised at explicit `as_of` timestamps for
scheduled, open, late, closed-by-time and stored lifecycle override behavior.
Policy-snapshot validation and chronology constraints are exercised at the DB
boundary.

## 17. Integration tests

`tests/courses/activity-runs.pg.spec.ts` proves all 27 owner-required scenarios:
direct/course creation through one table, immutable version pinning, lifecycle,
dates/availability, nullable grading, provenance, retry/concurrency, zero learner
runtime creation and M0/M1 regressions.

## 18. Browser E2E

N/A — no visible UI/read path changes.

## 19. Security negative tests

- learner create denied;
- outside teacher denied;
- foreign tenant/LAV and wrong classroom CourseRun denied;
- foreign-owner private content denied;
- compatibility LAV denied;
- forged direct/course provenance denied;
- immutable lineage and unrestricted runtime table access denied.

## 20. Performance considerations

Create uses one source-scoped advisory lock and indexed point lookups. Base
availability resolves one Run and optional parent CourseRun, with no roster,
participation or Attempt scan.

## 21. Acceptance checklist

- [x] one physical direct/course ActivityRun model
- [x] exact canonical LAV pin and compatibility exclusion
- [x] exact classroom/school/course provenance
- [x] stored lifecycle and guarded transitions
- [x] UTC chronology and run-level base availability
- [x] nullable explicit late policy without flattened LAV default
- [x] provenance-preserving runtime policy snapshot
- [x] nullable explicit same-school grading pin and no fake default
- [x] retry/concurrency proof
- [x] zero ActivityParticipation/Attempt/CourseEnrollment side effects
- [x] migration fresh apply and repeat zero
- [x] M0/M1-001/M1-002 regressions
- [x] security/RLS evidence
- [x] repository gates
- [x] ledger updated without premature overall closure

## 22. Evidence

Implementation SHA before evidence-only documentation:
`e8bac4574508161dc121840de948a552cfb51872`.

- isolated fresh `asalab_test`: 92 migrations applied through `0093`, PASS;
- guarded repeat apply: 0 migrations applied, PASS;
- `pnpm test:learning-m1-003`: 15/15 PASS, covering the required 27 scenarios;
- `pnpm test:learning-m1-001`: 15/15 PASS;
- `pnpm test:learning-m1-002`: 15/15 PASS;
- M0 projection/surface/adapter regressions: 12/12 PASS;
- `NX_SKIP_NX_CACHE=true pnpm gate:repository`: PASS; 172/172 test files,
  1186/1186 tests and 15/15 RLS tests; Nx lint/typecheck/build cache skipped;
- `pnpm control-plane:check`, `pnpm gate:governance`, `git diff --check`: PASS;
- browser evidence: N/A because no UI or current reader changed;
- production evidence: N/A; production was not touched or claimed.
