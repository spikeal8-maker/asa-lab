# ASA Games Platform — Protocols, Runtime and Realtime Design

**Status:** Draft  
**Scope:** HTTP commands, realtime gateway, room runtime, allocation, reconnect, recovery, netcode, security and observability

## 1. Design goals

The network architecture must support:

- reliable turn-based 1v1 games on weak school networks;
- invitations and matchmaking without polling as the final UX;
- reconnect after browser sleep/network loss;
- spectators where allowed;
- server-authoritative realtime room games;
- future horizontal scale without making Redis/Kubernetes mandatory now;
- browser-first clients;
- event/temporary games that can be deployed and disabled independently;
- compatibility with existing ASA auth/tenant/security patterns.

## 2. Control Plane HTTP API

HTTP remains the authoritative command path for durable command games and control-plane mutations.

Target namespace:

```text
/api/games
```

### 2.1 Discovery

```text
GET /api/games
GET /api/games/:gameKey
```

Returns public game manifest/capabilities, not implementation internals.

### 2.2 Invites

```text
POST /api/games/invites
GET  /api/games/invites
POST /api/games/invites/:id/accept
POST /api/games/invites/:id/decline
POST /api/games/invites/:id/cancel
```

Every mutating request uses an idempotency key.

### 2.3 Party

```text
POST /api/games/parties
POST /api/games/parties/:id/invites
POST /api/games/parties/:id/join
POST /api/games/parties/:id/leave
POST /api/games/parties/:id/close
```

### 2.4 Matchmaking

```text
POST /api/games/matchmaking
GET  /api/games/matchmaking/:ticketId
POST /api/games/matchmaking/:ticketId/cancel
```

`POST` returns ticket immediately. Match-found arrives via realtime notification and remains queryable over HTTP.

### 2.5 Matches

```text
GET  /api/games/matches/:matchId
GET  /api/games/matches/:matchId/reconnect?after=<sequence>
GET  /api/games/matches/:matchId/events?after=<sequence>
POST /api/games/matches/:matchId/commands
POST /api/games/matches/:matchId/resign
POST /api/games/matches/:matchId/draw-offer
...
```

Generic control actions are available only when manifest/mode capabilities permit them.

### 2.6 Stats/rating

```text
GET /api/games/me/profile
GET /api/games/me/stats?gameKey=...
GET /api/games/me/history
GET /api/games/players/:playerId
GET /api/games/ratings/:gameKey/:pool
GET /api/games/leaderboards/:gameKey/:pool
```

Public endpoints apply visibility policy and never expose internal identity keys.

## 3. Command request envelope

Generic command shape:

```json
{
  "commandId": "client-generated-safe-id",
  "expectedVersion": 17,
  "kind": "game-command",
  "payload": {}
}
```

Server flow:

```text
authenticate session
→ resolve GamePlayerProfile
→ authorize match + participant seat
→ validate envelope size/schema
→ idempotency replay check
→ load match + pinned game version
→ compare expectedVersion
→ invoke registered CommandGameAdapter
→ validate transition/outcome
→ transaction:
     save canonical state
     increment match version/sequence
     insert durable events
     insert command receipt
     insert outbox
→ return authoritative receipt
```

The adapter never receives raw cookies/session secrets.

## 4. Command response envelope

```json
{
  "matchId": "...",
  "version": 18,
  "sequence": 44,
  "replayed": false,
  "state": {},
  "events": []
}
```

The exact public game state is produced by the game adapter's viewer-aware projection.

For hidden-information games each player may receive a different `state` view while the authoritative server state remains single.

## 5. Realtime Gateway protocol

Protocol name proposal:

```text
ASA_GAME_CONTROL_RT_V1
```

Transport baseline: WebSocket over TLS.

### 5.1 Connection handshake

The browser authenticates using existing ASA session/origin controls or a short-lived scoped connection token; long-lived account credentials are never copied into game messages.

Server acknowledges:

```json
{
  "type": "HELLO_ACK",
  "protocol": 1,
  "connectionId": "...",
  "serverTime": 123456789
}
```

### 5.2 Subscription model

Client does not freely choose arbitrary channels. It requests typed subscription:

```json
{
  "type": "SUBSCRIBE",
  "topic": "match",
  "resourceId": "...",
  "afterSequence": 44
}
```

Gateway asks authorization provider before subscribing.

Topics may include:

