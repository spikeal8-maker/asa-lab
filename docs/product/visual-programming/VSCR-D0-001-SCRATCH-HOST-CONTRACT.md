# VSCR-D0-001 — ASA Scratch host contract

**Status:** accepted design contract; `VSCR-M1-002` remains blocked until the exact upstream release pin is normalised by `VSCR-M0.1-002`  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)  
**Upstream lock:** `infra/scratch-editor/upstream.env`

This file fixes the host/runtime architecture so a coding agent does not decide how to
embed, brand or partially disable Scratch while implementing another task. It is not
permission to start coding.

---

## 1. Decision

M1+ uses the pinned Scratch Editor **shipping standalone distribution** as a library inside
an ASA-owned static host.

The current M0 image that serves `packages/scratch-gui/build/index.html` is only build and
health evidence. It is not the ASA product runtime.

Target direction:

```text
scratchfoundation/scratch-editor @ exact reviewed release commit
→ npm ci
→ scratch-gui shipping standalone dist
→ two enumerated ASA compatibility patches where upstream has no safe host prop
→ ASA-owned host files
→ Nginx runtime container
```

The ASA Web application never imports Scratch GUI/VM packages directly.

---

## 2. Exact upstream provenance is a prerequisite

The current M0 lock is intentionally treated as provisional for M1 host work.

Audit on 10 September 2026 established:

```text
official tag v15.1.1 → 99bcc17e0580588f181f8a87577a2f676537a487
current ASA pin        → 82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The current pin is nine commits after the release tag and the inspected delta is dependency
maintenance rather than an ASA-required Scratch feature. Therefore M1 host work MUST NOT
continue while documentation calls the current commit the exact `v15.1.1` release.

`VSCR-M0.1-002` normalises the pin to the official release-tag commit unless a later
explicit review proves an ASA-required reason to retain a post-release snapshot. A coding
agent may not silently choose another SHA.

---

## 3. Upstream API surface we intentionally depend on

At the reviewed upstream revision the standalone export must provide and tests must verify:

```text
EditorState
createStandaloneRoot
setAppElement
GUIConfig / GUIStorage shape
ScratchStorage
buildDefaultProject
onVmInit(vm)
onProjectLoaded()
onSetProjectThumbnailer(...)
projectId
isPlayerOnly
VM PROJECT_CHANGED
vm.toJSON()
vm.assets
```

These are preferred extension points. Any removed/renamed surface is an upstream-update
STOP condition.

---

## 4. ASA-owned host and image layout

Target repository shape:

```text
infra/scratch-editor/
├── upstream.env
├── Dockerfile
├── nginx.conf.template
├── README.md
├── patches/
│   ├── 0001-host-logo-prop.patch
│   └── 0002-extension-button-visibility.patch
└── host/
    ├── index.html
    ├── host.js
    ├── host.css
    └── assets/
        └── asa-blocks-mark.svg
