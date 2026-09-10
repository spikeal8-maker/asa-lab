# ASA Lab Visual Programming — Scratch integration master specification

**Document:** Master Technical Specification / implementation contract  
**Version:** 1.0  
**Date:** 10 September 2026  
**Product:** ASA Lab  
**Module key:** `blocks`  
**Product name:** `Визуальное программирование`  
**Architecture decision:** [`ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md`](../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md)

---

## 0. Status and source-of-truth rules

This document is the **normative TARGET and implementation-order contract** for the
Scratch-compatible visual-programming capability of ASA Lab. It defines what must be
built, the architectural boundaries that must not be crossed, task decomposition,
acceptance evidence and stop conditions.

This document **does not declare the current task, branch, PR, Issue, checkpoint, SHA,
CI conclusion, deployment or owner acceptance**. Those facts belong only to
[`docs/execution/current.yaml`](../execution/current.yaml), according to `AGENTS.md`.
A bot MUST NOT infer that a milestone is authorised merely because it is described here.

### 0.1 Hierarchy of truth

| Question | Source of truth |
|---|---|
| What Visual Programming must ultimately do | this master specification |
| Why the Scratch boundary and persistence model exist | `ADR-VSCR-001` |
| What task is authorised now | `docs/execution/current.yaml` + explicit owner instruction |
| What actually exists | repository code + migrations + configuration |
| What API actually exists | code + `schemas/openapi.yaml` |
| What actually works | exact-SHA CI/integration/browser evidence |
| What was accepted | owner acceptance |
| What Scratch upstream is used | `infra/scratch-editor/upstream.env` |

If this document and current code differ, a bot MUST NOT silently “fix everything”. It
must limit itself to the authorised slice, record the mismatch and resolve it only when
that mismatch is inside the slice.

### 0.2 Normative words

- **MUST / ОБЯЗАН** — mandatory.
- **MUST NOT / ЗАПРЕЩЕНО** — forbidden.
- **SHOULD / СЛЕДУЕТ** — expected unless the change records a concrete reason.
- **MAY / МОЖЕТ** — optional.
- **STOP** — do not continue coding until the owner/governance condition is resolved.

---

# 1. Product goal

ASA Lab MUST provide a self-hostable visual-programming module with the familiar
Scratch 3 editor/runtime model while keeping ASA Lab as the only application system of
record.

The primary learner journey is:

```text
create Visual Programming project in ASA Lab
→ open editor
→ add/edit blocks, sprites, costumes and sounds
→ run the project
→ autosave to ASA Lab
→ close/reload/reopen
→ receive the identical saved work
→ checkpoint/version
→ optionally submit/publish/remix/export .sb3
```

The critical product property is **durability before visibility**. The module MUST remain
non-creatable for ordinary users until the save/load acceptance gate proves that closing
and reopening does not lose work.

---

# 2. Architectural formula

```text
ASA Lab Web
│
├── Project / Classroom / Learning / Gallery shell
│
└── separate-origin iframe
     ↓
Scratch-compatible runtime container
     ├── Scratch GUI
     ├── Scratch VM
     ├── Scratch Renderer
     ├── Scratch Storage
     └── Paint / sound / sprites
          │
          │ short-lived, project-scoped capability
          ↓
ASA Blocks Runtime API
     ├── Project Core use cases
     ├── Blocks asset metadata
     ├── private blob/object storage
     └── Project snapshots
```

Scratch runtime owns only subject execution/editor concerns. ASA Lab owns identity,
authorisation, projects, drafts, immutable versions, classrooms, assignments,
submissions, publication, remix provenance, backups and deployment.

There MUST NOT be a parallel Scratch user database, classroom database, social backend,
project database or LMS.

---

# 3. Hard safety invariants

These rules apply to every VSCR task.

1. `moduleKey` remains **`blocks`**. Do not create a competing `scratch` module.
2. The user-facing product name is **`Визуальное программирование`**. Compatibility may
   be described factually as “совместимо с проектами Scratch 3 (.sb3)”. Do not present
   ASA Lab as an official Scratch product and do not add Scratch logos/brand assets
   without a separate rights review.
3. Scratch upstream MUST remain pinned by exact commit in
   `infra/scratch-editor/upstream.env`. No `latest`, moving branch or unreviewed upstream
   auto-update may reach a runtime image.
4. Scratch packages MUST NOT be installed into the main ASA Web bundle merely to make
   integration easier. The editor remains behind its isolated build/runtime boundary.
5. `projectJson` belongs in Project Core JSON persistence. Binary costumes/sounds/images
   MUST NOT be embedded as base64/byte arrays/full `.sb3` archives in Project Core JSONB.
