# GP-R0-004 — Match State Machine

**Status:** accepted architecture decision  
**Issue:** #230  
**Termination contract:** `R0_004_TERMINATION_FINALIZATION.md`  
**Runtime/schema changes:** none

## Decision

Every canonical `GameMatch` uses one server-owned lifecycle:

```text
waiting -> ready -> active -> finishing -> finished
   |         |        |          |
   +-------> cancelled |          +-------> aborted*
             |          +---------------> aborted
             +--------------------------> aborted
```

`cancelled`, `aborted` and `finished` are terminal.

`* finishing -> aborted` is exceptional and allowed only for an audited integrity/admin invalidation before finalization. Ordinary downstream failure must retry; it must not invalidate a valid result.

There is deliberately no generic `allocating`, `connected`, `disconnected`, `reconnecting`, `paused` or `draw_offered` status. Those belong to runtime/presence/game-owned state.

## Status semantics

- **waiting** — Match exists and immutable game/version/admission metadata is pinned, but start preconditions are not complete.
- **ready** — participants, configuration and required runtime binding are valid enough to start authoritative play.
- **active** — official authoritative play has started.
- **finishing** — authoritative terminal outcome is durable; platform core finalization is still completing/retrying.
- **finished** — canonical result and core finalization/outbox boundary are durable. Derived projections may still process asynchronously.
- **cancelled** — play never started and no official result exists.
- **aborted** — no trustworthy official result can be retained/produced because of integrity, security, admin or unrecoverable runtime failure.

Command games may traverse `ready` and `finishing` within one transaction. Realtime games may remain in those states while start/result handoff is completed.

## Allowed transitions

| From | To | Authority | Typical trigger |
| --- | --- | --- | --- |
| create | `waiting` | Games platform | accepted admission creates Match |
| `waiting` | `ready` | Games platform | start preconditions satisfied |
| `waiting` | `cancelled` | admission/platform | decline, expiry, pre-start cancel |
| `waiting` | `aborted` | integrity/admin | invalid setup/security failure |
| `ready` | `active` | game/runtime authority | authoritative start |
| `ready` | `finishing` | platform/game authority | official pre-play forfeit/no-show |
| `ready` | `cancelled` | admission/platform | valid pre-start cancellation |
| `ready` | `aborted` | integrity/admin | unrecoverable start failure |
| `active` | `finishing` | game/runtime authority | rules result, resign, timeout, forfeit, draw |
| `active` | `aborted` | integrity/admin | unrecoverable/integrity failure |
| `finishing` | `finished` | Games finalizer | durable core finalization boundary |
| `finishing` | `aborted` | integrity/admin only | result invalidated before finalization |

All other transitions are invalid in V1.

Terminal states never reopen. Later moderation/rating corrections are additive audit/correction events.

## Transition authority

A participant never writes canonical lifecycle fields directly.

```text
player intent
(move / resign / accept draw / cancel request)
          ↓
authorized command or game/runtime authority
          ↓
validated Match transition
```

Authorities are narrow:

- **Games platform/admission authority** — create, readiness, valid pre-start cancellation;
- **game authority** — command adapter/service for command games;
- **room authority** — currently authoritative fenced room generation for realtime games;
- **Games finalizer** — `finishing -> finished`;
- **platform integrity/admin** — audited exceptional abort/invalidation only.

Browser-supplied `status`, winner or terminal reason is never authoritative.

Every accepted lifecycle transition increments `lifecycleVersion`. Stale/concurrent transition attempts fail rather than overwrite newer state. Exact error/idempotency representation is GP-R0-007.

## Presence and runtime separation

Connectivity and room allocation are separate state machines.

Examples:

- player loses network briefly: Match remains `active`;
- reconnect succeeds: Match remains `active`;
- room allocation is still searching: Match remains `waiting`;
- recoverable room crash/reallocation succeeds: Match may remain `active`;
- policy converts prolonged disconnect to official loss: `active -> finishing`;
- unrecoverable room loss with no valid result: `active -> aborted`.

This keeps command games independent from WebSocket/room mechanics.

## Termination and finalization

Canonical reason families and the durable finalization invariant are normative in `R0_004_TERMINATION_FINALIZATION.md`.

Key rule: an official game result cannot be considered safely finalized unless the core finalization/outbox boundary is durable and retryable. Rating/stats failures must not erase the result or reopen the Match.

## Checkers compatibility

Current Checkers maps without changing Russian-64 rules or existing saves:

- newly created bot/local/service games may traverse `waiting -> ready -> active` immediately;
- `document.result !== '*'` drives authoritative `active -> finishing -> finished`;
- classroom `pending` -> `waiting`;
- classroom `declined` -> `cancelled`;
- classroom `active` -> `active`;
- classroom `finished` -> `finished` after canonical finalization.

The presentation label `abandoned` does not become a canonical state; source evidence determines `cancelled` vs `aborted`.

## Chess compatibility

Chess challenge lifecycle remains admission-owned rather than duplicated as Match lifecycle.

A current Chess Live game starts as `active`; R4 can represent creation as transactional `waiting -> ready -> active`. Rules outcome, resignation, timeout and accepted draw move through `finishing`. `drawOffer`, clocks, FEN and reconnect remain Chess/runtime state.

Existing Chess tables remain unchanged during R0. Before R4 cutover, rated finalization must satisfy the shared durable finalization invariant.

## Negative cases

1. Client submits `{status:'finished'}` — rejected/ignored; authority owns lifecycle.
2. Player disconnects — Match remains `active` unless policy later produces official forfeit/abort.
3. Rating service fails after a win — canonical result survives and projection retries.
4. Duplicate resign reaches a finished Match — no reopen and no second result.
5. Allocator is finding a room — allocation state stays outside Match lifecycle.
6. Chess draw is offered — Match remains `active`.
7. Tournament no-show — server policy chooses pre-start cancellation or official `ready -> finishing` forfeit; client does not guess.

## Deferred deliberately

- exact terminal reason list/finalization details -> `R0_004_TERMINATION_FINALIZATION.md`;
- team/placement outcome shape -> GP-R0-005;
- admission/capability eligibility -> GP-R0-006;
- error codes/idempotency payloads -> GP-R0-007;
- room lease/fencing implementation -> realtime delivery stage;
- physical SQL/triggers/outbox -> R1 after R0 closes.