```text
player                 personal invites/match found/rating
party:<id>
match:<id>
event:<id>
tournament:<id>
```

Resource IDs are validated; wildcard subscriptions are prohibited for clients.

### 5.3 Server messages

```text
PRESENCE_CHANGED
INVITE_CREATED
INVITE_UPDATED
PARTY_UPDATED
MATCHMAKING_UPDATED
MATCH_FOUND
MATCH_READY
MATCH_EVENT
MATCH_FINISHED
RATING_CHANGED
LEADERBOARD_INVALIDATED
SERVER_NOTICE
RESYNC_REQUIRED
```

Every durable match event carries sequence/version. Ephemeral presence messages do not pretend to be durable.

### 5.4 Backpressure

Because classic browser WebSocket lacks built-in backpressure, gateway MUST define bounded queues.

Suggested policy classes:

- **critical durable** — never silently drop; disconnect/resync slow consumer if buffer exceeds limit;
- **replaceable state** — coalesce to latest state;
- **presence** — coalesce by player/resource;
- **telemetry/non-critical** — may drop.

Metrics:

```text
outbound_queue_depth
outbound_bytes
slow_consumer_disconnects
coalesced_messages
dropped_noncritical_messages
```

## 6. Command game reconnect

Client persists:

```text
matchId
lastSeenSequence
lastSeenVersion
```

Reconnect:

```text
GET /api/games/matches/:id/reconnect?after=44
```

Response:

```json
{
  "snapshot": {},
  "version": 18,
  "sequence": 51,
  "events": [45, 46, 47, 48, 49, 50, 51]
}
```

Rules:

- snapshot is authoritative;
- events are convenience/audit/UI animation support;
- client can discard local speculative state and rebuild;
- if event retention no longer includes `after`, server returns snapshot with `events=[]` and `resyncRequired=true`;
- correctness never depends on continuous WebSocket connection.

This generalizes the successful snapshot + event-sequence pattern already present in chess-live.

## 7. Matchmaking flow

### 7.1 Command game

```text
Client
  ↓ join queue
Matchmaker
  ↓ compatible group found
Match Core creates GameMatch + participants
  ↓
Outbox MATCH_FOUND
  ↓
Realtime Gateway
  ↓
Clients open match
```

### 7.2 Realtime room game

```text
Client/Party
  ↓
Matchmaker
  ↓ compatible players
Create GameMatch(status=allocating)
  ↓
GameRoomAllocator
  ↓
Runtime instance + room reservation
  ↓ ROOM_READY
GameMatch(status=ready)
  ↓
short-lived room credentials
  ↓
clients connect to room
  ↓
MATCH_STARTED
```

Matchmaker MUST NOT own room process lifecycle.

## 8. GameRoomAllocator contract

Logical port:

```ts
interface GameRoomAllocator {
  allocate(input: {
    matchId: string;
    gameKey: string;
    gameVersion: string;
    regionPreference?: string;
    playerCount: number;
    topology: string;
    resourceProfile: string;
  }): Promise<RoomAllocation>;

  release(roomId: string, reason: string): Promise<void>;
}
```

Allocation result:

```ts
interface RoomAllocation {
  runtimeId: string;
  roomId: string;
  endpoint: string;
  expiresAt: string;
  runtimeProtocolVersion: number;
}
```

### V1 implementation

One configured runtime instance can satisfy all allocations. This proves contract without requiring cluster orchestration.

### Future adapters

Possible future implementations:

- static Docker runtime pool;
- Redis-coordinated runtime pool;
- Kubernetes custom allocator;
- Agones Fleet/GameServerAllocation;
- managed hosting provider adapter.

Games Core depends only on the allocator port.

## 9. Room credentials

Room connection uses a short-lived signed token scoped to:

```text
matchId
roomId
playerId
seat/team
gameKey/gameVersion
permissions (player/spectator)
issuedAt
expiresAt
nonce/session id
```

Room runtime validates signature/issuer/audience/version and does NOT call the main identity database for every input packet.

Token must not carry child-sensitive profile data.

Revocation strategy:

- short TTL;
- match/room status check at connect;
- disconnect control channel for bans/aborts if required.

## 10. Realtime Room Protocol

Protocol proposal:

```text
ASA_GAME_ROOM_V1
```

The protocol defines transport-independent logical messages.

### Client → room

```text
ROOM_HELLO
INPUT
CLIENT_ACK
RESYNC_REQUEST
PING
LEAVE_REQUEST
```

