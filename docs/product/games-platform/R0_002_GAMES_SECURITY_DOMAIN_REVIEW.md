# GP-R0-002 — Review Receipt

**Requirement:** `GP-R0-002`  
**Issue:** #223  
**Change class:** L3_CRITICAL architecture/security boundary

## POST_STEP_REVIEW

- STEP: decide Games platform storage/security scope without misusing participant tenant ownership.
- CHANGED: architecture/documentation only; no schema/runtime/deployment.
- USER_RESULT: later R1 can implement cross-workspace online Checkers without redesigning tenant ownership after SQL exists.
- INVARIANTS_TOUCHED: tenant/RLS defense-in-depth, authenticated actor authority, child-data minimization, no second auth system.
- EVIDENCE: `DATA_SECURITY_AND_TENANCY.md`; `@asa-lab/database.withTenantContext`; Chess Live migration/repository; accepted `GP-R0-001`.
- TESTS: no runtime tests run; current `main` facts inspected directly.
- NEGATIVE_CHECKS: participant-tenant ownership, synthetic tenant, client-claimed player/tenant, no Games context, cross-player ticket mutation, class outsider, public identity leakage.
- DOC_DRIFT: generic tenancy document needs an explicit platform-scoped-domain exception; addressed in the same bounded documentation slice before closure.
- UNVERIFIED: actual SQL/RLS behavior remains future R1 implementation evidence.
- VERDICT: PASS.

## CHALLENGE_REVIEW

Rejected alternatives:

1. **Use creator/player tenant for the match.** Fails when opponents come from different tenants and leaks ownership semantics into ratings/history.
2. **Use a synthetic global Games tenant.** Reuses tenant machinery but collapses all players into one fake tenant and turns a missing application predicate into broad exposure risk.
3. **Reuse `learner_identity` / classroom scope as Games storage owner.** Breaks non-school Accounts and cross-school history; Learning identity is school-scoped.
4. **Drop RLS and trust only service code.** Conflicts with ASA defense-in-depth requirements.
5. **Create a second Games database immediately.** Adds deployment/backup/availability cost before R1 proves the common core; repository boundary already preserves later extraction.

Accepted model: same PostgreSQL initially, explicit platform Games security domain, dedicated Games schema/repositories, server-derived `game_player_id` transaction context, forced RLS for private rows, narrow audited cross-player transactional operations, and tenant scope only as verified relation binding.

**VERDICT: PASS.**