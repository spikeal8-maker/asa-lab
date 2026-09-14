# ASA Games Platform — Chess R4 Correctness Risks

**Status:** supporting R4 risk register  
**Observed main:** `16dea36ea023a7f1ffff5441cf1f739c5ef68de6`  
**Read with:** `CHESS_HYGIENE_AUDIT.md`

This file holds correctness/contract risks that must not be hidden inside a file-size cleanup task.

## CHESS-CORR-001 — rated finalization atomicity

Current `ChessLiveService.applyGameCommand()` saves the finished game, durable events and command receipt first. When the transition is `active → finished` and the game is rated, it then calls `applyRatingUpdate()` as a separate repository operation. The result of `saveRatingUpdate()` does not change the already successful command result.

Failure window:

1. terminal command saves finished game + command receipt;
2. process/DB failure occurs before or during rating update;
3. client retries the same command;
4. receipt makes the retry an idempotent replay;
5. replay returns the saved game and does not execute rating finalization again.

Result: canonical match may be finished while rating/ledger is missing.

The current browser E2E proves only the normal path: rated matchmaking, resignation and expected `+24/-24` ledger updates. It does not inject a failure between match persistence and rating persistence.

### Required R4 resolution

Before Chess cutover to shared Games Core:

- terminal match persistence must produce a durable, idempotently consumable finalization fact in the same atomic boundary as match completion (transactional outbox or equivalent);
- rating/stat finalizers must be retry-safe and rebuildable from canonical match outcome;
- replay of the original command must not be the only mechanism capable of repairing projections;
- a fault-injection test must fail after match completion but before projection update and then prove eventual recovery without a duplicate rating event.

If current Chess rated mode needs production-grade guarantees before R4, fix this as its own bounded correctness task; do not wait for or disguise it as cosmetic hygiene.

## CHESS-CORR-002 — client/server DTO duplication

`apps/web/src/chess/chess-live-api.ts` manually mirrors challenge/game/ticket/rating transport shapes. This works today but must not become the pattern for Games Core.

R4 must introduce/use a dedicated Games contract boundary (OpenAPI/generated/shared DTO as selected by the implementation stage). Do not append generic Games DTOs to the already oversized global `apps/web/src/api.ts`. Chess keeps a compatibility adapter until parity is proven.

## CHESS-CORR-003 — matchmaking retry payload lifecycle

`chess-live-api.ts` caches serialized matchmaking bodies in a module-level `Map` keyed by command ID. The intent is valid: repeated polling with one idempotency key must reuse the exact original body/fingerprint instead of recalculating a changing expiry payload.

The cache currently has no explicit terminal eviction. R4 must preserve exact-body retry semantics while either:

- removing cached entries when the ticket reaches a terminal state/game starts; or
- moving the immutable retry payload into an explicit session-owned object.

Do not “simplify” this by recomputing the body for the same command ID; that can correctly trigger an idempotency conflict on the server.

## R4 risk gate

R4B cutover is blocked while `CHESS-CORR-001` is unresolved. `CHESS-CORR-002/003` must have an explicit compatibility decision and tests in the R4 delivery brief. This risk register is supporting evidence; Games Match/Rating contracts remain the normative authority.