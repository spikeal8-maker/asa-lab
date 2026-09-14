# GP-R0-004 — Review Receipt

**Issue:** #230  
**Decision:** `R0_004_MATCH_STATE_MACHINE.md`  
**Change class:** L3_CRITICAL architecture/state machine  
**Runtime/schema changes:** none

## POST_STEP_REVIEW

- **STEP:** define one server-owned lifecycle for command and realtime Matches.
- **USER_RESULT:** later Checkers/Chess/Arena implementations can share lifecycle semantics without treating transport/game-specific states as Match states.
- **INVARIANTS:** GP-R0-001 stable player identity; GP-R0-002 platform security domain; GP-R0-003 canonical Match envelope.
- **EVIDENCE:** current Checkers `active|finished`, classroom `pending|active|declined|finished`, Chess Live `active|finished` plus game-owned draw/termination fields.
- **NEGATIVE CHECKS:** client cannot set status/winner; disconnect is not status; draw offer is not status; allocation is not status; terminal state cannot reopen; downstream rating failure cannot erase result.
- **UNVERIFIED:** physical SQL/outbox, exact team outcome schema and error payloads are intentionally deferred.
- **VERDICT:** PASS.

## CHALLENGE_REVIEW

### Why keep `ready`?

It separates an admitted Match from an authoritative start. Command games may traverse it transactionally, while realtime games need a stable pre-start boundary after room/config validation. Removing it would force room/runtime concepts into `waiting` or `active`.

### Why keep `finishing`?

Current Chess demonstrates the failure mode: durable game completion and rating update can be separate effects. `finishing` gives the platform an explicit boundary where the authoritative result is already durable but required core finalization/outbox work is still retryable. Derived rating/stats projections may lag after `finished`; the canonical result remains immutable.

### Why no `reconnecting`, `paused` or `allocating`?

They are transport/runtime/game concerns. A command game has no room allocation; a chess draw offer is game state; a short disconnect should not mutate canonical lifecycle. Keeping them out preserves the generic boundary.

### Cancellation vs abort

`cancelled` means authoritative play never started and there is no official result. `aborted` means the platform cannot safely retain/produce an official result because of integrity/security/unrecoverable runtime failure. Active games therefore never become `cancelled`.

### Pre-play forfeit

`ready -> finishing` is intentionally allowed for policy-authoritative no-show/forfeit results. This prevents inventing fake gameplay just to award an official tournament result.

### Terminal immutability

`finished/cancelled/aborted` do not reopen. Later moderation or rating corrections are additive records. This preserves replay/history/audit integrity and prevents stale retries from rewriting outcomes.

## Compatibility verdict

- **Checkers:** service `active/finished` and classroom `pending/declined/active/finished` map without changing Russian-64 rules or existing saves.
- **Chess:** challenge remains admission lifecycle; game completion, resignation, timeout and draw agreement map through `finishing`; draw offer/reconnect stay Chess/runtime state. R4 must repair rated finalization before cutover.
- **Realtime:** room allocation/presence stay external; recoverable room loss can keep Match active, unrecoverable loss aborts only under explicit policy.

**Final verdict: PASS.**
