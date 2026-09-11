# ASA Lab Visual Programming — Scratch integration master specification

**Document:** Master Technical Specification / implementation contract  
**Version:** 2.0  
**Date:** 10 September 2026  
**Product:** ASA Lab  
**Module key:** `blocks`  
**Product name:** `Визуальное программирование`  
**Architecture decision:** [`ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md`](../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md)

---

## 0. Status: design convergence is required before implementation

This document is the normative TARGET, dependency order and safety contract for the
Scratch-compatible Visual Programming capability of ASA Lab.

It is **not** a declaration of the active task, branch, PR, checkpoint, SHA, CI result,
deployment or owner acceptance. Current execution state belongs only to
[`docs/execution/current.yaml`](../execution/current.yaml) plus an explicit owner
instruction, according to `AGENTS.md`.

Version 2.0 corrects a material defect in v1.1: the old document was strong enough to
protect the broad architecture, but it still forced a coding agent to invent decisions at
critical boundaries. Therefore **VSCR-D0 design convergence is now an explicit mandatory
gate**. M1 coding MUST NOT begin merely because an M1 task is described below.

### 0.1 Hierarchy of truth

| Question | Source of truth |
| --- | --- |
| What Visual Programming must ultimately do | this master specification |
| Why the integration boundary exists | `ADR-VSCR-001` |
| Exact D0 design for one boundary | the matching `VSCR-D0-00X` contract |
| What task is authorised now | `docs/execution/current.yaml` + explicit owner instruction |
| What actually exists | repository code + migrations + configuration |
| What API actually exists | code + `schemas/openapi.yaml` |
| What actually works | exact-SHA non-skipped CI/integration/browser evidence |
| What Scratch upstream is used | `infra/scratch-editor/upstream.env` |
| What was accepted | explicit owner acceptance |

### 0.2 D0 implementation-contract set

Before an implementation task touches the corresponding boundary, the agent MUST read the
matching contract:

```text
docs/product/visual-programming/
├── VSCR-D0-001-SCRATCH-HOST-CONTRACT.md
├── VSCR-D0-002-PERSISTENCE-CONTRACT.md
├── VSCR-D0-003-ASSET-STORAGE-CONTRACT.md
├── VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md
└── VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md
```

These D0 files are design contracts, not current-task state and not permission to execute
the roadmap automatically.

### 0.3 Normative words

- **MUST / ОБЯЗАН** — mandatory.
- **MUST NOT / ЗАПРЕЩЕНО** — forbidden.
- **SHOULD / СЛЕДУЕТ** — expected unless a reviewed change records a concrete reason.
- **MAY / МОЖЕТ** — optional.
- **STOP** — do not continue coding until the design/owner/governance condition is
  resolved.

---

# 1. Product goal

ASA Lab MUST provide a self-hostable visual-programming environment using the Scratch 3
editor/runtime model without depending on `scratch.mit.edu` for the supported school
baseline.

Primary learner journey:

```text
create Visual Programming project in ASA Lab
→ open editor
→ edit blocks, sprites, costumes and sounds
→ run
→ durable autosave to ASA Lab
→ close/reload/reopen
→ receive the same project
→ checkpoint/version
→ submit/publish/remix/export .sb3 when applicable
```

The governing product rule is:

> **Durability + recoverability + self-hosted baseline before public activation.**

`blocks` MUST remain non-creatable for ordinary users until the final activation gate.

---

# 2. Stable architecture

```text
ASA Lab Web
│
├── auth / project / classroom / learning / gallery shell
│
└── separate-origin iframe
     ↓
ASA Scratch host container
     ├── pinned Scratch GUI standalone distribution
     ├── Scratch VM / renderer / paint / sound
     ├── ASA runtime bootstrap
     ├── ASA Scratch storage adapter
     └── ASA save/recovery orchestrator
          │
          │ short-lived project/version capability
          ↓
ASA Blocks Runtime API
     ├── Project Core use cases
     ├── Blocks persistence guard
     ├── tenant-scoped asset metadata
     ├── private S3-compatible blob store
     └── existing Project Snapshot subsystem
```

Scratch owns the editing/runtime mechanics. ASA owns identity, authorisation, projects,
drafts, immutable versions, classrooms, submissions, publication, remix provenance,
asset durability, backups and deployment.

There MUST NOT be a second Scratch account system, classroom system, project database,
LMS, social backend or gradebook.

---

# 3. Hard safety invariants

These rules apply to every VSCR task.

1. The module key remains `blocks`; do not create a parallel `scratch` module.
2. User-facing branding is `Визуальное программирование`; Scratch compatibility is a
   factual compatibility statement, not official-product branding.