6. `.sb3` is an **import/export interchange format**, not the autosave storage format.
7. Subject code MUST follow the current repository architecture. New Blocks subject code
   belongs under **`contexts/blocks/**`**, analogous to the existing subject contexts.
   Do not create `modules/blocks` while `modules/` remains intentionally unused, unless a
   separate architecture decision changes that repository rule.
8. Blocks MUST NOT import Classroom/Learning/Project infrastructure internals. It uses
   public contracts/ports/use cases. Core contexts MUST NOT import Scratch upstream code.
9. No destructive migration, tenant/RLS redesign, working-DB reset, force-push,
   deployment, Docker restart or live restore is implied by this specification.
10. An upstream/editor failure MUST NOT take down ASA Web or corrupt another subject
    module.
11. No physical deletion of Blocks binary assets is allowed before a separate, proven
    reference-aware garbage-collection milestone.
12. No silent overwrite on project revision conflict.
13. No bot may advance to the next VSCR task automatically. One owner-authorised slice
    is implemented, tested and reported at a time.

---

# 4. Agent execution protocol

Before changing code for any VSCR task, the coding agent MUST:

```text
1. read AGENTS.md
2. read START_HERE_FOR_AI.md
3. read docs/execution/current.yaml through the normal agent context flow
4. read this master specification: §0–§4 + the exact authorised task section
5. read ADR-VSCR-001
6. inspect the exact current code it will change
7. list expected changed paths before editing
8. run the task's focused gate, then the required repository gate
9. report exact SHA/CI/deployment state separately
```

The specification is not a work queue that a bot may consume end-to-end.

### 4.1 Default writable scope

A VSCR implementation slice SHOULD be limited to the smallest necessary subset of:

```text
contexts/blocks/**
apps/api/src/blocks-*.ts
apps/api/src/module-registry.ts
apps/web/src/blocks/**
apps/web/src/pages/*Blocks*.tsx
infra/scratch-editor/**
schemas/openapi.yaml
migrations/*blocks*.sql
tests/blocks/**
e2e/blocks-*.spec.ts
compose*.yaml                 # only for an authorised infrastructure slice
.env*.example                 # names/defaults only, never secrets
docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md
docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md
```

Files outside that set are not forbidden automatically, but every additional path MUST
have a direct reason in the task. “While I am here” refactors are forbidden.

### 4.2 Protected neighbouring areas

A Blocks bot MUST NOT casually modify:

```text
contexts/electronics/**
contexts/chess/**
contexts/checkers/**
contexts/three-d/**
owner-supplied/audit electronics assets
identity/tenant/RLS semantics
Learning canonical state semantics
```

A later Learning integration task may touch Learning through its existing public/canonical
submission path, but MUST NOT create a Blocks-specific parallel Learning runtime.

### 4.3 STOP conditions

STOP and return control if the slice unexpectedly requires any of the following:

- destructive persistence migration or tenant/RLS redesign;
- replacement of Project Core revision/version semantics;
- copying `scratch-www` or building a parallel Scratch backend;
- moving Scratch dependencies into the ASA Web dependency graph;
- modifying another subject context to “make Blocks fit”;
- adding a second persistent Compose project;
- storing secrets in Git;
- enabling public project creation before the activation gate;
- copying Scratch media/branding with unclear rights;
- weakening CORS/CSP/origin checks to make an iframe work;
- bypassing a failing gate or labelling a skipped check as PASS;
- deploying/restarting production without explicit owner instruction.

---

# 5. Stable repository placement

The target bounded context is:

```text
contexts/blocks/
├── domain/
│   ├── document.ts
│   ├── asset.ts
│   └── validation.ts
├── application/
│   ├── ports.ts
│   ├── import-sb3.ts
│   └── export-sb3.ts
├── infrastructure/          # only adapters owned by the context
├── testing/
├── index.ts
├── module.ts
├── package.json
├── project.json
└── tsconfig.json
```

The exact file split MAY be smaller, but public exports MUST come through the context's
single public entry point, following the existing bounded-context convention.

`apps/api` owns transport/composition adapters. `apps/web` owns the ASA shell around the
runtime. `infra/scratch-editor` owns the pinned upstream editor image. None of those
locations may become a second copy of domain state.

---

# 6. Persistent document contract

The logical project envelope remains:

```text
BlocksProjectDocumentV1
├── schemaVersion = 1
├── format = scratch-3
├── projectJson = Scratch project.json | null
└── assets[]
    ├── assetId
    ├── dataFormat
    ├── objectKey
    ├── sha256
    └── sizeBytes
```

