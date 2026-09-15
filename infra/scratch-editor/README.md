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
runtime are still required. The legacy preview flag is only a TEST presentation
setting; never use it as an access-control switch. School/class controls are deferred.
Missing configuration or a runtime timeout does not hide the module. Keep the
no-account-save warning and native `.sb3` instructions. A timed-out or failed
runtime can be reconnected from the parent-owned status row.

The historical preview recipe below describes the existing packaging mechanism,
not a requirement to hide ordinary user access.

A legacy explicitly configured TEST stand uses
`ASA_BLOCKS_PREVIEW=1`, `ASA_BLOCKS_RUNTIME_ORIGIN` for the browser-visible exact
Scratch origin and `ASA_BLOCKS_PARENT_ORIGIN` for the exact ASA parent origin.
Web/API must agree on the preview flag. `compose.blocks-preview.yaml` supplies the
isolated Scratch service; the base Compose stack has no mandatory Scratch service.
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

All product code lives in the repository. TEST may only rebuild an accepted SHA;
local or acceptance-only product patches are not a delivery mechanism. Updating a
running installation is a separate explicitly authorised guarded deployment.

## Deliberate limits

The current runtime uses read-only controlled project fixtures. The visible
preview warning states that changes are not saved. Native Save to your computer
is upstream local export, not ASA durable persistence. This integration does not
claim runtime JWT endpoints, durable asset storage, ASA save/reopen, autosave,
recovery/conflicts, publication, Learning submission, backup/restore or public
activation. Those require their separately selected canonical milestones.

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

Preview Web/API must use this same revision and the explicit preview flag. The
portal header shows TEST only in the configured Blocks preview, while the editor
continues to show the existing no-save preview warning. Keep the normal installation
and its data separate; changing a test address is configuration, not a product fork.

## Embedded preview status ownership

The shipping `BlocksEditor` reserves a normal-flow footer below its iframe for one
parent-owned status and the persistent no-save warning. It does not cover the
Scratch workspace or controls. The iframe uses `?asaStatus=parent`, a presentation
opt-in only: it carries no token, permission or project authority. The child hides
its redundant local live region only after an accepted editor INIT; before INIT,
in player mode, and for parents without the opt-in, local host messages remain.
Parent runtime-failure reporting is unchanged. No upstream UI or protocol payload
is modified. `e2e/blocks-product-integration.spec.ts` checks a non-overlapping,
unclipped footer and the retained warning in ready/error states at
1440/1024/390/320; these checks do not certify all upstream mobile editor controls.

## Native File round-trip evidence

The shipping-parent browser suite edits a real program, adds a stock sprite and
sound plus a named variable, then uses native File > Save to your computer.
It checks File > New clears those changes, closes that browser, and imports the
actual downloaded `.sb3` through File > Load from your computer in a fresh editor.
The restored program runs/stops, sprite position, costumes and sound are checked,
and restoration must not fetch stock-library resources or issue a server write.
The no-save warning and parent-owned account remain visible. Evidence includes the
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