3. Scratch upstream remains pinned by exact commit in `infra/scratch-editor/upstream.env`.
4. Scratch GUI/VM dependencies remain outside the main ASA Web bundle.
5. M1+ runtime MUST NOT serve the upstream playground/debug application as the ASA
   product host. The M0 playground image is only build/health evidence.
6. `projectJson` belongs in Project Core JSON persistence; binary asset bytes and full
   `.sb3` archives do not.
7. `.sb3` is import/export interchange, not autosave persistence.
8. Subject code belongs under `contexts/blocks/**` under the current repository
   architecture.
9. Core contexts MUST NOT import Scratch GUI/VM packages merely to make integration easy.
10. Project Core optimistic revision/version/checkpoint semantics remain canonical.
11. No silent last-write-wins on a revision conflict.
12. Browser/runtime input is untrusted, including asset metadata supplied by the runtime.
13. A runtime credential is not an ASA account session and never grants generic API
    authority.
14. Viewer and editor authority are distinct server-enforced capabilities.
15. Scratch compatibility identity (`assetId`, `md5ext`) and ASA integrity (`sha256`) are
    distinct.
16. Physical object-store locator (`objectKey`, bucket, provider) MUST NOT be persisted in
    `BlocksProjectDocumentV1`.
17. No binary GC before reference-safe design proves historical versions cannot break.
18. Object storage failure MUST degrade Blocks, not take down unrelated ASA modules.
19. No rights-unclear Scratch media/brand mirroring.
20. Public activation MUST occur only after durability, backup/restore and sovereign
    network-deny acceptance.
21. No bot advances automatically to the next VSCR task.
22. No deployment, service restart or live restore is implied by a product/spec task.

---

# 4. Agent execution protocol

Before changing code for any VSCR task, the coding agent MUST:

```text
1. read AGENTS.md
2. read START_HERE_FOR_AI.md
3. obtain the authorised lane/task from the normal current.yaml context flow
4. read this master spec §0–§4 and the selected task section
5. read ADR-VSCR-001
6. read every D0 contract named by the selected task
7. inspect the exact current code to be changed
8. state expected changed paths before editing
9. implement only the authorised slice
10. run the focused gate and required repository gates
11. report SHA, CI, deployment and owner acceptance separately
```

A bot MUST STOP rather than invent a new architecture when the selected task contradicts a
D0 contract.

### 4.1 Default writable scope

The smallest expected scope is drawn from:

```text
contexts/blocks/**
apps/api/src/blocks-*.ts
apps/api/src/app.factory.ts             # security/path hook task only
apps/api/src/app.module.ts              # composition task only
apps/api/src/module-registry.ts
apps/web/src/blocks/**
apps/web/src/pages/*Blocks*.tsx
infra/scratch-editor/**
schemas/openapi.yaml
migrations/*blocks*.sql
tests/blocks/**
e2e/blocks-*.spec.ts
compose*.yaml                           # authorised infrastructure task only
.env*.example                           # names/defaults only; no secrets
docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md
docs/product/visual-programming/**
docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md
```

Cross-cutting additions to `contexts/projects/**` are permitted only by the persistence
contract and only as generic additive Project Core ports/use-case wiring. Blocks-specific
code MUST NOT enter Project Core.

### 4.2 Protected neighbouring areas

Do not opportunistically modify:

```text
contexts/electronics/**
contexts/chess/**
contexts/checkers/**
contexts/three-d/**
identity model / tenant semantics
Learning canonical workflow state
existing project version semantics
owner-supplied electronics/media assets
```

### 4.3 STOP conditions

STOP if the implementation unexpectedly requires:

- destructive migration or tenant/RLS redesign;
- replacing Project Core revisions/checkpoints;
- copying `scratch-www`;
- moving Scratch GUI/VM into the ASA Web dependency graph;
- weakening the normal ASA origin policy globally;
- adding Scratch runtime origin to generic cookie-authenticated mutation trust;
- storing object-store credentials or runtime tokens in Git/browser persistent auth
  storage;
- accepting a draft that references an unverified blob;
- enabling `blocks` before the activation gate;
- deleting blobs to “clean up” a failed save;
- bypassing/skipping a gate and calling it PASS;
- deployment/restart/live restore without explicit owner authorisation.

---

# 5. Repository placement

Target bounded context:

```text
contexts/blocks/
├── domain/
│   ├── document.ts
│   ├── asset.ts
│   └── validation.ts
├── application/
│   ├── ports.ts
│   ├── project-document.ts
│   ├── import-sb3.ts
│   └── export-sb3.ts
├── infrastructure/
├── testing/
├── index.ts
├── module.ts
├── package.json
├── project.json
└── tsconfig.json
```

The package name MUST be `@asa-lab/blocks` and follow the current context package
convention. Public imports enter through `contexts/blocks/index.ts`.

`apps/api` owns transport/composition. `apps/web` owns ASA chrome. The separate runtime
host remains in `infra/scratch-editor` and does not become a second source of project
truth.