`projectJson = null` is allowed only before the embedded VM has initialised a new default
project.

### 6.1 Asset-reference security

`objectKey` is **server-owned metadata**, even though it is persisted in the project
envelope. A browser/runtime MUST NOT be trusted to choose an arbitrary object key.

On asset upload the server MUST:

1. authorise the project-scoped runtime credential;
2. validate the file format and configured size limit;
3. compute `sha256` itself;
4. derive the storage key itself;
5. write immutable bytes or reuse an identical existing tenant blob;
6. return the complete canonical asset reference.

On draft save the server MUST verify every submitted asset reference against server-side
asset metadata for the same tenant. A forged `objectKey`, size or digest MUST fail the
save. A project MUST NOT be able to reference another tenant's private blob by guessing a
key.

### 6.2 Storage ownership

The current base Compose stack does not contain S3/MinIO. Therefore storage introduction
is a deliberate M1 infrastructure slice, not an assumption.

Blocks MUST depend on an application port such as:

```ts
interface BlocksBlobStorePort {
  putImmutable(...): Promise<StoredBlocksAsset>;
  get(...): Promise<Uint8Array | null>;
  exists(...): Promise<boolean>;
}
```

The production target is private S3-compatible object storage. A self-hosted MinIO
adapter MAY be used for local/test/self-hosted deployment.

If MinIO is added to Docker, it MUST join the existing ASA Compose project/profile. A
second permanent Compose project is forbidden.

Buckets MUST be private. Long-lived object-store credentials MUST be visible only to the
API/storage adapter, never to Scratch browser JavaScript.

A recommended server-derived key is:

```text
tenants/{tenantId}/blocks/assets/{sha256[0:2]}/{sha256}.{dataFormat}
```

The exact key scheme is internal; clients must not construct it.

### 6.3 Asset metadata

If a relational metadata table is introduced, it MUST be additive and tenant-scoped. The
minimum semantics are:

```text
asset identity
 tenant_id
 scratch assetId + dataFormat
 sha256
 sizeBytes
 storage key
 created_at
```

Deduplication MAY happen within one tenant by `(sha256, dataFormat)`. Cross-tenant
physical sharing MUST NOT leak authorisation or storage keys.

### 6.4 No GC in M1–M3 activation path

Uploads may temporarily become orphaned when a later draft save fails. That is accepted.
An orphan is cheaper than a broken historical checkpoint.

Physical deletion requires a later GC design that proves no reference exists in:

```text
current draft
any immutable project version
published version
submission version
gallery/remix lineage that still references the blob
```

Until that proof exists: **GC OFF**.

---

# 7. Runtime isolation and trust boundary

The embedded editor MUST run on a different browser origin from the ASA application.
Local development may use the reserved `127.0.0.1:4613` editor port. Production SHOULD
use a dedicated runtime origin/subdomain routed to the Scratch editor container.

Reason: upstream editor JavaScript must not inherit ambient authority from ASA's account
cookies merely because it is displayed inside ASA Lab.

### 7.1 Runtime bootstrap

The parent ASA page performs ordinary ASA authentication and requests a short-lived,
project-scoped runtime capability:

```http
POST /api/projects/{projectId}/blocks/runtime-session
```

The response contract MUST be versioned and include at least:

```json
{
  "protocolVersion": 1,
  "projectId": "uuid",
  "runtimeToken": "opaque-or-standard-signed-capability",
  "expiresAt": "RFC3339",
  "draftRevision": 12,
  "runtimeOrigin": "https://..."
}
```

The credential MUST be restricted to one tenant, principal, project, module `blocks`,
expiry and explicit operations. It MUST NOT be a reusable ASA account session.

A bot MUST NOT invent handwritten cryptography. Use an existing repository-approved
security primitive/library; if none fits, the security mechanism is a dedicated design
slice before implementation.

Default lifetime SHOULD be 10 minutes and MUST NOT exceed 15 minutes without an explicit
security decision. The parent renews before expiry and passes the replacement capability
to the runtime. Expiry must not destroy unsaved local recovery data.

### 7.2 Runtime capability operations

The capability is limited to operations equivalent to:

```text
project:read
project:save
asset:read
asset:write
snapshot:write
```

No classroom/admin/account/settings operation is permitted.

### 7.3 Browser handling

The runtime token MUST:

- stay in memory;
- never enter `localStorage`, URL/query string, logs or analytics;
- be sent only in an `Authorization` header to dedicated Blocks runtime endpoints;
- use `credentials: omit` for those bearer requests.