### Room → client

```text
ROOM_WELCOME
ROOM_STATE
SNAPSHOT
DELTA
INPUT_ACK
GAME_EVENT
PARTICIPANT_STATE
RESYNC
MATCH_END
ERROR
PONG
```

### Input envelope

```json
{
  "type": "INPUT",
  "clientSequence": 391,
  "lastServerTick": 8012,
  "payload": {}
}
```

The platform validates envelope bounds; game adapter validates payload semantics.

## 11. Realtime tick model

Manifest/runtime config declares:

```text
tickRateHz
snapshotRateHz
maxInputRateHz
maxPlayers
maxInputBytes
maxSnapshotBytes
```

Example certification target:

```text
ASA Arena Mini
tickRate = 30 Hz
snapshotRate = 10–20 Hz
maxPlayers = 8
```

At 30 Hz tick budget is ~33.3 ms. The runtime must record simulation duration and overrun count.

A room that consistently exceeds budget should degrade/abort safely rather than silently accumulate unbounded lag.

## 12. Prediction, reconciliation and interpolation

Games Platform defines sequence/tick primitives; each realtime game chooses appropriate algorithms.

### Local player

Expected flow:

```text
capture input
→ client predicts immediately
→ send input sequence
→ server simulates authoritative state
→ server snapshot includes last processed input sequence
→ client reconciles
→ replay still-unacknowledged inputs
```

### Remote players

Client buffers authoritative snapshots and renders remote entities with interpolation delay.

### Lag compensation

Optional game-specific policy for actions such as hitscan. Server remains authoritative and bounds rewind window.

The platform MUST NOT automatically trust client timestamps or hit claims.

## 13. State synchronization strategy

Three categories:

### A. Reliable control events

Examples:

```text
round start
score changed
objective completed
player eliminated
match end
```

Must be reliably delivered/represented in authoritative state.

### B. Replaceable snapshots/deltas

Position/velocity/orientation can be superseded by newer state. For WebSocket they are still reliable at transport level, but application may coalesce stale queued updates to avoid latency growth.

### C. Future unreliable datagrams

If WebTransport is later adopted, replaceable high-frequency state may use datagrams, while control uses streams.

Protocol semantics must not assume every message is reliable merely because v1 uses WebSocket.

## 14. Room lifecycle

```text
ALLOCATING
→ READY
→ WAITING_FOR_PLAYERS
→ ACTIVE
→ FINISHING
→ CLOSED
```

Exceptional:

```text
LOST
ABORTED
DRAINING
```

Runtime sends heartbeat/liveness to allocator/control-plane adapter.

A room is not considered ready merely because process exists; game version/runtime protocol compatibility and room initialization must pass.

## 15. Disconnect/reconnect policy

Manifest/mode declares:

```text
disconnectGraceMs
supportsReconnect
supportsLateJoin
```

When player disconnects:

1. room marks participant disconnected;
2. gameplay policy decides pause/continue/bot/forfeit after grace;
3. Control Plane/Gateway can notify party/match UI;
4. reconnect token binds same player/seat;
5. reconnect receives current snapshot, not tick history.

No rating penalty is applied solely from transient socket disconnect; only authoritative match termination policy determines result.

## 16. Realtime recovery classes

### Durable command

Reconstruct from PostgreSQL canonical state/events.

### Checkpointed room

Room periodically emits bounded checkpoint to durable store. On runtime loss allocator may restore if game supports it.

### Non-recoverable room

Runtime loss causes authoritative `MATCH_ABORTED`. Rated mode is normally prohibited or result is void.

GameManifest must make this explicit.

## 17. Realtime server authority and anti-cheat

Room validates:

- token/match/seat;
- monotonic client sequence;
- input rate;
- input schema/size;
- allowed input ranges;
- impossible command cadence;
- server-side cooldowns/resources;
- collisions/hits/score;
- game termination.

Client never sends authoritative:

```text
position
velocity
health
damage
kills
score
winner
rating
```

Client-side prediction is presentation, not authority.

## 18. WebSocket security requirements

Per OWASP-aligned design:

- TLS (`wss`);
- strict Origin validation where browser session auth is used;
- authenticate handshake;
- authorize every subscription/resource;
- validate every message against allowlisted schema;
- max message size;
- message rate limits;
- connection count limits;
- heartbeat/idle timeout;
- bounded queues/backpressure;
- anti-replay sequence/idempotency;
- safe error messages;
- no secrets/PII in frames/logs;
- compression disabled or carefully evaluated for attacker-controlled sensitive contexts;
- revoke/close connections when account/match permission changes.

