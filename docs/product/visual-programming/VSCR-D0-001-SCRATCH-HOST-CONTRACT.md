# VSCR-D0-001 — ASA Scratch host contract

**Status:** canonical accepted host design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`

This file is the single active host contract. Historical branding addenda/audits do not
override it.

It does not authorise coding by itself.

<a id="upstream-provenance"></a>
## Upstream provenance

Exact source lock remains in:

```text
infra/scratch-editor/upstream.env
```

Current reviewed profile:

```text
Scratch Editor package version: 15.1.1
ASA exact pin: 82c5fea6d3e60c781f25c09b375045f9b46a43f7
provenance: reviewed post-release snapshot after official v15.1.1 tag
```

Do not call the ASA pin the official release-tag commit. A future pin change requires a new
exact diff review, dependency/license/security review and host/browser evidence.

The M0 image that serves upstream `packages/scratch-gui/build/index.html` is only technical
build/health evidence. M1+ product runtime must use the shipping standalone distribution.

<a id="host-layout"></a>
## Host layout

Target structure after M1-002:

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
    ├── main.js
    ├── protocol.js
    ├── editor-config.js
    ├── branding.js
    ├── storage.js
    ├── status.js
    └── host.css
```

Later persistence tasks may add:

```text
host/save-orchestrator.js
```

Do not create a second JS package manager/build graph for the host. The host loads the
standalone vendor bundle produced from the pinned upstream source.

Runtime image shape:

```text
/usr/share/nginx/html/
├── index.html
├── main.js
├── protocol.js
├── editor-config.js
├── branding.js
├── storage.js
├── status.js
├── host.css
├── assets/asa-lab-mark.svg
└── vendor/scratch/**
```

The Docker build must fail if the expected standalone bundle, host entry point or canonical
ASA logo source is missing.

After M1-002 `/` must never serve upstream playground `build/index.html`.

The ASA Web application must not add Scratch GUI/VM dependencies.

<a id="branding"></a>
## Branding

Canonical logo source is exactly:

```text
apps/web/public/asa-lab-mark.svg
```

Docker copies those bytes into the runtime image. There is no independently editable
`asa-blocks-mark.svg` or other second source of ASA artwork.

Required rendered result:

```text
Scratch product logo              absent
ASA Lab canonical mark            present
link/navigation to scratch.mit.edu absent
Scratch account/community chrome  absent
upstream licenses/NOTICE           preserved
```

A no-op click handler is not sufficient. The upstream Scratch mark itself must not remain
as ASA product chrome.

Compatibility text may truthfully state `совместимо с проектами Scratch 3 (.sb3)` without
implying official Scratch Foundation endorsement.

Only one branding patch is authorised:

```text
0001-host-logo-prop.patch
```

Its sole purpose is to make the pinned MenuBar use the host-supplied logo when provided.
The host supplies `/assets/asa-lab-mark.svg`.

Do not mass-rebrand upstream source strings.

Production default media is a separate concern. Upstream default Scratch assets may be used
only as a non-user-facing M1 compatibility fixture while `blocks` is `coming_soon`. Before
activation the default project/library media must be ASA-owned/right-cleared or intentionally
empty unless a separate explicit rights review permits otherwise.

<a id="product-controls"></a>
## Product controls

ASA owns project naming, persistence and `.sb3` product flows.