Dedicated runtime endpoints MUST require the capability even if an ASA cookie happens to
be present.

### 7.4 Parent ↔ iframe protocol

Communication MUST use an explicit versioned message protocol containing:

```text
protocolVersion
messageType
projectId
sessionNonce
requestId where a response is expected
```

Both directions MUST validate exact `origin`. `postMessage(..., '*')` is forbidden.
Messages with the wrong `projectId`, nonce or protocol version are ignored/rejected.

The iframe SHOULD use the narrowest tested `sandbox` permissions. Do not add top-level
navigation, arbitrary popups or other permissions merely to silence an upstream error.
Every added permission requires a demonstrated editor requirement and browser test.

---

# 8. Dedicated Blocks runtime API

The Scratch iframe MUST NOT be granted generic access to all normal ASA cookie-authenticated
project APIs. Provide a minimal bearer-authenticated facade that calls the same Project
Core use cases internally.

Target logical endpoints:

```text
GET  /api/blocks/runtime/projects/{projectId}
PUT  /api/blocks/runtime/projects/{projectId}/draft
GET  /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
PUT  /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
PUT  /api/blocks/runtime/projects/{projectId}/snapshot
```

All new endpoints MUST be specified in `schemas/openapi.yaml` in the same change that
introduces them.

The facade MUST NOT create a second draft/version implementation. `PUT .../draft` calls
Project Core's existing optimistic revision save path.

---

# 9. Scratch storage adapter

The pinned Scratch GUI accepts an injectable storage configuration and calls
`saveProject(...)` repeatedly as changes occur. Scratch Storage also supports custom web
stores for assets. The ASA adapter MUST use those extension points rather than patching
core Scratch persistence logic wherever possible.

Target adapter responsibilities:

```text
AsaScratchStorage
├── register ASA asset GET/PUT store
├── remember canonical server-returned asset references
├── resolve old references when loading
└── never expose object-store credentials

AsaScratchProjectAdapter
├── parse VM save state to projectJson
├── build BlocksProjectDocumentV1
├── call debounced runtime draft save
├── track confirmed server revision
└── expose saved/saving/error/conflict status
```

A fork/patch of upstream Scratch is permitted only when a documented adapter route cannot
meet the requirement. Such a patch MUST be minimal, isolated, tested and listed in the
upstream update compatibility gate.

---

# 10. Save/load transaction semantics

## 10.1 Load

Opening an existing project:

```text
ASA parent authorises project
→ create runtime session
→ iframe READY
→ parent sends bootstrap capability
→ runtime loads Blocks document + revision
→ runtime registers ASA asset store
→ Scratch VM loads projectJson
→ VM resolves referenced assets through ASA asset endpoint
→ editor becomes interactive
```

The editor MUST NOT report “loaded” until project JSON and all assets required for the
initial visible state are either resolved or a concrete recoverable error is shown.

## 10.2 New project

For a new technical/experimental project, the VM initialises the normal default Scratch
project, then the first confirmed save replaces `projectJson: null` with real Scratch 3
JSON.

Ordinary user creation remains gated until the activation milestone.

## 10.3 Asset-before-document ordering

New binary assets MUST be persisted before a document revision that references them is
accepted:

```text
new costume/sound
→ upload immutable asset
→ receive canonical ref
→ include ref in document
→ save draft revision
```

If the draft save then fails, an orphan blob may remain. Do not delete it inline.

A draft that references an unknown/unverified asset MUST fail closed rather than save a
project that cannot later reopen.

## 10.4 Optimistic revision

Every draft save uses the existing semantics:

```text
baseRevision = exact last confirmed server revision
mutationId   = stable identifier for retrying that exact mutation
```

The browser MUST NOT guess a newer revision.

## 10.5 Autosave

Default policy:

```text
debounce after change: 750 ms
maximum dirty interval before an attempted save: 3 s
concurrent saves: 1
queue: latest state only, not an unbounded FIFO
```

If changes occur during an in-flight save, send one newest state after the first request
finishes.

A retry of the same exact mutation reuses its `mutationId`. A later changed document gets
a new `mutationId`.

## 10.6 Save status

The ASA editor shell MUST expose at least:

```text
Сохранено
Есть несохранённые изменения
Сохраняем…
Нет соединения
Конфликт версии
Ошибка сохранения
```

“Сохранено” is allowed only after the server confirms the revision.

---

# 11. Conflict and crash recovery

A `project_revision_conflict` MUST NOT trigger last-write-wins.

Required conflict flow:

```text
409 conflict
→ stop autosave
→ persist local recovery copy
→ fetch current server revision metadata
→ show explicit conflict state
→ preserve both the server copy and local recovery copy
```

