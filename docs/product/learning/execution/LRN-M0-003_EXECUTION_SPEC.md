# LRN-M0-003 — Status Divergence Trace Execution Spec

**Task:** `LRN-M0-003`

**Milestone:** `M0 — State Convergence`

**Status:** DONE — evidence accepted by owner on 2026-08-24
**Baseline SHA:** `57a3dfa3dd392253d2c0c7b4e20f9411bf2fedcb`

**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`

**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Prove or fail to reproduce, from exact CURRENT controller, SQL, table and UI
lineage, how the same classroom learner and assignment can be represented as
submitted or waiting on one surface and not started on another.

## 2. Non-goals

This task does not change runtime behavior, schema, data, OpenAPI, Gradebook,
Quiz Engine, learner identity, status resolution or historical evidence. It
does not start M0-004 or any M1-M7 work.

## 3. Requirement IDs

```text
MIG-001 — evidence only; remains in_progress because this task does not resolve the contradiction
MIG-005 — target-state boundary only; not implemented by this task
```

## 4. CURRENT evidence

The accepted M0-001 audit establishes three CURRENT state families: legacy
classroom work, course runtime and assessment runtime. This task will verify the
audit against the baseline descendant and cite exact evidence from:

```text
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
docs/architecture/ADR-LEARNER-IDENTITY-001.md
migrations/0033_classroom_assignments.sql and subsequent classroom migrations
migrations/0068_classroom_course_runs.sql and subsequent course migrations
migrations/0077_learning_assessment_foundation.sql
migrations/0083_quiz_engine.sql
migrations/0084_grade_scales_and_learner_results.sql
apps/api/src/** learning/classroom/course controllers
apps/web/src/** learner/teacher learning projections
tests/** existing PostgreSQL and controller evidence
```

Observed behavior will be recorded only after exact source and read-only
diagnostic verification. ADR option B is TARGET context, not a CURRENT table.

## 5. Existing contracts to reuse

Read-only evidence reuses the existing Account, StudentSeat, Principal and
Classroom membership provenance; `classroom_assignments`,
`classroom_assignment_work`, course-run tables, learning activity/attempt/
submission/evaluation tables, `assessment_results`, `gradebook_entries`, their
controllers and existing tests. No new contract is introduced.

## 6. Exact files to change

```text
docs/product/learning/execution/LRN-M0-003_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml (evidence/status accuracy only)
docs/execution/current.yaml (task completion transition only after acceptance evidence)
docs/project-map/PROJECT_MAP.md (minimal governance drift synchronization only)
```

## 7. Files explicitly out of scope

```text
migrations/**
schemas/openapi.yaml
apps/api/**
apps/web/**
contexts/**
tests/**
e2e/**
docs/architecture/ADR-LEARNER-IDENTITY-001.md
```

## 8. Database / migration

N/A — diagnostics are read-only; no DDL, DML, migration or backfill is
authorized. Any database query must run in a read-only transaction or be an
existing test whose own fixture transaction is isolated and rolled back.

## 9. API / OpenAPI

N/A — endpoint and OpenAPI coverage are traced as CURRENT evidence, but no
contract convergence or endpoint change is authorized.

## 10. Transaction boundaries

N/A — no product transaction changes. Diagnostic SQL uses `BEGIN READ ONLY`
and `ROLLBACK` where a live database is inspected.

## 11. Idempotency / concurrency

N/A — no writes. The report will identify current mutable pointers and
transaction boundaries where they affect observed status precedence.

## 12. Authorization / RLS

No authorization or RLS policy changes. Evidence must identify current
seat/account/principal provenance and active/suspended/removed visibility
filters without exposing credentials or personal learner data.

## 13. Migration / compatibility

N/A — the task documents legacy/new coexistence and its exact divergence. It
does not reconcile, fabricate or convert historical evidence.

## 14. Feature flag / rollout

N/A — documentation and governance only.

## 15. Rollback

Revert the documentation commit and governance completion transition. There is
no product or data rollback because runtime and persistence are unchanged.

## 16. Unit tests

N/A — no implementation is changed. Existing unit/controller tests may be run
as read-only code-path evidence.

## 17. Integration tests

Run focused existing PostgreSQL tests that exercise project submission/review,
quiz result publication and Gradebook/learner result projections if they do not
require product mutation. Record exact command, fixture and result.

## 18. Browser E2E

N/A unless exact controller/query lineage cannot establish the two surfaces.
Browser evidence is supplementary and must not substitute for data lineage.

## 19. Security negative tests

No new security behavior. Existing cross-seat/class and seat-status tests may
be cited or run to prove visibility filters. Live diagnostics expose aggregates
and schema facts only.

## 20. Performance considerations

N/A — no runtime query changes or load are introduced.

## 21. Acceptance checklist

- [x] exact endpoint → SQL/query → table/field → UI map for every status surface
- [x] direct project, course-generated project and direct quiz paths traced
- [x] learner-result and Gradebook read models traced
- [x] required legacy/new/result-pointer and seat-lifecycle scenarios decided
- [x] conclusion is exactly `PROVEN`
- [x] migrations N/A — prohibited
- [x] OpenAPI changes N/A — prohibited
- [x] unit implementation tests N/A — no implementation
- [x] relevant existing integration evidence
- [x] browser N/A unless required by unresolved lineage
- [x] security/read-visibility evidence
- [x] `git diff --check`
- [x] `pnpm control-plane:check`
- [x] `pnpm gate:governance`
- [x] ledger evidence/status accuracy updated

## 22. Evidence

The `PROVEN` evidence, exact commands, setup failures, successful test outputs,
aggregate data shapes and known gaps are recorded in
`docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md`. Browser E2E
is N/A because exact SQL reader calls reproduced both conflicting projections.
`git diff --check`, `pnpm control-plane:check`, `pnpm gate:governance` and
`pnpm contracts:check` pass on the documentation change set.
