# VSCR-M1-002 — ASA-owned Scratch host + iframe/message skeleton

**Status:** BLOCKED until M1-001 is accepted  
**Risk:** high  
**Behavioral goal:** establish the isolated ASA host boundary; no durable writes yet.

## Goal

Replace the M0 upstream playground boundary with an ASA-owned host around the pinned Scratch
shipping standalone distribution, using small maintainable host modules and the exact
parent/iframe protocol.

This task deliberately stops before real runtime JWT issuance, S3/MinIO or Project Core
persistence.

## Components

Resolve in `../COMPONENT_MAP.yaml`:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
blocks.host.protocol
blocks.host.storage-adapter
```

Open only the referenced cards:

```text
../components/module.yaml → blocks.upstream.pin only
../components/host.yaml
```

Do not read runtime/assets/project/Gallery/Learning/sb3 cards for this task except the exact
D0-004 sections explicitly required for iframe/origin semantics.

## Minimal read set

```text
AGENTS.md
START_HERE_FOR_AI.md
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml compact index
../components/module.yaml → blocks.upstream.pin
../components/host.yaml
../../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md §§0–5,9–11,13
../../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md
../VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md only sections required for iframe/origin/CSP semantics
infra/scratch-editor/upstream.env
current infra/scratch-editor/Dockerfile
current infra/scratch-editor/nginx.conf
```

Do not read all runtime-security/storage contracts.

## Expected write paths

```text
infra/scratch-editor/Dockerfile
infra/scratch-editor/nginx.conf.template
infra/scratch-editor/README.md
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/patches/0002-extension-button-visibility.patch
infra/scratch-editor/host/index.html
infra/scratch-editor/host/main.js
infra/scratch-editor/host/protocol.js
infra/scratch-editor/host/editor-config.js
infra/scratch-editor/host/branding.js
infra/scratch-editor/host/storage.js
infra/scratch-editor/host/status.js
infra/scratch-editor/host/host.css
apps/web/src/blocks/**                  # minimal parent component/test harness only
.github/workflows/scratch-m0-focused.yml or one focused successor workflow
e2e/blocks-host.spec.ts                 # if this is the accepted test placement
../components/host.yaml
../components/module.yaml               # only if upstream/build ownership changed
```

Canonical ASA logo source is read/copied, not redrawn:

```text
apps/web/public/asa-lab-mark.svg
```

Do not create a second independently editable ASA logo asset under `infra/scratch-editor/**`.

## Host module boundaries

Keep `main.js` composition-only. Do not turn it into a monolith.

```text
main.js          editor root composition / lifecycle wiring
protocol.js      parent/iframe message parsing/validation
editor-config.js Scratch GUI feature flags
branding.js      canonical ASA logo/product-brand configuration
storage.js       ScratchStorage/GUIStorage adapter skeleton
status.js        child status/error messages/state presentation
host.css         runtime-local presentation
```

Later persistence tasks may add `save-orchestrator.js`; M1-002 does not implement durable
save logic.

## Required product controls

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

Required branding result:

```text
Scratch product logo              absent
ASA Lab canonical mark            present
scratch.mit.edu navigation         absent
Scratch account/community chrome  absent
```

Exactly two upstream compatibility patches are allowed. A third patch is STOP.

## Protocol now

Implement the exact finite message set from D0-001:

```text
parent → child
  ASA_BLOCKS_INIT
  ASA_BLOCKS_TOKEN_UPDATE
  ASA_BLOCKS_FLUSH_REQUEST
  ASA_BLOCKS_STOP

child → parent
  ASA_BLOCKS_READY
  ASA_BLOCKS_STATUS
  ASA_BLOCKS_TOKEN_REFRESH_REQUIRED
  ASA_BLOCKS_FLUSH_RESULT
  ASA_BLOCKS_FATAL
```

Validate exact source, origin, protocol version, project ID and session nonce. No wildcard
postMessage target. No generic RPC/eval bridge.

M1-002 may use deterministic fixture capability data in tests. Real capability issuance is
M1-003.

## Storage adapter now

Create the ScratchStorage/GUIStorage skeleton required to mount/load controlled fixtures.

```text
saveProject()        defensive failure; no fake successful save
getLibraryAssetUrl() ASA/local only; no Scratch Foundation fallback
backpack/cloud       absent
```

Do not claim durable writes.

## Tests/evidence

Browser/Docker evidence must prove at least:

```text
standalone dist, not upstream playground root
exact pin/version identity reported
exactly two patches apply
canonical ASA logo rendered; no Scratch logo
File menu absent
Extensions button absent
no account/share/backpack/cloud/server-save ownership
editor does not render before valid INIT
wrong source/origin/project/nonce/protocol rejected
token absent from URL/localStorage/sessionStorage/IndexedDB/logs
no postMessage '*'
new fixture does not fetch ASA UUID as upstream project ID
no project/library fallback to Scratch Foundation
PROJECT_CHANGED reaches ASA host after load
player mode mounts read-only
runtime failure leaves ASA parent alive with controlled error state
```

Use actual DOM/network evidence; source grep alone is not acceptance.

## Forbidden

```text
no real JWT issuance
no S3/MinIO
no database migration
no Project Core save
no asset PUT
no production-hidden editor route exposed accidentally
no activation
no third upstream patch
no M1-003 work in this slice
```

## Done

```text
ASA-owned standalone host builds reproducibly
host is split into mapped maintainable modules
canonical logo source is used
iframe protocol is browser-tested
no durable write is claimed
components/host.yaml contains actual source/test ownership
focused + required repository gates pass on exact final SHA
```

## Bounded self-review

Use `../AGENT_GUIDE.md` against this task, final diff, D0-001 and browser/Docker evidence.

Extra questions:

```text
Did I leave any Scratch product branding/navigation visible?
Did I accidentally expose File/Extensions/account/cloud paths?
Did I create a second logo source?
Did main.js absorb logic that belongs in a smaller mapped module?
Did I accidentally implement or claim persistence/JWT/storage?
Did I use more than two upstream patches?
Did I update actual components/host.yaml source/test paths and symbols?
```

Then STOP. M1-003 requires separate owner selection and independent review.
