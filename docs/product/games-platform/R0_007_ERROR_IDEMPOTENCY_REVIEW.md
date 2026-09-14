# GP-R0-007 — Challenge Review

**Decision:** `R0_007_ERROR_IDEMPOTENCY.md`  
**Supporting:** `R0_007_ERROR_CATALOG_LIMITS.md`  
**Issue:** #241  
**Verdict:** PASS

## Challenges

1. **Lost response:** state/events/receipt/outbox share a durable boundary; exact retry replays instead of applying twice.
2. **Stale version:** `expectedVersion` is in the fingerprint; after reconciliation a new command id is required.
3. **Authorization:** receipt ownership is server-resolved and current read entitlement is checked before replay data is exposed.
4. **Bad input volume:** malformed/unauthenticated requests fail before durable receipt creation.
5. **Concurrent writes:** compare-and-write on the authoritative version permits at most one winner.
6. **Game-specific errors:** `GAME_COMMAND_REJECTED` is generic transport semantics; game reason may be namespaced details.
7. **Limits:** numeric ceilings are API safety defaults, not a Redis/microservice commitment.
8. **Checkers:** R1 adds the platform command boundary without rewriting Russian-64 rules.
9. **Chess:** existing receipt/fingerprint/version behavior is reusable, but the known rated-finalization durability gap remains an R4 blocker.
10. **Finalization:** GP-R0-004 remains intact; terminal result/outbox is durable before derived rating/stats are trusted.

## Evidence

- `contexts/chess-live/application/ports.ts` already persists command actor/kind/fingerprint/resource identity.
- `contexts/chess-live/application/service.ts` already rejects same command id with another fingerprint.
- `apps/api/src/validation.ts` already enforces mandatory safe 1..128-character idempotency keys.
- Chess PostgreSQL tests already prove deterministic expected-version races and repeated command replay.
- `contexts/checkers/application/game-service.ts` proves current expectedVersion guard and the missing typed/idempotent R1 layer.

No SQL/runtime behavior changes are authorized by this review.
