# ASA Lab Scratch Editor runtime

This directory builds the pinned upstream Scratch Editor as an isolated ASA runtime.
Scratch GUI/VM stays outside the ASA Web dependency graph. Execution state and owner
acceptance live only in `docs/execution/current.yaml`.

## Upstream lock and product boundary

`upstream.env` is authoritative. The retained lock is
`scratchfoundation/scratch-editor` commit `82c5fea6d3e60c781f25c09b375045f9b46a43f7`,
package version `15.1.1` (reviewed post-release snapshot, not a floating tag).
The Docker build verifies both commit and package version. Its sole upstream patch
is `patches/0001-host-logo-prop.patch`; native Settings, language detection,
File/Edit, local file import/export, Extensions and semantic block colours remain upstream.
ASA changes the wordmark, top product-bar colour and parent-owned account presentation.

## Shipping host

`/` serves the ASA host, never an upstream playground. The shipping standalone UMD
bundle lives under `/vendor/scratch/`; static/chunk requests use the pinned dist.
The host validates the exact configured parent origin and the accepted C protocol
before mounting the real editor. Invalid source/origin/project/nonce is rejected.
The runtime capability is memory-only and does not carry ASA account authority.

`apps/web/src/blocks/BlocksEditor.tsx` is the normal editor-route adapter. Its
fullscreen shell covers the viewport without a portal sidebar or a second ASA
header. The native Scratch product bar contains the ASA Lab wordmark and native
menus; the parent renders the account overlay at the right. `ModuleEditorHost`
uses the existing `useEditorAvatar` hook, including uploaded images and profile
changes. No avatar, account cookie or profile callback is forwarded into Scratch.

## Local stock media, not a project fallback

`fetch-library-assets.mjs` extracts sprite/backdrop/costume/sound references from
the exact pinned source. The build downloads bounded-concurrency stock media,
checks safe hash-based filenames and verifies each file's MD5 identity before
writing `library-assets-manifest.json`. Network timeouts and retries are bounded;
missing or corrupt media fails the build. Binary stock libraries are not checked into Git.

At runtime, media loads only from same-origin `/library-assets/<hash>.<extension>`
without credentials or redirects. The storage helper accepts supported media types
and matching formats only. Project/JSON IDs, arbitrary URLs and traversal paths
never become media requests. HTML responses are rejected, and nginx returns a real
404 for absent library files rather than falling through to a successful SPA page.
There is no runtime fallback to Scratch Foundation project/asset servers.
Explicitly selected native extensions may still use their own services/devices;
that is not a hidden dependency of core project/media loading.

## Preview configuration

Owner change 2026-09-16: Scratch is now an active, local-file editor for all
users. `ASA_BLOCKS_PREVIEW` no longer controls module visibility, creation or
editor mounting. A valid isolated `ASA_BLOCKS_RUNTIME_ORIGIN` and a reachable
runtime are still required. Never use the legacy preview flag as an access-control switch. School/class controls are deferred.
Missing configuration or a runtime timeout does not hide the module. Keep the
native `.sb3` controls; the ready editor has no persistent footer. A timed-out or failed
runtime can be reconnected from the parent-owned status row.

The historical preview recipe below describes the existing packaging mechanism,
not a requirement to hide ordinary user access.

A legacy explicitly configured TEST stand uses
`ASA_BLOCKS_PREVIEW=1`, `ASA_BLOCKS_RUNTIME_ORIGIN` for the browser-visible exact
Scratch origin and `ASA_BLOCKS_PARENT_ORIGIN` for the exact ASA parent origin.
`compose.blocks-preview.yaml` is retained for compatibility only; the base Compose
stack supplies the isolated Scratch service for normal startup.
The default preview port is `127.0.0.1:4613`.

The preview service runs as uid/gid `101:101`, read-only, without capabilities,
with temporary writable nginx cache/run directories. The static nginx config is
baked into `/etc/nginx/conf.d/default.conf`; no entrypoint write to a read-only
configuration directory is required. CI exercises these same restrictions.

## Verification

Run `pnpm gate:blocks` for focused source checks and
`pnpm gate:blocks --browser` against the production-built isolated runtime.
GitHub Actions owns the heavy pinned Docker build and exact-SHA browser evidence.
The general repository gate remains separate.

Browser evidence includes the trusted protocol, real VM run/stop, read-only player,
native Russian/English Settings and Extensions, local stock library selection,
defensive storage and missing-media HTTP 404s. The product integration harness
bundles the shipping `BlocksEditor` and `useEditorAvatar`; only its account HTTP
response is deterministic fixture data. It checks the actual image, parent-only
identity, fullscreen geometry, account updates and survival of runtime failure.
It does not claim a production account or production database was exercised.

Portable installation instructions: [SCRATCH_INSTALLATION.md](../../docs/deployment/SCRATCH_INSTALLATION.md).

All product code lives in the repository. TEST may only rebuild an accepted SHA;
local or acceptance-only product patches are not a delivery mechanism. Updating a
running installation is a separate explicitly authorised guarded deployment.

## Deliberate limits

The current runtime uses read-only controlled project fixtures. The ready editor
has no permanent notice; local-file limitations remain in docs and leave confirmation.
Native Save to your computer
is upstream local export, not ASA durable persistence. This integration does not
claim runtime JWT endpoints, durable asset storage, ASA save/reopen, autosave,
recovery/conflicts, publication, Learning submission or coherent managed-storage
backup/restore. Those require their separately selected canonical milestones.
Basic local-file access is already active by the owner decision.

## License and provenance

The image preserves the upstream AGPL license, Scratch GUI trademark notice and
exact lock under `/licenses/`. Pin changes require reviewed compatibility,
dependency/security/license and reproducible build/browser evidence.

