# VSCR-D0-001 — ASA Scratch host contract

**Status:** accepted design contract for the Visual Programming programme  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)  
**Upstream lock:** `infra/scratch-editor/upstream.env`

This file fixes the host/runtime architecture so a coding agent does not decide how to
embed Scratch while implementing another task. It is not permission to start coding.

---

## 1. Decision

M1+ uses the pinned Scratch Editor **shipping standalone distribution** as a library inside
an ASA-owned static host.

The current M0 image that serves `packages/scratch-gui/build/index.html` is only a proof
that the pinned upstream source builds and responds. It is not the product runtime.

The production direction is:

```text
scratchfoundation/scratch-editor @ exact commit
→ npm ci
→ production scratch-gui standalone dist
→ ASA-owned host files
→ Nginx container
```

The ASA Web application never imports Scratch GUI/VM packages directly.

---

## 2. Upstream API surface we intentionally depend on

At the pinned upstream revision the standalone export provides the integration surface we
need:

```text
EditorState
createStandaloneRoot
setAppElement
GUIConfig / GUIStorage shape
ScratchStorage
buildDefaultProject
```

GUI also exposes callbacks/props needed by the host, including:

```text
onVmInit(vm)
onProjectLoaded()
onSetProjectThumbnailer(...)
projectId
isPlayerOnly
```

These are the preferred extension points. A direct patch to upstream Scratch source is a
last resort and requires a separate enumerated compatibility patch.

---

## 3. Target files

The first host implementation uses this shape unless the selected task explicitly proves
a smaller equivalent split:

```text
infra/scratch-editor/
├── upstream.env
├── Dockerfile
├── nginx.conf.template
├── README.md
└── host/
    ├── index.html
    ├── host.js
    └── host.css
```

No new package manager or second JS build system is introduced for the ASA host. The host
loads the upstream UMD standalone bundle and accesses its exported `GUI` global.

Target image layout:

```text
/usr/share/nginx/html/
├── index.html
├── host.js
├── host.css
└── vendor/scratch/
    ├── scratch-gui-standalone.js
    ├── static/**
    ├── chunks/**
    └── any other dist files required by the pinned standalone build
```

The Docker build MUST verify at least:

```text
packages/scratch-gui/dist/scratch-gui-standalone.js exists
ASA host/index.html exists
all required standalone static/chunk directories copied
```

Do not copy `packages/scratch-gui/build/index.html` as the runtime entry document after
this contract is implemented.

---

## 4. Host startup

`index.html` loads, in order:

```text
/vendor/scratch/scratch-gui-standalone.js
/host.js
```

`host.js` does not obtain project identity or authority from URL query/hash parameters.
Runtime token, project ID and mode arrive only through the parent/iframe message protocol.

The host creates exactly one editor root per iframe lifetime.

---

## 5. Parent/iframe bootstrap protocol

### 5.1 Initial message

The ASA parent creates a random `sessionNonce`, waits for iframe `load`, then sends:

```json
{
  "protocolVersion": 1,
  "messageType": "ASA_BLOCKS_INIT",
  "projectId": "uuid",
  "sessionNonce": "opaque-random-value",
  "mode": "editor",
  "versionId": null,
  "apiOrigin": "https://configured-asa-origin",
  "runtimeToken": "short-lived-capability",
  "draftRevision": 12,
  "hasProjectJson": true,
  "assets": [],
  "recoveryNamespace": "opaque-non-secret-string"
}
```

For player mode:

```text
mode = player
versionId = immutable project version UUID
```

The parent MUST call `postMessage` with the exact configured runtime origin, never `*`.

### 5.2 Initial origin validation in the child

Before accepting `ASA_BLOCKS_INIT`, the child requires all of:

```text
event.source === window.parent
protocolVersion === 1
messageType === ASA_BLOCKS_INIT
projectId is valid
sessionNonce is non-empty
runtimeToken is non-empty
```

The child derives the expected parent origin from `document.referrer` and requires
`event.origin` to equal that origin. Cross-origin referrer policy may provide only the
origin; that is sufficient.

If referrer is missing/invalid or origin does not match, the host fails closed and does
not render an authorised editor.

Server-side `frame-ancestors` is still required; referrer checking is not its replacement.

### 5.3 Child ready

After storage/config is installed and the Scratch root is mounted, child sends:

```json
{
  "protocolVersion": 1,
  "messageType": "ASA_BLOCKS_READY",
  "projectId": "uuid",
  "sessionNonce": "same-value",
  "runtimeBuild": {
    "scratchVersion": "15.1.1",
    "scratchCommit": "exact-pin"
  }
}
```

Every message after INIT includes `protocolVersion`, `projectId` and `sessionNonce`.
Messages with a wrong origin/project/nonce/version are ignored and recorded only as a
technical rejection counter, never with token/body logging.

### 5.4 Required message types v1

Parent → child:

```text
ASA_BLOCKS_INIT
ASA_BLOCKS_TOKEN_UPDATE
ASA_BLOCKS_FLUSH_REQUEST
ASA_BLOCKS_STOP
```

Child → parent:

```text
ASA_BLOCKS_READY
ASA_BLOCKS_STATUS
ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
ASA_BLOCKS_FLUSH_RESULT
ASA_BLOCKS_FATAL
```

`requestId` is required for FLUSH request/result pairing.

No generic RPC/eval/message-forwarding mechanism is allowed in protocol v1.

---

## 6. Scratch GUI configuration

ASA owns the outer navigation/title/save status. The embedded Scratch GUI is rendered with
its server/product ownership controls disabled:

```text
canSave = false
canCreateNew = false
canEditTitle = false
backpackVisible = false
showComingSoon = false
cloud provider = absent
account/community functions = absent
onClickLogo = no-op or explicit parent message; never scratch.mit.edu navigation
```

Do not use the upstream playground's `HashParserHOC` as a way to pass project authority or
runtime tokens.

Player mode sets upstream player-only state/props and still uses the same ASA host and ASA
asset storage.

---

## 7. ASA GUIStorage

The host creates a new `ScratchStorage` instance and supplies a GUIStorage implementation
through `new EditorState(params, () => ({storage: asaStorage}))`.

The ASA storage object contains:

```text
scratchStorage
saveProject()             # defensive failure: ASA orchestrator owns persistence
getLibraryAssetUrl()      # local/ASA URL only; never implicit Scratch fallback
```

`backpackStorage` and `cloudVariables` are absent in the core programme.

### 7.1 Default project cache

Before rendering a new project, the host calls upstream `buildDefaultProject()` and caches
the returned Project/Sound/Image assets in the local `ScratchStorage` built-in cache.

The pinned default project uses internal Scratch project ID `0`. ASA may use that internal
ID for local Scratch initialisation only; the canonical persistence identity remains the
ASA project UUID from INIT.

When `hasProjectJson=false`, the host MUST keep the ASA project UUID only in ASA host
state/API paths and MUST NOT pass that UUID as Scratch GUI `projectId`. Passing it would
make upstream `ProjectFetcherHOC` treat the empty ASA project as an existing Scratch
project and fetch a raw project that does not exist yet. In this state, omit/leave Scratch
`projectId` undefined so its locally cached default project ID `0` is used.

After the first durable save, a new page/runtime session returns `hasProjectJson=true`; at
that point the host passes the ASA UUID as Scratch `projectId` and the custom Project web
store loads the saved raw `project.json` from ASA.

The first ASA durable save MUST materialise every referenced default asset through the ASA
asset API even if Scratch marks it clean.

### 7.2 Existing project load

When `hasProjectJson=true`, Scratch internal `projectId` is the ASA project UUID and a
custom Project web store resolves raw JSON from:

```text
GET /api/blocks/runtime/projects/{projectId}/project.json
```

The request uses the current in-memory bearer token and `credentials: omit`.

Custom ImageVector/ImageBitmap/Sound web stores resolve:

```text
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
```

The request function reads the current mutable in-memory token so token rotation does not
require rebuilding the ScratchStorage instance.

### 7.3 Library URL behaviour before M3

The host MUST implement `getLibraryAssetUrl`; leaving it undefined would allow upstream
legacy Scratch-host fallback.

Before rights-cleared local libraries exist, unsupported library asset URLs resolve only
to an ASA/local endpoint that may return a controlled unavailable state. They never fall
back to `assets.scratch.mit.edu`.

M3 replaces this with the approved local library catalogue.

---

## 8. ASA-owned save orchestrator

Server persistence in upstream `ProjectSaverHOC` is intentionally disabled by
`canSave=false`.