---

# 6. Canonical project document v1

Before durable Blocks data exists, M0 contract correction MUST remove the physical
`objectKey` field from the persistent document.

```ts
interface BlocksProjectDocumentV1 {
  schemaVersion: 1;
  format: 'scratch-3';
  projectJson: Record<string, unknown> | null;
  assets: BlocksAssetReferenceV1[];
}

interface BlocksAssetReferenceV1 {
  assetId: string;
  dataFormat: 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';
  sha256: string;
  sizeBytes: number;
}
```

`projectJson: null` is valid only for an ASA project whose Scratch VM has not yet produced
the first saved Scratch project state.

### 6.1 Identity rules

For supported Scratch 3 costumes/sounds:

```text
assetId     = Scratch compatibility ID; v1 requires lowercase 32-hex MD5
md5ext      = `${assetId}.${dataFormat}` when present in projectJson
sha256      = ASA server-computed integrity digest of exact bytes
objectKey   = server-only physical locator, never in project document
```

For initial v1 imports/uploads the server MUST verify `MD5(bytes) == assetId`. A fixture
that proves official/pinned compatibility requires an exception is a design change, not a
reason for a bot to silently weaken this rule.

For every referenced costume/sound in `projectJson`, `assets[]` contains exactly one
matching `(assetId, dataFormat)` canonical reference. Missing, duplicate or digest/size
inconsistency fails closed.

`assets[]` contains only current-document references. Historical versions retain their own
immutable reference lists.

---

# 7. Scratch host contract summary

The detailed contract is `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md`.

M1+ MUST build the pinned upstream shipping standalone distribution and wrap it with an
ASA-owned host. It MUST NOT ship `packages/scratch-gui/build/index.html` as the product
host.

Target runtime composition:

```text
pinned scratch-editor source
→ npm ci
→ scratch-gui production standalone dist
→ ASA-owned index/bootstrap/storage/orchestrator
→ Nginx static runtime image
```

The ASA host uses exported upstream extension points such as:

```text
EditorState(configFactory)
createStandaloneRoot(...)
GUIStorage / ScratchStorage
onVmInit(vm)
onProjectLoaded()
```

The host renders Scratch with upstream server persistence disabled:

```text
canSave = false
canCreateNew = false
backpackVisible = false
cloud provider absent
Scratch-site logo/community navigation absent/no-op
```

ASA persistence is owned by the ASA save orchestrator, not by upstream
`ProjectSaverHOC`. The reason is correctness: upstream project-changed state is a boolean
and can clear changes that occur during an in-flight save; ASA requires generation-aware
latest-state queuing.

The host receives the VM through `onVmInit`, subscribes to VM project-change events, and
tracks its own save generation/status.

New ASA Blocks projects use Scratch's pinned built-in default project/assets locally;
existing ASA projects load through the ASA project/asset runtime API. The ASA project UUID
is the persistence identity even when Scratch internally uses built-in project ID `0` to
initialise a new project.

---

# 8. Persistence contract summary

Detailed contract: `VSCR-D0-002-PERSISTENCE-CONTRACT.md`.

Current `ModuleProvider.validateDocument()` remains synchronous structural validation.
Blocks MUST NOT make the whole module SDK async.

Project Core receives one generic additive async pre-save durability port. Logical form:

```ts
interface ProjectDraftPersistenceGuardPort {
  validate(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    moduleKey: string;
    document: JsonValue;
  }): Promise<PersistenceGuardResult>;
}
```

The default/non-Blocks path is allow. The Blocks implementation performs server-side asset
metadata and project/reference validation. The guard runs after structural
`module.validateDocument()` and before `repository.saveDraft()`.

This closes the bypass through the existing generic project draft API. Blocks-specific
logic stays outside `contexts/projects`.

No draft becomes durable unless every referenced asset is already durable and verified.

---

# 9. Asset storage contract summary

Detailed contract: `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md`.

Target server metadata model:

```text
blocks_blobs
  tenant_id
  sha256
  data_format
  size_bytes
  object_key        # server-only
  created_at
  PK (tenant_id, sha256, data_format)

blocks_asset_aliases
  tenant_id
  asset_id          # Scratch MD5 compatibility ID
  data_format
  sha256
  created_at
  PK (tenant_id, asset_id, data_format)
  FK -> blocks_blobs in same tenant
```

The S3 client selection is `@aws-sdk/client-s3`; the implementation PR pins an exact
version that passes the repository security/license gates. Substituting another S3 client
is a D0 contract change.

Object key is derived server-side, for example:

```text
tenants/{tenantId}/blocks/assets/{sha256[0:2]}/{sha256}.{dataFormat}
```

The bucket is private. Browser JavaScript never receives bucket credentials.

