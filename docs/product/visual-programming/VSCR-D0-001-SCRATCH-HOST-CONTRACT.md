# VSCR-D0-001 — ASA Scratch host contract

**Status:** canonical accepted host design  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`  
**Component routing:** `COMPONENT_MAP.yaml`  
**Upstream lock:** `infra/scratch-editor/upstream.env`

This is the single active host contract. It preserves the exact accepted host/protocol/storage
boundary while routing future agents to individual sections instead of requiring full-file
reading for every local change.

It does not authorise coding by itself.

## Upstream provenance

Exact reviewed profile:

```text
official tag v15.1.1 → 99bcc17e0580588f181f8a87577a2f676537a487
ASA exact pin        → 82c5fea6d3e60c781f25c09b375045f9b46a43f7
Scratch package      → 15.1.1
provenance           → reviewed post-release snapshot after v15.1.1
```

The ASA pin is intentionally retained. The reviewed delta from the release tag contains
package/dependency maintenance and no Scratch Editor source-code file delta.

Do not call the ASA pin the official v15.1.1 tag commit. A future pin change requires:

```text
exact tag/candidate diff review
dependency + license + security review
compatibility-coupling review
Docker/browser evidence appropriate to implemented milestone
```

No bot upgrades Scratch merely because a newer revision exists.

The M0 image that serves upstream `packages/scratch-gui/build/index.html` is build/health
evidence only. M1+ product runtime uses the shipping standalone distribution inside the ASA
host.

## Upstream integration surface

At the reviewed upstream revision the standalone integration relies on these supported/exported
surfaces and tests must protect the coupling:

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
EditorState locale detection / Scratch locale reducer
VM PROJECT_CHANGED
vm.toJSON()
vm.assets
```

Removed/renamed behaviour during a future Scratch pin update is a STOP condition until the
adapter is reviewed.

Prefer supported configuration/export surfaces. Only the three explicitly authorised source
patches below may cross into upstream implementation for the pinned revision used by M1-002B.

## Host layout

M1-002 is implemented as bounded sub-slices, but the accepted final host layout is:

```text
infra/scratch-editor/
├── upstream.env
├── Dockerfile
├── nginx.conf.template
├── README.md
├── patches/
│   ├── 0001-host-logo-prop.patch
│   ├── 0002-extension-button-visibility.patch
│   └── 0003-file-menu-policy.patch
└── host/
    ├── index.html
    ├── main.js
    ├── protocol.js
    ├── editor-config.js
    ├── branding.js
    ├── storage.js
    ├── status.js
    ├── theme.css
    └── host.css
```

Later persistence work may add:

```text
host/save-orchestrator.js
```

Responsibilities remain separated:

```text
main.js          composition/lifecycle wiring only
protocol.js      parent/iframe message parsing and validation
editor-config.js Scratch GUI feature flags, locale and bounded product-control configuration
branding.js      ASA logo/product-brand configuration
storage.js       ScratchStorage/GUIStorage adapter
status.js        child status/error reporting
theme.css        ASA product-chrome styling only
host.css         runtime-local shell presentation
```

ASA account/avatar presentation is parent-owned under `apps/web/src/blocks/**`; it is not a
Scratch-origin identity implementation.

