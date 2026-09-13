# ADR-GAME-002: Game packages, publishing and trust boundaries

**Status:** Proposed  
**Date:** 2026-09-13  
**Scope:** developer ecosystem, student/community games, builds, publication and runtime trust

## Context

ADR-GAME-001 defines the multiplayer/runtime boundaries of ASA Games Platform. That is sufficient for first-party games, but not for the stronger creator goal:

> ASA can ingest a game from GitHub/upload/ASA Creator without making that game part of the trusted ASA codebase.

The platform may host code written by students, teachers, ASA developers and later third parties. Source can be buggy or malicious. A repository URL is therefore not an executable trust grant.

External platform research shows complementary patterns:

- Steam separates application identity, build artifacts and release branches;
- Discord Activities embed web apps in an iframe and communicate through a versioned SDK/RPC bridge;
- Roblox keeps new experiences private by default and uses scoped creator/publication permissions;
- GitHub Apps support least-privilege repository access and webhook integration;
- WebAssembly/WASI offers capability-oriented sandbox primitives for future managed rules execution;
- dedicated server products separate matchmaking from server allocation and runtime execution.

## Decision

### 1. Source, build, release and publication are separate entities

ASA defines the following lifecycle:

```text
GameDefinition
    ↓
GameSourceConnection (optional)
    ↓
SourceRevision
    ↓
GameBuild
    ↓
Validation/Review/CapabilityGrant
    ↓
GameRelease
    ↓
GameReleaseChannel
    ↓
GamePublication
```

A source push can trigger a candidate build but MUST NOT automatically become a public release.

### 2. GameDefinition is stable identity

It owns product identity independent of version/build.

Required properties include:

```text
id
game_key stable unique key
owner principal/team
name
description/status
created_at
```

Changing source repository or build technology does not change `game_id`.

### 3. GameSourceConnection is replaceable

Initial provider is GitHub, but provider is not part of runtime contracts.

Potential providers:

```text
github
zip_upload
asa_creator
gitlab
school_repository
```

GitHub integration uses a GitHub App with minimum required permissions. Personal access tokens MUST NOT be a normal publishing mechanism.

### 4. GameBuild is immutable

A build pins exact source and build provenance.

Conceptual fields:

```text
id
game_id
source_provider
source_revision
manifest_digest
client_artifact_digest nullable
rules_artifact_digest nullable
server_artifact_digest nullable
sbom_digest nullable
provenance_ref nullable
builder_version
sdk_version
status
created_at
```

Once successful, artifact bytes/digests do not change.

### 5. GameRelease points to one build

Release adds semantic compatibility metadata and approval state.

```text
id
game_id
build_id
release_version
game_sdk_protocol
client_bridge_protocol
runtime_protocol nullable
rules_version nullable
state_schema_version nullable
review_status
approved_by nullable
approved_at nullable
```

### 6. Release channel is a mutable pointer, not a mutable build

Initial channel set:

```text
private
preview
classroom
beta
stable
```

Event/campaign channels may be added.

Rollback changes a channel to an older approved release.

### 7. Publication scope is distinct from channel

Channel answers **which release** is used. Publication answers **who can discover/use the game**.

Scopes include:

```text
author-only
specific-classroom
workspace/school
ASA-community
featured
event/campaign
```

A classroom release can exist without being publicly discoverable.

### 8. Manifest requests capabilities; policy grants capabilities

A game manifest is not an authorization document.

Example requests:

```text
player.public_profile.read
storage.private
match.invites
match.quick
match.rated
runtime.websocket
input.pointer_lock
ui.fullscreen
network.external
```

Platform policy records actual `GameCapabilityGrant` per release/scope.

High-risk capabilities require stronger trust/review.

### 9. Integration kind and trust level are orthogonal

Integration kinds:

```text
platform-native
sandbox-web
managed-command
isolated-room-runtime
```

Trust levels:

```text
platform
verified
classroom
private-draft
```

Example combinations:

```text
ASA Checkers      platform-native + platform
student puzzle    sandbox-web + classroom
verified arena    isolated-room-runtime + verified
student prototype sandbox-web + private-draft
```

Trust level does not silently change runtime kind.

### 10. Default creator path is sandbox-web

Student/community games first target a client web artifact embedded in a sandboxed cross-origin frame.

Properties:

- no ASA session cookie;
- no parent DOM access;
- no direct platform DB/API internals;
- SDK calls through versioned bridge/scoped endpoints;
- separate origin;
- CSP/Permissions Policy;
- requested/granted capabilities;
- bounded storage/network.

