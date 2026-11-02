# Chess network — owner-selected delivery contract

This contract defines one casual Chess vertical requested by the owner on 2026-11-01. Live status, selected task and SHA belong only to current.yaml.

## User result

A teacher controls whether pupils may play games, separately enables network play and selects opponents from the same class, school or the whole platform. Two independently authenticated users can create/accept an invitation, complete a real server-authoritative Chess game, reconnect and reopen its history.

This owner selection changes delivery priority for this vertical. It does not claim completion of Checkers R1–R3 or general Chess R4 migration. Accepted Games R0 identity, storage, lifecycle and error contracts remain mandatory.

## Authorization

- Preserve existing offline allow/deny/rating-threshold and individual overrides. Denied game access never becomes a network entitlement.
- Separate network permission, default off for pupils, with classroom/school/platform opponent scope. Teachers manage only classes they actually administer; students cannot write policy.
- Owner explicitly confirmed that network restrictions also apply to a verified linked personal Account. Derive all active verified pupil links server-side and require every applicable pupil policy to permit the opponent; a cookie/workspace switch cannot bypass a teacher restriction. Unlinked adult Accounts retain ordinary platform access. Existing Account-only offline behavior is unchanged.
- Derive Account/StudentSeat, verified account links, school and class membership from authenticated server state. Preserve invalid/revoked/conflicting cookie semantics; no Account fallback that bypasses pupil policy.
- Authorize BOTH players at invite redemption and each active operation using current membership and policy. Matching one party's wider scope is insufficient.
- Membership/policy revocation stops network actions for both players, aborting a live casual match without inventing a victory. Durable history remains intact.
- Global play exposes only opaque game-player ids and public-safe aliases; no school roster or internal identity identifiers.

## Architecture

Use a dedicated platform-owned Games boundary in the existing PostgreSQL and migration stream, as GP-R0-001/002 require. No participant tenant owns the match; no synthetic tenant and no weakening of existing education RLS/Auth. New private Games tables use forced RLS and narrow reviewed transactions. Existing Chess Live APIs remain a compatibility boundary and their StudentSeat prohibition is not removed.

Reuse the Chess rules engine. Owner additionally requested scoped online discovery and avatars on 2026-11-02. Owner requested portal-wide invitation delivery on 2026-11-02. A visible authenticated portal heartbeat publishes only currently network-eligible players, using public-safe game aliases and scoped avatar delivery. Teacher network-off prevents presence publication and invitation delivery. Recipient-bound invitations are accepted or declined explicitly; possession of a leaked directed code grants no third party access. No whole-platform education roster, rated matchmaking, ratings or Checkers migration. Persist canonical Match dimensions, players/participants, required team storage (zero teams for duel), immutable commands/events and atomic result/outbox finalization. Retries must not duplicate invites, moves or results. Use pinned game/schema/rules versions and optimistic concurrency.

The UI supports invite creation/cancellation/expiry/acceptance, board play with authoritative clocks, resignation/draw/rules outcome, reconnect/resume and history. Polling is bounded and cannot revert newer state. Preserve the calibrated board and ASA editor header.

## Evidence and acceptance

Use the same focused and browser scripts locally and in CI. Extend Chess R1 gates narrowly to include network tests; keep PostgreSQL-backed tests distinct from embedded fixtures. Owner evidence uses NX_SKIP_NX_CACHE=true and reports executed Nx tasks.

Required negative evidence: foreign teacher write, student policy write, cross-class/school restriction in both directions, wider/narrower policy pair, denied offline access, stale/revoked/conflicting session, policy/membership revocation during a game, nonparticipant access, forged identity/FEN/result/clock, concurrent accept/move, idempotent replay and durable finalization.

Real isolated PostgreSQL/Chromium CI must demonstrate two independent sessions playing a legal sequence to a durable result, reconnect/reload and matching history. It must also prove teacher off/network-off and all three opponent scopes using separate class/school fixtures. Embedded DB or mocked fetch is supplementary evidence.

UI review covers 1440/1024/390/320 and empty/loading/error/long-content states. NEW independent L3 review of the final exact SHA is required before integration. Green CI is not owner acceptance.

No local Docker/runtime or working database, deployment, backup, restore, ports/origins or host network change is authorized by this slice. CI creates only isolated disposable test data and stacks.

## Scoped lobby and avatars

An authenticated visible portal publishes transient Chess presence when current teacher policy permits network play, expiring after 45 seconds without a heartbeat. The private notification endpoint projects only recipient invitation ids/expiry, without discovering opponents. The common Games navigation and Chess card show pending counts; a finite pulse and one quiet 190ms descending sine cue announce a new invitation. Delivery ids persist locally per canonical game player to prevent replay on polling/navigation/reload, with Web Locks serializing tabs. Audio requires a browser user gesture; blocked sound is not queued. Hidden/offline pages do not poll, and revoked/expired/accepted/declined invitations disappear on the next bounded refresh. Both current policies and source grant marks filter every listing, avatar read, targeted challenge and acceptance. Class/school circles use existing verified affiliations; linked personal Accounts preserve pupil limits. No unrelated school roster or internal identity ids are returned. Only the existing game-player id, game alias and an authenticated avatar URL leave the service. The selected source profile picture is resolved server-side; raster uploads are served privately without caching, built-in avatar choices redirect to the existing ASA assets. Profile revision changes refresh the image URL.

A challenge has one canonical recipient. Incoming/outgoing projections are private. A recipient can decline with idempotency and version checks. Targeted acceptance is serialized on both canonical players and rejects a busy participant; existing undirected invitation compatibility remains intact. A pupil policy OFF/ON invalidates pending directed grants, while completed match history remains unchanged.

`pnpm gate:chess-r1` remains the source/type/build gate. The scoped lobby evidence command is `pnpm gate:chess-lobby:browser`: forced-RLS real PostgreSQL contracts followed by the two-pupil browser journey (scoped discovery, selected avatar delivery, direct challenge/acceptance, moves, reload, a terminal result and teacher controls). The Chess R1 workflow accepts `lobby_only` for this bounded evidence; the default full browser gate is unchanged. Passing the scoped gate does not claim acceptance of unrelated offline/module-loading journeys or a release candidate.