M1 needs at minimum a safe “open server version while preserving my local recovery”
path. A later product slice may offer “save my local recovery as a new project/copy”.

Automatic JSON merging of two Scratch project graphs is forbidden unless a future task
proves merge semantics independently.

### 11.1 IndexedDB recovery

The runtime MUST maintain a bounded recovery store, for example:

```text
database: asa-blocks-recovery
key:      tenantId/projectId
```

Recovery contains:

```text
project document / projectJson
baseRevision
updatedAt
pending canonical asset refs
pending unsent asset Blob/ArrayBuffer where needed
```

Do not base64-encode pending binary solely for recovery. Apply explicit total-size and age
limits and surface quota failures.

After a confirmed server save that covers the recovered state, stale recovery data is
removed.

This is crash/network recovery, not a claim of full offline/PWA functionality.

---

# 12. Asset validation and limits

Only formats required by Scratch 3 project assets are accepted in the first release:

```text
svg
png
jpg
wav
mp3
```

Server-side format/container validation MUST not trust the filename or declared MIME type
alone.

Default configurable limits:

```text
projectJson serialised size: 16 MiB
single SVG/PNG/JPG:          10 MiB
single WAV/MP3:              25 MiB
total referenced assets:    250 MiB per project
```

A task MAY tune limits using evidence, but may not silently remove them.

Imported SVG/XML must be treated as untrusted content. Do not introduce an HTML/SVG
execution surface merely to preserve a costume. Asset responses use strict content types,
`nosniff` and the runtime's constrained origin/CSP.

---

# 13. Stage snapshot

Project cards use the existing Project Snapshot subsystem, not a Blocks-specific thumbnail
table.

After a confirmed project save, the runtime SHOULD capture the stage at Scratch aspect
ratio, target 480×360, preferring WebP with PNG fallback.

The snapshot MUST carry the exact **confirmed** source revision. An older rendered stage
must never be attached to a newer project revision.

Snapshot failure is non-fatal:

```text
draft save failure → project is not saved
snapshot failure   → project is saved; card image may be stale/missing
```

Reuse the existing snapshot validation/storage use case rather than creating a separate
Blocks image persistence path.

---

# 14. `.sb3` import/export

## 14.1 Import

Regular ASA-authorised import endpoint, logical form:

```http
POST /api/projects/{projectId}/blocks/import
Content-Type: multipart/form-data
```

Server pipeline:

```text
receive .sb3
→ validate ZIP safely
→ require exactly one project.json
→ parse/validate Scratch project JSON
→ validate/extract supported asset entries
→ persist immutable assets
→ build canonical BlocksProjectDocumentV1
→ save through Project Core optimistic path/checkpoint policy
```

Default configurable archive limits:

```text
compressed size:   100 MiB
unpacked size:     300 MiB
entries:           1000
single entry:      obey asset/document limits
```

Reject path traversal, absolute paths, duplicate `project.json`, malformed ZIP, nested
archive tricks and unsupported dangerous entries. Extraction MUST never write attacker-
controlled paths to the host filesystem.

## 14.2 Export

Logical endpoint:

```http
GET /api/projects/{projectId}/blocks/export.sb3
GET /api/projects/{projectId}/blocks/export.sb3?versionId={uuid}
```

Pipeline:

```text
load authorised draft or immutable version
→ verify document
→ resolve every referenced asset
→ create project.json
→ add Scratch-named asset files
→ stream ZIP as .sb3
```

An export is successful only if the resulting archive opens in the pinned editor and in a
representative official/current Scratch-compatible editor used by the compatibility test.

Missing referenced bytes are an error; do not silently export a damaged partial project.

---

# 15. Milestone execution order

The IDs below are stable planning identifiers. They are not active tasks until selected by
the owner/current execution state.

## VSCR-M0 — Foundation

Purpose: establish the non-creatable module contract, isolated pinned upstream runtime,
hard ban on inline binary persistence, focused tests and architecture decision.

M0 MUST NOT claim durable user save/load.

## VSCR-M1 — Durable persistence bridge

### VSCR-M1-001 — Blocks bounded context

Move the subject contract/provider from application composition into
`contexts/blocks/**` following the existing context conventions. `apps/api` keeps only
composition/transport wiring.

**Do not** move code into `modules/blocks` under the current repository architecture.

Acceptance:

```text
context builds/types/lints
module registry imports public @asa-lab/blocks entry
no subject-context boundary violation
manifest remains non-creatable
no behaviour regression in module catalogue
```

