# VSCR-M1-002D — ScratchStorage/GUIStorage fixture adapter

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-002C accepted.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002D`.

## Goal

Mount the pinned standalone editor through ASA-owned ScratchStorage/GUIStorage fixture
behaviour without introducing real runtime API persistence. The adapter must have no implicit
Scratch Foundation project/library fallback.

## Components

```text
blocks.host.storage-adapter
```

Open only that entry in `components/host.yaml` plus direct protocol dependency when needed.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/host.yaml → blocks.host.storage-adapter
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Scratch storage adapter + VM/save boundary
actual host/protocol accepted in M1-002A–C
```

## Expected write paths

```text
infra/scratch-editor/host/storage.js
infra/scratch-editor/host/main.js       # adapter composition only
infra/scratch-editor/host/status.js     # only adapter status wiring
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
controlled new fixture mounts and runs
no project/media request falls back to Scratch Foundation hosts
saveProject cannot report durable success
new fixture does not fetch ASA project UUID upstream
PROJECT_CHANGED reaches ASA host observation after stable load
player fixture can mount read-only
```

## Tests/evidence

```text
browser network evidence shows no Scratch Foundation fallback
new fixture + existing controlled fixture load paths
saveProject defensive-failure test
PROJECT_CHANGED observation test
player fixture read-only test
node tools/validate-blocks-docs.mjs
```

## Forbidden

```text
no real /api/blocks/runtime project/asset implementation
no JWT issuance
no asset PUT
no draft PUT
no autosave orchestrator
no S3/MinIO
no production route exposure
```

## Bounded self-review

Review only storage-adapter behaviour, final diff, mapped D0 section and network/browser
evidence. Confirm no persistence success is claimed and no external fallback remains.

## Stop

STOP after evidence. VSCR-M1-002E requires separate owner-authorised selection in
`current.yaml` after D is accepted.
