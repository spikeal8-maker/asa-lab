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

Blocks remains milestone-gated by default. An explicitly configured preview uses
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
