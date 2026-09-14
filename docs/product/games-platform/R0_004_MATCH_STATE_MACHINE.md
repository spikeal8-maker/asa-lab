# GP-R0-004 — Match State Machine and Termination

**Status:** accepted architecture decision  
**Issue:** #230  
**Runtime/schema changes:** none

## Decision

ASA Games uses one server-owned lifecycle for every canonical `GameMatch`:

```text
waiting -> ready -> active -> finishing -> finished
   |         |        |          |
   +-------> cancelled |          +-------> aborted*
             |          +---------------> aborted
             +--------------------------> aborted
```

`cancelled`, `aborted` and `finished` are terminal.

`* finishing -> aborted` is allowed only for an explicit integrity/admin invalidation before the result is finalized. Ordinary downstream failure must retry finalization and must not turn a valid result into an abort.

There is deliberately no generic `allocating`, `connected`, `disconnected`, `paused`, `draw_offered` or `reconnecting` status. Those belong to room allocation, participant presence, or game-owned state.

## Status semantics

### `waiting`

A Match exists and its immutable game/version/admission metadata is pinned, but start preconditions are not yet satisfied. Typical examples: invite accepted but opponent/session not fully ready, matchmaking pairing created while runtime/config checks complete.

### `ready`

Participants, immutable configuration and required runtime binding are valid enough to start authoritative play. A command game may pass through `ready` in the same request that creates/starts it; realtime games may remain `ready` until the authoritative room begins.

### `active`

Official authoritative play has started. Player commands/inputs may change game-owned state. Disconnect/reconnect does not leave this status by itself.

### `finishing`

An authoritative terminal outcome has been decided and made durable, but platform finalization is not yet complete. The canonical outcome/reason cannot be replaced by a client retry. Required outbox/finalization work must be retryable.

For command games this state may be transient inside one transaction. For realtime games it can cover the accepted fenced room result before platform finalization.

### `finished`

The canonical terminal outcome is accepted and the platform has durably recorded the core finalization/outbox boundary. Rating, stats and leaderboard projections may still process asynchronously; their temporary failure does not reopen the Match or erase the result.

### `cancelled`

The Match ended before authoritative play started and no official game result exists. Cancellation is not a loss/win/draw.

### `aborted`

The Match cannot safely produce or retain an official result because of an integrity, security, administrative or unrecoverable runtime failure. An abort is not silently converted to a normal loss/win/draw.

## Allowed transitions

| From | To | Authority | Typical trigger |
| --- | --- | --- | --- |
| create | `waiting` | Games platform | accepted admission creates Match |
| `waiting` | `ready` | Games platform | start preconditions satisfied |
| `waiting` | `cancelled` | admission/platform authority | decline, expiry, pre-start cancel |
| `waiting` | `aborted` | platform integrity/admin | invalid setup/security failure |
| `ready` | `active` | game/runtime authority | authoritative start |
| `ready` | `finishing` | platform/game authority | official pre-play forfeit/no-show result |
| `ready` | `cancelled` | admission/platform authority | valid pre-start cancellation |
| `ready` | `aborted` | platform integrity/admin | unrecoverable start/runtime failure |
| `active` | `finishing` | game/runtime authority | rules outcome, resign, timeout, forfeit, agreed draw |
| `active` | `aborted` | platform integrity/admin | unrecoverable/integrity failure |
| `finishing` | `finished` | Games finalizer | canonical outcome + durable finalization boundary |
| `finishing` | `aborted` | audited integrity/admin only | outcome invalidated before finalization |

All other transitions are invalid in V1.

Terminal states are immutable. A later moderation/rating correction is an additive correction/audit event; it does not rewrite `finished -> active` or `finished -> aborted`.

## Transition authority

A participant never writes canonical `status` directly.

Participant actions are intentions:

```text
resign / accept draw / make move / ready / cancel request
                 ↓
authorized command handler / game authority
                 ↓
validated lifecycle transition
```

Authorities are intentionally narrow:

- **Games platform/admission authority** — creates Match, validates readiness and pre-start cancellation;
- **game authority** — command adapter/service for command games;
- **room authority** — the currently authoritative fenced room generation for realtime games;
- **Games finalizer** — moves `finishing -> finished` after durable core finalization;
- **platform integrity/admin** — audited exceptional abort/invalidation only.

A browser-supplied `status`, terminal reason or winner is never authoritative.

Every accepted transition increments `lifecycleVersion`. Stale/concurrent transition attempts fail rather than silently overwrite a newer state. Exact error/idempotency representation is GP-R0-007.

