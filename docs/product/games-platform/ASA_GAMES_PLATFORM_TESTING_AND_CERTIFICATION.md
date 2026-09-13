# ASA Games Platform — Testing and Certification Strategy

**Status:** Draft quality contract  
**Purpose:** определить доказательства, необходимые до подключения игры или сетевого capability к production.

## 1. Why certification is separate from game tests

Обычные unit tests отвечают: «правильно ли игра считает свои правила?»

Games Platform certification отвечает на другой вопрос:

> может ли эта игра безопасно и корректно жить внутри общей сетевой платформы без bespoke infrastructure?

Поэтому сертификация обязательна даже если rules engine уже имеет 100% собственных тестов.

## 2. Test pyramid

```text
Game domain tests
        ↓
Game SDK contract tests
        ↓
Match Core integration tests
        ↓
Persistence / RLS tests
        ↓
Gateway / protocol tests
        ↓
Browser multi-client journeys
        ↓
Fault injection / reconnect
        ↓
Load / soak / capacity
```

Realtime-room games additionally require runtime simulation/performance certification.

## 3. Universal manifest certification

Every registered game must prove:

- unique valid `gameKey`;
- semantic versions valid;
- runtime kind known;
- topology compatible with min/max players;
- rated capability has rating policy;
- reconnect/lateJoin/recovery combinations allowed;
- event lifecycle dates/config valid;
- runtime resource limits bounded;
- unsupported capability cannot be invoked through API/UI.

## 4. Command game adapter certification

Required fixtures:

### Determinism / authoritative transition

For same state + participant + command, adapter produces valid expected transition unless explicitly documented randomness is injected by server-owned deterministic/random port.

### Seat/turn authorization

Player cannot command another seat or move when game rules forbid it.

### Illegal command

Returns stable domain rejection; canonical state/version unchanged.

### Finished match

No further gameplay commands accepted.

### Public state

Each participant/spectator sees only permitted fields.

### Outcome

Native game result converts to generic participant outcomes correctly.

## 5. Idempotency tests

For every externally retriable mutation:

1. send command A with commandId X;
2. simulate timeout after server commit;
3. resend same command A/X;
4. assert replayed receipt and exactly one domain effect;
5. send different command B with X;
6. assert idempotency conflict.

Applies to:

- game commands;
- invite creation/accept;
- matchmaking join/cancel;
- party actions;
- match control actions;
- rating/outbox consumers where appropriate.

## 6. Optimistic concurrency tests

Two clients load version 10.

Both issue valid but incompatible command with `expectedVersion=10`.

Expected:

- exactly one commits version 11;
- loser gets conflict/resync response;
- no duplicated sequence/event;
- client can recover with authoritative snapshot.

## 7. Persistence and RLS certification

Under actual restricted runtime DB role:

- own authorized rows readable/writable;
- cross-tenant unauthorized read rejected/empty;
- cross-tenant write rejected;
- composite parent/child tenant mismatch impossible;
- append-only event/rating tables reject update/delete;
- command receipt uniqueness enforced;
- match/participant/event transaction rollback leaves no partial state;
- outbox insert is atomic with aggregate change.

Global/cross-tenant Games storage, when introduced, requires a dedicated authorization suite rather than disabling RLS casually.

## 8. Public identity leak suite

Fixtures deliberately include sensitive-looking values:

```text
account id
principal id
learner identity id
email
school id
classroom id
real name
```

Public DTO/snapshot/profile/leaderboard/spectator responses are snapshot-tested to ensure only approved `PublicGameIdentity` fields survive.

Alias lookup failure MUST return safe generic label or policy-defined alias, never raw internal ID.

## 9. Invite certification

Test:

- directed invite;
- public code/link invite;
- expired invite;
- cancelled invite;
- declined invite;
- simultaneous accepts;
- accept retry;
- unsupported game/mode;
- blocked relation;
- classroom scope policy;
- wrong user redemption;
- match created once.

## 10. Matchmaker certification

### Compatibility

Never pair incompatible:

- game/version;
- mode;
- player count/topology;
- rating pool;
- scope policy;
- party size;
- blocked relation;
- runtime compatibility.

### Fairness/window

Given deterministic tickets/time, widening policy produces expected candidate window.

### Concurrency

Same ticket/player cannot be paired into two matches under parallel matcher runs.

### Cancellation race

Cancel and pair race results in one valid terminal state.

### Queue expiry

Expired tickets never create new match.

## 11. Rating certification

For each rating policy:

- deterministic fixture vectors;
- win/loss/draw or placement/team fixtures;
- provisional behavior;
- bounds/uncertainty behavior;
- retry idempotency;
- unique match/player/pool application;
- no rating for bot/local/unrated modes;
- aborted/void match behavior;
- historical policy version remains interpretable.

Do not approve a new rating algorithm using only UI examples.

## 12. Statistics projection certification

Test process:

1. create authoritative match history fixtures;
2. build projection;
3. record result;
4. delete/rebuild projection cache;
5. compare exact totals;
6. replay duplicate outbox events;
7. assert totals unchanged.

Include:

- WDL;
- streaks;
- seat split;
- head-to-head;
- FFA placement;
- team outcomes;
- bot results;
- custom metric aggregation.

## 13. Gateway protocol certification

### Authentication/authorization

- unauthenticated handshake rejected;
- expired token/session rejected;
- unauthorized resource subscription rejected;
- player topic bound to authenticated player;
- spectator permissions separate from participant permissions.

### Message validation

- malformed JSON/binary frame;
- unknown message type;
- oversized payload;
- invalid resource id;
- rate flood;
- replayed nonce/sequence where applicable.

### Backpressure

Synthetic slow client:

