# VSCR-M1-002D — ScratchStorage/GUIStorage fixture adapter + first visible editor

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-002C accepted.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002D` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Mount the pinned standalone editor through ASA-owned ScratchStorage/GUIStorage fixture behaviour
behind the protocol boundary accepted in C. This is the **first visible Scratch checkpoint**:
a user/test must be able to see and operate a real editor without claiming durable ASA save yet.

## Components

```text
blocks.host.storage-adapter
```

Open only that entry in `components/host.yaml` plus the accepted protocol dependency when needed.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/host.yaml → blocks.host.storage-adapter
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Scratch storage adapter + VM/save boundary
actual host/protocol accepted in M1-002A/C
```

## Expected write paths

```text
infra/scratch-editor/host/storage.js
infra/scratch-editor/host/main.js       # adapter composition + editor mount only
infra/scratch-editor/host/status.js     # only adapter/editor status wiring
tests/blocks/fixtures/**                # bounded local fixture data if needed
e2e/blocks-host-storage.spec.ts
../components/host.yaml → blocks.host.storage-adapter only
```

## Adapter scope

```text
ScratchStorage/GUIStorage created by ASA host
saveProject() rejects defensively; no fake save success
getLibraryAssetUrl() ASA/local fixture only
backpack storage absent
cloud provider absent
new technical fixture may use internal Scratch default ID 0
ASA UUID is not sent to upstream ProjectFetcher for a new fixture
```

No production runtime project/asset endpoint is introduced here.

## Acceptance

```text
valid INIT can mount the real Scratch editor
workspace and stage are visibly rendered
controlled fixture project loads and runs
controlled block programme can start and stop
no project/media request falls back to Scratch Foundation hosts
saveProject cannot report durable success
new fixture does not fetch ASA project UUID upstream
PROJECT_CHANGED reaches ASA host observation after stable load
player fixture can mount read-only
```

This checkpoint is intentionally usable but not yet durable: refresh/reopen may lose unsaved
fixture changes until M1-005.

## Tests/evidence

```text
real browser visible-editor journey
workspace/stage presence
controlled run/stop interaction
browser network evidence shows no Scratch Foundation fallback
new fixture + existing controlled fixture load paths
saveProject defensive-failure test
PROJECT_CHANGED observation test
player fixture read-only test
node tools/validate-blocks-docs.mjs
```

## Forbidden

```text
no product branding/File/Extensions work
no real /api/blocks/runtime project/asset implementation
no JWT issuance
no asset PUT
no draft PUT
no autosave orchestrator
no S3/MinIO
no production route exposure
```

## Bounded self-review

Review only storage-adapter/editor-mount behaviour, final diff, mapped D0 section and
network/browser evidence. Confirm no persistence success is claimed and no external fallback
remains.

## Independent review

Because this is a HIGH-risk external-fallback/runtime-boundary slice, acceptance requires a
reviewer that is not the authoring execution context. Give the reviewer only:

```text
this task card
final diff
blocks.host.storage-adapter component entry
mapped D0-001 sections
authoritative browser/network evidence on the exact SHA
```

The reviewer checks that the editor mounts only through the accepted C boundary, no Scratch
Foundation fallback remains, fixture IDs cannot invoke upstream project fetch semantics,
`saveProject()` cannot fake durable success and no real M1-003/M1-004/M1-005 API was implemented
early.

## Stop

STOP at the **FIRST VISIBLE SCRATCH** checkpoint. The next planned slice is `VSCR-M1-002B`, which
productises the now-real editor DOM with ASA branding and File/Extensions controls. B requires
separate selection in `current.yaml`.