### 9.1 Asset PUT wire contract

Logical endpoint:

```http
PUT /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
Authorization: Bearer <runtime capability>
```

Server streams/limits bytes, validates actual container, computes MD5 and SHA-256,
requires MD5 to equal path `assetId`, stores/reuses immutable tenant blob, then establishes
an immutable alias.

Idempotent success wire shape MUST include the Scratch storage success marker:

```json
{
  "status": "ok",
  "asset": {
    "assetId": "32hex",
    "dataFormat": "svg",
    "sha256": "64hex",
    "sizeBytes": 1234
  }
}
```

If an existing alias maps to different bytes, return an explicit conflict and never
retarget the alias.

### 9.2 Asset GET

Editor/viewer asset GET resolves an alias server-side and returns exact bytes. A
project/version capability may read only assets referenced by that authorised draft or
immutable version, except separately approved library endpoints.

Guessing another project's MD5 is not read authority.

### 9.3 Initial limits

```text
projectJson serialised size      16 MiB
single SVG/PNG/JPG               10 MiB
single WAV/MP3                   25 MiB
total unique referenced assets  250 MiB/project
```

All values are configurable downward/upward only through reviewed configuration; removal
of limits is forbidden.

### 9.4 No GC

Failed document saves may leave orphan immutable blobs/aliases. M0–M4 do not physically
delete them. A future reference-safe GC programme is separate.

---

# 10. Runtime security contract summary

Detailed contract: `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md`.

Runtime capabilities use a standard JWS/JWT implementation via `jose`, not handwritten
cryptography. Initial signing profile:

```text
algorithm: HS256
audience: asa-blocks-runtime
module: blocks
editor TTL: 10 min (hard maximum 15 min without new decision)
viewer TTL: 10 min
separate signing secret: ASA_BLOCKS_RUNTIME_SIGNING_KEY
```

Required claims include issuer/audience, subject principal, tenant, project, module,
mode, permissions, `jti`, `iat`, `nbf`, `exp`, and immutable `versionId` for viewer mode.

Token stays in memory, never URL/localStorage/logs. Runtime API requests use
`Authorization` and `credentials: omit`.

### 10.1 Origin policy

Normal ASA cookie APIs keep the existing origin policy unchanged.

Runtime paths are a separate trust surface:

```text
/api/blocks/runtime/**
```

They receive exact path-scoped CORS/origin handling for `ASA_BLOCKS_RUNTIME_ORIGIN` and
require bearer capability authority. Adding the runtime origin to generic ASA mutation
trust is forbidden.

### 10.2 Parent/iframe channel

The iframe is loaded from `runtimeOrigin` returned by ASA configuration/runtime-session;
client machines MUST NOT be given a server-side `127.0.0.1` URL.

Parent sends `INIT` after iframe load. Every post-bootstrap message includes:

```text
protocolVersion
messageType
projectId
sessionNonce
requestId where needed
```

Both sides verify exact origin and nonce. `targetOrigin='*'` is forbidden.

Initial iframe sandbox is:

```text
allow-scripts allow-same-origin
```

Additional permissions require a focused browser test and contract update.

### 10.3 Runtime-specific abuse protection

The generic mutation IP/session budget is not reused unchanged for classroom autosave.
Runtime endpoints use capability/project keyed limits plus a coarse IP ceiling, defined in
the security contract. A school NAT must not cause normal class activity to exhaust a
single ordinary API IP budget.

---

# 11. Runtime API v1

All routes are documented in `schemas/openapi.yaml` in the same implementation change.

Cookie-authenticated parent/control routes:

```text
POST /api/projects/{projectId}/blocks/runtime-session
POST /api/projects/{projectId}/blocks/import
GET  /api/projects/{projectId}/blocks/export.sb3
```

Bearer runtime editor routes:

```text
GET /api/blocks/runtime/projects/{projectId}/bootstrap
GET /api/blocks/runtime/projects/{projectId}/project.json
PUT /api/blocks/runtime/projects/{projectId}/draft
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
PUT /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
PUT /api/blocks/runtime/projects/{projectId}/snapshot
```

Viewer uses a version-scoped read-only capability and version routes; it never receives a
draft-write endpoint.

The `bootstrap` response contains non-secret metadata needed before rendering, including:

```text
protocolVersion
projectId
mode
hasProjectJson
draftRevision
canonical assets[]
recoveryNamespace
runtime build identity
```

The raw `project.json` route exists specifically so Scratch Project storage can consume a
plain Scratch project representation instead of ASA's envelope.

---

# 12. Durable save algorithm

The ASA save orchestrator receives `vm` using upstream `onVmInit` and subscribes to the
VM's project-change event. Upstream server autosave remains disabled.

### 12.1 Generation state machine

Minimum logical states:

