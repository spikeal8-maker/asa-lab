# ASA Games R1 — Private Online Checkers Delivery Brief

**Status:** accepted delivery contract  
**Issue:** #250  
**Observed main:** `8ec4afe910acd0e07ffcb0d4a537b865a384a699`  
**Authorization:** R1 only; no R2+ scope

## Result

Two real authenticated ASA users complete one private online Russian Checkers match:

`create invite -> redeem/accept -> play -> disconnect/reconnect -> finish -> history`

The match is server-authoritative, reuses the Russian-64 engine, survives retries, and requires no classroom, friend graph, public matchmaking, rating, or dedicated realtime service.

## User journey

1. A chooses `Играть с другом`.
2. Server returns a short invite code + URL with high entropy and bounded TTL.
3. Authenticated B redeems/accepts idempotently.
4. One canonical match exists with two participants, zero team rows and `invite + casual + private + command + duel`.
5. Both users see the same authoritative board/version without manual reload.
6. Moves send `commandId + expectedVersion`; existing Checkers rules validate turn/legality.
7. Reopen/reconnect restores the canonical snapshot.
8. Normal finish/resignation/draw finalizes one durable result.
9. Both participants can open the finished match from history.

The code/link is the R1 opponent-discovery mechanism; no user search/social directory is required.

## Required platform changes

R1 implements only the accepted R0 seams required by this journey:

- gaming-subject resolver -> canonical `game_player_id`;
- platform-scoped Match repository/security boundary;
- Match, participants and **team storage from the first migration** (R1 duel rows = 0);
- private invite admission service;
- lifecycle/finalization;
- command receipts + optimistic versioning;
- reconnect snapshot/history;
- transactional finalization/outbox boundary;
- capability gate `match.private_invite`;
- `GameUpdateDeliveryPort`.

`GameUpdateDeliveryPort` is transport-independent. R1 MAY use bounded polling or long-polling. UI/Checkers code MUST NOT depend on the transport. Full realtime gateway work belongs to R6.

Deployment remains modular monolith + existing PostgreSQL. No new infrastructure service is required.

## Required Checkers changes

- reuse `contexts/checkers` rules/document/draw logic; no second engine;
- adapt human-v-human sessions to the Games Match envelope;
- keep bot/local/classroom paths working;
- add only the private-online UI seam;
- do not add a new responsibility to `CheckersModuleExperience.tsx` or `checkers.css`; extract the needed seam if touched;
- do not migrate Chess in R1.

## Persistence/API intent

R1 must persist, with physical names deferred to implementation:

- canonical game player + verified identity binding/alias;
- match, participants and match teams;
- private invite + safe redeem lookup;
- command receipt/fingerprint;
- Checkers-owned authoritative state/snapshot/events keyed by match id;
- durable result/history;
- transactional outbox/finalization evidence.

Mutations follow GP-R0-007. Client-supplied player/tenant ids never grant authority.

## Invite contract

Invite code/link MUST:

- be non-sequential and impractical to enumerate;
- have server-enforced TTL;
- support idempotent acceptance/replay;
- reject second-opponent takeover after redemption;
- avoid existence/identity leakage;
- be cancellable before match start;
- never let one user control both seats.

Encoding/length is an implementation choice proven by tests.

## Implementation checkpoints

### R1A — Hygiene + foundation
Create the read-only hygiene command and minimum storage/API skeleton.

- `pnpm games:hygiene --changed <base>`;
- `pnpm games:hygiene --full`;
- report growth, hard-limit files and suspicious temp/generated/debug artifacts; never auto-delete/refactor;
- additive migration/repositories/contracts + focused tests.

### R1B — Two-user invitation
A creates code/link, B redeems it, exactly one shared private match exists, each user owns only their seat.

### R1C — Authoritative play + delivery
Two browser contexts play legal moves on the same canonical board without manual reload. Duplicate/stale commands are safe behind `GameUpdateDeliveryPort`.

### R1D — Reconnect + finish + history
Disconnect/reopen restores canonical state; one match completes; both users see the same durable result/history. Run full R1 hygiene audit.

## Test evidence

R1 requires **two independent authenticated browser contexts/users** proving:

- create/redeem/accept;
- same match id with opposite seats;
- illegal actor/seat access rejected;
- legal move propagation without manual reload;
- stale `expectedVersion` rejected;
- same `commandId` retry does not duplicate effects;
- disconnect/reconnect snapshot recovery;
- terminal match rejects another move;
- result/history visible to both;
- unrelated third user cannot read/control the private match;
- responses expose no school/classroom/email/internal identity.

Skipped/discovered tests are not PASS.

## Hygiene

At R1 entry remeasure current Checkers hotspots. Existing hard-threshold files are grandfathered debt, not a refactor project.

- changed-file hygiene each slice;
- mini audit after 3 implementation slices or 14 days;
- full audit at R1 exit;
- normally <=1 hygiene/refactor slice per 3 value slices.

Refactor a hotspot only when R1 requires it or the change would add responsibility/growth beyond the contract.

## Dependencies and rollback

Default new dependencies: **none**. Redis, brokers, realtime service, another DB, Kubernetes/Agones require stopping and amending this brief.

Each checkpoint stays additive/reversible:
- legacy bot/local/classroom Checkers remains intact;
- private-online entry stays behind availability/capability policy until proven;
- failed R1 work disables the new admission path instead of rewriting mature data.

## NOT IN SCOPE

- Quick Match/public queue;
- rated play, rating, stats, leaderboards;
- classmates/friends directory or presence;
- Chess convergence;
- full WebSocket/realtime gateway/room runtime;
- Arena/FFA/team gameplay;
- tournaments/events;
- Creator/SDK/game upload;
- Redis/Kafka/NATS/Kubernetes/Agones;
- free-form chat.

## Stop conditions

Stop and amend the brief if R1 requires:
- a second Checkers engine;
- weakened RLS/cross-workspace authorization;
- a full realtime service instead of an interchangeable delivery adapter;
- Quick/Rating/Social/Chess scope;
- a new hard-limit monolith;
- materially larger schema/API scope;
- browser proof without two genuinely independent ASA identities.

## R1 exit

R1 closes only when R1D browser evidence passes, full hygiene has no unaccepted regression, finalization/history are recoverable, and the private online path is enabled under policy.

Only then may R2 Quick Match + Tic-Tac-Toe begin.
