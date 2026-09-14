# GP-R0-001 — Gaming Identity Decision

**Status:** accepted architecture decision  
**Issue:** #222  
**Observed `main`:** `c3c1c10d7e37782de58ec84d31ed3336971150f5`  
**Change class:** L3_CRITICAL architecture/canonical resolver  
**Runtime/schema changes:** none  
**Review:** `R0_001_GAMING_IDENTITY_REVIEW.md`

## Decision

ASA Games introduces a stable platform-owned **Gaming Subject** identified by an opaque `game_player_id`. It is not an authentication identity and does not replace Account, Principal, StudentSeat or LearnerIdentity.

Authentication remains owned by ASA Identity. Games resolves the authenticated ASA subject through a narrow adapter:

```text
authenticated ASA subject
        ↓
GamingSubjectResolver
        ↓
canonical game_player_id
        ↓
public-safe GamePlayerProfile
```

The resolver uses verified source identities, not presentation data:

- Account authentication resolves by `account_id`;
- a standalone StudentSeat resolves by `seat_id`;
- raw `principals.id`, email, display name, school and `learner_identity.id` are not gaming identity keys.

Storage placement, RLS and global/cross-workspace authorization are intentionally deferred to `GP-R0-002`; this decision defines identity semantics only.

## Why Principal is not the gaming subject

Current ASA permits both `account` and `student_seat` principals. A StudentSeat can also be owned by an Account while retaining its own seat principal for classroom semantics. Therefore one human may legitimately appear through an account principal and one or more seat principals.

Using `principals.id` directly would split one Account user into several public gaming identities when classroom context changes. Conversely, merging principals heuristically would violate scoped identity and privacy rules.

`learner_identity.id` is also unsuitable: it is immutable within `(tenant, school)` and exists specifically to converge learning evidence inside a school scope, not as a global player key.

## Resolution rules

### Account

An authenticated Account resolves to exactly one canonical Gaming Subject independent of current workspace, school, class or tenant context. Switching workspace does not create a new player profile or rating identity.

If the Account occupies several classroom seats, those classroom relations may authorize class-scoped play, but they do not create additional gaming identities.

### Standalone StudentSeat

A StudentSeat without a verified Account link resolves to a seat-backed Gaming Subject. Its authentication remains scoped to that seat/class according to existing Identity rules.

Two seats are **not** merged because names, labels, school, device or teacher appear similar. Until ASA has a verified link, they are separate gaming subjects.

### Account-owned StudentSeat

When a seat has a verified `account_id`, Games resolves the player to the Account-backed Gaming Subject. Classroom seat identity remains available as authorization/scope context, but not as a second public player identity.

### Verified seat → Account linking

Linking is explicit and evidence-based; never by name/email guess.

If only one side already has a Gaming Subject, that subject is retained and the verified source link is attached to it.

If both the seat and Account already have distinct Gaming Subjects, the link operation creates an audited canonical merge/alias relation:

- one `game_player_id` becomes canonical for new writes;
- the former id remains a permanent alias that resolves to the canonical id;
- historical matches are not rewritten destructively;
- derived stats/history aggregate through canonical alias lineage;
- competitive rating merge semantics are decided separately in R3 and must be represented by explicit rating events/policy, never arithmetic hidden inside identity linking.

This preserves stable historical references while preventing two active profiles for the same verified Account link.

## Lifecycle rules

### Class/workspace change

For an Account-backed player, joining/leaving a class or switching workspace does not change `game_player_id`. It only changes eligible scopes/relationships.

For a seat-only player, loss of that seat does not imply a new identity elsewhere. A later unrelated seat is a new subject unless an explicit verified linking flow connects it.

### Suspension/revocation

Revoking a workspace/class/seat access path prevents that path from authorizing new Games actions. It does **not** delete matches, rating events, achievements or historical opponent references.

Account or Games suspension blocks new competitive/social actions according to policy while preserving historical records. Stale sessions/caches cannot continue authorization after revocation.

### Delete/anonymize

Deleting or anonymizing the source Account/Seat must not cascade-delete canonical match history. Authentication links may become inactive/tombstoned, while the platform retains the opaque `game_player_id` required for integrity/audit.

Public presentation becomes anonymized: alias/avatar/PII are removed or replaced by a non-identifying platform label. Historical match participants remain referentially valid without exposing the deleted source identity.

## Public-safe profile contract

The minimum public projection is conceptually:

```ts
interface GamePlayerPublicV1 {
  playerId: string;
  displayAlias: string;
  avatarRef: string | null;
}
```

It must never expose or use as fallback:

- `account_id`, `principal_id`, `seat_id` or `learner_identity_id`;
- email/login credentials;
- tenant/workspace/school/classroom ids;
- age/birth date;
- internal suspension/moderation reason.

A Games alias may be initialized from an existing safe profile/seat label under product policy, but public presentation is a Games projection and must not turn an internal identity field into an API identifier.

## Authorization boundary

`game_player_id` answers **who the stable player is**, not **what they may do**. Every invite, matchmaking, classroom, rated or tournament action still derives permission from the current authenticated ASA context plus Games policy/scope. Possessing or knowing a `playerId` grants no access.

## Compatibility

### Checkers

Existing bot/local/classroom saves and Russian-64 rules remain unchanged. R1 online Checkers will resolve authenticated humans to `game_player_id` at the Games adapter boundary. Legacy participant identifiers are not bulk-rewritten as part of R0.

### Chess

Current Chess Live uses tenant/user identifiers and remains unchanged before R4. R4 must shadow-map authenticated Chess participants to Gaming Subjects and prove parity before cutover. Existing Chess history is preserved; no rename-in-place of chess tables or participant ids is authorized by this decision.

## Negative cases

1. Same Account enters two schools/classes: **one** Gaming Subject, multiple authorization relations.
2. Two unlinked StudentSeats both named `Алексей`: **two** Gaming Subjects; no heuristic merge.
3. One Account plus its classroom seat principal: **one** Account-backed Gaming Subject, not two profiles.
4. `learner_identity.id` remains Learning-owned and is not copied into public Games identity.
5. Teacher leaves one workspace: Games history survives; only that workspace relationship is revoked.
6. Deleted player appears in old match history: opaque historical identity remains, public PII does not.
7. Client submits another player's `playerId`: server resolves actor from authenticated ASA context and ignores it as authority.

## Deferred by design

This decision does not define:

- physical tables/RLS/global storage (`GP-R0-002`);
- Match schema (`GP-R0-003..005`);
- rating merge algorithm (`R3`);
- public matchmaking eligibility for minors (`R2` policy gate);
- creator identity/ownership (`R7`).

Those decisions must consume this identity contract rather than redefine it.
