# LRN-M0-002 — Execution Spec

**Task:** `LRN-M0-002`  
**Milestone:** `M0`  
**Status:** DONE — architecture decision accepted; runtime remains unimplemented  
**Baseline SHA:** `6866e05d441e3f5e57e5b3125cd8470f1ccddaaa`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

## 1. Goal

Choose exactly one stable learner-key strategy from CURRENT evidence and record
it in `ADR-LEARNER-IDENTITY-001` without changing runtime or persistence.

## 2. Non-goals

- no migration or physical learner-identity table;
- no API, OpenAPI, UI, Gradebook or Quiz Engine change;
- no historical-row rewrite or inferred learner merge;
- no M0-003 or M1-M7 work.

## 3. Requirement IDs

```text
DB-000
IDN-001
IDN-002
IDN-003
IDN-004
```

`IDN-002` may become proven when the ADR is accepted. `IDN-001`, `IDN-003`
and `IDN-004` remain unimplemented because this task makes no runtime change.

## 4. CURRENT evidence

- `docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md` maps Account,
  StudentSeat, Principal, classroom membership, Attempt, Submission, Result and
  Gradebook lineages.
- `migrations/0010_account_identity_sessions_v2.sql` defines global Account and
  account Principal records and Project Principal ownership.
- `migrations/0021_classroom_roster_studentseat.sql` defines class-scoped seats,
  seat status and tenant RLS.
- `migrations/0026_student_seat_principal.sql` defines a lazy, one-per-seat
  Principal distinct from account Principal.
- `migrations/0050_account_learners.sql` links an Account to one seat per class,
  permits one Account in multiple classes and omits membership when tenant
  lineage cannot produce a legacy user.
- `migrations/0077_learning_assessment_foundation.sql`,
  `migrations/0083_quiz_engine.sql` and
  `migrations/0084_grade_scales_and_learner_results.sql` make current Attempts,
  results and Gradebook rows seat-owned and account reads an active-seat union.

## 5. Existing contracts to reuse

Reuse Account as an authentication subject, StudentSeat as classroom access and
participation evidence, Principal as Project Core owner/actor, Classroom and
School as tenant lineage, and immutable Attempt/Submission/Result rows as
historical evidence. None is preselected as the stable learner key.

## 6. Exact files to change

```text
docs/product/learning/execution/LRN-M0-002_EXECUTION_SPEC.md
docs/architecture/ADR-LEARNER-IDENTITY-001.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/.lrn-m0-002-bootstrap.md (remove)
```

Governance integration changes are committed separately in `main`:

```text
docs/execution/current.yaml
docs/project-map/PROJECT_MAP.md
```

## 7. Files explicitly out of scope

```text
migrations/**
schemas/openapi.yaml
apps/**
contexts/**
tests/**
e2e/**
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
```

## 8. Database / migration

N/A — architecture decision only. The ADR may describe a future minimal
mapping layer, but no DDL, backfill or persistence mutation is authorized.

## 9. API / OpenAPI

N/A — no runtime contract changes.

## 10. Transaction boundaries

N/A for this task. The ADR records future atomic linking/merge constraints.

## 11. Idempotency / concurrency

N/A for this task. Future linking must be idempotent and prevent two active
school-scoped identities for the same verified Account without reconciliation.

## 12. Authorization / RLS

Source-inspect current tenant and resource boundaries. The ADR must state the
future school/tenant lineage and negative cross-school requirements; it does
not alter policies.

## 13. Migration / compatibility

Document a future additive mapping/backfill only. Existing `seat_id` and
Principal ownership remain intact; ambiguous rows are reported, never guessed.

## 14. Feature flag / rollout

N/A — no runtime.

## 15. Rollback

Revert documentation/governance commits. No database or product rollback is
needed.

## 16. Unit tests

N/A — documentation-only decision.

## 17. Integration tests

N/A — documentation-only decision.

## 18. Browser E2E

N/A — UI and runtime are unchanged.

## 19. Security negative tests

N/A at runtime. Security evidence is source review of tenant, school, class,
Account, seat and Principal boundaries; future negative tests remain required.

## 20. Performance considerations

N/A — no query or runtime change. Future mapping resolution requires indexed
school, Account and StudentSeat links.

## 21. Acceptance checklist

- [x] ADR chooses exactly A or B
- [x] all four candidates are evaluated against required lifecycle criteria
- [x] exact stable owner key is named for all learning history
- [x] school tenant lineage and multi-school behavior are fixed
- [x] migration/backfill and RLS consequences are explicit
- [x] migrations N/A
- [x] OpenAPI N/A
- [x] browser N/A
- [x] governance/documentation gates pass
- [x] ledger updated without claiming runtime implementation

## 22. Evidence

```text
baseline SHA: 6866e05d441e3f5e57e5b3125cd8470f1ccddaaa
canonical package commit: 9a0e86a1a8dfdac9f48c2ec23e69b7e1b3c76581
activation commit: 41509e3c730db26752920eda9f015f78e74da22c
final SHA: reported by Git after merge and governance completion; not self-recorded in this commit
ADR decision: B
stable learner key: learner_identities.id (future school-scoped immutable UUID)
command: git diff --check
result: PASS
command: pnpm control-plane:check
result: PASS; Admin/Auth primary, learning lane LRN-M0-002, blocking=0
command: pnpm gate:governance
result: PASS; 51 control-plane cases and all documentation/governance validators passed
command: pnpm contracts:check
result: PASS; OpenAPI 0.5.0 unchanged, 37 paths; health JSON Schema valid
command: pnpm exec prettier --check <LRN-M0-002 files>
result: PASS
browser artifacts: N/A; no UI/runtime change
migration evidence: N/A; no migration created or run
security evidence: static Account/Seat/Principal/Classroom/RLS and multi-school boundary review
known gaps: physical mapping layer, backfill and negative runtime tests require a future separately activated task
```
