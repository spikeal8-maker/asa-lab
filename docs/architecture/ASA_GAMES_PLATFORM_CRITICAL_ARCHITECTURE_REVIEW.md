# ASA Games Platform — Critical Architecture Review

**Status:** Draft review / documentation only  
**Date:** 2026-09-13  
**Scope:** Games Platform, developer ecosystem, student/community games, multiplayer and publishing  
**Decision authority:** this document critiques the current draft; normative changes are captured by ADRs.

## 1. Executive conclusion

The current Games Platform documentation correctly separates cross-game Control Plane, command games, realtime gateway and room runtimes. That foundation should be preserved.

However, the current draft is still primarily an **internal game-integration architecture**. It is not yet sufficient for the stronger product goal:

> A student, teacher, ASA developer or future third-party developer can create a game outside the ASA monorepo, connect a source repository or upload a package, pass automated validation/review, and obtain platform services without being trusted with ASA internals.

To reach that goal, ASA needs a second first-class architecture layer:

```text
Game Developer Platform
├── Source connectors
├── Game Package contract
├── isolated Build Service
├── Build/Artifact Registry
├── capability review/grants
├── release channels
├── publication scopes
├── client sandbox
└── runtime admission

Games Runtime Platform
├── Games Control Plane
├── Command Runtime
├── Realtime Gateway
└── Realtime Room Runtime
```

The recommended design is **not a clone of Steam, Roblox or Discord**. It is a hybrid optimized for ASA Lab's web-first, educational and child-safety constraints.

## 2. What the current draft gets right

Preserve these decisions:

1. Cross-game features belong to Games Platform, not each game.
2. Command games and realtime-room games require different execution models.
3. Server authority is mandatory for competitive multiplayer.
4. PostgreSQL is durable truth, not a realtime physics store.
5. Matchmaking and room allocation are different responsibilities.
6. Game-specific code must not own accounts, ratings, matchmaking or platform notifications.
7. Infrastructure products remain adapters; game code must not depend on Agones/Redis/GameLift concepts.
8. Generic match/participant/outcome/history/rating/statistics contracts should be shared.
9. Mature Chess/Checkers should not be migrated until third-game certification proves the abstraction.
10. `apps/realtime-gateway` should be a transport/presence/fanout boundary, not a universal game server.

## 3. Critical gap: source code is not a game release

The largest missing boundary is the distinction between:

```text
Git repository
Game source revision
Build
Release
Runtime deployment
Publication
```

These MUST be different entities.

A GitHub repository is only a source connector. ASA must never treat:

```text
https://github.com/student/game
```

as something that can be cloned and executed directly in production.

Recommended lifecycle:

```text
SourceConnection
    ↓
SourceRevision (immutable commit SHA)
    ↓
Isolated Build
    ↓
GameBuild (immutable artifacts + provenance)
    ↓
Validation / moderation / capability review
    ↓
GameRelease
    ↓
Publication scope/channel
    ↓
Runtime deployment when required
```

This separation is analogous to SteamPipe's distinction between application identity, uploaded build/depots and the build that is selected for a live/beta branch, but ASA must add a much stronger sandbox/review boundary because its authors can be children or untrusted community developers.

## 4. Critical gap: integration kind and trust level are currently conflated

These are two independent dimensions.

### Integration kind

Describes **how the game runs**:

- `platform-native` — trusted code compiled into ASA repositories/applications;
- `sandbox-web` — client web bundle embedded in an isolated frame/origin;
- `managed-command` — command game with server-authoritative rules executed by an ASA-controlled restricted rules host;
- `isolated-room-runtime` — realtime server artifact implementing the ASA Room Runtime Protocol.

### Trust level

Describes **who is allowed to publish/run it**:

- `platform` — first-party ASA code;
- `verified` — manually reviewed developer/team;
- `classroom` — teacher-approved student/community content;
- `private-draft` — author/playtest only.

A student game can therefore be `sandbox-web + classroom`, while ASA Checkers can be `platform-native + platform`.

Do not encode trust as runtime type.

## 5. Recommended external platform model

### 5.1 Steamworks — useful for developer/release semantics, not sandboxing

Steamworks demonstrates several valuable platform concepts:

- stable application identity (`AppID`);
- SDK access to common platform services;
- content builds separated from source;
- immutable build/manifests;
- public/private beta branches;
- explicit promotion/rollback of builds.

Official references:

- https://partner.steamgames.com/doc/sdk/uploading
- https://partner.steamgames.com/doc/features/multiplayer/matchmaking

ASA should borrow these **release and service-integration concepts**, not Steam's trust model for arbitrary native applications.

### 5.2 Discord Activities — closest client embedding pattern

Discord Activities are web applications hosted in an iframe and communicate with the parent platform through an Embedded App SDK / `postMessage` protocol.

Official references:

- https://docs.discord.com/developers/activities/overview
- https://docs.discord.com/developers/activities/how-activities-work

This is a strong model for ASA student/community web games:

```text
ASA shell
  ↓
sandboxed cross-origin iframe
  ↓
ASA Game Client SDK bridge
```

The game should not receive the ASA session cookie or direct DOM access to the host application.

### 5.3 Roblox — closest UGC/publishing trust model

Roblox provides a controlled creation/runtime ecosystem, private-by-default publication, collaborator roles/permissions, version history and scoped Open Cloud credentials.

Official references:

- https://create.roblox.com/docs/production/publishing/publish-games-and-places
- https://create.roblox.com/docs/cloud/auth/api-keys
- https://create.roblox.com/docs/scripting/security/client-server-boundary

ASA should borrow:

- private-by-default student content;
- explicit playtest/publish permissions;
- capability/scoped credentials;
- server-side validation of client actions;
- managed versions rather than executing arbitrary source directly.

### 5.4 GameLift / Agones / Colyseus — runtime patterns, not developer contracts

Use as references for authoritative room infrastructure:

- FlexMatch separates matchmaking from session placement;
- Agones allocates ready dedicated game servers;
- Colyseus keeps authoritative Room state on the server and synchronizes client views.

Official references:

- https://docs.aws.amazon.com/gameliftservers/latest/flexmatchguide/gamelift-match-howitworks.html
- https://agones.dev/site/docs/reference/gameserverallocation/
- https://docs.colyseus.io/state

These concepts belong behind ASA runtime ports and MUST NOT appear in a student game manifest as provider-specific resources.

## 6. Recommended target model: hybrid Steam + Discord + Roblox

The best fit for ASA is:

```text
Steam-like
  Game identity / builds / releases / channels

Discord-like
  embedded cross-origin web client + versioned SDK bridge

Roblox-like
  managed trust / private-by-default / creator permissions / controlled runtime

ASA-specific
  classroom identity / child safety / educational scopes / self-hosting
```

This avoids two bad extremes:

1. **Too open (Steam-like native execution):** unsafe for student uploads.
2. **Too closed (Roblox-only engine):** would force every ASA game into one proprietary editor/runtime and prevent Phaser/Three.js/Godot/headless/custom engines.

## 7. Recommended canonical entities

### GameDefinition

Stable product identity.

```text
id
game_key
owner_principal/team
name
summary
status
created_at
```

It survives every code/build update.

### GameSourceConnection

Optional source integration.

```text
id
game_id
provider = github | upload | asa_creator
repository/resource locator
installation/reference metadata
tracked branch/tag policy
```

No production credential is exposed to the game.

### GameBuild

Immutable output from one exact source revision.

```text
id
game_id
source_revision
manifest_digest
client_artifact_digest
server_artifact_digest optional
sbom_digest
provenance/attestation
build_status
created_at
```

A failed build is never a release.

### GameRelease

Approved build + compatibility/capability contract.

```text
id
game_id
build_id
release_version
sdk_protocol_version
runtime_protocol_version
state/rules versions
release_status
approved_by
approved_at
```

### GameReleaseChannel

Points a named channel to a release.

```text
private
classroom
preview
beta
stable
event-<id>
```

Promotion/rollback changes a channel pointer; it does not mutate an old build.

### GamePublication

Controls discoverability/audience separately from release.

Examples:

```text
author-only
specific-classroom
workspace/school
ASA community
featured
event campaign
```

### GameCapabilityGrant

Manifest can **request** capabilities. Platform policy **grants** them.

Never treat manifest declaration as permission.

Example:

```text
requested: storage.private, multiplayer.invites, externalNetwork

granted: storage.private, multiplayer.invites

denied: externalNetwork
```

## 8. Critical security decision: student source is hostile input

Any GitHub/ZIP/student package MUST be treated as potentially malicious even when the student is trusted personally.

Threats include accidental or intentional:

