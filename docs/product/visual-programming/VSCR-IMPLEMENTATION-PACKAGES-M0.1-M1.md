# VSCR implementation packages — M0.1 and M1

**Status:** normative task packages for the first implementation wave  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)  
**Architecture:** [`../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md)

These packages turn the accepted D0 architecture into bounded coding tasks. They are not a
work queue. A package is executable only when its task ID is explicitly selected by the
owner/current execution state.

A coding agent MUST implement **one package only** and stop after its acceptance evidence.

---

# 0. Package execution rules

For every package below:

```text
1. verify selected task ID
2. verify all prerequisite task evidence exists
3. read master §0–§4 + selected package
4. read every D0 contract listed by package
5. inspect current code before editing
6. state expected changed paths
7. do not widen scope without a documented STOP reason
8. run focused package tests
9. run repository-required gate(s)
10. report exact SHA/CI separately
11. do not start the next package
```

If current code differs materially from the package, STOP and report the mismatch instead
of silently redesigning the package.

M2/M3 coding MUST NOT begin from the master roadmap alone. After M1 acceptance, dedicated
M2 implementation packages must be written against the actual accepted M1 interfaces.
The same rule applies to M3. This prevents future tasks from coding against speculative
interfaces.

---

# VSCR-M0.1-001 — Correct persistent Blocks document v1

## Goal

Remove the physical object-store locator from the pre-release Blocks project document and
make the v1 asset reference strict enough for later durability work.

## Preconditions

```text
PR/M0 branch still has no real user Blocks data
blocks remains coming_soon
master v2 + ADR v2 accepted
```

Read:

```text
VSCR-D0-003-ASSET-STORAGE-CONTRACT.md §1–§3, §14
```

## Expected changed paths

Only:

```text
apps/api/src/blocks-module.ts
apps/api/src/blocks-module.spec.ts
```

A documentation typo directly caused by the code correction may be fixed in the same
slice, but no infrastructure/API/storage code is authorised.

## Exact implementation

Change:

```ts
interface BlocksAssetReferenceV1 {
  assetId: string;
  dataFormat: 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';
  sha256: string;
  sizeBytes: number;
}
```

Remove `objectKey` from the interface and validator.

Asset validation v1:

```text
assetId: exactly lowercase 32 hex
format: exactly svg|png|jpg|wav|mp3
sha256: exactly lowercase 64 hex
sizeBytes: positive safe integer
```

Asset reference keys are strict. Allowed keys are exactly:

```text
assetId
dataFormat
sha256
sizeBytes
```

Any extra key is rejected. This includes the former `objectKey` and all binary-like
fields (`data`, `base64`, `bytes`, `dataUrl`). Keep the dedicated inline-binary diagnostic
for the known binary keys so the architectural error remains explicit.

Top-level document remains:

```text
schemaVersion
format
projectJson
assets
```

Existing explicit `sb3`/`sb3Base64` rejection remains.

`projectJson` structural M0 check remains intentionally shallow in this task; semantic
Scratch validation belongs to the persistence implementation.

Keep:

```text
schemaVersion = 1
availability = coming_soon
projectType = scratch-3
```

Bump provider `moduleVersion` from `0.1.0` to `0.1.1` to record the pre-release contract
correction. Do not create schemaVersion 2 because no durable/public Blocks v1 data has been
accepted yet and master v2 defines this corrected shape as the intended v1.

## Required tests

Update/add tests proving:

```text
empty document valid
canonical supported asset valid
objectKey is rejected as an unknown asset field
uppercase/short/non-MD5 assetId rejected
unsupported format gif/json/sb3 rejected
uppercase/invalid SHA-256 rejected
zero/negative/non-integer size rejected
inline base64 rejected with inline_binary diagnostic
embedded sb3 rejected
manifest still coming_soon
preview count unchanged
```

## Forbidden

```text
no database migration
no S3/MinIO
no Scratch host change
no Project Core change
no module activation
no current.yaml change unless this exact task is selected by governance
```

## Done

```text
focused Blocks contract tests PASS
API typecheck PASS
format/lint PASS
no objectKey accepted/persisted by Blocks document provider
```

Stop after reporting evidence.

---

# VSCR-M1-001 — Extract `@asa-lab/blocks` bounded context

## Goal

Move Blocks subject contract/provider out of API composition into a normal isolated ASA
context without changing behaviour.

## Preconditions

```text
VSCR-M0.1-001 accepted
blocks remains coming_soon
```

Read:

```text
master §5–§6
D0-002 persistence contract only for future boundary awareness
existing contexts/three-d structure as repository convention
```

## Expected changed paths

```text
contexts/blocks/package.json
contexts/blocks/project.json
contexts/blocks/tsconfig.json
contexts/blocks/index.ts
contexts/blocks/module.ts
contexts/blocks/domain/document.ts
contexts/blocks/domain/validation.ts
contexts/blocks/testing/module.spec.ts
apps/api/package.json
apps/api/src/module-registry.ts
apps/api/src/blocks-module.ts          # delete after imports migrate
apps/api/src/blocks-module.spec.ts     # delete/move after tests migrate
pnpm-lock.yaml                         # only workspace-link update if pnpm changes it
package.json                            # only to add blocks build before an existing registry-loading focused gate if CI proves it is required
.github/workflows/scratch-m0-focused.yml # only if paths/commands must follow moved tests
```

Do not invent `modules/blocks`.

## Exact package metadata

`contexts/blocks/package.json` follows the existing context package convention:

```json
{
  "name": "@asa-lab/blocks",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "@asa-lab/module-sdk": "workspace:*"
  }
}
```

`apps/api/package.json` adds:

```json
"@asa-lab/blocks": "workspace:*"
```

`project.json`:

```text
name: blocks
projectType: library
sourceRoot: contexts/blocks
tags: type:lib, scope:core, context:blocks
build: tsc -p contexts/blocks/tsconfig.json
typecheck: tsc -p contexts/blocks/tsconfig.json --noEmit
lint: eslint contexts/blocks
```

`tsconfig.json` follows the existing isolated-context pattern and includes only public,
module, domain/application files required by this task; testing is excluded from build.

## Exact code split

```text
domain/document.ts
  BlocksAssetFormat
  BlocksAssetReferenceV1
  BlocksProjectDocumentV1

