# ASA Games Platform — Developer Integration Guide

**Status:** Draft developer contract  
**Audience:** developer/agent adding a new game to ASA Lab  
**Prerequisite:** read `ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md` first

## 1. Principle

A new game plugs into Games Platform. It does not create its own copy of platform networking.

Game-owned responsibilities:

```text
rules / authoritative simulation
game-specific state
commands or realtime inputs
public state projection
renderer/client
bots (optional)
custom metrics (optional)
assets/content
```

Platform-owned responsibilities:

```text
auth / GamePlayerProfile
GameMatch lifecycle
participants/teams
invites / party
classmates/recent opponents
matchmaking
room allocation
reconnect envelope
history
rating framework
statistics
leaderboards
notifications
moderation hooks
platform shell
```

## 2. Proposed source layout

Trusted command game:

```text
contexts/<game-key>/
├── domain/
│   ├── model.ts
│   ├── rules.ts
│   └── metrics.ts
├── application/
│   └── game-adapter.ts
├── testing/
│   └── fixtures.ts
├── index.ts
├── package.json
└── project.json

apps/web/src/<game-key>/
├── <Game>Renderer.tsx
├── <Game>Experience.tsx
└── testing/
```

Realtime game may additionally have:

```text
runtimes/<game-key>/
├── adapter
├── simulation
├── protocol bindings
└── Dockerfile/entrypoint (if isolated)
```

Final repository path can differ after implementation ADR, but ownership boundary must remain equivalent.

## 3. Game Manifest example — command game

Illustrative contract, not yet compiled API:

```ts
export const ticTacToeManifest = defineGame({
  gameKey: 'tic-tac-toe',
  gameVersion: '1.0.0',
  rulesVersion: 'classic-3x3-v1',
  stateSchemaVersion: 1,

  displayName: 'Крестики-нолики',

  runtimeKind: 'command',
  topology: 'duel',
  minPlayers: 2,
  maxPlayers: 2,

  capabilities: {
    bots: true,
    local: true,
    privateInvites: true,
    quickMatch: true,
    rated: false,
    spectators: true,
    reconnect: true,
    lateJoin: false,
    classroom: true,
  },

  lifecycle: { kind: 'permanent' },
  recovery: { kind: 'durable' },
});
```

Game manifest MUST NOT contain:

- PostgreSQL table names;
- NestJS controller classes;
- WebSocket library objects;
- Redis keys;
- Kubernetes resources;
- account/session secrets.

## 4. Command adapter example

Illustrative:

```ts
interface TicTacToeState {
  board: readonly ('x' | 'o' | null)[];
  sideToMove: 'x' | 'o';
  result: 'x' | 'o' | 'draw' | null;
}

type TicTacToeCommand = {
  type: 'place';
  cell: number;
};

const adapter: CommandGameAdapter<TicTacToeState, TicTacToeCommand> = {
  createInitialState() { ... },

  applyCommand({ state, participant, command }) {
    // validate participant seat, turn and game rule
    // return new state + game events/outcome
  },

  publicView({ state }) {
    return state;
  },

  outcome(state) {
    // convert game result to generic participant outcome
  },
};
```

Important:

- adapter is deterministic from authoritative inputs/state where game permits;
- adapter never writes DB directly;
- adapter never sends WebSocket messages;
- adapter never updates rating/stats;
- adapter never authenticates user;
- adapter returns transition to Games Core.

## 5. Hidden-information games

`publicView()` receives viewer identity/seat and may filter authoritative state.

For cards/battleship:

```text
Authoritative state
  ├── Player A view
  ├── Player B view
  └── Spectator view
```

Never serialize authoritative hidden state and rely on frontend to hide it visually.

A certification test must explicitly attempt cross-seat information leakage.

## 6. Game outcomes

Game adapter converts native outcome into generic platform outcome.

Duel:

```ts
[
  { seat: 'light', result: 'win', placement: 1 },
  { seat: 'dark', result: 'loss', placement: 2 },
]
```

FFA:

```ts
[
  { seat: 'p3', result: 'completed', placement: 1, score: 120 },
  { seat: 'p1', result: 'completed', placement: 2, score: 95 },
  ...
]
```

Team:

```text
team red = win
team blue = loss
individual custom metrics remain game-specific
```

The browser never submits this authoritative outcome.

## 7. Bot provider

Optional game-owned provider:

```ts
interface GameBotDescriptor {
  botKey: string;
  displayName: string;
  difficultyOrder: number;
  calibratedRating?: number;
}
```

Do not publish a numeric bot rating unless actually calibrated and defined by game owner.

Bot agent receives the same authoritative state/rules contract as a player command generator. It does not bypass game rules.

Platform records bot match participant with `player_kind=bot` and derives bot statistics without altering human rated pool unless explicit policy says otherwise.

## 8. Custom metrics

A game registers a versioned metrics schema.

Example:

```ts
interface CheckersMetricsV1 {
  captures: number;
  promotions: number;
  maxCaptureChain: number;
}
```

Rules:

- generated server-side from authoritative match/runtime;
- bounded payload;
- schema version pinned;
- no arbitrary PII/user content;
- optional projectors may expose selected metrics in stats UI.

## 9. Realtime-room manifest

Illustrative:

```ts
export const arenaManifest = defineGame({
  gameKey: 'asa-arena-mini',
  gameVersion: '1.0.0',
  rulesVersion: 'collect-v1',
  stateSchemaVersion: 1,

  runtimeKind: 'realtime-room',
  topology: 'free-for-all',
  minPlayers: 4,
  maxPlayers: 8,

  capabilities: {
    bots: false,
    local: false,
    privateInvites: true,
    party: true,
    quickMatch: true,
    rated: false,
    spectators: true,
    reconnect: true,
    lateJoin: false,
  },

  runtime: {
    tickRateHz: 30,
    snapshotRateHz: 15,
    maxInputRateHz: 60,
    maxInputBytes: 512,
    maxSnapshotBytes: 32768,
  },

  recovery: { kind: 'non_recoverable' },
  lifecycle: { kind: 'permanent' },
});
```

Actual limits are benchmarked, not copied blindly from this example.

## 10. Realtime adapter responsibilities

Adapter owns:

- initial simulation state;
- input validation semantics;
- simulation tick;
- game-specific snapshot/delta projection;
- objective/score rules;
- finish/outcome;
- custom metrics.

Runtime shell owns:

- room token verification;
- participant connection mapping;
- input envelope sequence/rate/size limits;
- tick scheduling;
- heartbeat/lifecycle;
- generic room metrics;
- final outcome handoff;
- shutdown/drain.

## 11. Client renderer integration

Trusted game:

```tsx
<GameShell match={platformView}>
  <TicTacToeRenderer game={gameView} />
</GameShell>
```

Renderer owns interaction/visuals only.

It should receive platform actions as capabilities rather than import global APIs directly.

Example:

```ts
interface GameShellActions {
  submitCommand?: (...);
  leave?: (...);
  resign?: (...);
  offerDraw?: (...);
  rematch?: (...);
  reportPlayer?: (...);
}
```

## 12. Isolated event game integration

External/experimental game does not import ASA server internals.

Package contract can contain:

```text
game.yaml
client artifact/image
runtime image (if needed)
SBOM
license inventory
protocol compatibility metadata
resource profile
```

Client may run in sandboxed iframe / isolated origin and receives only public match context + short-lived tokens through a versioned parent/child protocol.

Runtime receives only room configuration and signed room credentials, not database passwords or ASA session cookies.

## 13. Adding a new command game — checklist

1. Reserve stable `gameKey`.
2. Define game/rules/state schema versions.
3. Write manifest.
4. Implement rules/domain state.
5. Implement CommandGameAdapter.
6. Implement viewer/public projection.
7. Implement generic outcome conversion.
8. Implement renderer.
9. Add optional bots/metrics.
10. Register game.
11. Run game-sdk conformance tests.
12. Run command certification tests.
13. Verify Games Hub capability rendering.
14. Verify invite/quick/reconnect/history/stats using platform infrastructure.
15. Verify privacy/cross-scope tests.
16. Only then enable game availability.

## 14. Adding a realtime-room game — additional checklist

1. Define tick/snapshot/input limits.
2. Implement RealtimeGameAdapter.
3. Build runtime artifact/image.
4. Implement room protocol bindings.
5. Implement client prediction/interpolation as appropriate.
6. Define reconnect/late-join policy.
7. Define recovery policy.
8. Define server-side outcome and metrics.
9. Load-test certified player count.
10. Pass room isolation/token tests.
11. Pass runtime crash/drain tests.
12. Prove no DB I/O in hot tick path unless explicitly benchmarked/approved.
13. Prove client cannot authoritatively set position/health/score/result.

## 15. Forbidden patterns

Do not add:

```text
/api/<game>/matchmaking        // when generic matcher can serve it
/api/<game>/invites            // generic invites exist
<game>_ratings                 // generic rating store exists
<game>_friends                 // relationships platform-owned
<game>_presence                // gateway/platform-owned
```

Do not:

- import another game's runtime;
- query Games DB tables from renderer;
- send internal IDs to UI because alias lookup failed;
- trust browser result/score;
- use WebSocket-only mutation without durable command path for command games;
- create background poll loop where platform realtime topic exists;
- make event game runtime a privileged DB client;
- add infrastructure technology directly into game-sdk contract.

## 16. Version change rules

### Game version

Bump when packaged game implementation/content changes in a way relevant to match compatibility.

### Rules version

Bump when authoritative rules/outcome semantics change.

### State schema version

Bump when durable state representation changes.

### Protocol version

Bump on incompatible wire contract change.

A match pins exact versions at creation. Do not migrate an active match in place across incompatible rules/runtime versions.

## 17. Removal/deprecation

Disabling a game means:

```text
no new admission
existing active matches drain/abort by policy
history/stats remain readable
```

Removing runtime/client artifact is allowed only after:

- no active match needs it;
- replay/history requirements are understood;
- retention policy permits;
- manifest/catalog points to archived state.

## 18. Developer definition of done

A new game is done when:

- it passes the appropriate platform certification suite;
- it does not replicate generic networking services;
- server authority is proven;
- public state passes privacy tests;
- network failure/retry paths are tested;
- metrics/health are present;
- game can be disabled independently;
- old active version can coexist during rollout if required;
- documentation states capabilities/non-capabilities accurately.