## Termination reasons

Reason is separate from lifecycle status.

### Normal official finish

Valid with `finishing/finished`:

- `rules_outcome` — checkmate, no legal move, board/rules victory, normal draw, score/objective result;
- `resignation`;
- `draw_agreement`;
- `timeout`;
- `forfeit`;
- `disconnect_forfeit` — only when a game/policy explicitly converts prolonged disconnect into an official forfeit;
- `no_show_forfeit` — only when competition policy awards an official result without play.

Game-specific details may exist in game-owned outcome metadata, but cannot invent new generic lifecycle transitions.

### Cancellation before play

Valid only with `cancelled`:

- `participant_cancelled`;
- `participant_declined`;
- `admission_expired`;
- `matchmaking_cancelled`;
- `no_show_cancelled`;
- `policy_rejected`;
- `admin_cancelled`.

### Abort / invalid official result

Valid only with `aborted`:

- `runtime_lost`;
- `unrecoverable_state`;
- `integrity_failure`;
- `security_abort`;
- `version_incompatible`;
- `admin_abort`.

A recoverable room crash does **not** immediately mean `runtime_lost`; the Match remains `active` while recovery/reallocation policy still permits recovery.

## Reconnect and presence

Connectivity is participant/runtime state, not Match lifecycle.

Examples:

- player loses network for 10 seconds: Match remains `active`;
- command game client reconnects and obtains snapshot/events: Match remains `active`;
- room instance restarts and recovery succeeds: Match remains `active`;
- disconnect timer expires and policy awards loss: game authority records `active -> finishing` with `disconnect_forfeit`;
- rated realtime room is irrecoverably lost and policy forbids a synthetic result: `active -> aborted` with `runtime_lost`.

This avoids coupling lifecycle to WebSocket implementation details.

## Finalization invariant

The system must never repeat the current Chess risk where a game can be durably finished while a required rating/finalization effect is neither durable nor retryable.

The target invariant is:

1. authoritative game/runtime decides terminal outcome;
2. `active/ready -> finishing` persists canonical outcome + reason;
3. the same durable boundary records/enqueues the platform finalization event/outbox;
4. retries are idempotent;
5. `finishing -> finished` happens only after that core durability boundary exists;
6. derived rating/stats consumers may retry independently.

A failed rating consumer does not roll the Match back to `active` and does not erase the result.

## Checkers compatibility

Current Checkers service `active|finished` maps directly after migration:

- newly created bot/local/service games may traverse `waiting -> ready -> active` immediately;
- `document.result !== '*'` causes authoritative `active -> finishing -> finished`;
- classroom `pending` maps to `waiting`;
- classroom `declined` maps to `cancelled/participant_declined`;
- classroom `active` maps to `active`;
- classroom `finished` maps to `finished` after canonical finalization.

Existing presentation label `abandoned` is not carried into the canonical model; source evidence decides `cancelled` vs `aborted`.

## Chess compatibility

Chess challenge lifecycle remains admission-owned and is not duplicated as Match lifecycle.

When a Chess game is created today it is immediately `active`; R4 may model this as transactional `waiting -> ready -> active` without changing chess rules. Checkmate/stalemate/rules outcomes, resignation, timeout and draw agreement transition through `finishing`.

`drawOffer` remains Chess-owned state. Reconnect remains snapshot/events, not a Match status.

Before Chess R4 cutover, the known rated-finalization consistency risk must be eliminated using the canonical finalization/outbox invariant above.

## Negative cases

1. Client sends `{status:'finished'}`: ignored/rejected; only authority may transition.
2. Player disconnects: Match stays `active` unless policy later produces forfeit/abort.
3. Rating service is down after a win: canonical result survives; finalization retries asynchronously.
4. Finished match receives duplicate resign command: no reopen/new result.
5. Room allocator is searching for a host: Match remains `waiting`; allocation state is external.
6. Draw is offered: Match remains `active`; Chess/game state owns the offer.
7. Tournament opponent never appears: policy chooses `cancelled/no_show_cancelled` or official `finishing/no_show_forfeit`; it is not guessed by the client.

## Deferred deliberately

- exact team/placement outcome shape -> GP-R0-005;
- admission/capability eligibility -> GP-R0-006;
- error codes, idempotency keys and conflict payloads -> GP-R0-007;
- room lease/fencing implementation -> realtime delivery stage;
- physical tables/triggers/outbox implementation -> R1 after R0 acceptance.