domain/validation.ts
  structural validator helpers
  validateBlocksDocument(...)
module.ts
  BLOCKS_MODULE
  createPreview / module provider assembly
index.ts
  public exports only
```

No Nest/Fastify/pg/React/Scratch package import is permitted in `contexts/blocks` in this
task.

`module-registry.ts` changes from local import to:

```ts
import { BLOCKS_MODULE } from '@asa-lab/blocks';
```

Delete the old API-local module/spec only after all references/tests have moved.

## Behaviour that MUST remain byte-for-semantic equivalent

```text
moduleKey blocks
moduleVersion 0.1.1
availability coming_soon
projectType scratch-3
schemaVersion 1
editor/viewer routes
empty document
asset validation
preview summary
```

No persistence/API feature is added.

## Required tests/gates

```text
nx build module-sdk
nx build blocks
nx run blocks:typecheck
nx run blocks:lint
Blocks module tests from contexts/blocks/testing
existing modules controller tests
API typecheck
boundaries:check
focused Scratch workflow updated to execute the moved tests/build
any existing focused gate that loads apps/api/src/modules.controller.spec.ts builds blocks first
```

## Forbidden

```text
no host changes
no database/storage
no Project Core guard
no runtime endpoints
no Web editor route
no activation
no unrelated context refactor
```

## Done

API composes `@asa-lab/blocks`; no Blocks subject provider remains defined in
`apps/api/src/blocks-module.ts`; behaviour is unchanged and boundaries pass.

Stop.

---

# VSCR-M1-002 — Build ASA-owned Scratch host and message skeleton

## Goal

Replace the M0 playground runtime boundary with an ASA-owned host around the pinned
Scratch shipping standalone distribution. Establish secure parent/iframe protocol without
implementing durable server writes yet.

## Preconditions

```text
M1-001 accepted
D0-001 accepted
D0-004 accepted for iframe/origin semantics
```

Read in full:

```text
VSCR-D0-001-SCRATCH-HOST-CONTRACT.md
VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md §10–§16
```

## Expected changed paths

```text
infra/scratch-editor/Dockerfile
infra/scratch-editor/nginx.conf or nginx.conf.template
infra/scratch-editor/README.md
infra/scratch-editor/host/index.html
infra/scratch-editor/host/host.js
infra/scratch-editor/host/host.css
apps/web/src/blocks/**                  # minimal parent test harness/component only
apps/web/package.json                   # only if needed by existing Web conventions; no Scratch deps
.github/workflows/scratch-m0-focused.yml or new focused Blocks host workflow
bookkeeping tests/e2e under tests/blocks or e2e/blocks-*.spec.ts
```

Do not add Scratch npm dependencies to `apps/web`.

## Docker build exact direction

Build stage:

```text
clone exact upstream commit
verify commit/version
npm ci
NODE_ENV=production BUILD_MODE=dist npm run build (or the exact pinned command that
produces the verified standalone dist)
assert packages/scratch-gui/dist/scratch-gui-standalone.js
```

Runtime image copies the standalone distribution/static dependencies plus ASA-owned host
files. It no longer uses upstream `build/index.html` as root entry.

If the exact upstream command differs after inspection, the agent may adjust only the
build command while preserving the required output and must record why. It must not switch
back to playground.

## Parent skeleton

Create a minimal reusable ASA Blocks iframe host component under `apps/web/src/blocks/`.
It accepts explicit props/state supplied by the eventual project page, including:

```text
runtimeOrigin
projectId
mode
runtimeToken
draftRevision
assets
recoveryNamespace
```

This task does not fetch/issue a real runtime token yet. Tests use a deterministic fixture
payload. Production code must not expose an unauthorised hidden Blocks editor route as a
result of this task.

Parent creates random `sessionNonce`, validates child message origin, and sends exact
`ASA_BLOCKS_INIT` only to exact runtimeOrigin.

## Child skeleton

Host JS:

```text
waits for valid INIT
validates event.source + parent origin + protocol/project/nonce
stores capability only in memory
creates custom ScratchStorage/GUIStorage skeleton
caches pinned default project assets
creates EditorState with ASA configFactory
mounts createStandaloneRoot
obtains VM through onVmInit
suppresses persistence: canSave=false, canCreateNew=false
removes Backpack/cloud/account/community/site-navigation ownership
emits READY and STATUS
```

No draft PUT/asset PUT implementation in this task. `saveProject()` is a defensive rejected
promise if unexpectedly invoked.

For an existing test project, custom Project/asset web-store functions may be stubbed to
controlled fixture endpoints or responses; real bearer runtime API comes in later tasks.

## Message types to implement now

```text
INIT
TOKEN_UPDATE
FLUSH_REQUEST (returns not-ready/no-durable-save result in this task)
STOP
READY
STATUS
TOKEN_REFRESH_REQUIRED skeleton
FLUSH_RESULT
FATAL
```

No generic RPC.

## Required tests

Unit/browser tests prove:

```text
host does not render authorised editor before INIT
wrong source/origin/project/nonce rejected
exact INIT mounts Scratch
READY includes exact pin identity
runtime token absent from URL/localStorage/sessionStorage/IndexedDB
Backpack/cloud/server save absent
logo cannot navigate to scratch.mit.edu
getLibraryAssetUrl does not implicitly use Scratch Foundation
new/default project loads locally
player mode mounts read-only/player state
parent ignores wrong-origin child messages
parent never uses postMessage target '*'
runtime crash leaves parent component alive/error state
```

Docker smoke changes expected document marker from upstream playground title to an
ASA-host marker plus presence of standalone vendor bundle.

## Forbidden

```text
no runtime JWT issuance yet
no S3/MinIO
no Project Core save
no production hidden route
no module activation
no upstream fork
```

## Done

Pinned standalone ASA host is reproducibly built and browser-tested; message boundary is
established; no durable write is claimed.

Stop.

---

# VSCR-M1-003 — Runtime capability auth and path-scoped origin/CORS

## Goal

Create the real short-lived editor capability and protected runtime API trust surface,
without asset storage or draft persistence yet.

## Preconditions

```text
M1-002 accepted
D0-004 accepted
runtime host supports INIT/TOKEN_UPDATE
```

Read:

```text
VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md in full
existing apps/api/src/app.factory.ts mutation-origin hook
existing project/session actor resolution used by ProjectsController
```

## Expected changed paths

```text
apps/api/package.json
pnpm-lock.yaml
apps/api/src/tokens.ts
apps/api/src/app.module.ts
apps/api/src/app.factory.ts
apps/api/src/blocks-runtime-token.service.ts
apps/api/src/blocks-runtime-session.controller.ts
apps/api/src/blocks-runtime.controller.ts
apps/api/src/blocks-runtime-rate-limit.ts
apps/api/src/*.spec.ts for the above
apps/web/src/blocks/**
infra/scratch-editor/host/host.js
infra/scratch-editor/nginx.conf.template or generated-config mechanism
schemas/openapi.yaml
.env*.example
```

`apps/api/src/origin-policy.ts` may be changed only to add a reusable safe origin parser or
helper; generic ASA mutation semantics must not widen.

## Dependencies

Add:

```text
jose
```

Pin the exact selected version through normal pnpm workflow. Do not manually edit lockfile.
Run dependency/security/license gates before considering task done.

## Configuration

Add validated configuration names:

```text
ASA_BLOCKS_RUNTIME_ORIGIN
ASA_BLOCKS_RUNTIME_SIGNING_KEY
```

Signing key minimum entropy/length follows D0-004. Tests inject controlled values; no
secret is committed.

## Token service exact responsibilities

```text
issueEditorCapability(...)
verifyRuntimeCapability(token, expected permission/resource)
```

Claims/HS256/iss/aud/TTL exactly follow D0-004.

No capability permissions are accepted from HTTP body.

## Runtime-session endpoint

Implement:

```http
POST /api/projects/{projectId}/blocks/runtime-session
body {"mode":"editor"}
```

Reuse existing ASA account/student actor resolution and Project Core load/authorisation.
Require moduleKey `blocks`. Return versioned response from D0-004.

Because storage is not yet implemented, `assets` may only be the current canonical document
refs already present in a test project; do not fabricate storage metadata.

## Runtime API skeleton

Create `/api/blocks/runtime/**` controller routes only as needed to test auth boundary.
At minimum implement an authenticated bootstrap/metadata GET that returns safe project
metadata. Draft/asset write methods may return a stable `501/not_implemented` after auth
until their owning tasks, but MUST NOT accidentally call generic write code yet.

Do not publish routes that claim write success without implementation.

## app.factory exact security change

For `/api/blocks/runtime/**`:

```text
OPTIONS handled by exact runtime CORS policy
non-OPTIONS browser origin must exactly match ASA_BLOCKS_RUNTIME_ORIGIN
bearer capability required in controller/guard
normal cookie mutation origin check is not applied as authority
normal generic mutation limiter is not double-applied
runtime-specific limiter applies
```

For every other path, existing origin and abuse behaviour remains unchanged.

Parent ASA CSP gains exact validated runtime origin in `frame-src`. Runtime CSP gains exact
ASA parent in `frame-ancestors` and exact API origin in `connect-src` as defined by D0-004.

## Rate limiter

Implement initial D0-004 ceilings keyed by:

```text
jti capability bucket
coarse IP bucket
invalid-token IP bucket
runtime-session normal session bucket
asset concurrency hook reserved for M1-004
```

No unbounded Map. Follow existing limiter bounded-key/eviction style where possible.

## Host token refresh

Child emits refresh-needed near expiry; parent calls runtime-session again and sends
TOKEN_UPDATE. Tests can use shortened injected time/clock; production TTL remains 10 min.

## Required tests

```text
valid editor capability accepted
wrong/tampered/expired/nbf/aud/iss/alg/project/tenant/module denied
runtime origin exact match accepted
wrong/null browser runtime origin denied where browser origin is required
runtime origin cannot mutate normal ASA endpoint
normal ASA Web mutation origin behaviour unchanged
runtime request cookie without bearer denied
bearer with credentials omitted works
session endpoint derives permissions server-side
session endpoint refuses non-blocks project
runtime token never logged/persisted
parent refresh updates child token
pending host state survives token replacement
runtime rate limits use jti/coarse IP rather than ordinary session limiter
30 capability synthetic rate model remains under normal ceiling
OpenAPI parses/contracts check
```

## Forbidden

```text
no generic Bearer auth for all ASA APIs
no runtime origin in generic allowed web origins
no asset storage
no draft-save success
no player public issuance yet unless explicitly split as M2 package
no activation
```

## Done

Real editor capability trust surface exists, is isolated from cookie APIs, and host token
refresh works. Writes still remain unimplemented until their owner packages.

Stop.

---

# VSCR-M1-004 — Asset metadata, private S3 store and test fixture

## Goal

Make Scratch costume/sound/image bytes durable in tenant-scoped private object storage and
provide canonical immutable asset references.

## Preconditions

```text
M1-003 accepted
D0-003 accepted
runtime bearer/origin infrastructure works
```

Read:

```text
VSCR-D0-003-ASSET-STORAGE-CONTRACT.md in full
VSCR-D0-005 §5–§7 for Compose ownership
```

## Expected changed paths

```text
contexts/blocks/application/ports.ts
contexts/blocks/application/*asset*.ts
contexts/blocks/infrastructure/* only if repository convention permits adapter there
contexts/blocks/testing/**
apps/api/package.json
pnpm-lock.yaml
apps/api/src/blocks-blob-store*.ts
apps/api/src/blocks-asset*.ts
apps/api/src/blocks-runtime.controller.ts
apps/api/src/app.module.ts
migrations/<next>_blocks_asset_storage.sql
compose*.yaml                         # only selected existing compose files/profiles
.env*.example
schemas/openapi.yaml
tests/blocks/**
```

## Dependencies

Add exactly the selected S3 client family:

```text
@aws-sdk/client-s3
```

Use normal `pnpm add`/workspace workflow and frozen lock verification. Exact version is the
one resolved/pinned by the implementation PR after security/license checks.

Any separate format-sniff/XML dependency must be named in the implementation report and
pass the same gates; adding a broad media processing framework is not authorised.

## Migration

Implement `blocks_blobs` and `blocks_asset_aliases` with semantics exactly from D0-003:

```text
tenant-scoped PKs
alias FK to blob
alias immutable
ON DELETE RESTRICT
format/digest/size CHECKs
RLS following current ASA tenant conventions
no public grants
```

Migration is additive only.

## S3 adapter

Implement configuration for:

```text
ASA_OBJECT_STORAGE_ENDPOINT
ASA_OBJECT_STORAGE_REGION
ASA_OBJECT_STORAGE_BUCKET
ASA_OBJECT_STORAGE_ACCESS_KEY
ASA_OBJECT_STORAGE_SECRET_KEY
ASA_OBJECT_STORAGE_FORCE_PATH_STYLE
```

Adapter derives key server-side. Bucket private. Runtime never gets S3 credentials/key.

## Local/test MinIO

Add MinIO only to existing ASA Compose project/profile if local object integration tests
need it.

Requirements:

```text
internal 9000
healthcheck
persistent test/dev volume as appropriate
console not public by default
credentials via environment
no second compose project
```

## Asset PUT

Implement exact streaming/temp/hash/validation/object/DB sequence from D0-003.

Success must be:

```json
{
  "status": "ok",
  "asset": {
    "assetId": "32hex",
    "dataFormat": "svg|png|jpg|wav|mp3",
    "sha256": "64hex",
    "sizeBytes": 1
  }
}
```

Alias collision with different SHA is 409 and never retargets.

## Asset GET

At this task stage, GET is authorised only when the current test Blocks document already
contains the canonical ref. Do not introduce tenant-wide MD5 lookup as sufficient read
authority.

Return exact bytes/content type/nosniff.

## Test-only technical project fixture

Create the fixture factory defined by D0-002 in test-only code. It creates a Blocks project
with the exact empty document against isolated test DB/repository infrastructure while
module remains coming_soon.

No production debug creation endpoint.

## Required tests

```text
migration smoke + RLS/cross-tenant
PUT valid svg/png/jpg/wav/mp3
wrong bytes/format rejected
computed MD5 must equal assetId
SHA computed server-side
same upload idempotent
same alias different bytes conflict
same-tenant SHA dedup reuses blob metadata where applicable
objectKey never returned/documented as client field
GET exact bytes for referenced ref
GET same-tenant but unreferenced alias denied
cross-tenant GET/PUT denied
S3 failure => no DB durability claim
DB failure after object write => request fails, no inline delete assumption
temp file cleanup
per-file limits
MinIO/compose health if selected
object outage does not break unrelated API smoke
test project fixture works while normal blocks creation remains rejected
```

## Forbidden

```text
no draft save bridge yet
no autosave
no object GC
no public bucket/presigned broad access
no activation
```

## Done

Canonical asset PUT/GET, immutable tenant metadata and test fixture work under real
S3-compatible integration tests. Module remains gated.

Stop.

---

# VSCR-M1-005 — Project Core persistence guard + durable load/save bridge

## Goal

Close the end-to-end durability loop:

```text
Scratch VM state
→ ensure every referenced asset durable
→ canonical Blocks document
→ generic Project Core persistence guard
→ optimistic draft revision
→ close/reopen same work
```

This package implements basic durable save/load. Generation scheduler/recovery/conflict UI
hardening belongs to M1-006, though base revision conflicts must already fail safely here.

## Preconditions

```text
M1-004 accepted
D0-001, D0-002, D0-003, D0-004 accepted
ASA host has real token/storage request support
asset API and fixture exist
```

## Expected changed paths

```text
contexts/projects/application/ports.ts
contexts/projects/application/project.usecases.ts
contexts/projects/testing/**
contexts/blocks/application/*document*.ts
contexts/blocks/application/*durab*.ts
contexts/blocks/testing/**
apps/api/src/app.module.ts
apps/api/src/blocks-persistence.guard.ts
apps/api/src/blocks-runtime.controller.ts
apps/api/src/blocks-runtime*.spec.ts
infra/scratch-editor/host/host.js
apps/web/src/blocks/**                 # save status plumbing only if needed by test harness
schemas/openapi.yaml
tests/blocks/**
e2e/blocks-*.spec.ts
```

If a compatibility parser dependency is needed, it must be selected before code in this
package report/plan and pinned normally; no Scratch parser enters ASA Web.

## Project Core generic change

Add the subject-neutral `ProjectDraftPersistenceGuardPort` from D0-002.

Change `SaveDraftUseCase` constructor from two dependencies to three:

```text
repository
module catalog
persistence guard
```

Canonical execution order exactly follows D0-002. Non-Blocks guard path is success/no-op.

Update every existing `new SaveDraftUseCase(...)` call/test factory with the no-op/default
guard required by the new constructor. Do not modify other Project Core semantics.

## Blocks durable validator

For non-null project JSON:

```text
validate supported Scratch 3 semantic/document form using selected pinned validator
extract costume/sound expected (assetId,dataFormat,md5ext) set
require exact equality with document.assets[] key set
load tenant alias/blob metadata
require digest/size/format equality
enforce project aggregate limit
```

For `projectJson:null`, require empty `assets[]`.

The guard writes nothing.

## Runtime raw project load

Implement:

```http
GET /api/blocks/runtime/projects/{projectId}/project.json
```

For existing project:

```text
verify editor capability
load authorised project
require blocks
require projectJson != null
return raw Scratch project JSON only
```

The Scratch Project web store consumes this raw JSON. Do not return the ASA envelope from
this endpoint.

Bootstrap returns canonical `assets[]` and confirmed draft revision.

## Runtime draft PUT

Implement:

```http
PUT /api/blocks/runtime/projects/{projectId}/draft
Authorization bearer
```

Body:

```json
{
  "document": {},
  "baseRevision": 1,
  "mutationId": "uuid-v4"
}
```

After runtime auth, delegate to the same `SaveDraftUseCase` used by generic Project API.
Do not duplicate repository save logic.

Return confirmed canonical draft revision/document metadata in a stable OpenAPI response.

## Host `ensureReferencedAssetsDurable`

On a save snapshot:

```text
vmState = vm.toJSON()
parse projectJson
extract unique referenced asset keys
for each key:
  if server canonical ref cache has key → reuse
  else locate matching vm.assets entry and exact bytes
       PUT asset with current token
       require status=ok
       store returned canonical ref
if any ref cannot become durable → abort draft PUT
build document from projectJson + exact canonical refs
PUT draft
```

This path MUST process referenced clean/default assets when canonical server ref is absent.
Do not filter solely by `asset.clean`.

## Basic save trigger in this package

M1-005 may expose a manual/test `flush` save and a minimal single-save trigger sufficient
for end-to-end durability proof. It MUST NOT claim the final autosave scheduler/recovery
acceptance reserved for M1-006.

A save snapshot has:

```text
baseRevision = current last confirmed revision
mutationId = UUIDv4
```

409 becomes explicit conflict/error state; do not guess a new revision.

## Load/reopen journey

Required real-browser flow:

```text
create test-only Blocks project
open ASA host with real runtime capability
load pinned default Scratch project
make a deterministic block/sprite/costume edit
flush save
assert assets PUT before draft PUT
assert confirmed revision increments
close page/browser context
open same project again with new runtime capability
assert project JSON/blocks/sprites/assets semantically match saved state
```

At least one test MUST verify a default clean Scratch asset became durable on first save.

## Generic bypass test

Call the normal existing Project draft API for the same test Blocks project with a
structurally valid but nonexistent/forged canonical asset ref.

Assert:

```text
request rejected
revision unchanged
```

This proves the generic path cannot bypass Blocks durability.

## Required regressions

```text
existing Electronics draft save still passes
existing Chess/Checkers/3D save contracts unchanged where applicable
existing project revision conflict semantics unchanged
existing mutationId/idempotency tests unchanged
boundaries PASS
```

Do not loosen existing tests to make the new constructor fit; supply the explicit no-op
guard dependency in test composition.

## Required API/storage tests

```text
raw project.json endpoint exact JSON
bootstrap canonical refs/revision
runtime draft PUT requires project:save
player/no-write token denied
asset missing => guard rejects, no revision
asset digest/size mismatch => reject
extra/unreferenced asset => reject
cross-tenant alias => reject
all durable => revision commits
runtime route and generic route use same guard
object store failure during ensure phase => no draft PUT
```

## Forbidden

```text
no final 750ms autosave/recovery state machine claim yet
no silent merge
no sb3 import/export
no Gallery/Learning
no activation
no Project schema/revision redesign
```

## Done

A test technical Blocks project can be edited, explicitly saved through the real asset +
Project Core path, closed and reopened without losing project graph or bytes. Generic
Project API cannot create a broken Blocks revision.

Stop. The next package, M1-006, must be separately authorised.

---

# Deferred package rule

The following roadmap IDs are intentionally **not coding-ready solely from this file**:

```text
VSCR-M1-006 autosave/recovery/conflict/snapshot
VSCR-M1-007 sb3 import/export
VSCR-M1-008 M1 acceptance
VSCR-M2-*
VSCR-M3-*
VSCR-M4 activation
```

Before coding each, create/review its task package against the interfaces actually accepted
by preceding tasks. This is deliberate progressive elaboration, not missing permission to
improvise.

The first point at which this document should be extended is after M1-005 is accepted and
the concrete runtime/storage/persistence interfaces are visible in code.