Do not create a second JS package manager/build graph for the host. It loads the standalone
vendor distribution produced from the pinned upstream source.

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
├── theme.css
├── host.css
├── assets/asa-lab-mark.svg
└── vendor/scratch/**
```

The Docker build fails if the expected standalone bundle, ASA host entry point or canonical
ASA logo source is absent.

After M1-002 `/` must never serve upstream playground `build/index.html`.

Scratch GUI/VM packages must not enter the ASA Web dependency graph.

## Branding

ASA product branding is:

```text
ASA Lab — Визуальное программирование
```

Canonical logo source is exactly:

```text
apps/web/public/asa-lab-mark.svg
```

Docker copies those exact bytes into the runtime image, for example as:

```text
/assets/asa-lab-mark.svg
```

There is no independently editable `asa-blocks-mark.svg` or second ASA artwork source.

Required rendered result:

```text
Scratch product logo               absent
ASA Lab canonical mark             present
link/navigation to scratch.mit.edu absent
Scratch account/community chrome   absent
upstream license/NOTICE             preserved
```

A no-op Scratch-logo click handler is insufficient. The mark itself must not remain as ASA
product chrome.

Factual compatibility/attribution wording is permitted, for example:

```text
совместимо с проектами Scratch 3 (.sb3)
```

Do not imply official Scratch Foundation endorsement and do not mass-rebrand upstream source
strings.

### Authorised host-logo patch

One minimal compatibility patch is authorised:

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
```

Its only behavioural purpose is to make the pinned MenuBar use the supplied host `logo` prop
when provided. The ASA host supplies the canonical ASA mark.

The patch is applied deterministically during Docker build and protected by patch/upstream
coupling tests.

### Default project/media boundary

`buildDefaultProject()` and upstream default media may be used only as non-user-facing M1
compatibility fixtures while `blocks` remains `coming_soon`.

They are not the production ASA default media set.

Before M3/public activation, the default project/library uses ASA-owned/right-cleared media or
a deliberately empty stage unless a separate explicit rights review permits otherwise.

## Localization

Scratch's built-in localization is authoritative. ASA must not fork or manually duplicate
Scratch translations merely to make the editor Russian.

The language selector remains exactly where Scratch already places it: inside the existing
Settings menu. A second top-level `Language` / `Язык` button is forbidden.

Initial locale policy:

```text
1. canonical ASA account/user locale, once such a preference exists;
2. otherwise Scratch's own browser-locale detection against its supported locale registry;
3. upstream regional normalization where supported (for example ru-RU → ru, en-US → en);
4. if upstream detection would fall back to English while the browser did not request English,
   ASA fallback is ru.
```

The implementation must reuse upstream detection/locale state rather than maintaining a second
hand-written list of Scratch translations. The current D fixture's hard-coded `locale: 'en'`
must not survive B.

Acceptance includes at least:

```text
ru-RU/ru browser → Russian initial UI
en-US/en browser → English initial UI
unsupported non-English browser with no requested supported locale → Russian fallback
Settings → language selector remains present
Russian → English → Russian switches the normal Scratch UI/block labels
no language operation depends on scratch.mit.edu
```

## ASA theme boundary

The product shell adopts the existing ASA Lab visual identity, but Scratch's programming-language
colour semantics remain upstream.

Canonical current ASA header references:

```text
primary product/header colour: #0877B3
darker/border/hover reference: #076B98
canonical brand tokens: apps/web/src/brand/brand.css
```

ASA styling may apply to product chrome such as:

```text
top product bar
Extensions launcher/button
sprite/backdrop add controls
selected sprite/product accent states
ASA-owned focus/selection chrome
```

Do not globally replace `$looks-secondary`, Scratch purple or another shared upstream colour token.
The standard Scratch semantic colours for Motion, Looks, Sound, Events, Control, Sensing,
Operators, Variables and My Blocks remain unchanged.

If an upstream token is shared by both product chrome and a semantic programming category, isolate
the product-chrome styling in ASA host CSS or through an already-authorised narrow host prop. Do
not recolour the language to match ASA branding.

## ASA identity shell

ASA owns the account/avatar control shown at the right edge of the product header.

The Scratch origin never becomes an ASA account surface. Required ownership:

```text
avatar image / initials / account menu → ASA parent Web
Scratch iframe                         → editor/runtime only
ASA account cookies                    → never exposed to Scratch origin
Scratch account/community system       → absent
```

Prefer a parent-owned overlay/shell aligned with the Scratch header so the result appears as one
ASA product bar without weakening the accepted separate-origin iframe boundary.

Reuse the existing ASA avatar/account behaviour from the parent application rather than creating a
second profile model for Scratch.

## Product controls

ASA owns project naming, durable persistence and user-facing safe `.sb3` policy, but the familiar
Scratch Settings/File/Edit surfaces remain visible where their behaviour is truthful.

M1-002B core product mode configures the equivalent of:

```text
canChangeLanguage = true
canSave = false
canCreateCopy = false
canRemix = false
canEditTitle = false
canManageFiles = true
canShare = false
backpackVisible = false
showComingSoon = false
canUseCloud = false
extensionsButtonVisible = true
fileNewVisible = true
fileImportVisible = false
fileExportVisible = false
```

`fileNewVisible`, `fileImportVisible` and `fileExportVisible` are host-control semantics introduced
by the authorised File-menu compatibility patch below. The exact upstream-safe names used by the
patch may differ only if the task/component card is updated first and the behaviour remains exactly
this bounded policy.

Consequences during B:

```text
Settings is present and owns language switching
File menu is present
Edit menu is present
New may create/reset the technical local project with honest unsaved-work confirmation
upstream/server Save now is disabled
local .sb3 import is unavailable before M1-007
local .sb3 export is unavailable before M1-007
Scratch account/share/remix ownership is absent
backpack/cloud ownership is absent
```

ASA durable save arrives in M1-005. Safe `.sb3` import/export arrives in M1-007 and may then enable
the existing familiar File-menu entries rather than adding duplicate ASA buttons.

### Authorised File-menu patch

At the pinned upstream revision, `canManageFiles` controls the whole File menu while `Load from your
computer` and `Save to your computer` are unconditional inside upstream `FileMenu`. Therefore the
accepted requirement “File remains visible, unsafe `.sb3` items remain unavailable until M1-007”
cannot be implemented truthfully by configuration alone.

A third minimal compatibility patch is explicitly authorised:

```text
infra/scratch-editor/patches/0003-file-menu-policy.patch
```

Its only behavioural purpose is to let the host independently control visibility/availability of:

```text
New
Load from your computer
Save to your computer
```

The patch must have upstream-safe defaults equivalent to current Scratch behaviour. It must not:

```text
implement ASA persistence
parse or validate .sb3 itself
change VM/project semantics
create a second File menu
change language handling
change product colours
```

## Extensions

The familiar Scratch Extensions entry point remains visible in ASA product mode. It is styled as
ASA product chrome but does not gain permission to reach arbitrary Scratch Foundation services.

The second authorised compatibility patch remains:

```text
infra/scratch-editor/patches/0002-extension-button-visibility.patch
```

It introduces host-controlled:

```text
extensionsButtonVisible
upstream-safe default: true
ASA B mode: true
```

The button may expose only locally bundled or explicitly approved extension sources. Any extension
or library item that would require an unapproved Scratch Foundation/network dependency is
unavailable rather than silently falling back externally.

M3 still owns the final sovereign extension allowlist/policy and external-service/hardware
classification.

A fourth upstream source patch is a STOP condition requiring an explicit design revision.

## Host startup and authority

`index.html` loads the standalone vendor bundle and ASA host entry.

Project identity and API authority never come from URL query/hash parameters. Runtime token,
project ID, mode and revision/bootstrap metadata arrive only through the parent/iframe
protocol.

One iframe lifetime creates one editor root.

The editor must not mount an authorised project before a valid INIT message.

## Parent/iframe protocol

Protocol version v1 is finite and explicit. There is no generic RPC/eval bridge.

Parent creates a cryptographically random `sessionNonce`, waits for iframe load and sends INIT
only to the exact configured runtime origin:

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

Player mode binds an immutable `versionId` and read-only capability.

Child accepts INIT only when:

```text
event.source === window.parent
protocolVersion === 1
messageType === ASA_BLOCKS_INIT
projectId is valid
sessionNonce is non-empty
runtimeToken is non-empty for an authorised editor/player bootstrap
event.origin equals expected ASA parent origin
```

Expected parent origin is derived only from validated deployment/referrer configuration under
D0-004. Missing/mismatched origin fails closed.

After successful mount the child emits `ASA_BLOCKS_READY` including exact Scratch
version/commit identity.

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

Every post-init message carries:

```text
protocolVersion
projectId
sessionNonce
```

Flush request/result pairs additionally bind exact `requestId`.

Parent uses exact runtime origin as postMessage target. `postMessage('*')` is forbidden.

Messages never contain ASA account cookie, signing key, object-store credentials or arbitrary
JavaScript/eval payload.

M1-002C may use deterministic fixture authority for browser protocol evidence. Real capability
issuance/verification belongs to M1-003.

## Scratch storage adapter

The host creates a new `ScratchStorage` and supplies it through the `EditorState`
configuration factory.

ASA GUIStorage contains only the required surface:

```text
scratchStorage
saveProject()        # defensive failure until ASA durable save exists
getLibraryAssetUrl() # ASA/local only; never implicit Scratch Foundation fallback
```

`backpackStorage` and cloud-variable provider are absent.

### New technical project fixture

While `hasProjectJson=false`:

```text
ASA UUID remains only in ASA host/API state
Scratch GUI projectId is omitted/undefined
local Scratch internal default ID 0 may initialise the technical M1 fixture
```

Passing the ASA UUID to upstream ProjectFetcher in this state is forbidden because it would
attempt to fetch a nonexistent Scratch project from upstream semantics.

Later first durable save must materialise every referenced asset, including clean/default
assets; M1-002D itself does not perform that durable save.

### Existing project runtime shape

When durable runtime endpoints exist, existing project JSON conceptually loads from:

```text
GET /api/blocks/runtime/projects/{projectId}/project.json
```

Referenced asset bytes conceptually load from:

```text
GET /api/blocks/runtime/projects/{projectId}/assets/{assetId}.{format}
```

Requests use current in-memory bearer token and:

```text
credentials: omit
```

Token rotation affects subsequent storage requests without rebuilding ScratchStorage.

M1-002D may use only controlled fixtures/stubs for this behaviour. It must not create fake
production success or implement the M1-003/M1-004 APIs early.

### Library behaviour before M3

`getLibraryAssetUrl()` never falls back to Scratch Foundation hosts.

Before an approved local library exists, unavailable items resolve to a controlled ASA/local
unavailable state. M3 replaces this with a rights-cleared local catalogue.

## VM and save boundary

M1-002 obtains the VM through supported `onVmInit(vm)` and observes VM
`PROJECT_CHANGED` events, but performs no durable server write.

Upstream server save remains disabled.

Later M1-005/M1-006 introduce an ASA-owned generation-aware save orchestrator responsible for:

```text
change generation
save scheduling
ensureReferencedAssetsDurable
optimistic draft PUT
confirmed revision tracking
token refresh/retry
conflict handling
recovery snapshots
status messages
```

Never enable upstream project server save simultaneously with ASA autosave.

Initial project load begins in `LOADING`; VM changes emitted during initial load do not become
user edits. After stable `onProjectLoaded()` initialization, future save orchestration begins
from a clean generation/state.

## Thumbnail boundary

Use a supported upstream thumbnail/stage-capture callback when available. Do not scrape
arbitrary Scratch DOM/canvas internals for thumbnails.

Later snapshot save is bound to a confirmed project revision and remains non-fatal to draft
save success.

## Runtime headers and sandbox

Initial iframe sandbox:

```html
sandbox="allow-scripts allow-same-origin"
```

No popup, top-navigation, forms, download, camera, microphone or geolocation permission is
added in core mode.

Runtime keeps `/healthz` and sets at least:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Permitted-Cross-Domain-Policies: none
Content-Security-Policy using exact frame-ancestors/connect-src rules from D0-004
```

Runtime sets no cookie and does not require credentialed CORS.

`.sb3` import/export remains unavailable until the later M1-007 policy allows the corresponding
File-menu entries and sandbox/download authority is reviewed explicitly.

## M1-002 acceptance

M1-002 acceptance occurs in M1-002E after A/C/D/B are independently completed/accepted.

Integrated browser/Docker evidence proves all of:

```text
1. configured Scratch SHA equals reviewed immutable ASA pin and runtime reports exact provenance
2. runtime uses standalone dist, not upstream playground build/index.html
3. exactly three authorised compatibility patches apply; no fourth patch exists
4. rendered logo bytes originate from apps/web/public/asa-lab-mark.svg
5. Scratch product logo/navigation is absent
6. ASA product header uses canonical ASA colour without recolouring semantic Scratch block categories
7. Settings remains and contains the built-in Scratch language selector
8. no separate top-level Language/Язык control exists
9. ru-RU/ru resolves to Russian; en-US/en resolves to English; unsupported non-English fallback is ru
10. language switching uses upstream Scratch localization and works Russian → English → Russian
11. File menu remains visible while Save now and .sb3 import/export are unavailable before their owning milestones
12. Edit menu remains visible
13. Extensions entry point remains visible, ASA-themed and has no Scratch Foundation fallback
14. ASA avatar/account control is parent-owned and does not give Scratch-origin ASA account authority
15. no account/share/backpack/cloud/Scratch-server-save ownership is exposed
16. editor does not render before valid INIT
17. wrong parent origin/source/project/nonce/protocol/version is rejected
18. runtime token is absent from URL/localStorage/sessionStorage/IndexedDB/logs
19. new technical project uses local internal ID 0 and does not fetch ASA UUID
20. existing-project fixture/runtime shape requests project JSON only through ASA runtime boundary
21. asset fixture/runtime requests use Authorization semantics + credentials: omit
22. token update affects subsequent storage requests without rebuilding storage adapter
23. no project/library/extension URL falls back to Scratch Foundation
24. PROJECT_CHANGED reaches ASA host after stable initial load
25. player mode mounts read-only from same host
26. runtime failure does not crash ASA Web parent and produces controlled error state
```

Actual browser DOM/network inspection is mandatory; source grep is insufficient.

M1-002E performs independent review and does not invent new architecture while accepting the
milestone.

## Upstream update coupling

Every future Scratch pin update rechecks at least:

```text
standalone bundle/export global
EditorState config factory and built-in locale detection
createStandaloneRoot
ScratchStorage request hooks
buildDefaultProject fixture shape
GUI onVmInit/onProjectLoaded
player-only mode
thumbnail callback
VM PROJECT_CHANGED
vm.toJSON/vm.assets
host-logo patch context
extension-visibility patch context
FileMenu structure and file-menu-policy patch context
```

If any accepted compatibility patch no longer applies exactly, stop the upstream update and check
whether upstream now provides a native host control before modifying the patch.
