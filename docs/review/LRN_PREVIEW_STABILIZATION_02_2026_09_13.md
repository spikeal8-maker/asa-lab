# Bounded Preview technical review — stabilization 02

This receipt supersedes the earlier Preview receipts specifically on the all-database-write interpretation and 0137. Owner acceptance remains pending. Base is immutable `recovery/e1-learning-20260913` at `8ea7771d902d92f5288685a031b134feb353f4cc`; this review is not a main merge candidate or E1 acceptance.

## Decision: ordinary author session resolver (variant B)

Authority: proposed Integrated V1.4 §4.4 and LRN-PRV-001, reviewed against the same academic prohibition already present in the inherited specification. They prohibit Account/Seat, Enrollment/Participation, Attempt/Submission, Completion/Result/Gradebook/Notification and real learner-session changes. They do not prohibit the normal `sessions_v2.last_seen_at` heartbeat of the existing authenticated author. The compact contract now says this explicitly; this clarifies the existing domain boundary rather than weakening learner isolation.

Variant A provided total SQL read-only behavior, but duplicated the session validity query, expanded Identity ports/use cases, and imposed an additional DB-first migration. Its parity tests showed no current weakening, yet maintaining a second resolver would add an unnecessary future divergence risk. Total SQL silence is stronger than the canonical requirement and is not selected merely to satisfy the previous test.

Variant B restores the three Identity files byte-for-byte to recovery, removes the special controller readOnly path and withdraws unreleased 0137 from the branch. Existing clients and session validity predicates remain unchanged. 0136 remains the Preview data function and is already in recovery. No production DB was migrated, and no database object/data was dropped. The earlier isolated test database containing 0137 is retained; fresh tests now build a separate `_test` database through 0136. A deployment from the intermediate branch with 0137, if one ever existed, must retain its migration ledger and be reviewed before a future release; this task performs no deployment.

The HTTP regression rejects INSERT/UPDATE/DELETE/TRUNCATE on every public table, including all academic and learner-session tables, except that existing requesting-author sessions may advance only last_seen_at. Inserts/deletes, credentials, expiry, scope and unrelated-session updates remain forbidden. The exception uses exact fixture token hashes; test counters are supplementary, not the write proof. The test proves the guard rejects author expiry changes and zero-row academic UPDATEs, and proves normal heartbeat occurs.

Fresh PostgreSQL: 135 migration files applied through 0136; two selected tests pass (six unrelated Result A tests excluded). Author session validity rejects revoked/expired sessions, suspended accounts and revoked membership. Actual Preview HTTP covers exact saved/published content and digest, stale draft 409, foreign author/version 404, missing auth 401 and malformed/conflicting source 400. The first guard self-test referred to an absent updated_at column; corrected to the real state column, then both tests passed. API build passed with 15 tasks rerun and Nx cache disabled.

## Lifecycle dependency

Restoring the recovery Gradebook file reproduces exactly one Web type error, TS2367 at ClassroomGradebook.tsx:490: canonical state excludes `accepted`. `accepted` is a pedagogical result decision, not an Attempt lifecycle state. Recovery's `canonical-learning-state.ts` already supplies the authoritative state union; completed/result rendering remains unchanged. The one-line stale comparison removal is carried in a separate lifecycle commit, not justified as Preview behavior. Its acceptance source is the existing lifecycle contract, not a new result-selection decision.

## Remaining evidence

Final focused unit/type/build/browser, lint/contracts/governance evidence and exact GitHub status are recorded below when performed. This decision alone is not a full PASS, independent review, owner acceptance, release candidate, integration or deployment.