### VSCR-M1-002 — Runtime message protocol and host skeleton

Implement the separate-origin iframe host, versioned READY/INIT/status protocol and exact
origin/nonce validation. No durable write yet.

Acceptance: wrong origin, wrong nonce and wrong project messages are rejected in tests.

### VSCR-M1-003 — Runtime capability auth

Implement issuance, refresh and verification of least-privilege project-scoped runtime
capabilities. Introduce no general bearer access to ASA APIs.

Acceptance includes expiry, wrong-project, wrong-tenant, wrong-module, tamper and replay/
retry semantics appropriate to the selected credential design.

### VSCR-M1-004 — Blob-store port + asset persistence

Introduce Blocks asset metadata and a private blob-store adapter. If a local MinIO service
is selected, add it only to the existing Compose project and update backup design before
production activation.

Acceptance:

```text
upload supported asset
server computes digest/key
reload exact bytes
same-tenant dedup works if enabled
forged objectKey/ref is rejected
cross-tenant access is rejected
API cannot be tricked into public bucket/object access
```

### VSCR-M1-005 — Project load/save/autosave/recovery

Connect Scratch GUI/VM storage hooks to the dedicated Blocks runtime facade and Project
Core revision use case.

Acceptance journey:

```text
open technical project
add block
add sprite/costume
wait for confirmed save
close browser
reopen
same blocks/sprites/assets appear
```

Also test network failure, browser close during dirty state and revision conflict.

### VSCR-M1-006 — Stage snapshot

Connect stage capture to existing Project Snapshot semantics with source revision.

### VSCR-M1-007 — `.sb3` round trip

Implement safe import/export and compatibility fixtures.

Fixtures MUST be ASA-authored/generated or otherwise have explicit redistribution rights;
do not copy arbitrary community Scratch projects into the repository.

Minimum fixtures:

```text
basic motion
multiple sprites
vector costume
bitmap costume
sound
variables/lists
clones
one explicitly classified extension fixture
```

For each fixture:

```text
import → load → edit → save → export → reload
```

### VSCR-M1-008 — M1 acceptance gate

M1 is complete only when all are proven on the same candidate SHA:

```text
A. empty technical project initialises
B. editor loads
C. blocks change saves
D. sprite change saves
E. SVG/PNG/JPG costume reloads
F. WAV/MP3 sound reloads
G. close/reopen reproduces work
H. revision conflict never silently overwrites
I. crash recovery preserves dirty local state
J. stage snapshot is tied to confirmed revision
K. checkpoint restore reopens historical work
L. .sb3 import succeeds
M. .sb3 export succeeds and reopens
N. Project Core JSON contains no inline asset bytes/full .sb3
O. cross-tenant asset access is denied
P. focused and required repository gates are green/non-skipped
```

**After M1, the module still remains `coming_soon` for ordinary users.** Product shell,
viewer and integration are finished before activation.

---

# 16. VSCR-M2 — ASA product integration

## VSCR-M2-001 — ASA editor shell

Implement `/projects/:projectId/blocks` using ASA navigation/title/save-state conventions.
Reuse the neutral shared editor-header contract where available; do not import another
subject's editor header/CSS as a dependency.

The page owns ASA chrome; the iframe owns the Scratch editing surface.

Testing before public activation may use an explicit development/test-only flag. A hidden
deep link MUST NOT become an accidental production bypass of module availability.

## VSCR-M2-002 — Read-only player/viewer

Implement the module viewer route for an **immutable project version**. Viewer mode may
run green flag/stop/fullscreen but MUST NOT save or mutate the project.

## VSCR-M2-003 — Classroom/Learning integration

Blocks projects use the existing ASA assignment/attempt/submission runtime. Do not create
`blocks_assignments`, Scratch assignments or a second gradebook.

The canonical direct-project submission path already freezes work into an immutable
`project_versions` record and records `project_version_id`; Blocks MUST plug into that
mechanism rather than duplicate it.

Critical evidence:

```text
learner submits version N
→ learner continues editing draft to N+1
→ teacher opens submission
→ teacher still sees exactly submitted version N
```

## VSCR-M2-004 — Gallery and remix

Publication uses ASA Gallery/project metadata. Viewer uses the immutable published
version.

Remix uses ASA project provenance. Same-tenant remixes MAY reuse immutable asset blobs;
cross-tenant remixes MUST establish destination-tenant-owned references/copies and MUST
NOT expose the source tenant's private storage key/credentials.

## VSCR-M2-005 — Product acceptance

Before activation prove:

```text
create route is ready but still gated
editor shell works desktop + target school viewport
save/reload works through real browser
viewer works from immutable version
assignment submission freezes exact version
gallery/player works
remix provenance works
import/export remains green
```

## VSCR-M2-006 — Activation

Only this final slice changes module availability from `coming_soon` to `active`.

Activation MUST be the smallest possible change after all preceding M1/M2 evidence is
green. If the activation changes anything besides availability/wiring/tests required by
that flip, split it.

---

# 17. VSCR-M3 — Sovereign/self-hosted acceptance

“Sovereign” in this milestone means **no critical dependency on Scratch Foundation
network services during normal editing**. It does not mean a browser can operate with no
connection to the local/ASA server; full client-offline/PWA behaviour is a separate M4
concern.

## VSCR-M3-001 — External dependency and rights inventory

Before mirroring libraries, inventory every outbound host and every media/library source.
Classify each dependency:

```text
LOCAL_REQUIRED
EXTERNAL_OPTIONAL
HARDWARE_LOCAL
UNSUPPORTED
```

Also classify redistribution rights. Do not scrape/copy Scratch CDN libraries or brand
assets into ASA merely because the code is open source.

## VSCR-M3-002 — Local approved libraries

Mirror/bundle only assets with confirmed rights and required metadata. Sprites, costumes,
backdrops, sounds and thumbnails used by the school baseline must resolve without Scratch
Foundation hosts.

## VSCR-M3-003 — Extension policy

Each extension is classified:

```text
A: fully local
B: browser/hardware local dependency
C: requires external service
D: unsupported
```

Only a tested allowlist may be shown as supported in sovereign mode. Preserve unknown
extension identifiers in imported projects where safe, but do not falsely claim they run.

## VSCR-M3-004 — Network-deny/CSP acceptance

Browser tests fail on unexpected outbound requests to Scratch Foundation or any host not
on the explicit runtime allowlist.

Test with those hosts denied:

```text
open editor
create/load project
choose approved local sprite/costume/sound
run
save
reload
viewer
export
```

Runtime/server headers include an explicit CSP, `nosniff`, referrer policy and narrowly
configured `frame-ancestors`. API CORS allows only configured runtime origins; never `*`.

## VSCR-M3-005 — Backup and restore

Object storage makes PostgreSQL-only backup insufficient. Before sovereign/production
acceptance, the guarded backup design MUST cover both:

```text
PostgreSQL project/version/asset metadata
+ corresponding Blocks blob/object storage
```

A restore test MUST use an isolated test destination according to ASA backup rules and
prove an old project version reopens with all assets.

Do not modify live restore policy or restore production data as part of a normal VSCR
task.

## VSCR-M3-006 — Sovereign acceptance gate

With Scratch Foundation hosts denied:

```text
editor loads
approved libraries load
new project saves/reloads
historical version loads
viewer runs
assignment submission/view works
import/export works
no unexpected Scratch-host request occurs
backup/isolated restore evidence exists
```

Only then may the product claim independence from availability of `scratch.mit.edu` for
the supported baseline.

---

# 18. VSCR-M4 — Optional extensions, separate from core delivery

These are independent programmes and MUST NOT block M1–M3:

- **M4-A Scratch Link / hardware:** client-machine bridge for supported hardware such as
  micro:bit/LEGO where applicable. Do not pretend it is a Docker service.
- **M4-B ASA cloud variables:** ASA-owned real-time provider; never silently connect to
  Scratch cloud data services.
- **M4-C ASA Backpack:** ASA-owned personal asset/script storage using ASA identity and
  blob storage.
- **M4-D full offline/PWA:** browser-side application/runtime/assets and queued sync for
  operation without connection to the ASA server.
- **M4-E asset GC:** reference-aware, checkpoint-safe garbage collection with dry-run and
  restore evidence.

Each requires its own task/spec before coding.

---

# 19. Upstream update policy

A Scratch upstream change is a dependency upgrade, not routine application deployment.
The pinned commit may change only in a dedicated update change.

Required upgrade evidence grows with implemented milestones:

```text
always: image build + health + editor smoke + licence inventory
M1+: old fixture load + save/reload + .sb3 round trip
M2+: viewer + assignment submission immutable-version check
M3+: outbound network-deny + local-library checks
```

An automated watcher MAY open an update proposal, but MUST NOT merge, deploy or rewrite
`upstream.env` in production automatically.

Any local upstream patch must be enumerated so the upgrade test proves it still applies
or can be removed.

---

# 20. API and security requirements

Every Blocks API change MUST satisfy:

```text
OpenAPI updated in same slice
server derives tenant/principal from authenticated context/capability
no tenantId accepted from untrusted body as authority
strict body shape
strict size limits
idempotency where retries can occur
no secrets/tokens in response logs
RLS/tenant tests for new relational metadata
negative auth tests, not only happy path
```

Runtime bearer endpoints and normal cookie-authenticated endpoints are distinct trust
surfaces and MUST be tested as such.

---

# 21. Observability and privacy

Allowed operational events include:

```text
blocks.runtime.started
blocks.project.loaded
blocks.project.saved
blocks.project.save_conflict
blocks.asset.uploaded
blocks.asset.load_failed
blocks.snapshot.saved
blocks.sb3.imported
blocks.sb3.import_failed
blocks.sb3.exported
```

Operational metadata MAY include project/tenant identifiers, revision, duration, asset
format/size and status when consistent with ASA logging policy.

Logs/telemetry MUST NOT contain:

```text
runtime token
session cookie
object-store secret
complete projectJson
learner-authored text merely for debugging
raw costume/sound bytes
```

---

# 22. Performance and resilience baseline

Initial school-LAN targets are engineering budgets, not reasons to corrupt state:

```text
only one active draft-save request per editor
autosave normally confirms within 2 s on healthy LAN
repeat identical asset should not be re-uploaded after canonical ref is known
snapshot capture/upload no more often than needed (target ≥10 s between captures)
Scratch runtime crash/reload must not crash ASA shell
slow snapshot must never block draft durability
```

If a target is missed, instrument first. Do not remove revision checks, limits or asset
verification to make a benchmark green.

---

# 23. Testing contract

Every milestone has four evidence layers as applicable:

```text
unit/domain
API/integration
cross-context contract
real-browser journey
```

A test that is skipped because Docker/PostgreSQL/browser is absent is **SKIPPED**, not
PASS.

Planned gate names MUST NOT be written into canonical execution state until the scripts
actually exist. Once a Blocks focused gate exists, local, CI and owner evidence must run
the same command.

Browser tests MUST include at least:

```text
reload after save
network interruption/retry
revision conflict
large/invalid asset rejection
cross-tenant asset denial
iframe wrong-origin rejection
runtime token expiry/refresh
submitted immutable-version view
```

---

# 24. Rollback design

The integration is intentionally reversible until activation:

- `blocks` stays `coming_soon` while persistence/product work is incomplete;
- Scratch runtime is a separate service boundary;
- new storage metadata migrations are additive;
- binary storage is private and initially consumed only by Blocks;
- Project Core semantics remain unchanged;
- other subject modules remain isolated.

If a milestone fails, rollback means disabling/removing that VSCR wiring while preserving
stored project/version/blob data. Do not “rollback” by deleting learner work.

---

# 25. Definition of Done for the core programme

The core VSCR programme (M0–M3) is done only when all are true:

1. Visual Programming project can be created from ASA after the activation gate.
2. The pinned editor opens inside the ASA shell without receiving ambient ASA authority.
3. Blocks, sprites, costumes and sounds save durably.
4. Closing/reopening reproduces the same project.
5. Binary assets are outside Project Core JSONB and cannot be forged cross-tenant.
6. Autosave uses optimistic revisions and never silently overwrites conflicts.
7. Crash/network recovery preserves dirty local work.
8. Historical checkpoints reopen with their historical assets.
9. `.sb3` import is safe against malformed/archive attacks.
10. `.sb3` export reopens compatibly.
11. Project cards use revision-bound snapshots.
12. Read-only viewer uses immutable project versions.
13. Learning submission uses ASA's canonical immutable `project_version_id` path.
14. Gallery/publication uses ASA metadata/version semantics.
15. Remix provenance is preserved and cross-tenant asset access remains isolated.
16. Supported school editing works with Scratch Foundation hosts blocked.
17. Only rights-cleared local media/extensions are claimed as supported.
18. Object storage and PostgreSQL are both covered by backup/isolated restore evidence.
19. Scratch upstream can be updated only through a pinned, tested change.
20. No neighbouring subject module, user model or Learning state machine was forked to
    make Blocks work.

---

# 26. Short instruction for the next coding bot

When the owner selects a VSCR task, the bot should receive only one task ID from this
specification. Example form:

```text
Implement VSCR-M1-004 only.
Read AGENTS.md, START_HERE_FOR_AI.md,
docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md §0–§7 and §15,
ADR-VSCR-001, then inspect current storage/compose code.
Do not activate blocks, do not deploy, do not touch other subject contexts.
Return exact changed paths, tests/gates, SHA and any STOP condition.
```

That pattern is intentional: the master plan gives context, but **the task ID limits the
work**.