## Exact-SHA artifact packaging for a manual TEST stand

A small packaging recipe, `Dockerfile.artifact`, reuses the completed GitHub Actions
standalone artifact without rerunning the heavy upstream compiler on Docker Desktop.
Use only an artifact from a successful exact-SHA Scratch workflow; verify the archive
SHA-256 against the Actions artifact digest before extracting it. Do not edit product files.
Prepare a dedicated build context containing the artifact's `standalone/` directory,
`configure-artifact.mjs`, and `nginx.conf.template` copied as `nginx.conf` from the same
repository SHA. Build with `Dockerfile.artifact`, `ASA_BUILD_REVISION` set to that full
SHA, and `ASA_BLOCKS_PARENT_ORIGIN` set to the exact TEST Web origin.

The recipe rejects a mismatched `asa-commit.txt`, incomplete payload and non-origin
URLs. It configures only the deployment parent origin, just like the normal source
Dockerfile. Run it with the same non-root/read-only/bounded tmpfs restrictions as
`compose.blocks-preview.yaml`. Source compilation in CI remains the authoritative
reproducible build; artifact packaging does not replace or weaken that gate.

A manual TEST stand must keep Web/API/runtime on the same revision. The legacy
preview flag does not restore a permanent editor footer or gate access. Keep TEST
data separate; changing a test address is configuration, not a product fork.
Normal installation uses source builds and does not require this artifact recipe.

## Connection status ownership

The shipping `BlocksEditor` removes its status row entirely once `editor-ready`
is received. The iframe fills the available viewport. Connecting/error/retry states
remain actionable but are not permanent footnotes. `?asaStatus=parent` hides the
child's redundant status only after accepted INIT; it never grants authority.
Owner follow-up supersedes the previous always-visible save notice requirement.
The explicit home-leave confirmation remains. Tests cover full-height ready state,
error/retry, origins, account and native File behavior at 1440/1024/390/320.

## Native File round-trip evidence

The shipping-parent browser suite edits a real program, adds a stock sprite and
sound plus a named variable, then uses native File > Save to your computer.
It checks File > New clears those changes, closes that browser, and imports the
actual downloaded `.sb3` through File > Load from your computer in a fresh editor.
The restored program runs/stops, sprite position, costumes and sound are checked,
and restoration must not fetch stock-library resources or issue a server write.
The parent-owned account remains visible; the ready status row is absent. Evidence includes the
synthetic `.sb3`, screenshots and phase-labelled network requests in
`reports/blocks/product-integration/native-file-roundtrip/`.
This verifies preserved upstream local File behavior, not ASA durable save/reopen,
untrusted archive validation, or completion of the separate M1-007 import/export API.

### Stock WAV transport regression

The pinned Nginx image does not map `.wav` in its default MIME table. Returning
`application/octet-stream` makes the host's deliberately strict media loader reject
stock WAV bytes. Scratch may retain the sound name with fallback data; the resulting
local `.sb3` can reference `undefined.wav` and fail to reopen correctly.

The stock-library location explicitly maps WAV to `audio/wav` and retains the SVG,
PNG, JPEG, MP3 and JSON mappings. The media loader's allowlist is not relaxed.
The browser suite checks the real runtime HTTP MIME, RIFF/WAVE signature and pinned
Bark content hash. After the native File round trip it also exports Bark through
Scratch's native sound context menu and checks the downloaded bytes against that
same stock hash. A visible label alone no longer proves sound preservation.

Failure evidence includes the last editor screenshot/DOM and browser errors as well
as the downloaded project and phase-labelled network log. A supplementary fixture
using Nginx's former WAV header reproduced an invalid archive/import failure; the
new MIME assertion rejects that header. Only the exact-SHA Docker/browser CI can
accept the actual Nginx configuration. This correction does not deploy the runtime,
change Scratch's interface, enable server saving, or accept the whole B milestone.

## ASA home navigation and local loading checks

The top-left ASA wordmark has a parent-owned button, hover/focus feedback and a
keyboard-accessible name. `ModuleEditorHost` supplies the home callback; the parent
asks for confirmation with the local `.sb3` warning before invoking it. Cancel
keeps the same editor alive. Account navigation stays on the right-hand avatar.
The native Scratch Home/icon does not acquire portal navigation authority; neither
an account callback nor a navigation message is added to the child protocol.

The build precompresses JavaScript, CSS, JSON and SVG without changing original
bytes. Nginx prefers these static gzip files, avoiding per-request compression of
the large GUI bundle; dynamic gzip remains a fallback for small host files. This includes
requests arriving through a proxy (`gzip_proxied any`, `Vary: Accept-Encoding`).
It serves no authenticated account/API responses. Only hash-addressed stock files
get year-long immutable caching. The stock manifest, unversioned host/scripts,
HTML and revision metadata revalidate with `Cache-Control: no-cache`. Missing
media still returns a genuine 404 without an immutable-cache header; WAV types
and bytes remain unchanged. Do not infer gzip from a HEAD request without
`Accept-Encoding`, or compare a decoded response size with wire bytes.

The cumulative browser suite checks gzip/plain payload equality, cache boundaries,
native file restoration, the wordmark hit area without covering Settings, hover,
keyboard confirmation/cancellation and the unchanged avatar. Ready/error layout
checks remain in force. Local performance diagnostics must distinguish cold from
warm loads, first usable library content from all preview images, and loopback
from simulated network limits. Do not claim a measured domain bottleneck from
local tests. A local runtime may reuse the exact released image with only its
parent-origin configuration changed; label that fixture, keep the working stack
untouched, and remove only the temporary diagnostic container afterwards.

Dated local measurements and limits: [local UX report](../../docs/review/VSCR_M4_002_LOCAL_UX_2026-09-16.md).
