# GP-R0-007 — Command Idempotency and Concurrency

**Status:** accepted architecture decision  
**Issue:** #241  
**Observed main:** `c880a376989f65b7d418db881eed183452b30160`  
**Runtime/schema changes:** none

## Decision

Every externally initiated Games mutation is a **command**. Each valid command has a stable idempotency identity, and mutations of existing versioned resources use optimistic concurrency.

HTTP mutations use `Idempotency-Key`; non-HTTP transports carry the same value as `commandId`. Reads do not require an idempotency key. The client may request intent, but never supplies authoritative result, winner, rating, lifecycle state, sequence, participant identity or server time.

For R1–R4 command ids use the existing safe API format: `1..128` characters from `A-Z a-z 0-9 . _ : -`.

## Command identity

A durable receipt is logically keyed by `(actorKey, commandId)` and binds:

```ts
interface GameCommandReceiptV1 {
  actorKey: string;
  commandId: string;
  commandKind: string;
  fingerprint: string;
  resourceType: string;
  resourceId: string | null;
  outcomeKind: 'applied' | 'rejected';
  resultRef: string | null;
  createdAt: string;
}
```

`actorKey` is resolved from authenticated server context and is never trusted from JSON. `resultRef`, when present, identifies the immutable applied result/version or terminal rejection evidence required to replay the same logical outcome.

The fingerprint is computed from a canonical representation of:

- command kind;
- target resource/admission reference;
- `expectedVersion` when required;
- normalized semantic payload.

It excludes request tracing, presentation-only fields and server-generated timestamps.

For the same authenticated actor and `commandId`:

- same kind + same fingerprint → replay the same logical outcome with `replayed=true`, with no second domain effect;
- different kind or fingerprint → `IDEMPOTENCY_CONFLICT`;
- changing `expectedVersion` changes the fingerprint, so the old command id cannot be reused.

Authentication and current read entitlement are still checked before exposing replayed result data. A receipt never bypasses suspension, privacy or resource-read authorization.

Server-owned jobs/finalizers use an equivalent deterministic operation identity derived from their authoritative source event/match; they do not impersonate a user command.

## When a command id is consumed

Malformed JSON, invalid key format and unauthenticated requests fail before the command pipeline and do not reserve a command id.

After authentication + structural validation admits a request to authoritative command processing, its `(actorKey, commandId)` identity is immutable. Applied commands and deterministic domain rejections may be durably receipted so restart cannot change retry semantics.

For an applied command, a receipt MUST NOT be committed separately from the domain effect it claims to represent. A rejected receipt is valid only when it records a deterministic rejection and no domain mutation occurred.

## Atomicity invariant

For a successful durable command, one transaction/durable boundary contains:

```text
authoritative state mutation
+ lifecycle/game event(s)
+ command receipt
+ required transactional outbox record(s)
```

If that boundary does not commit, the command is not applied.

This consumes GP-R0-004: terminal outcome/finalization and the required outbox are durable or retryable before `finished` is trusted. Rating/stats/leaderboard consumers are downstream and independently idempotent, normally by source event/result identity.

A lost response after commit is recovered by retrying the exact same command id and payload.

## `expectedVersion`

Every mutation of an existing versioned Match/admission/game-command resource requires a positive integer `expectedVersion`, except creation-only operations with no prior resource version.

Rules:

1. compare against authoritative current version;
2. mismatch performs no mutation and returns `VERSION_CONFLICT`;
3. authorized conflict response may include `currentVersion`;
4. client reconciles/reconnects, computes new intent, then sends a **new commandId**;
5. generic Match `lifecycleVersion` and game-owned state version/sequence remain distinct.

A stale version is never silently upgraded server-side. Two concurrent commands targeting the same prior version cannot both succeed; persistence must make compare-and-write atomic.

## Retry contract

- network timeout, lost response or transient 5xx → retry exact command with same `commandId`;
- `RATE_LIMITED` before application → retry same command after backoff;
- `VERSION_CONFLICT` → reconcile, then new command id;
- `IDEMPOTENCY_CONFLICT` → client/programming error; never modify the body under the same id;
- validation/forbidden/not-found → no blind retry;
- successful replay returns normal success with `replayed=true`.

A client MUST NOT generate a new command id only because a response was lost.

## Checkers compatibility

Current Checkers already checks `expectedVersion`, but errors are free-form and there is no durable command receipt.

R1 adds idempotency/error translation at the Games adapter/service/persistence boundary:

- Russian-64 legality remains authoritative;
- move command receives `commandId + expectedVersion`;
- version mismatch → `VERSION_CONFLICT`;
- illegal move → `GAME_COMMAND_REJECTED`;
- finished match → `MATCH_FINISHED`;
- Checkers rules/document engine does not learn HTTP/idempotency concepts;
- platform timestamps are server-owned; current client `occurredAt` cannot become authoritative Games time.

## Chess compatibility

Chess Live is the donor pattern:

- receipt already stores command id, actor, kind and fingerprint;
- same id with changed fingerprint already conflicts;
- game mutations already use `expectedVersion`;
- HTTP API already requires a safe `Idempotency-Key`.

R4 keeps these semantics while translating to canonical Games error codes/envelope.

The known Chess rated-finalization gap remains blocked from R4 cutover: committed terminal result + required outbox must not lose the rating/stat trigger.

## Negative cases

1. Lost response retried under a new id can duplicate effect and is invalid client behavior.
2. Reusing a successful id with new `expectedVersion` is `IDEMPOTENCY_CONFLICT`.
3. Same-version concurrent commands cannot both mutate state.
4. Receipt without matching applied domain mutation/outbox is invalid.
5. A finished match rejects mutation even with a fresh version.
6. Public errors must not reveal whether an unauthorized private match id exists.
7. Client result/status/winner/rating/timestamp fields cannot become authority.
8. Duplicate finalization or outbox delivery cannot produce a second rating/stat effect.

## Deferred

- physical receipt/outbox SQL and indexes → R1;
- exact R1 endpoint DTO/OpenAPI → R1 Delivery Brief;
- distributed/global rate-limit backend → only when deployment topology requires it;
- realtime packet/tick budgets → R6;
- Creator upload/build quotas → R7+.