```text
LOADING
CLEAN
DIRTY
PREPARING_ASSETS
SAVING
DIRTY_DURING_SAVE
WAITING_FOR_TOKEN
OFFLINE_RETRY
CONFLICT
FATAL
```

A monotonically increasing local `changeGeneration` increments on every project-change
event after initial load.

Save snapshot captures:

```text
capturedGeneration
vmState = vm.toJSON()
baseRevision = last confirmed server revision
mutationId = UUIDv4 for this exact snapshot
```

If `changeGeneration > capturedGeneration` when the save succeeds, the orchestrator does
not mark the editor globally clean; it immediately schedules the newest state.

### 12.2 Scheduler

```text
debounce after last change: 750 ms
hard dirty deadline: 3 s from first unsaved change
active draft saves: 1
pending queue: one latest state, never unbounded FIFO
```

Due time is effectively:

```text
min(lastChange + 750ms, firstDirty + 3s)
```

Retrying the exact same snapshot reuses `mutationId`. A newly serialised state gets a new
`mutationId`.

### 12.3 Ensure every referenced asset is durable

Before document PUT:

```text
parse vmState
→ enumerate unique costume/sound (assetId, dataFormat)
→ for each reference:
     canonical server ref already known and matches? reuse
     otherwise locate exact bytes in vm.assets
     upload/verify asset
→ fail if any referenced bytes/ref cannot be made durable
→ build canonical assets[] from server-returned refs
→ PUT draft
```

This includes clean built-in/default assets. The implementation MUST NOT rely on Scratch's
`asset.clean` flag as evidence that ASA has the bytes.

Existing project asset refs are seeded into the runtime's canonical-ref cache by the
bootstrap envelope. Default/new-project assets are materialised from the VM on first
durable save.

### 12.4 Project save

`PUT .../draft` sends:

```text
document
baseRevision
mutationId
```

The API calls the same Project Core `SaveDraftUseCase`. Structural validation runs first;
then the generic async persistence guard verifies Blocks durability; only then may
`repository.saveDraft()` commit a new revision.

### 12.5 Save status

ASA shell exposes:

```text
Сохранено
Есть несохранённые изменения
Сохраняем…
Нет соединения
Конфликт версии
Ошибка сохранения
```

`Сохранено` means the server confirmed the exact latest local generation or no newer
local generation exists.

---

# 13. Recovery and conflict

Conflict is never auto-merged.

```text
409 project_revision_conflict
→ stop remote autosave
→ write/retain IndexedDB recovery
→ fetch current server metadata
→ show conflict state
→ preserve server version and local recovery
```

Recovery database:

```text
name: asa-blocks-recovery
key: opaque recoveryNamespace supplied by ASA
```

Stored recovery data includes:

```text
projectJson/document snapshot
baseRevision
changeGeneration
updatedAt
canonical asset refs
unsent binary Blob/ArrayBuffer only when not durable yet
```

Binary recovery is not base64. Size/age quota is explicit. Runtime serialises a recovery
snapshot on a short independent debounce (target 500 ms, hard maximum 2 s while dirty),
not only when a server save is attempted.

After a confirmed server revision covers that recovery generation, obsolete recovery is
deleted.

Token expiry causes `WAITING_FOR_TOKEN`; it does not destroy or replace the pending
mutation. Parent refreshes capability and the same exact mutation may retry.

Network/5xx retry uses bounded exponential backoff with jitter, capped at 30 s; dirty
recovery remains local throughout.

---

# 14. Snapshot

Use upstream `onSetProjectThumbnailer`/VM stage capture rather than inventing a new canvas
path. Snapshot flow:

```text
confirmed draft revision
→ obtain Scratch stage thumbnail
→ runtime snapshot endpoint
→ existing SaveProjectSnapshotUseCase
→ exact confirmed sourceRevision
```

Target 480×360. Prefer WebP when supported by the existing snapshot validator/path; PNG is
fallback. Capture/upload no more frequently than once per 10 s by default.

Snapshot failure is non-fatal to project durability.

---

# 15. `.sb3` import/export

Import/export implementation waits until the D0 persistence/storage/security contracts
are accepted.

### 15.1 Import

```text
cookie-authorised multipart upload
→ route-scoped streaming limits
→ safe ZIP iteration; never attacker path extraction
→ exactly one project.json
→ validate project JSON
→ validate asset filenames/MD5/format/content
→ persist immutable blobs + aliases
→ build canonical BlocksProjectDocumentV1
→ persistence guard
→ Project Core save/checkpoint policy
```

Initial archive limits:

```text
compressed:               100 MiB
aggregate uncompressed:   300 MiB
entries:                  1000
compression ratio:        50:1 per entry and aggregate
single entry:             normal project/asset limits
```

Multipart/body limits MUST be route-scoped. Do not raise the whole ASA API body limit to
hundreds of MiB.

