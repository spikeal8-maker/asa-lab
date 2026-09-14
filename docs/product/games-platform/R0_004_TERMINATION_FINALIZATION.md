# GP-R0-004 — Termination and Finalization Contract

**Parent decision:** `R0_004_MATCH_STATE_MACHINE.md`  
**Issue:** #230  
**Runtime/schema changes:** none

This contract defines terminal reasons and the durable finalization invariant. It does not add lifecycle states.

## Terminal reason families

Reason is separate from Match status.

### Official result reasons

Valid with `finishing` / `finished`:

- `rules_outcome` — normal game/rules result, including game-defined draw;
- `resignation`;
- `draw_agreement`;
- `timeout`;
- `forfeit`;
- `disconnect_forfeit` — only when explicit policy turns prolonged disconnect into an official result;
- `no_show_forfeit` — only when competition policy awards a result without play.

Game-specific details belong to game-owned outcome metadata. They cannot create new generic lifecycle states.

### Pre-start cancellation reasons

Valid only with `cancelled`:

- `participant_cancelled`;
- `participant_declined`;
- `admission_expired`;
- `matchmaking_cancelled`;
- `no_show_cancelled`;
- `policy_rejected`;
- `admin_cancelled`.

Cancellation creates no win/loss/draw result.

### Abort reasons

Valid only with `aborted`:

- `runtime_lost`;
- `unrecoverable_state`;
- `integrity_failure`;
- `security_abort`;
- `version_incompatible`;
- `admin_abort`.

A recoverable room crash is not automatically `runtime_lost`; the Match remains `active` while recovery policy still permits recovery.

## Finalization invariant

The platform must never allow a durable official game result while required core finalization is neither durable nor retryable.

Required order:

1. authoritative game/runtime decides the terminal outcome;
2. `active` or eligible `ready` Match enters `finishing` with immutable outcome reference + terminal reason;
3. the same durable boundary records/enqueues the platform finalization/outbox event;
4. retries are idempotent;
5. `finishing -> finished` occurs only after that core durability boundary exists;
6. rating/stats/leaderboard consumers may process asynchronously and retry independently.

A failed derived consumer never rolls the Match back to `active`, erases the result, or invents a second result.

For command games, `active -> finishing -> finished` may occur within one transaction if the outcome and outbox are committed atomically. For realtime games, `finishing` may persist while a fenced authoritative room result is accepted and platform finalization completes.

## Disconnect/reconnect

Connectivity is participant/runtime state, not termination by itself.

- short disconnect: Match stays `active`;
- reconnect succeeds: Match stays `active`;
- disconnect grace expires and policy awards loss: `active -> finishing` with `disconnect_forfeit`;
- room is irrecoverably lost and policy forbids synthetic result: `active -> aborted` with `runtime_lost`.

## Compatibility implications

### Checkers

- `CheckersDocument.result` supplies the authoritative game result;
- service/classroom presentation must map source evidence to `finished`, `cancelled` or `aborted` rather than using one ambiguous `abandoned` bucket;
- existing bot/local/classroom saves are not rewritten during R0.

### Chess

- checkmate/stalemate/rules result -> `rules_outcome`;
- resignation -> `resignation`;
- accepted draw -> `draw_agreement`;
- clock expiration -> `timeout`;
- `drawOffer` remains Chess-owned state;
- current rated-finalization consistency risk must be repaired before R4 cutover so official result + outbox are durable before rating projection is relied on.

## Correction after terminal state

`finished`, `cancelled` and `aborted` are not reopened. Later moderation, anti-cheat or rating correction is represented by additive audit/correction records and, where applicable, compensating rating events. Historical lifecycle remains immutable.
