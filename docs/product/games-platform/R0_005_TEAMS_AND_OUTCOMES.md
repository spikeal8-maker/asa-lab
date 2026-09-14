# GP-R0-005 — First-class Teams and Outcomes

**Status:** accepted architecture decision  
**Issue:** #238  
**Observed main:** `599981488846951989de3c0e7d7a3b90536ceb5b`  
**Runtime/schema changes:** none

## Decision

ASA Games uses first-class **match-scoped teams** for `topology=teams|coop`.

Teams are not reconstructed from participant metadata or reused from external social/admission groups.

For `duel` and `free_for_all`, the match contains **zero team rows**; one-person teams are forbidden.

## Canonical structural model

Conceptually:

```ts
interface GameMatchTeamV1 {
  id: string;          // platform-owned opaque id
  matchId: string;
  teamKey: string;     // opaque game-owned role, unique within the match
}

interface GameMatchParticipantV1 {
  id: string;
  matchId: string;
  participantKind: 'player' | 'bot' | 'local_guest';
  gamePlayerId: string | null;
  botKey: string | null;
  seatKey: string;
  teamId: string | null;
}
```

`teamKey` may be `red`, `blue`, `alpha` or another game-defined role. Games Core stores it, guarantees match-local uniqueness and does not interpret it.

`seatKey` and `teamId` are independent:

- `seatKey` addresses the participant's game-owned seat/role;
- `teamId` groups participants into the authoritative match team.

A 4v4 arena may therefore have eight distinct seat keys but only two team ids.

A participant belongs to at most one team in a match.

## Topology invariants

### `duel`

- exactly two competing participants according to game policy;
- zero team rows;
- all participant `teamId` values are `null`;
- competitive outcome is participant-authoritative.

Checkers and Chess remain duel games and require no synthetic team records.

### `free_for_all`

- two or more competing participants;
- zero team rows;
- all participant `teamId` values are `null`;
- participant placement/score/result is authoritative when the game publishes it.

An eight-player race is eight participants, not eight teams.

### `teams`

- at least two team rows;
- every competing participant belongs to exactly one team;
- every referenced `teamId` belongs to the same match;
- team size/equality rules are game configuration/rules, not generic Games Core assumptions;
- team competitive outcome is authoritative for team competition.

Bots/local guests may be team members when game policy allows.

### `coop`

- exactly one match team represents the shared cooperative objective;
- all competing participants belong to that team;
- shared objective result belongs to the team;
- participant-specific completion/score may still be recorded separately.

If multiple cooperative groups compete against each other, the topology is `teams`, not `coop`.

## Outcome model

Generic outcome data is deliberately small and orthogonal:

```ts
type CompetitiveResult = 'win' | 'loss' | 'draw';
type ObjectiveResult = 'success' | 'failure';
type CompletionStatus = 'completed' | 'did_not_finish' | 'disqualified';

interface GameMatchTeamOutcomeV1 {
  teamId: string;
  competitiveResult: CompetitiveResult | null;
  objectiveResult: ObjectiveResult | null;
  placement: number | null;
  primaryScore: number | null;
}

interface GameMatchParticipantOutcomeV1 {
  participantId: string;
  competitiveResult: CompetitiveResult | null;
  completionStatus: CompletionStatus | null;
  placement: number | null;
  primaryScore: number | null;
}
```

SQL type for `primaryScore` is deferred to R1; rich metrics stay game-owned.

### Source-of-truth rules

- `duel` / `free_for_all`: participant outcomes are authoritative; no team outcomes exist.
- `teams`: team outcome is authoritative for team win/loss/draw, team placement and team score. Participant outcome MAY carry individual completion, placement or score when the game has those concepts, but MUST NOT become a second authoritative copy of the team's competitive result.
- `coop`: team `objectiveResult` is authoritative for shared success/failure. Participant outcome MAY carry individual completion/score.
- cancelled or aborted matches do not require competitive outcomes; lifecycle/termination remains governed by GP-R0-004.
- official outcomes are server-owned and are written/finalized only through the authoritative match finalization path.

Stats/rating may derive a player's team result from membership + team outcome; duplicated participant win/loss is not another source of truth.

## Placement and score semantics

`placement` is a positive ranking position only when the game publishes an ordered result. Ties may share a placement only when the game rules explicitly allow them.

`primaryScore` is optional. Absence of a score is valid for Chess/Checkers and many win/loss games.

Game-specific metrics such as kills, captures, accuracy, lap time, checkmates or promotion count remain outside generic team/participant outcome rows.

## Match-scoped snapshot, not social identity

A `GameMatchTeam` is immutable match structure, not a durable social team.

It MUST NOT reuse:

- `partyId`;
- classroom/team membership ids;
- tournament roster ids;
- guild/friend-group ids.

Those systems may be admission/source references. At match start, the authoritative participant/team assignment is snapshotted into the match.

Later social/classroom changes cannot rewrite historical teams.

## Roster freeze

Before `active`, admission/runtime policy may still build the roster while the match is `waiting` or `ready`.

Once the match enters `active`:

- participant identity;
- participant `seatKey`;
- participant `teamId`;
- team identity and `teamKey`

are immutable for V1.

Substitutions/late roster mutation require a future explicit capability/protocol version.

## Compatibility

### Checkers

Current Checkers always maps to:

- `topology=duel`;
- two participant rows;
- zero team rows;
- `seatKey=light|dark`;
- participant competitive result derived from authoritative Checkers result.

No Checkers rules or save format changes are authorized by this decision.

### Chess

Current Chess Live maps to:

- `topology=duel`;
- white/black participant rows;
- zero team rows;
- `seatKey=white|black`;
- participant competitive result from canonical Chess result.

Existing Chess Live tables remain unchanged until R4 parity/cutover.

### Arena proof

A future Arena 2v2/4v4 uses:

- `topology=teams`;
- two match team rows, e.g. `red` and `blue`;
- every competing participant linked to exactly one team;
- team score/result stored once on team outcome;
- individual kills/assists/etc. kept as participant/game metrics.

No `GameMatch` redesign is required.

## Negative cases

1. Checkers light/dark are seats, not teams.
2. Chess white/black are seats, not teams.
3. FFA players are not wrapped in synthetic one-person teams.
4. A Party is not a Match Team and changing a Party never changes historical teams.
5. A participant cannot belong to two teams in one match.
6. A team from another match cannot be referenced.
7. A team win/loss is not duplicated as an independently mutable participant win/loss source.
8. `teamKey=red` does not give Games Core knowledge of what "red" means.
9. An aborted room does not fabricate winner/loser outcomes.
10. Rich game metrics are not added as generic Games schema columns.

## Deferred deliberately

- physical SQL tables/types/indexes → R1 after all R0 decisions close;
- exact finalization transaction/idempotency → GP-R0-007;
- rating algorithms/team rating projection → R3+;
- party/social team product model → later admission/social stages;
- substitution/late roster mutation → future explicit capability;
- spectator model → later runtime/product contract.
