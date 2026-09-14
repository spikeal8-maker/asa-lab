# GP-R0-001 — review receipt

**Decision:** `R0_001_GAMING_IDENTITY.md`  
**Issue:** #222  
**Observed `main`:** `c3c1c10d7e37782de58ec84d31ed3336971150f5`

## POST_STEP_REVIEW

- STEP: define stable Games player identity over Account/StudentSeat without a second auth system.
- CHANGE_CLASS: L3_CRITICAL.
- CHANGED: architecture decision only; no runtime/schema.
- USER_RESULT: future Games features now have one stable player identity contract before persistence is created.
- INVARIANTS_TOUCHED: `IDA-SCOPE-001`, `IDA-AUTH-001`, `IDA-SEAT-001`, `IDA-LINK-001`, `IDA-REV-001`, `IDA-PROFILE-001`.
- TESTS: no runtime tests run; documentation/evidence review only.
- NEGATIVE_CHECKS: principal split, learner-identity misuse, heuristic seat merge, client-claimed player id, revoke/delete history loss.
- DOC_DRIFT: none found against current identity contract/evidence.
- UNVERIFIED: physical storage/RLS and rating merge policy are intentionally deferred.
- VERDICT: PASS.

## CHALLENGE_REVIEW

The decision was challenged against:

- one Account represented through account and classroom seat principals;
- standalone child seats with no Account;
- multiple seats with identical display labels;
- school-scoped `learner_identity`;
- class/workspace revocation;
- account deletion/anonymization;
- client-supplied public player ids;
- legacy Checkers and Chess participant/history compatibility.

Rejected alternatives:

- raw `principal_id` as Games identity — splits one Account human across scoped principals;
- `learner_identity.id` — school-scoped Learning key, not global Games identity;
- name/email/display-label merge — violates explicit-link and privacy invariants;
- destructive rewrite of historical participants after link — breaks immutable history and auditability.

Accepted model: separate Gaming Subject + verified Account/StudentSeat source links + canonical alias lineage for explicit merges. Authentication and authorization remain Identity/policy owned.

**VERDICT: PASS.**