- dependency scripts;
- filesystem access;
- network exfiltration;
- infinite CPU/memory use;
- fork bombs/subprocesses;
- attempts to access environment variables;
- malicious HTML/JS;
- service workers;
- browser top-navigation/popups;
- API abuse;
- credential theft.

Therefore the Build Service is a sandbox boundary, not a normal CI job.

## 9. Build pipeline recommendation

```text
GitHub App / ZIP / ASA Creator
        ↓
source snapshot pinned by SHA/digest
        ↓
Ephemeral isolated builder
        ↓
manifest validation
SDK compatibility
build/tests
license inventory
SBOM
vulnerability/static checks
artifact size/resource policy
        ↓
immutable artifacts
        ↓
content digest + provenance
        ↓
GameBuild Registry
```

Build worker rules:

- no production secrets;
- no Docker socket;
- no ASA DB connection;
- non-root;
- CPU/memory/PID/time/output quotas;
- ephemeral filesystem;
- network denied by default or routed only through controlled dependency proxies;
- build result copied out only from declared artifact paths;
- package scripts are assumed hostile, not trusted;
- builder destroyed after build.

GitHub integration SHOULD use a GitHub App with minimum repository permissions, not personal access tokens. GitHub's own guidance is to grant only required app permissions.

Reference: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app

## 10. Supply-chain provenance

Each published build SHOULD record:

```text
source provider
repository
commit SHA
builder version
SDK version
manifest digest
artifact digests
SBOM
scan status
review status
```

For higher-trust server artifacts, sign/attest artifacts.

Possible implementations:

- GitHub artifact attestations for supported source/build contexts;
- Sigstore/Cosign for OCI images and blobs.

References:

- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.sigstore.dev/cosign/signing/signing_with_containers/

Provenance proves where/how an artifact was built; it does not prove the artifact is safe, so policy/scanning/review remain required.

## 11. Client sandbox recommendation

Untrusted/community client bundles MUST NOT execute inside the same trusted React tree as ASA Web.

Use:

```text
ASA Games Shell
    ↓
cross-origin iframe
    ↓
ASA Game Client SDK
```

Minimum controls:

- separate origin from authenticated ASA application;
- iframe `sandbox` with minimal flags;
- CSP and Permissions Policy;
- no ASA cookies/session storage;
- no access to parent DOM;
- exact `postMessage` origin/source validation;
- bounded/versioned RPC schema;
- external network disabled by default;
- storage provided through platform SDK where practical;
- camera/microphone/geolocation/fullscreen explicitly capability-gated.

MDN warns that same-origin frames combining `allow-scripts` and `allow-same-origin` can defeat the value of sandboxing. Untrusted content should be served from a separate origin.

References:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html

## 12. Client SDK boundary

Community game sees stable platform APIs, not internal ASA services.

Illustrative API families:

```text
asa.player.publicProfile
asa.ui.invites
asa.party
asa.match
asa.storage.private
asa.achievements
asa.history
asa.notifications
asa.runtime.connect
asa.telemetry.clientError
```

It MUST NOT expose:

```text
raw account/session
email
learner_identity
workspace DB IDs
PostgreSQL
NestJS services
internal classroom tables
rating mutation
authoritative result mutation
```

High-risk operations use short-lived scoped capability tokens or host-mediated RPC.

## 13. Server-side community code needs a stricter boundary

Arbitrary student Node/Java/Python server code MUST NOT be loaded inside the ASA API process.

Recommended tiers:

### Private/client-only web games

No custom server code. Safest and easiest creator path.

### Managed command games

Server rules execute in a restricted ASA-managed rules host.

Long-term candidate mechanisms:

- WebAssembly/WASI component;
- tightly restricted script isolate;
- microVM execution for heavier adapters.

WASI's capability model is attractive because modules start without ambient authority and receive only explicitly granted host capabilities.

References:

- https://wasi.dev/
- https://webassembly.org/docs/security/

Do not commit to one implementation until a GP prototype benchmarks developer ergonomics and resource isolation.

### Realtime room server packages

Custom OCI/runtime images are allowed only for higher-trust `platform` or `verified` developers in the first versions.

They run:

- outside API/realtime-gateway processes;
- without platform DB credentials;
- without ASA cookies/secrets;
- non-root;
- with egress deny/restrictions;
- CPU/memory/PID/time quotas;
- via versioned ASA Room Runtime Protocol.

`classroom` student games SHOULD NOT receive arbitrary server-container execution by default.

