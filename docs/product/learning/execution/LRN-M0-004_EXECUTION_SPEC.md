# LRN-M0-004 — Canonical State/Result Resolver Design Execution Spec

**Task:** `LRN-M0-004`

**Milestone:** `M0 — State Convergence`

**Status:** IN_PROGRESS
**Baseline SHA:** `879f659471709e36d6df6110ab6c0e0612a4c7c5`

**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`

**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Define one deterministic server-side canonical state/result resolver contract
for direct projects, course-generated projects and quizzes, including truthful
legacy compatibility, result-selection compatibility and lifecycle visibility.

## 2. Non-goals

This task does not implement runtime code, migrations, backfill,
`learner_identities`, UI or Gradebook 2.0; it does not converge OpenAPI, run the
M0-005 dry-run, or begin M1-M7.

## 3. Requirement IDs

```text
ARCH-003 — design evidence only; no projection implementation
MIG-005 — deterministic target/compatibility rule only; not implemented
GRD-002 — canonical projection input contract design only
GRD-005 — canonical orthogonal DTO design evidence only
IDN-001 / IDN-003 — compatibility interface implications only; runtime remains in_progress
```

## 4. CURRENT evidence

The design must be derived from, and cite exact CURRENT contracts in:

```text
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md
docs/architecture/ADR-LEARNER-IDENTITY-001.md
migrations/0033_classroom_assignments.sql
migrations/0068_classroom_course_runs.sql and related course migrations
migrations/0077_learning_assessment_foundation.sql
migrations/0083_quiz_engine.sql
migrations/0084_grade_scales_and_learner_results.sql
apps/api/src learning/classroom/course controllers
apps/web/src learner/teacher learning projections
tests/courses and relevant controller fixtures
```

Exact CURRENT Attempt values must be extracted from schema/code; TARGET states
must not be reported as existing CURRENT enum values.

## 5. Existing contracts to reuse

The design reuses StudentSeat/account/principal provenance, classroom assignment
and work compatibility rows, activity-version mappings, Attempt/Submission/
Evaluation/Result evidence, Gradebook selected pointer and accepted ADR option B.
It introduces a contract, not a second runtime system.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/learning/execution/LRN-M0-003_EXECUTION_SPEC.md
docs/product/learning/execution/LRN-M0-004_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_CANONICAL_STATE_RESULT_RESOLVER.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml (design evidence only)
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

N/A — design/contract only. No DDL, DML, backfill or data dry-run is authorized.

## 9. API / OpenAPI

N/A — the canonical DTO and resolver boundary are normative future contracts,
but no endpoint or `schemas/openapi.yaml` change is authorized in M0-004.

## 10. Transaction boundaries

N/A for this documentation task. The design must identify immutable evidence
and mutable selection inputs but does not change their write transactions.

## 11. Idempotency / concurrency

The pure resolver must be deterministic for an identical input snapshot. Future
readers must acquire mutually consistent input or expose its read revision; no
write/idempotency behavior is implemented here.

## 12. Authorization / RLS

No policy changes. The output separates historical evidence existence, teacher
historical visibility and learner current access. Caller authorization remains
outside the pure mapping and must be supplied by server-side scoped readers.

## 13. Migration / compatibility

The design must preserve legacy-only submitted truth without fabricating an
Attempt, Submission, ProjectVersion, digest or Result; it must work with CURRENT
seat provenance and future `learner_identities.id` without changing output DTO.

## 14. Feature flag / rollout

N/A — no runtime rollout. Future cutover is outside M0-004.

## 15. Rollback

Revert the documentation/governance commit. Runtime and persistent data are
unchanged.

## 16. Unit tests

Future resolver unit-test design must cover all source-matrix rows, including
legacy-only submitted, changes requested with cleared legacy timestamp, old
selected result plus new Attempt, removed-seat history, course project and quiz.

## 17. Integration tests

Future adapter/reader fixtures must prove direct project, course-generated
project and quiz normalize to the same DTO, selection remains orthogonal to
workflow, and lifecycle access does not erase history.

## 18. Browser E2E

N/A — no UI/runtime changes. Future consumer E2E expectations are specified as
contract consequences, not run as evidence for this documentation task.

## 19. Security negative tests

Future tests must cover cross-school learner IDs, direct UUID access, removed
and suspended seat access, and teacher historical access without granting
learner current access. No security behavior changes in this task.

## 20. Performance considerations

The resolver is one pure/domain mapping over a bounded per-cell input. Future
batch readers must avoid per-cell queries for the Gradebook target of 30 by 100;
performance is not measured in this documentation-only task.

## 21. Acceptance checklist

- [ ] one canonical output DTO and allowed values
- [ ] one deterministic input precedence/conflict table
- [ ] all proven M0-003 conflicts receive exact outputs
- [ ] legacy-only submitted remains truthful without fake evidence
- [ ] selected result is orthogonal to current workflow
- [ ] lifecycle visibility is orthogonal to evidence existence
- [ ] direct/course/quiz share one semantic resolver contract
- [ ] CURRENT seat and future learner identity inputs preserve the same output
- [ ] exact M0-005 classifications and rules
- [ ] future unit/integration/security fixture design for the full source matrix
- [ ] ledger contains design evidence without false implementation claims
- [ ] `git diff --check`
- [ ] `pnpm control-plane:check`
- [ ] `pnpm gate:governance`
- [ ] `pnpm contracts:check`

## 22. Evidence

Pending. Final evidence will identify the normative design document, exact
commands, gate outcomes, final SHA and unresolved risks. Browser/runtime,
migration and OpenAPI evidence are N/A because this task changes no product
contract or runtime.