The implementation task must pin one ZIP/multipart library choice in its task package and
pass dependency security/license gates; a bot does not substitute libraries ad hoc.

### 15.2 Export

```text
load authorised draft or immutable version
→ verify document/ref consistency
→ resolve every exact blob
→ emit project.json
→ emit `${assetId}.${dataFormat}` files
→ stream ZIP
→ reopen in pinned/current compatibility fixture test
```

Missing bytes make export fail; no partial archive is labelled successful.

---

# 16. Technical-project fixture contract

M1 must not temporarily set `blocks` active and must not add a production debug endpoint
just to obtain a test project.

A test-only Blocks fixture factory is required before browser M1 acceptance. It creates an
isolated test project through repository/test-kit infrastructure against a test database,
using the same document/schema invariants but bypassing public `getCreatable()` only inside
the test harness.

Forbidden:

```text
production hidden create endpoint
manual INSERT instructions as acceptance path
temporary module activation committed to product code
```

The fixture helper itself is not available in production builds/routes.

---

# 17. Milestone order — v2

Planning IDs do not authorise work.

```text
VSCR-M0 foundation
  ↓
VSCR-D0-001 host contract
VSCR-D0-002 persistence contract
VSCR-D0-003 storage contract
VSCR-D0-004 security contract
VSCR-D0-005 deployment/activation contract
  ↓ all D0 accepted
VSCR-M0.1-001 document schema correction (remove objectKey)
  ↓
VSCR-M1-001 Blocks bounded context
  ↓
VSCR-M1-002 ASA Scratch host + iframe protocol skeleton
  ↓
VSCR-M1-003 capability auth + path-scoped runtime origin/CORS
  ↓
VSCR-M1-004 blob metadata + S3 adapter + test fixture
  ↓
VSCR-M1-005 durable load/save + persistence guard + ensureReferencedAssetsDurable
  ↓
VSCR-M1-006 autosave/recovery/conflict + stage snapshot
  ↓
VSCR-M1-007 safe .sb3 import/export + fixture corpus
  ↓
VSCR-M1-008 durability acceptance
  ↓
VSCR-M2-001 ASA editor shell
VSCR-M2-002 immutable read-only player
VSCR-M2-003 Learning/classroom submission integration
VSCR-M2-004 gallery/remix integration
VSCR-M2-005 product acceptance while still coming_soon
  ↓
VSCR-M3-001 external dependency/rights inventory
VSCR-M3-002 approved local libraries
VSCR-M3-003 extension allowlist
VSCR-M3-004 browser network-deny + CSP
VSCR-M3-005 backup/restore + deployment topology acceptance
VSCR-M3-006 sovereign acceptance
  ↓
VSCR-M4-001 ACTIVATION: coming_soon → active
  ↓
VSCR-M5 optional cloud variables / hardware / backpack / PWA / GC
```

No public activation occurs in M2 anymore.

---

# 18. M1 acceptance: durable technical vertical slice

All evidence must refer to the same candidate SHA.

```text
A. test-only technical project can initialise without module activation
B. ASA-owned standalone Scratch host loads; upstream playground is not the product host
C. existing project loads projectJson through ASA runtime API
D. default/new project first save materialises clean default assets durably
E. blocks/sprites/costumes/sounds save and reopen identically
F. SVG/PNG/JPG/WAV/MP3 bytes round-trip exactly
G. project document contains no objectKey/base64/full sb3
H. server verifies MD5 asset identity and SHA-256 integrity
I. generic /api/projects draft path cannot bypass Blocks persistence guard
J. forged/missing/cross-tenant asset references are rejected
K. in-flight save followed by new edits cannot falsely become CLEAN
L. token expiry/refresh preserves pending mutation/recovery
M. revision conflict never overwrites
N. browser crash/network recovery preserves dirty state
O. snapshot is tied to confirmed revision
P. checkpoint restore reopens historical assets
Q. sb3 import/export fixtures round-trip
R. runtime origin cannot call generic cookie mutation APIs
S. viewer/write authority is not introduced accidentally
T. focused and required repository gates are non-skipped and green except explicitly
   documented unrelated repository blockers
```

After M1, `blocks` remains `coming_soon`.

---

# 19. M2 product integration while still gated

### VSCR-M2-001 editor shell

Route `/projects/:projectId/blocks` owns ASA title/navigation/save status/fullscreen shell.
Scratch iframe owns only editing surface. Test/dev access must be explicit and must not
become a production availability bypass.

### VSCR-M2-002 immutable player

Use the same ASA Scratch host in player mode with upstream `EditorState({isPlayerOnly:
true})` or equivalent pinned supported API. Viewer receives a version-scoped read-only
capability and cannot call draft save, asset PUT or snapshot PUT.

### VSCR-M2-003 Learning

