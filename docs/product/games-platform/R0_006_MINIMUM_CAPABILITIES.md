# GP-R0-006 — Minimum Capability Vocabulary

**Status:** accepted architecture decision  
**Issue:** #240  
**Runtime/schema changes:** none

## Decision

ASA Games uses a deliberately small capability vocabulary for R1–R4. A capability describes a platform action/policy boundary; it is not a client flag and it is not proof that an actor may perform the action.

Four layers remain separate:

1. **Game support** — whether the pinned game release can technically support a capability.
2. **Platform policy grant** — whether ASA policy allows a subject/account category/scope to use it.
3. **Eligibility decision** — a server-side decision for this actor, game, scope and moment.
4. **Game admission state** — whether new admission into the game is globally enabled.

The effective rule is:

```text
allow =
  game_supports(capability)
  AND platform_grants(subject, capability, scope)
  AND eligibility_checks_pass(subject, game, scope)
  AND admission_state_allows(action)
```

Clients may request an action, but never assert any of these four facts.

## R1–R4 capability keys

The canonical V1 keys are:

```text
admission.invite
admission.matchmaking
competition.rated
session.reconnect
history.read_self
profile.public_projection
```

No additional capability key is introduced during R1–R4 without an explicit architecture amendment.

### `admission.invite`

Allows authenticated private/direct invitation flows when game support and actor policy permit them.

It does not create a friend graph. An invite code/URL is an admission reference, not identity or authorization by itself.

R1 Checkers requires this capability.

### `admission.matchmaking`

Allows entry into server-side matchmaking.

Quick Play is `admission.matchmaking` with `competition=casual`. There is no separate `quick` permission key.

R2 requires this capability.

### `competition.rated`

Allows the actor and pinned game release to participate in rating-bearing competition.

Rated matchmaking therefore requires both:

```text
admission.matchmaking
competition.rated
```

The model also leaves room for a future policy-approved rated invite without inventing another capability.

R3 requires this capability.

### `session.reconnect`

Allows an authenticated participant to recover canonical active-match state after transport interruption.

Reconnect is not admission into a new match. Disabling new game admission MUST NOT strand participants in an already authorized active match.

R1 requires this capability.

### `history.read_self`

Allows an authenticated player to read their own authorized match history/projections.

It does not grant access to another player's private history or classroom metadata.

R1 requires minimal own-history access.

### `profile.public_projection`

Allows publication/read of the explicitly public-safe game profile/stat projection defined by product policy.

It never exposes email, school, classroom, teacher, age, learner/account/principal ids or learning evidence.

R3 uses this capability for public competitive profiles/leaderboards. A product may keep the projection disabled even when rated play is enabled.

## Admission state

`GameAdmissionStateV1` is not a player capability:

```text
enabled
disabled_new_matches
```

`disabled_new_matches` blocks:

- creating or accepting new invites;
- entering matchmaking;
- creating new direct/bot competitive sessions through Games admission.

It does not:

- delete history;
- mutate completed matches;
- revoke authorized history reads;
- automatically abort active matches;
- block reconnect to an already authorized active match.

Emergency termination of active matches is an explicit GP-R0-004 administrative/integrity action, not a side effect of disabling admission.

## Support versus grant versus eligibility

A game/release support declaration is descriptive:

```text
supports: [admission.invite, session.reconnect, history.read_self]
```

It cannot grant itself access to users or scopes.

A platform policy grant is controlled by ASA configuration/account/organization policy.

Eligibility remains dynamic and MUST re-check relevant facts such as:

- authenticated canonical `game_player_id`;
- suspension/revocation;
- requested scope authorization;
- public matchmaking eligibility policy;
- block/report/safety restrictions where applicable;
- game admission state;
- requested competition policy.

Capability evaluation never bypasses GP-R0-001 identity or GP-R0-002 authorization/RLS.

## Scope is not capability

`private`, `classroom`, `workspace`, `global`, `event`, `tournament` remain Match scope from GP-R0-003.

Do not create capability keys such as `scope.global` or `school.member`. Scope authorization is an input to eligibility.

Classmate challenge/social discovery belongs to R5; R0-006 does not invent a cross-product friend graph.

## Stage mapping

### R1 — private online Checkers

Required:

- `admission.invite`;
- `session.reconnect`;
- `history.read_self`;
- admission state gate.

Not required: matchmaking, rated competition, public profile projection.

### R2 — Quick Match + XO proof

Adds:

- `admission.matchmaking`;
- an explicit Quick Match eligibility policy.

Quick is casual; it does not require `competition.rated`.

### R3 — competitive Checkers

Adds:

- `competition.rated`;
- `profile.public_projection` for policy-approved public-safe stats/leaderboards.

Rating/state correctness remains separate from profile visibility.

### R4 — Chess convergence

Chess challenge maps to `admission.invite`; Chess matchmaking maps to `admission.matchmaking`; rated Chess maps to `competition.rated`; reconnect/history/profile map to the same shared keys after parity is proven.

R4 does not create Chess-specific capability names.

## Negative cases

1. A client sends `capabilities: ['competition.rated']`; the server ignores it as authority.
2. A game supports rated play, but the account is ineligible; rated admission is denied.
3. Admission is disabled while two players are mid-match; reconnect remains allowed.
4. Possessing an invite URL does not authorize impersonating either participant.
5. Quick matchmaking is not a separate capability from matchmaking + casual competition.
6. Public profile permission does not expose classroom/school/learning fields.
7. Classroom membership is not encoded as a capability key.
8. A game package cannot grant itself matchmaking/rated/public visibility.
9. R0 does not define camera, microphone, filesystem, clipboard, external network, iframe, build or creator-runtime capabilities.
10. Spectating, party, chat, tournaments/events administration and classmate discovery remain later explicit contracts.

## Deferred deliberately

- exact Quick/Ranked minor/account eligibility policy → R2/R3 Delivery Briefs;
- classmate/social challenge discovery → R5;
- spectators/party/chat → later product stages;
- Creator/sandbox/browser/device/network permissions → R7+ capability catalog;
- persistence/configuration DTOs for grants/support → R1+ only as required by the current value slice;
- error codes/idempotent command behavior → GP-R0-007.
