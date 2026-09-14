# GP-R0-002 — Games Security & Storage Domain

**Status:** accepted architecture decision  
**Issue:** #223  
**Depends on:** `GP-R0-001` Gaming Subject  
**Runtime/schema changes:** none

## Decision

ASA Games global/cross-workspace data is **platform-scoped**, not tenant-owned.

For the first implementation it stays in the existing PostgreSQL database and migration stream, but lives behind a dedicated logical boundary (`games` PostgreSQL schema / Games repositories). This avoids a premature extra database/service while keeping a clean extraction boundary later.

Hard rules:

- no match, rating or player profile is owned by one participant's tenant;
- no synthetic “Games tenant” is introduced to fake cross-tenant ownership;
- ASA Identity remains the only authentication/session system;
- application/database runtime roles keep `NO BYPASSRLS` semantics;
- tenant-scoped education data remains tenant-scoped and is referenced, not copied into Games ownership.

## Platform-owned data

The following canonical entities are platform-scoped when introduced by later stages:

- Gaming Subject / `GamePlayerProfile` and verified source links;
- `GameMatch`, participants and teams;
- private invites and matchmaking tickets;
- command receipts and durable game events;
- ratings and immutable rating events;
- history/stat projections and Games outbox records.

These tables do not receive a participant `tenant_id` as an ownership key.

If a match is limited to a tenant-owned resource (classroom/workspace), Games stores an explicit **scope binding** containing the tenant lineage and resource id. The binding authorizes/labels the scope; it does not make that tenant the owner of the global player or match.

## Request security context

After normal ASA authentication, the server resolves the actor through the accepted `GamingSubjectResolver` and opens a Games transaction with a server-derived context conceptually equivalent to:

```text
GamesRequestContext
- gamePlayerId
- session/request audit id
- verified relationship/scope inputs when required
```

Games introduces transaction-local `app.game_player_id` (or equivalent repository context). It is set only from the authenticated server-side resolver, never from request body/query/header.

`app.tenant_id` remains the context for tenant-owned repositories. It is **not** reused as the ownership/access key for platform Games rows.

A request that needs a classroom relationship first resolves that relationship through the existing tenant-scoped authorization path, then passes the verified scope binding to Games. Games never trusts a client-supplied school/class/tenant id as authority.

## RLS and database privileges

Platform Games tables that contain player-private or match-private data use `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.

RLS is defense-in-depth, not the primary policy engine:

- private match/event reads require current-player participation or an explicitly permitted spectator projection;
- own invite/ticket/profile mutations require the current `game_player_id`;
- command receipts are actor-scoped;
- public-safe opponent/profile/rating views expose allowlisted projection only, never source identity links;
- absence of Games context fails closed.

The application role must not receive `BYPASSRLS` and must not own Games tables.

Operations that legitimately cross player rows are narrow transactional boundaries, not blanket RLS exceptions. Examples: redeem invite + create match, pair two matchmaking tickets, finalize a rated match + emit durable downstream work. These use reviewed repository transactions and, where RLS cannot express the boundary safely, narrowly scoped `SECURITY DEFINER` functions with:

- fixed/empty search path and fully qualified objects;
- no dynamic SQL;
- `REVOKE ... FROM PUBLIC`;
- only explicit `EXECUTE` granted to runtime role;
- database-state validation of invite/ticket/match/version invariants;
- no generic “system=true” flag that the normal app role can set to bypass policy.

## Cross-workspace/global matching

A global/private match between Player A in tenant A and Player B in tenant B is stored once in the Games domain:

```text
GameMatch(platform)
  ├─ participant: game_player_A
  └─ participant: game_player_B
```

There is no chosen `tenant_id` for the match. Each source identity continues to live in its existing identity/tenant structures.

Ratings are keyed by canonical `game_player_id + game_key + rating_pool/policy`, not tenant. Classroom leaderboards are projections filtered by verified class membership; they do not create a second classroom-owned rating identity.

## Privacy boundary

Games source-link tables are internal security data. Public APIs must not expose account, principal, seat, learner, tenant, school or classroom ids through the player profile.

For minors, global/profile/matchmaking visibility remains a product-policy decision for R2/R5, but the storage model must support restrictive visibility without moving identity/history into a school tenant.

Deletion/anonymization follows R0-001: source links/profile presentation may be disabled or anonymized while opaque match/rating history remains referentially valid where retention policy requires it.

## Negative/security cases

1. Player A knows Match B/C UUID: RLS/application auth returns no private match/event data.
2. Client submits another `gamePlayerId`: ignored; actor comes from authenticated Games context.
3. Client changes `tenantId`: cannot move/read a Games match because platform Games authorization does not use client tenant ownership.
4. Runtime DB role has no `app.game_player_id`: protected Games rows fail closed.
5. Setting/changing only `app.tenant_id` does not grant access to platform Games rows.
6. Player A cannot cancel Player B's ticket/invite or write B's profile.
7. Invite/matcher cross-player operation cannot accept arbitrary player ids; it must derive participants from valid persisted invite/ticket state.
8. Classroom outsider with a known match id cannot read/join a class-scoped match; membership is resolved from tenant-owned classroom authority.
9. Revoked seat/workspace relationship blocks future scoped actions but does not delete global historical match integrity.
10. Public player DTO cannot reveal source-link or tenant lineage.

## Compatibility

### Checkers

R1 private-online Checkers becomes the first consumer of platform Games persistence. Existing bot/local/classroom saves and classroom safety remain untouched. Classroom-specific Checkers can later bind a match to verified classroom scope without making the classroom tenant own the global player.

### Chess

Current Chess Live remains tenant-scoped until R4. Its forced-tenant RLS, user FKs and tenant-local matchmaking are compatibility input, not the generic Games schema. R4 uses shadow mapping/parity and additive migration; no R0 rename/rewrite of `chess_live_*` tables is authorized.

## Implementation consequences for R1

R1 may later add:

- a `games` persistence boundary;
- transaction helper for server-derived Games actor context;
- forced-RLS platform tables;
- explicit scope-binding model;
- negative DB/API tests under the runtime role.

R1 must not add Redis, a separate Games database, a synthetic tenant, public global matchmaking or Chess cutover merely to implement this decision.

## Deferred

This decision does not define canonical Match fields/state machine (`GP-R0-003/004`), team persistence (`005`), capability vocabulary (`006`), error/idempotency limits (`007`), minor eligibility (`R2`) or physical multi-database placement. Repository interfaces must keep future database extraction possible.