Use the existing canonical project submission path. Submission records immutable
`project_version_id`.

Required E2E:

```text
student submits version N
→ student edits draft N+1
→ teacher still opens exact submitted version N
```

No `blocks_assignments` or separate gradebook.

### VSCR-M2-004 Gallery/remix

Publication references immutable ASA project/version metadata. Bucket remains private.

Same-tenant remix may reuse immutable alias/blob metadata. Cross-tenant remix must create
valid destination-tenant aliases/blob ownership before destination project commit; source
private object keys/credentials are never exposed.

### VSCR-M2-005 product acceptance

Editor/player/Learning/gallery/remix journeys pass while module is still non-creatable for
ordinary users.

---

# 20. M3 sovereign + backup + deployment acceptance

Sovereign means the supported baseline works when Scratch Foundation services are
unavailable. It does not mean the browser works without the ASA server; full offline/PWA
is optional M5.

### 20.1 Dependency and rights inventory

Every runtime outbound destination and bundled/library media source is classified:

```text
LOCAL_REQUIRED
EXTERNAL_OPTIONAL
HARDWARE_LOCAL
UNSUPPORTED
```

Redistribution rights are recorded before local mirroring.

### 20.2 Local libraries

Supported baseline sprite/costume/backdrop/sound metadata and bytes resolve only from
rights-cleared local/ASA resources. `getLibraryAssetUrl` MUST NOT fall back to Scratch
Foundation hosts in sovereign mode.

### 20.3 Extensions

```text
A fully local
B browser/hardware local dependency
C external-service dependency
D unsupported
```

Only tested A/B items are shown as sovereign-supported.

### 20.4 Browser network deny

Playwright/browser tests fail on any unexpected external request. With Scratch Foundation
hosts denied, test editor, local library asset selection, run, save/reload, historical
version, player, assignment, import/export.

### 20.5 Backup consistency

Blocks blobs are immutable and document commit occurs only after referenced blobs exist.
Therefore the baseline backup ordering is:

```text
1. capture PostgreSQL backup
2. copy/mirror the private Blocks object set without deleting destination objects
3. record backup manifest/build identity
4. verify every Blocks asset ref in the DB backup resolves in the object backup
```

This ordering may contain harmless extra unreferenced blobs but MUST NOT omit a blob that
the captured DB references.

Restore evidence uses an isolated destination and proves an old immutable version opens
with exact assets.

### 20.6 Degradation

Blob-store/runtime unavailability disables/degrades Visual Programming only. Health and UI
must distinguish Blocks dependency degradation from whole-platform failure.

---

# 21. M4 activation gate

`availability: coming_soon → active` happens only in `VSCR-M4-001` after M1, M2 and M3
acceptance evidence.

Activation PR/change is intentionally tiny. It MUST NOT also introduce storage, security,
backup, library or editor logic.

Preconditions:

```text
durable save/reopen PASS
recovery/conflict PASS
immutable player PASS
Learning submission PASS
gallery/remix PASS
Scratch-host network deny PASS
rights-cleared local baseline PASS
PostgreSQL + object backup/restore PASS
real deployment topology smoke PASS
no critical/high dependency advisory introduced by Blocks work
```

Only after this gate may ordinary Project Core creation treat `blocks` as creatable.

---

# 22. Deployment topology rules

Detailed contract: `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md`.

Runtime origin is explicit configuration, not inferred as localhost in production.

Supported shapes:

```text
public/TLS:
  https://<asa-web-origin>
  https://<blocks-runtime-origin>

school LAN without DNS/TLS:
  http://<server-address>:<asa-port>
  http://<server-address>:<blocks-port>
```

`127.0.0.1:4613` is a developer-machine default only. It MUST NOT be returned to a remote
student browser.

The Scratch container listens internally on 8080. Any published host binding belongs to
the existing ASA Compose project and is explicit/configurable. A reverse proxy may expose
the dedicated runtime origin/subdomain without publishing the container directly.

---

# 23. Runtime rate baseline

Runtime endpoints do not consume the ordinary cookie-mutation limiter as if a whole class
were one interactive user.

Initial configurable runtime ceilings:

```text
per capability:       300 requests / 5 min
coarse per IP:      12000 requests / 5 min
asset uploads:          4 concurrent / capability
asset byte limits:      normal per-file/project limits still apply
```

The implementation must test a representative class behind one NAT. These numbers are
abuse ceilings, not a target request rate. Client autosave still aims to minimise traffic.

---

# 24. Observability/privacy

Allowed technical events:

```text
blocks.runtime.started
blocks.project.loaded
blocks.project.dirty
blocks.project.saved
blocks.project.save_conflict
blocks.asset.uploaded
blocks.asset.identity_conflict
blocks.asset.load_failed
blocks.snapshot.saved
blocks.sb3.imported
blocks.sb3.import_failed
blocks.sb3.exported
blocks.dependency.degraded
```