### 11. Community server code is not loaded into API

Arbitrary third-party/student server code MUST NOT execute inside:

- `apps/api`;
- `apps/realtime-gateway`;
- DB migration process;
- trusted web build.

Managed command games use an ASA-controlled restricted rules host when/if that capability is implemented.

Custom realtime OCI/server runtimes are initially limited to `platform`/`verified` trust and run in isolated runtime infrastructure without ASA DB credentials.

### 12. Build execution is an untrusted-code boundary

Builder MUST assume repository build steps are hostile.

Requirements:

- ephemeral isolation;
- no production secrets;
- no host Docker socket;
- no ASA database connectivity;
- non-root;
- resource/time/PID/output limits;
- controlled/disabled network;
- artifact output allowlist;
- destruction after build;
- audit metadata/provenance.

Implementation technology may be container sandbox, microVM or stronger isolation; the contract does not depend on provider.

### 13. Published artifacts are content-addressed and attestable

Each artifact has cryptographic digest. Server images/artifacts SHOULD support signatures/attestations.

A build record stores source revision, builder identity/version and resulting digests.

### 14. Client sandbox uses a dedicated origin

Untrusted client content MUST NOT be served as same-origin authenticated ASA Web content.

Use dedicated game-content origin strategy and sandboxed iframe.

Host/game communication uses a versioned protocol modeled on explicit RPC/events (`postMessage` or an equivalent transport). Receiver validates origin/source and message schema.

### 15. Competitive integrity is trust-sensitive

Only server-authoritative outcomes may affect:

- rated pools;
- verified public competitive leaderboards;
- tournament advancement;
- trusted W/L/D records.

Client-only games can write personal progress and explicitly labelled unverified/classroom scores according to policy.

### 16. Publication is private by default

New game/release default is author-only/private.

Promotion requires policy appropriate to scope:

```text
author-only        automated safe-build gate
classroom          teacher/moderator approval
workspace/school   workspace policy/admin
ASA community      platform moderation
featured/rated     full game certification
```

### 17. Source connector and builder credentials are separated

GitHub App installation token is used only by Source Importer to obtain the pinned source revision.

Builder receives a source snapshot, not GitHub credentials.

Game runtime receives neither source credentials nor build-system credentials.

### 18. Developer SDK is split by boundary

Do not create one privileged SDK.

Define at least:

```text
ASA Game Client SDK      // embedded game ↔ platform shell/services
ASA Game Package SDK     // manifest/build tooling/schema
ASA Command Rules SDK    // managed command adapter contracts
ASA Room Runtime SDK     // isolated realtime runtime protocol
ASA Game Testing SDK     // local simulator/conformance fixtures
```

These may ship under one package family, but capability/security boundaries remain separate.

## Rejected alternatives

### Treat repository as deployable application

Rejected: unreproducible and unsafe.

### Run arbitrary student Docker images automatically

Rejected: unacceptable infrastructure/security boundary for first versions.

### Force every game into one ASA-specific engine

Rejected: would simplify sandboxing but block web/game-engine diversity and future third-party integration.

### Allow all game code to live directly in the monorepo

Rejected as the only model. It remains valid for first-party platform games but cannot support a creator ecosystem.

### Give manifest self-authorizing permissions

Rejected: untrusted package cannot grant itself access.

### Let GitHub push publish directly to public stable

Rejected: source automation and publication authority are different concerns.

## Consequences

Positive:

- safe path for student/community games;
- reproducible releases and rollback;
- source-provider independence;
- creator workflow can evolve independently from runtime infrastructure;
- future Steam-like developer portal is possible;
- first-party and external games can use the same product services without same trust level.

Costs:

- Build Service and artifact registry are now first-class platform work;
- publication/moderation workflow is required;
- client bridge needs explicit versioning;
- server-side community game support requires sandbox/runtime research;
- game package compatibility must be tested continuously.

## Acceptance conditions

ADR may become `Accepted` only when:

1. Game Package spec exists with schema/versioning rules.
2. Client sandbox/origin strategy is security-reviewed.
3. GitHub source connector permissions are defined.
4. Build sandbox threat model is accepted.
5. Capability request vs grant semantics are explicit.
6. Publication scopes/approvals are product-approved.
7. Competitive outcome integrity policy is accepted.
8. A simple sandbox-web sample can be built and launched without ASA credentials.
9. A candidate release can be rolled back by channel pointer without rebuilding.
10. No implementation requires changes to `main` before ADR review approval.