Core mode explicitly configures:

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
extensionsButtonVisible = false
```

Consequences:

```text
no built-in Scratch File import/export
no upstream server save
no Scratch account/share/remix ownership
no backpack/cloud ownership
```

ASA `.sb3` import/export arrives only in its own later task.

<a id="extensions"></a>
## Extensions

Pinned GUI exposes the upstream extension library by default. Core M1/M2 must hide that
surface, not merely make its click handler a no-op.

The second and only other authorised compatibility patch is:

```text
0002-extension-button-visibility.patch
```

It introduces host-controlled `extensionsButtonVisible` with upstream-safe default `true`;
ASA core mode supplies `false`.

M3 may introduce an approved local extension allowlist. External-service/hardware
extensions are classified separately.

A third upstream patch is a STOP condition requiring an explicit design revision.

<a id="parent-iframe-protocol"></a>
## Parent/iframe protocol

The runtime is a separate-origin iframe.

Initial sandbox:

```html
sandbox="allow-scripts allow-same-origin"
```

Do not add popup/top-navigation/forms/download/camera/microphone/geolocation permissions in
core mode.

Project identity and authority never come from URL query/hash parameters.

Parent creates a cryptographically random `sessionNonce`, waits for iframe load and sends
INIT only to the exact configured runtime origin.

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

Every accepted message validates exact protocol version, expected source/origin, project ID
and session nonce. Flush request/result pairs also bind an exact request ID.

No generic RPC/eval bridge exists. `postMessage('*')` is forbidden.

The child stores runtime capability only in memory.

M1-002 may use a deterministic test capability payload; real JWT issuance belongs to
M1-003.

<a id="storage-adapter"></a>
## Scratch storage adapter

The host creates its own ScratchStorage/GUIStorage adapter.

It must provide only the storage behavior ASA needs:

```text
scratchStorage
saveProject()        defensive failure while ASA save path is not implemented
getLibraryAssetUrl() ASA/local only; never implicit Scratch Foundation fallback
```

Backpack storage and cloud provider are absent.

For a new technical M1 fixture:

```text
ASA UUID stays in ASA host state
Scratch projectId is omitted/undefined
internal default ID 0 may initialise the pinned technical fixture
```

Passing an ASA UUID into upstream ProjectFetcher for a not-yet-materialised Scratch project
is forbidden.

For an existing project, future runtime reads are conceptually:

```text
GET /api/blocks/runtime/projects/{projectId}/project.json
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
```

They use the current in-memory bearer token and `credentials: omit`.

Before M3, library asset resolution must never fall back to Scratch Foundation hosts.

## VM/save boundary

M1-002 obtains the VM through the supported `onVmInit(vm)` surface and observes
`PROJECT_CHANGED`, but performs no durable server write.

Later M1-005/M1-006 introduce an ASA-owned generation-aware save orchestrator. Upstream
server save must never run in parallel with ASA autosave.

Initial load must suppress false user edits; after stable `onProjectLoaded()` the ASA save
state begins clean.

## Runtime headers

Runtime keeps `/healthz` and at minimum sets:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
Content-Security-Policy with exact frame-ancestors/connect-src from D0-004
```

Runtime sets no cookie and uses no credentialed CORS.

## M1-002 acceptance

M1-002 is not accepted until browser/Docker evidence proves all of:

```text
1. exact configured Scratch pin/version is reported by runtime
2. standalone dist is used; upstream playground root is not
3. exactly the two authorised patches apply and no third patch exists
4. rendered logo bytes originate from apps/web/public/asa-lab-mark.svg
5. no Scratch product logo/navigation remains
6. File menu is absent
7. Extensions button is absent
8. no account/share/backpack/cloud/server-save ownership is exposed
9. editor does not render before valid INIT
10. wrong source/origin/project/nonce/protocol is rejected
11. token is absent from URL/localStorage/sessionStorage/IndexedDB/logs
12. new fixture does not fetch ASA UUID as upstream project ID
13. project/assets never fall back to Scratch Foundation hosts
14. PROJECT_CHANGED reaches ASA host orchestration after initial load
15. player mode can mount read-only without write authority
16. runtime failure leaves ASA parent alive with controlled error state
```

Actual browser DOM/network inspection is required; source grep alone is insufficient.

## Upstream update coupling

Every future Scratch pin update re-checks at least:

```text
standalone export/bundle
EditorState/createStandaloneRoot
ScratchStorage hooks
onVmInit/onProjectLoaded
player mode
thumbnail callback
PROJECT_CHANGED
vm.toJSON/vm.assets
logo patch context
extension visibility patch context
```

If either patch no longer applies exactly, stop the upstream update and check whether
upstream now provides a native host control before modifying the patch.