Never log:

```text
runtime token
session cookie
object-store credentials
complete projectJson
learner-authored text for routine debugging
raw costume/sound bytes
```

Request logging must not include query/token/body payloads.

---

# 25. Upstream update policy

Upstream changes only through dedicated pinned update work. No moving branch or automatic
production update.

Required evidence grows with implementation:

```text
always: exact commit/version + image build + ASA host smoke + licence/security inventory
M1+: fixture load + durable save/reopen + asset integrity + sb3 round trip
M2+: player + immutable submission
M3+: local libraries + browser network deny + backup compatibility
```

Every local upstream coupling (including any use of deprecated/internal Scratch API) must
be named in the host contract and covered by an upgrade test.

---

# 26. Performance/resilience baseline

```text
ASA shell remains responsive while Scratch loads
one active draft save/editor
healthy school-LAN save confirmation target < 2 s
save ordering never traded for benchmark speed
snapshot cannot block draft durability
runtime/blob outage does not crash unrelated ASA modules
same canonical asset is not repeatedly uploaded after ref is known
```

Measure first; never remove revision/security/size checks to make a benchmark green.

---

# 27. Test corpus contract

Fixtures are ASA-authored/generated or explicitly redistributable. Each fixture has a
manifest containing expected semantic features, expected asset IDs/formats/digests and
round-trip assertions.

Minimum corpus:

```text
01-basic-motion
02-multiple-sprites
03-vector-costume
04-bitmap-costume
05-sound
06-variable-list
07-clones
08-one-approved-extension
```

Assertions distinguish:

```text
semantic equality of project graph
exact equality of asset bytes/digests
allowed Scratch normalisation where proven by pinned round trip
```

No arbitrary community project is committed as a fixture.

---

# 28. Rollback

Until activation, rollback means disabling/removing the selected VSCR wiring while
preserving database rows and blob bytes. It never means deleting learner/test data to make
a previous commit shape reappear.

Storage migrations are additive. Runtime service is separate. Other subjects remain
isolated.

After activation, a rollback may set `blocks` non-creatable/disabled while preserving all
existing Blocks drafts, versions and blobs for recovery/read access.

---

# 29. Definition of Done for core Visual Programming

Core programme is done only when all are true:

1. ASA owns the only user/project/Learning record.
2. ASA-owned Scratch host uses pinned upstream shipping standalone build.
3. Ordinary create remains gated until M4 activation.
4. Blocks, sprites, costumes and sounds save durably.
5. Clean/default Scratch assets become durable on first save.
6. Closing/reopening reproduces the same project.
7. Project Core JSON contains no binary/base64/full `.sb3`/`objectKey`.
8. Scratch MD5 identity survives while ASA verifies SHA-256.
9. Every saved project asset reference resolves to verified tenant metadata/blob.
10. Generic Project Core save cannot bypass Blocks durability checks.
11. In-flight save plus new edits cannot falsely report clean.
12. Crash/network recovery preserves dirty state.
13. Revision conflict never silently overwrites.
14. Historical checkpoints retain historical assets.
15. `.sb3` import is archive-safe and compatibility-tested.
16. `.sb3` export opens compatibly.
17. Snapshot is bound to confirmed revision.
18. Viewer uses immutable version + read-only capability.
19. Learning submission pins immutable project version.
20. Gallery/remix reuse ASA semantics without public blob bucket.
21. Runtime origin cannot use generic ASA cookie authority.
22. One-school-NAT load does not trip ordinary mutation limiter.
23. Supported baseline works with Scratch Foundation hosts blocked.
24. Only rights-cleared local media/extensions are supported claims.
25. PostgreSQL and object storage both have isolated restore evidence.
26. Blocks dependency outage does not take down unrelated ASA modules.
27. Upstream updates are exact-pinned and regression-gated.
28. Activation is a final tiny change after all preceding gates.

---

# 30. Instruction shape for a future coding bot

A coding bot receives exactly one selected task ID. Example:

```text
Implement VSCR-M1-005 only.
Read AGENTS.md, START_HERE_FOR_AI.md,
ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md §0–§12 and §17–§18,
ADR-VSCR-001,
VSCR-D0-002-PERSISTENCE-CONTRACT.md,
VSCR-D0-003-ASSET-STORAGE-CONTRACT.md,
VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md.

Do not activate blocks.
Do not deploy.
Do not change Scratch upstream pin.
Do not modify neighbouring subject contexts.
Do not advance to M1-006.

Before editing: state expected paths and verify prerequisites.
After editing: report changed paths, exact tests/gates, SHA, CI status and STOP conditions.
```

The decisive rule is: **the selected task package should leave implementation choices,
not architecture choices, to the coding agent.**