## 14. Critical integrity rule for scores and ratings

Client-only/sandbox-web games cannot produce trusted competitive outcomes merely by calling:

```text
submitScore(999999)
```

Therefore classify results:

```text
personal/unverified
platform-authoritative
```

Only authoritative command/runtime results may affect:

- rated pools;
- competitive leaderboards;
- public win/loss records where integrity is expected;
- tournament advancement.

Client-only games may have personal progress, classroom experimentation or explicitly labelled unverified scoreboards.

## 15. Publishing workflow recommendation

A Git push MUST NOT mean production publication.

Recommended flow:

```text
source changed
  ↓
automatic candidate build
  ↓
automated validation
  ↓
preview/playtest
  ↓
manual/teacher/admin review depending scope
  ↓
release approved
  ↓
channel promotion
```

Scopes:

- author-only: automatic after safe build;
- classroom: teacher approval;
- workspace/school: organization policy/moderator;
- community: ASA moderation;
- featured/rated: additional game certification.

Rollback changes the channel pointer to an earlier release.

## 16. GitHub connection recommendation

GitHub is one **source provider**, not part of the game runtime contract.

Use a GitHub App:

- install on selected repositories;
- minimum required permissions (`Metadata: read`, `Contents: read`; webhook access as needed);
- no workflow-write/admin permission by default;
- validate webhook signatures;
- pin source revision by commit SHA;
- exchange installation credentials only inside Source Importer;
- builder receives source snapshot, not GitHub credentials.

Later source providers can include:

```text
ZIP upload
ASA Creator workspace
GitLab
school repository
```

without changing `GameBuild`/`GameRelease` semantics.

## 17. Recommended logical architecture

```text
                     ASA DEVELOPER PLATFORM

 GitHub / ZIP / ASA Creator
           │
           ▼
    Source Connector
           │
           ▼
   Isolated Build Service
           │
           ├── manifest validation
           ├── SDK conformance
           ├── tests/scans/SBOM
           └── artifact provenance
           │
           ▼
      Game Build Registry
           │
     Review / Capability Grants
           │
           ▼
       Game Releases
           │
  channels + publication scopes
           │
           ├─────────────────────────────┐
           ▼                             ▼
  Sandboxed Web Client           Runtime Admission
           │                             │
           ▼                    ┌────────┴────────┐
     ASA Games Shell            │                 │
                         Command Rules Host  Room Runtime Pool
                                │                 │
                                └────────┬────────┘
                                         ▼
                               Games Control Plane
                               Match/Stats/Rating/etc.
```

## 18. What NOT to build

Reject these designs:

### `git clone && npm install && npm start` in production

Unsafe and unreproducible.

### One privileged container per arbitrary student repository

Operationally expensive and unsafe.

### Put student JavaScript into ASA Web bundle

Destroys trust separation.

### Give each game ASA API credentials

Creates an uncontrolled internal API ecosystem and leaks platform structure.

### Let manifest permissions self-authorize

Manifest expresses requested capabilities; policy grants them.

### One giant Game SDK that imports NestJS/Postgres/WebSocket implementation

SDK must be protocol/domain contracts, not infrastructure internals.

### Make GitHub mandatory

GitHub is a connector. The platform package/release model must survive other source providers.

### Let client-only games update rated stats

Competitive integrity becomes meaningless.

### Auto-publish every push

Build automation and production release are different authorities.

## 19. Revised architecture priorities

Before further online Checkers work, documentation should add and accept:

1. `ADR-GAME-002` — Game Package, Build, Release, Capability and Trust boundaries.
2. Game Package manifest specification.
3. Client SDK bridge protocol.
4. Build sandbox/security specification.
5. Publication/moderation workflow.
6. Source connector contract (GitHub first).
7. Managed command rules-host feasibility spike.
8. Realtime runtime admission policy.

Only after these are accepted should the system implement a public `Add Game` admin/developer workflow.

## 20. Final assessment

The existing Games Platform draft is a strong multiplayer/runtime foundation but incomplete as a creator ecosystem.

The best ASA structure is **not “Steam inside ASA”**. It is:

> a Steam-like immutable release/catalog model + a Discord-like embedded web SDK + a Roblox-like controlled UGC trust model + ASA-owned authoritative multiplayer/runtime contracts.

This combination preserves ASA's ability to host many technologies while preventing student/community code from becoming trusted platform code.