Reason: pinned upstream project dirty state is a boolean. Its save path serialises state,
performs asynchronous work, then calls `setProjectUnchanged()` unconditionally. A change
that occurs while that save is in flight can therefore be cleared from the dirty flag.
That is incompatible with ASA's rapid autosave guarantee.

Instead:

```text
onVmInit(vm)
→ retain VM reference
→ subscribe to VM PROJECT_CHANGED
→ generation-aware ASA save orchestrator
```

The orchestrator defined by the master/persistence contract owns:

```text
changeGeneration
save scheduling
asset durability preparation
draft PUT
revision tracking
retry/token wait
conflict handling
recovery snapshots
ASA shell status messages
```

Do not simultaneously enable upstream project server save and ASA autosave.

---

## 9. Initial-load suppression

VM/project loading may emit internal state changes. The orchestrator starts in `LOADING`
and does not mark the project dirty until upstream `onProjectLoaded()` has fired and the
initial project has reached a stable rendered state.

After that transition:

```text
changeGeneration = 0
confirmedGeneration = 0
state = CLEAN
```

Only subsequent learner/editor changes enter the save scheduler.

For a new default project, the first owner-visible edit causes normal autosave. A selected
implementation task MAY also schedule one initial materialisation save after load if the
technical-project lifecycle requires a persisted default before editing; if so the task
must test that it does not create save loops.

---

## 10. Thumbnail integration

Use the pinned GUI/VM callback surface (`onSetProjectThumbnailer` or equivalent tested
stage capture). Do not inspect arbitrary DOM/canvas internals if the supported callback is
available.

Thumbnail/snapshot persistence occurs only after a confirmed project revision and is
non-fatal to the draft save.

---

## 11. Iframe sandbox and browser permissions

Initial ASA iframe:

```html
sandbox="allow-scripts allow-same-origin"
```

The iframe may also use the normal `allowfullscreen` mechanism for player/editor
fullscreen when tested.

Do not add:

```text
allow-top-navigation
allow-popups
allow-forms
allow-modals
allow-downloads
camera
microphone
geolocation
```

unless a later authorised feature proves the exact requirement and updates the security
contract.

`.sb3` import/export is owned by ASA outer routes and does not require giving the embedded
runtime general download/pop-up permissions.

---

## 12. Nginx runtime requirements

The runtime container keeps `/healthz`.

After M1 host implementation Nginx also sets at least:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
Content-Security-Policy with exact configured frame-ancestors
```

`frame-ancestors` is generated from explicit deployment configuration. It is never `*`.

The runtime must not set cookies and does not need credentialed CORS.

Static content-hashed vendor files may use immutable caching; `index.html` and host control
files must revalidate so security/runtime changes propagate.

---

## 13. Focused acceptance for the host task

The implementation is not accepted until tests prove:

```text
1. image uses scratch-gui standalone dist, not playground index
2. exact upstream version/commit still verified
3. ASA host root loads and emits READY only after valid INIT
4. wrong parent origin INIT is rejected
5. wrong nonce/project/version messages are rejected
6. token is absent from URL/localStorage/log output
7. editor mode exposes no Scratch server save/account/backpack/cloud authority
8. player mode mounts from same host with read-only orchestration disabled
9. new project uses local default ID 0 without trying to fetch the ASA UUID as an existing project
10. existing project requests raw project.json from ASA runtime API
11. asset loads carry Authorization and credentials: omit
12. token update changes subsequent storage requests
13. getLibraryAssetUrl never falls back to Scratch Foundation
14. PROJECT_CHANGED after initial load reaches ASA orchestrator
15. upstream saveProject defensive stub is not invoked in normal ASA editor flow
16. Scratch runtime failure does not crash the ASA parent shell
```

A browser test must inspect actual network requests. Source grep alone is not sufficient.

---

## 14. Upstream upgrade coupling inventory

The following upstream behaviours are intentional compatibility couplings and must be
rechecked when the pin changes:

```text
standalone UMD export global name/API
EditorState configFactory
createStandaloneRoot
ScratchStorage addWebStore request config support
buildDefaultProject descriptor shape
GUI onVmInit
GUI onProjectLoaded
player-only support
thumbnail callback support
VM PROJECT_CHANGED event
vm.toJSON()
vm.assets availability used by durability preparation
```

If one disappears, STOP the upstream update and update this contract before changing the
integration architecture.