## 19. Protocol version negotiation

Both gateway and room handshake include protocol version.

Client declares supported range/list. Server selects exact version or rejects with upgrade-required error.

Match pins protocol version so a rolling deploy cannot silently switch an active room mid-match.

New versions are additive where possible; breaking changes require parallel support window.

## 20. Event/outbox delivery to Gateway

Gateway does not poll every match table.

Initial practical implementation options:

1. API/outbox worker publishes in-process to gateway adapter when co-located in development;
2. PostgreSQL outbox poller + LISTEN/NOTIFY wake-up;
3. later shared pub/sub when gateway scales horizontally.

The durable source remains outbox/event rows. A missed notification must be recoverable.

## 21. Observability

### Control Plane

```text
game_match_create_total
game_match_finish_total
game_match_abort_total
game_invite_total
game_matchmaking_ticket_total
game_matchmaking_wait_ms
game_command_latency_ms
game_command_conflict_total
game_reconnect_total
```

### Gateway

```text
game_rt_connections
game_rt_messages_in_total
game_rt_messages_out_total
game_rt_outbound_queue_bytes
game_rt_slow_consumer_total
game_rt_reconnect_storm_rate
```

### Room Runtime

```text
game_room_active
game_room_players
game_room_tick_ms
game_room_tick_overrun_total
game_room_snapshot_bytes
game_room_input_rate
game_room_rtt_ms
game_room_desync_total
game_room_crash_total
```

Labels allowed:

```text
gameKey
gameVersion
mode
runtimeVersion
region
```

Do not label metrics by player/account/classroom id.

## 22. SLO additions proposed for Games

These values are planning targets and require load tests before acceptance.

### Command games school pilot

- command API availability during game windows: ≥ 99.9%;
- legal command acknowledgement P95: ≤ 500 ms under L1 load;
- durable command loss after success response: 0 accepted cases;
- duplicate command double-application: 0;
- reconnect snapshot P95: ≤ 1 s;
- match-found notification P95 after pairing: ≤ 1 s.

### Realtime Arena pilot

- room allocation P95 after group formed: ≤ 3 s for warm runtime;
- connection establishment P95: ≤ 2 s;
- tick overrun < 1% under certified room load;
- room crash rate measured and alertable;
- no authoritative state accepted directly from client;
- median/P95 RTT reported separately from server processing time.

These are added to, not replacements for, `CAPACITY_AND_SLO.md`.

## 23. Circuit breaker / isolation

Games Platform can disable new admission per game/version without disabling ASA itself.

Triggers may include:

- room crash rate;
- tick overrun saturation;
- match finish failures;
- protocol incompatibility;
- security incident;
- event-game expiry.

States:

```text
active
admission_paused
draining
disabled
```

Existing active rooms may drain where safe.

## 24. Deployment progression

### Phase D1 — no new realtime process

Command Game Core runs in API. PostgreSQL is durable source.

### Phase D2 — gateway

Deploy `realtime-gateway`; command games gain push notifications/events while HTTP remains authoritative.

### Phase D3 — one room runtime

Deploy a single `game-runtime` supporting ASA Arena Mini. Allocator returns that runtime.

### Phase D4 — static runtime pool

Multiple Docker runtime instances; allocator picks capacity.

### Phase D5 — scale coordination only if needed

Potential Redis/shared presence/pub-sub and/or Kubernetes/Agones adapter after measured scale requirements.

## 25. Protocol acceptance tests

Before production Games realtime:

- unauthorized match subscription rejected;
- cross-tenant/cross-class subscription rejected;
- malformed/oversized message closes/rejects predictably;
- flood limits work;
- duplicate command replay is idempotent;
- expectedVersion race returns conflict and authoritative resync;
- gateway restart does not lose durable match truth;
- slow consumer cannot create unbounded server memory;
- reconnect rebuilds command game from authoritative snapshot;
- room token cannot join another match/seat;
- input sequence replay rejected;
- shooter certification client cannot set its own position/HP/score;
- runtime crash maps match to recovery or abort policy;
- active version remains pinned during rolling deployment;
- match finish survives notification/gateway outage;
- rating/stats eventually converge from outbox after consumer restart.
