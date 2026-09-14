# GP-R0-003 — Canonical Match Model

**Status:** accepted architecture decision  
**Issue:** #226  
**Runtime/schema changes:** none

## Decision

ASA Games uses one game-independent `GameMatch` envelope. It describes **who/what/where/how the match is hosted**, but never attempts to describe the internal rules or board/world state of every game.

Five dimensions are independent:

```text
admission_kind   direct | invite | matchmaking | tournament | event | bot | local
competition_kind casual | rated
scope_kind       private | classroom | workspace | global | event | tournament
runtime_kind     command | realtime_room
topology         duel | free_for_all | teams | coop
```

No value on one axis implies a value on another. A tournament may be casual or rated; a classroom match may be direct or invite-driven; matchmaking may be casual or rated.

## Canonical envelope

Conceptually:

```ts
interface GameMatchV1 {
  id: string;
  gameKey: string;
  gameVersion: string;
  rulesVersion: string;
  stateSchemaVersion: number;
  protocolVersion: string;
  ratingPolicyVersion: string | null;

  admissionKind: AdmissionKind;
  competitionKind: 'casual' | 'rated';
  scopeKind: ScopeKind;
  runtimeKind: 'command' | 'realtime_room';
  topology: 'duel' | 'free_for_all' | 'teams' | 'coop';

  status: string;              // exact state machine is GP-R0-004
  lifecycleVersion: number;
  gameConfigRef: string | null;
  admissionRef: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`status` exists in the envelope, but its exact values, transitions, terminal reasons and transition authority are defined only by `GP-R0-004`.

`ratingPolicyVersion` is required only when `competitionKind = rated`. It is `null` for casual matches.

`gameConfigRef` identifies an immutable, game-validated configuration snapshot when required (for example chess time control). The generic Match does not understand the configuration payload.

`admissionRef` may point to the immutable source that created the match (invite, matchmaking ticket, tournament pairing, event pairing). The core does not create dedicated `challenge_id`, `queue_id` or `tournament_id` columns in `GameMatch`.

## Participants

Players are rows, not fixed color columns:

```ts
interface GameMatchParticipantV1 {
  id: string;
  matchId: string;
  participantKind: 'player' | 'bot' | 'local_guest';
  gamePlayerId: string | null;
  botKey: string | null;
  seatKey: string;
  teamId: string | null;       // semantics completed by GP-R0-005
}
```

Rules:

- `player` resolves to canonical `game_player_id` from GP-R0-001;
- `bot` uses a versioned bot key and has no fake human player id;
- `local_guest` permits same-device local play without inventing an ASA account;
- `seatKey` is an opaque game-owned role such as `light`, `dark`, `white`, `black`, `p1`; Games Core stores it but does not interpret it;
- `teamId` is nullable and becomes authoritative for team topology under GP-R0-005.

There are no generic columns named `white_player_id`, `black_player_id`, `light_player_id` or `dark_player_id`.

## Scope binding

`scopeKind` classifies visibility/admission policy. The authoritative relationship to a classroom/workspace/event/tournament is stored as a typed scope binding, not as ownership by that tenant.

Examples:

- private invite across two schools: `scope=private`;
- public quick queue: `scope=global`;
- teacher-created class match: `scope=classroom` plus verified classroom binding;
- tournament pairing: `scope=tournament` plus tournament binding.

This consumes GP-R0-002: a cross-workspace match remains platform-scoped.

## Game state boundary

The generic match MUST NOT contain:

- chess FEN, position keys, SAN/UCI moves or clocks;
- checker squares, move paths or draw tracker;
- card hands/decks;
- realtime positions, projectiles, HP or physics state;
- a universal `game_state_json` interpreted by Games Core.

Command games keep authoritative game-owned state/snapshots/events keyed by `matchId` and pinned `stateSchemaVersion`. Realtime games keep authoritative room state in the room runtime and durable checkpoints/results according to runtime policy.

`lifecycleVersion` is the optimistic version of generic match metadata/lifecycle. A game's own state revision/sequence is separate; the two must not be silently conflated.

## Version pinning

A created match pins the versions needed to reproduce and validate it. At minimum:

- game release/version;
- rules version;
- state schema version;
- transport/protocol version;
- rating policy version when rated.

Updating the current game release does not mutate existing matches.

## Checkers compatibility mapping

Current Checkers `mode` decomposes as follows:

| Current mode | admission | competition | scope | runtime | topology |
| --- | --- | --- | --- | --- | --- |
| `bot` | bot | casual | private | command | duel |
| `local` | local | casual | private | command | duel |
| `friend` | invite | casual | private | command | duel |
| `quick` | matchmaking | casual | global* | command | duel |
| `rated` | matchmaking | rated | global* | command | duel |
| `class` | actual source: direct/invite | casual | classroom | command | duel |

`*` Policy may later restrict a queue to workspace/classroom; that changes `scope`, not `admission` or `competition`.

`lesson` is **not** a canonical Match mode. Learning context remains an external relation. If a lesson embeds a real match, that match uses ordinary dimensions (normally direct + casual) while Learning references it separately.

Checkers `side` becomes participant `seatKey`. `CheckersDocument` and draw tracker remain Checkers-owned state.

## Chess compatibility mapping

Current Chess Live maps additively:

- challenge-created game → `admission=invite`;
- matchmaking game → `admission=matchmaking`;
- `rated` boolean → `competition=casual|rated`;
- private challenge → normally `scope=private`;
- queue scope is explicit policy (`global`, `workspace`, etc.), never inferred from current tenant storage;
- `whitePlayerId`/`blackPlayerId` → participant rows with `seatKey=white|black`;
- `challengeId` → admission source reference;
- time control → immutable Chess game configuration;
- FEN, moves, clock and draw offer → Chess-owned authoritative state;
- result/termination finalization is completed by GP-R0-004/005 and later rating contracts.

Existing tenant-scoped Chess tables remain unchanged until R4 parity/cutover.

## Negative cases

1. `friend + rated` is not a new mode: `invite + rated + private` is representable if policy permits it.
2. A classroom tournament is not ambiguous: `tournament + rated/casual + classroom/tournament` is expressible without a new enum value.
3. Chess color and Checkers side never require schema columns in `GameMatch`.
4. Arena 2v2 uses `realtime_room + teams`; it does not require a second Match table.
5. A lesson does not force Learning semantics into Games Core.
6. Changing Chess time control does not require altering generic Match columns.
7. A client cannot switch a casual match to rated by changing UI state; competition policy is server-owned and pinned at creation.

## Deferred deliberately

- exact lifecycle transitions/termination reasons → GP-R0-004;
- team rows/outcomes → GP-R0-005;
- capability/admission policy → GP-R0-006;
- command errors/idempotency → GP-R0-007;
- physical SQL types/indexes → R1 implementation after R0 closes.