- outbound queue never grows unbounded;
- replaceable messages coalesce/drop by policy;
- critical durable stream causes resync/disconnect rather than silent loss;
- gateway process remains healthy.

### Restart

After gateway restart:

- durable match truth unchanged;
- client reconnect/resubscribe restores current sequence;
- missed invite/match notification can be obtained from durable API/state.

## 14. Command-game browser certification

Run at least two real browser contexts/accounts against isolated test DB.

Journey:

```text
login A / login B
A creates invite or both queue
match created
both open same match
A command
B sees authoritative update without reload
B command
simulate A disconnect
B continues/policy applied
A reconnects
finish match
both see same result
history/stat projection converges
```

Assertions include sequence/version and public identity privacy.

## 15. Realtime room certification

### Authority test

Malicious client attempts:

```text
set x/y directly
set health
set score
claim hit
skip cooldown
replay old input sequence
send impossible input rate
```

None can directly mutate authoritative state outside game rules.

### Tick test

Measure:

```text
average tick
p95 tick
p99 tick
overrun %
CPU/memory per room
```

Certified player count is the highest configuration meeting explicit threshold with safety margin.

### Network impairment

Simulate:

- 50/100/200 ms latency;
- jitter;
- packet/message delay;
- reconnect;
- short disconnect;
- slow consumer;
- browser background/resume.

With WebSocket reliable transport, test application coalescing/backlog behavior. If WebTransport is later used, add datagram loss/reordering scenarios.

### Client smoothing

Verify visible behavior for:

- local prediction;
- server reconciliation;
- remote interpolation;
- large correction;
- resync.

Numerical server state remains authoritative even if rendering is smoothed.

## 16. Room lifecycle certification

Test:

```text
allocate
ready
players connect
start
active
finish
close
```

Failure paths:

```text
allocation timeout
runtime unhealthy
room never ready
player no-show
runtime crash
room lease loss
control-plane callback retry
shutdown/drain during deployment
```

Final Match status must be deterministic (`finished`, `aborted`, etc.).

## 17. Runtime token isolation tests

A token for:

```text
match A / player X / seat light
```

must fail for:

```text
match B
another player
another seat if seat-bound
after expiry
wrong runtime protocol/audience
```

Runtime never receives account password/session cookie.

## 18. Fault injection matrix

| Failure | Expected behavior |
|---|---|
| API restarts after command commit before response | retry returns idempotent receipt |
| Gateway down | command game remains correct; push delayed |
| Outbox consumer down | backlog grows; catches up later |
| Rating projector down | match finished; rating eventually converges |
| Statistics projector down | history truth preserved; projection rebuilds |
| PostgreSQL unavailable | durable command not acknowledged as success |
| Realtime room dies | recover/checkpoint or authoritative abort policy |
| Client disconnects | grace/reconnect/forfeit policy, not instant fabricated loss |
| Allocator unavailable | no room claimed ready; ticket/match reports recoverable failure |

## 19. Load profiles

### Command L1

Align with ASA L1 target and add game bursts:

- 500 concurrent connected users;
- representative number of simultaneous matches;
- move/command bursts around classroom event start;
- reconnect storm;
- invitation/queue fanout.

### Gateway

At minimum test 2x expected initial concurrency before production enablement.

### Room runtime

Test per-room and aggregate:

```text
1 room certified load
N rooms per process
CPU saturation
memory ceiling
GC/event-loop lag where applicable
```

Scale assumptions must be measurements, not estimates copied from another framework.

## 20. Soak test

For any realtime service entering production:

- multi-hour connection/room lifecycle;
- repeated create/close;
- memory trend;
- orphan subscriptions/rooms;
- DB pool behavior;
- reconnect churn;
- log volume;
- graceful rolling restart.

## 21. Certification games

### Tic-Tac-Toe

Required proof:

- no bespoke network repository/controller;
- uses generic Match Core;
- invite + quick match;
- idempotent commands;
- realtime delivery;
- reconnect;
- history/stats/rematch.

### ASA Arena Mini

Required proof:

- party or multiplayer queue;
- Matchmaker -> Allocator -> Room;
- 4–8 clients;
- authoritative movement/score;
- fixed tick;
- snapshot/update transport;
- reconnect;
- runtime crash policy;
- outcome persistence;
- event leaderboard/history/stats;
- production-like resource/health metrics.

## 22. Migration certification — Chess

Before switching writes:

- shadow-map representative live games to generic model;
- compare result/players/moves/version/events;
- compare rating ledger events;
- run old and compatibility API contract suites;
- prove existing history counts;
- verify active legacy games are not orphaned during cutover;
- rollback new-game admission without data loss.

## 23. Migration certification — Checkers

Before online enablement:

- Russian-64 rules remain authoritative unchanged;
- Match adapter parity with existing engine;
- bot/local behavior not accidentally rated;
- classroom scope policy preserved;
- quick/rated/invite all use generic Games services;
- no second checkers-specific matchmaking/rating persistence exists.

## 24. Release gates

A Games capability is production-ready only when:

```text
contract tests PASS
security/privacy negative tests PASS
migration tests PASS (if schema)
real multi-client browser E2E PASS
fault/reconnect scenarios PASS
load target PASS
observability dashboard/alerts ready
rollback/admission kill switch proven
documentation matches implementation
```

A green unit suite alone is insufficient for networking/realtime release.

## 25. Evidence policy

Each milestone records:

- exact commit SHA;
- exact game/protocol/schema versions;
- test commands/workflows;
- isolated database/runtime identity;
- pass/fail/blocked honestly;
- benchmark hardware/environment;
- artifacts/screenshots only where they prove behavior;
- known limitations.

Never report a browser/load test as PASS if it was only discovered/listed or skipped due missing environment.