```

No second package manager/build system is introduced for the host. The host loads the
upstream standalone bundle produced from the pinned source.

Target image:

```text
/usr/share/nginx/html/
├── index.html
├── host.js
├── host.css
├── assets/**
└── vendor/scratch/
    ├── scratch-gui-standalone.js
    ├── static/**
    ├── chunks/**
    └── other files required by the exact standalone build
```

The Docker build fails if the expected standalone bundle or ASA host entry file is absent.
After M1-002 it MUST NOT serve upstream `build/index.html` as `/`.

---

## 5. Branding and trademark boundary

ASA product branding is `ASA Lab — Визуальное программирование`.

The Scratch name is used only in factual compatibility/attribution text such as:

```text
совместимо с проектами Scratch 3 (.sb3)
```

The ASA product host MUST NOT display the Scratch logo as ASA navigation or product
branding. Merely setting `onClickLogo = no-op` is insufficient because pinned upstream
MenuBar still renders the Scratch mark.

### 5.1 Enumerated compatibility patch: host-supplied logo

Pinned upstream already carries a `logo` prop through GUI/MenuBar but the inspected MenuBar
implementation renders `getScratchLogo(...)` instead of the supplied prop. M1-002 is
authorised to carry one minimal patch whose only behavioural purpose is:

```text
MenuBar image source uses the supplied host `logo` prop when provided
→ ASA host supplies /assets/asa-blocks-mark.svg
→ upstream Scratch mark is not shown as ASA product chrome
```

Do not remove attribution/license files. Do not mass-rebrand upstream source strings.

The patch must be stored under `infra/scratch-editor/patches/`, applied deterministically
during Docker build and guarded by a patch-application/upstream-update test.

### 5.2 Default project assets

`buildDefaultProject()` MAY be used only as a pinned upstream compatibility fixture during
non-user-facing M1 development while `blocks` remains `coming_soon`.

It is NOT the final ASA production default-project asset set.

Before M3 acceptance/public activation, ASA MUST provide a rights-cleared ASA-owned default
project/sprite/backdrop/sounds (or a deliberately empty stage) and verify that creating a
new project requires no Scratch Foundation trademark/media asset.

Thus:

```text
M1 technical fixture may use upstream default assets
M3 activation baseline may not depend on them without explicit rights decision
```

---

## 6. File menu and extension surface

ASA owns project naming, save status and `.sb3` import/export.

Therefore editor host v1 explicitly sets:

```text
canSave = false
canCreateNew = false
canEditTitle = false
canManageFiles = false
canShare = false
canRemix = false
backpackVisible = false
showComingSoon = false
canUseCloud = false
```

`canManageFiles=false` is mandatory: built-in Scratch File import/export is not a second
persistence path.

### 6.1 Extensions button

Pinned GUI renders its Extensions button unconditionally and its connected default opens
the upstream extension library. A no-op click handler is not an acceptable product state.

M1-002 is authorised to carry one additional minimal upstream patch:

```text
new host-controlled boolean: extensionsButtonVisible
upstream default: true
ASA host core mode: false
```

The button is hidden, not merely disabled, through M1/M2 core mode. M3 defines the approved
local extension allowlist and may enable a controlled extension surface.

No additional upstream patch is authorised by this contract. A third patch is a STOP and
requires design update.

---

## 7. Host startup and authority

`index.html` loads the standalone vendor bundle and `/host.js`.

Project identity and API authority never come from query/hash parameters. Runtime token,
project ID and mode arrive only through the parent/iframe protocol.

One iframe lifetime creates one editor root.

---

## 8. Parent/iframe bootstrap protocol v1

Parent creates a cryptographically random `sessionNonce`, waits for iframe load and sends
to the exact configured runtime origin:

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

Player mode binds an immutable `versionId` and uses a read-only capability.

Child accepts INIT only when:

```text
event.source === window.parent
protocolVersion === 1
messageType === ASA_BLOCKS_INIT
projectId valid
sessionNonce non-empty
runtimeToken non-empty
event.origin equals expected ASA parent origin
```

The expected parent origin is derived from validated deployment configuration/referrer as
defined by D0-004; missing or mismatched origin fails closed.

After mount child emits `ASA_BLOCKS_READY` with the exact Scratch version/commit.

Required parent → child messages:

```text
ASA_BLOCKS_INIT
ASA_BLOCKS_TOKEN_UPDATE
ASA_BLOCKS_FLUSH_REQUEST
ASA_BLOCKS_STOP
```

Required child → parent messages:

```text
ASA_BLOCKS_READY
ASA_BLOCKS_STATUS
ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
ASA_BLOCKS_FLUSH_RESULT
ASA_BLOCKS_FATAL
```

Every post-init message carries `protocolVersion`, `projectId`, `sessionNonce`; flush pairs
also carry `requestId`. No generic RPC/eval bridge exists.

---

## 9. ASA GUIStorage

The host creates a new `ScratchStorage` and supplies it through the `EditorState`
configuration factory.

ASA GUIStorage contains:

```text
scratchStorage
saveProject()        # defensive failure; ASA save orchestrator owns persistence
getLibraryAssetUrl() # ASA/local only, never implicit Scratch-host fallback
```

`backpackStorage` and cloud-variable provider are absent.

### 9.1 New project

While `hasProjectJson=false`:

```text
ASA UUID stays only in ASA host/API state
Scratch GUI projectId is omitted/undefined
local Scratch internal default ID 0 may initialise the technical M1 fixture
```

Passing the ASA UUID to upstream ProjectFetcher in this state is forbidden because it
would attempt to fetch a nonexistent existing Scratch project.

The first durable save materialises every referenced asset, including clean/default assets.

### 9.2 Existing project

When `hasProjectJson=true`, custom Project storage loads raw JSON from:

```text
GET /api/blocks/runtime/projects/{projectId}/project.json
```

Asset web stores load:

```text
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
```

Requests use the current in-memory bearer token and `credentials: omit`. Token rotation
changes subsequent storage requests without rebuilding the ScratchStorage object.

### 9.3 Library behaviour before M3

`getLibraryAssetUrl()` never falls back to Scratch Foundation hosts. Before an approved
local library exists, unavailable library items resolve to a controlled ASA/local
unavailable state. M3 replaces that with a rights-cleared local catalogue.

---

## 10. ASA-owned save orchestrator

Upstream server save remains disabled.

ASA obtains the VM through `onVmInit(vm)`, listens to `PROJECT_CHANGED` and owns a
generation-aware persistence queue:

```text
changeGeneration
save scheduling
ensureReferencedAssetsDurable
optimistic draft PUT
confirmed revision tracking
token refresh/retry
conflict handling
recovery snapshots
status messages to parent
```

Never enable upstream project server save simultaneously with ASA autosave.

Initial project load starts in `LOADING`; VM changes emitted during load do not become user
edits. After `onProjectLoaded()` and stable initialisation:

```text
changeGeneration = 0
confirmedGeneration = 0
state = CLEAN
```

---

## 11. Thumbnail integration

Use supported upstream thumbnail callback/stage-capture surface when available. Do not
scrape arbitrary DOM/canvas internals merely to obtain a thumbnail.

Snapshot save is bound to a confirmed project revision and is non-fatal to the draft save.

---

## 12. Iframe and runtime headers

Initial iframe sandbox:

```html
sandbox="allow-scripts allow-same-origin"
```

No popup/top-navigation/forms/download/camera/microphone/geolocation permission is added
by core mode. `.sb3` import/export belongs to ASA outer routes.

Runtime keeps `/healthz` and sets at least:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
Content-Security-Policy with exact frame-ancestors/connect-src from D0-004
```

Runtime sets no cookie and requires no credentialed CORS.

---

## 13. M1-002 acceptance

M1-002 is not accepted until browser/Docker evidence proves all of:

```text
1. official reviewed upstream release SHA is the configured exact pin
2. runtime uses standalone dist, not playground build/index.html
3. the two authorised compatibility patches apply cleanly and no third patch exists
4. ASA-owned mark is shown instead of Scratch logo in product chrome
5. built-in File menu is absent (`canManageFiles=false`)
6. Extensions button is absent in core mode
7. no account/share/backpack/cloud/Scratch-server save authority is exposed
8. editor does not render before valid INIT
9. wrong parent origin/source/project/nonce/version is rejected
10. runtime token is absent from URL/localStorage/sessionStorage/IndexedDB/logs
11. new technical project uses local internal ID 0 and does not fetch ASA UUID
12. existing project requests raw project JSON only from ASA runtime API
13. asset loads use Authorization + credentials: omit
14. token update affects subsequent storage requests
15. no library URL falls back to Scratch Foundation
16. PROJECT_CHANGED reaches the ASA orchestrator after initial load
17. player mode mounts from the same host with writes disabled
18. runtime failure does not crash ASA Web parent
```

Actual browser network inspection is mandatory; source grep is insufficient.

---

## 14. Upstream-update coupling ledger

Every future Scratch pin update must re-check:

```text
standalone bundle/export global
EditorState config factory
createStandaloneRoot
ScratchStorage request hooks
buildDefaultProject technical fixture shape
GUI onVmInit/onProjectLoaded
player-only mode
thumbnail callback
VM PROJECT_CHANGED
vm.toJSON/vm.assets
host logo patch context
extension visibility patch context
```

If either compatibility patch no longer applies exactly, STOP the upstream update and
review whether upstream now provides a native host control before rewriting the patch.