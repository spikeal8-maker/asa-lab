# LRN-M0-008 — M0 Acceptance Gate — Execution Spec

**Task:** `LRN-M0-008`  
**Milestone:** `M0 — State Convergence`  
**Status:** IN_PROGRESS  
**Baseline SHA:** `309c66b4c04d769945af2f7c0c3bdb728ccb2a97`  
**Issue:** `#152`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Prove or disprove, with fresh database, code, browser, security, performance and governance evidence, that LRN-M0-001 through LRN-M0-007 form a coherent accepted M0 foundation for a separately authorized M1.

## 2. Non-goals

- No M1 entities, `ActivityRun`, `ActivityParticipation` or `CourseEnrollment`.
- No Quiz Engine, Gradebook Matrix, Course Builder or unrelated OpenAPI cleanup.
- No production deploy, migration, backfill, diagnostics, flag switch or restart.
- No production enablement of the isolated-test-only M0-006 convergence procedure.

## 3. Requirement IDs

```text
MIG-001 MIG-002 MIG-003 MIG-004 MIG-005 MIG-006 MIG-007
DB-000
IDN-001 IDN-002 IDN-003 IDN-004
ARCH-003
GRD-002 GRD-005 (M0 compatibility evidence only; M3 remains incomplete)
```

## 4. CURRENT evidence

The gate re-audits the accepted M0 evidence rather than inferring completion from task labels:

- `docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md`;
- `docs/architecture/ADR-LEARNER-IDENTITY-001.md`;
- `docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md`;
- `docs/product/learning/current/LRN_M0_CANONICAL_STATE_RESULT_RESOLVER.md`;
- `docs/product/learning/current/LRN_M0_LEGACY_DRY_RUN_REPORT.md`;
- `docs/product/learning/current/LRN_M0_ADDITIVE_BACKFILL_REPORT.md`;
- `docs/product/learning/current/LRN_M0_SURFACE_CONVERGENCE_REPORT.md`;
- migrations `0086` through `0089`, their tooling, APIs, OpenAPI, tests and browser artifacts.

Each M0 Definition of Done row must cite exact code/data/test/browser/SHA evidence in `docs/review/learning/M0_ACCEPTANCE_REPORT.md`.

## 5. Existing contracts to reuse

- ADR-selected `learner_identities` mapping layer and active links;
- legacy classroom evidence plus canonical Attempt/Submission/Result/Gradebook evidence;
- `resolveCanonicalLearningState(...)` and existing direct/course/quiz adapters;
- `LearningCanonicalProjectionService` and `learning_canonical_evidence_*` wrappers;
- M0 analyzer, guarded convergence tooling, migration and browser suites.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/learning/execution/LRN-M0-008_EXECUTION_SPEC.md
docs/review/learning/M0_ACCEPTANCE_REPORT.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml (only evidence/milestone truth)
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md (M2-009 dependency correction only)
docs/project-map/project-map.yaml (only factual M0 status drift)
docs/project-map/PROJECT_MAP.md (only factual M0 status drift)
apps/api/src/learning-canonical-projection.service.spec.ts (acceptance-only flag round-trip proof)
docs/product/learning/execution/LRN-M0-005_EXECUTION_SPEC.md (owner-acceptance factual drift)
docs/product/learning/execution/LRN-M0-006_EXECUTION_SPEC.md (owner-acceptance factual drift)
```

## 7. Files explicitly out of scope

```text
apps/** product runtime implementation
contexts/** domain/runtime implementation
migrations/** new or modified migrations
production configuration and data
M1-M7 implementation files
```

Existing runtime files may be read and executed, not changed. One test-only
round-trip assertion may be added where the owner-required acceptance proof is
stricter than the M0-007 test; it must not change product behavior.

## 8. Database / migration

No new migration. A completely fresh isolated PostgreSQL must apply `0001` through `0089`, report zero pending on repeat, then run migration validation, M0-005 analyzer, guarded M0-006 fixtures, canonical projection and M0-007 surface tests.

## 9. API / OpenAPI

No API change. `schemas/openapi.yaml` is checked only against HTTP contracts changed by M0-007. Historical unrelated OpenAPI debt remains out of scope.

## 10. Transaction boundaries

N/A — acceptance/documentation task. Existing isolated migration/convergence transactions are tested without changing their contract.

## 11. Idempotency / concurrency

Prove migration repeatability, analyzer repeatability and canonical → legacy → canonical read switching without evidence mutation.

## 12. Authorization / RLS

Re-run negative evidence for cross-learner, outside-teacher, direct UUID enumeration, cross-school links/results, inactive seats, learner diagnostic leakage, client-selected scope and application-role access to owner convergence procedures.

## 13. Migration / compatibility

Confirm exact evidence only, no fabricated historical Submission, preserved legacy feedback without grade conversion, unknown compatibility grading, additive rollback metadata and isolated-only convergence guard.

## 14. Feature flag / rollout

No production flag mutation. The report must assess the default-canonical risk when code reaches a database without migration 0089 and prescribe an explicit legacy-first, migration-before-canonical release order. An unsafe or unprovable order is a gate blocker.

## 15. Rollback

Prove canonical → `LEARNING_CANONICAL_READS=legacy` → canonical returns the same canonical state after restoration and does not mutate Attempt, Submission, Result, Gradebook pointer, legacy evidence or LearnerIdentity data.

## 16. Unit tests

```text
M0-ACC-UNIT-001 canonical resolver regression matrix A-F
M0-ACC-UNIT-002 feature flag canonical/legacy/canonical without writes
M0-ACC-UNIT-003 compatibility grading and pointer conflict fail closed
```

## 17. Integration tests

```text
M0-ACC-INT-001 fresh 0001..0089 and zero pending repeat
M0-ACC-INT-002 M0-005 analyzer repeatability
M0-ACC-INT-003 guarded M0-006 convergence fixtures
M0-ACC-INT-004 surface matrix A-H
M0-ACC-INT-005 RLS/security negative matrix
M0-ACC-PERF-001 30x100, bounded query count, timing recorded
```

## 18. Browser E2E

Re-run `e2e/learning-surface-convergence.spec.ts` for A-D and retained selected-result semantics. Existing screenshots may be replaced only by fresh run artifacts; no UI implementation is authorized.

## 19. Security negative tests

The exact eight-case owner matrix in section 12 is mandatory. Any missing enforcement is FAIL, not an inferred PASS.

## 20. Performance considerations

Re-run 30 learners × 100 assignments; require one bounded projection query and record elapsed time. M3 matrix virtualization is not evaluated.

## 21. Acceptance checklist

- [ ] M0-001..007 coherence matrix
- [ ] Master Spec M0 DoD evidence matrix
- [ ] fresh isolated database 0001..0089
- [ ] repeat migrations = zero pending
- [ ] regression matrix A-H
- [ ] ledger M0 subset audit
- [ ] IDN-003 M1 disposition without semantic weakening
- [ ] GRD-002/GRD-005 remain honest M3 scope
- [ ] M2-009 dependency conflict corrected documentarily
- [ ] factual governance/project-map drift corrected
- [ ] safe production rollout and rollback documented, not executed
- [ ] contracts/OpenAPI gate
- [ ] unit/integration/migration/security/performance gates
- [ ] browser evidence
- [ ] required repository gates on exact candidate SHA
- [ ] official GitHub workflow
- [ ] final verdict is exactly `M0 ACCEPTED` or `M0 NOT ACCEPTED`

## 22. Evidence

Pending. The final report will record the candidate/final SHA, exact commands and outputs, fresh database receipt, browser artifacts, security/performance evidence, known non-M0 gaps and production status.
