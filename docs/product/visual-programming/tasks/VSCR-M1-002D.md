# VSCR-M1-002D — FIRST VISIBLE SCRATCH

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted M1-002A standalone host and M1-002C protocol boundary.

**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002D` and `docs/execution/current.yaml.task.status` is `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be `VSCR-M1-002` with `owner_authorization` = `accepted`.

## Goal

Mount the pinned real Scratch editor through ASA-owned fixture storage after valid
INIT. A user can see the workspace/stage and run/stop a controlled block programme.
This checkpoint makes no durable-save claim.

## Read and edit

Read only `blocks.host.storage-adapter` in [components/host.yaml](../components/host.yaml),
then [D0-001: Scratch storage adapter](../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md#scratch-storage-adapter).
For the VM handoff read "VM and save boundary" in that same contract. Do not preload the whole contract,
Master, ADR, roadmap, component index or previous task cards.

Actual accepted interfaces:

- `infra/scratch-editor/host/main.js`: `requiredExports` checks the pinned standalone
  `GUI` API; `onInit` is the composition point after validated INIT. The editor root
  is currently empty. Put editor composition here or in its own ASA-owned module.
- `infra/scratch-editor/host/protocol.js`: `createChildProtocol` owns exact source,
  Origin, version, project, nonce, memory-only capability and terminal teardown.
  Its `onInit` callback deliberately receives no token. Read only the relevant
  interface when wiring the adapter; preserve the accepted boundary.
- `infra/scratch-editor/host/status.js`: `createStatusReporter` emits bound status,
  flush and FATAL messages. Current flush explicitly returns `storage_not_available`.
- `apps/web/src/blocks/runtime-protocol.ts`: `BlocksRuntimeBridge` owns parent-side
  binding and session-unique flush pairing. Extend it only if the mapped contract
  actually requires it; storage/editor logic belongs outside protocol modules.

Expected new source: `infra/scratch-editor/host/storage.js`. Expected browser test:
`e2e/blocks-host-storage.spec.ts`, with setup/helpers reusable from
`tools/blocks/browser/`. Update only the storage-adapter entry when paths become real.
The existing protocol scenarios remain in `tools/blocks/browser/scenarios.mjs`;
do not insert the editor journey into those security scenarios.

## Adapter scope

- ASA creates ScratchStorage/GUIStorage; library assets use ASA/local fixtures.
- `saveProject()` rejects defensively; no fake save success.
- No backpack or cloud provider and no Scratch Foundation fallback.
- A new technical fixture may use internal Scratch ID `0`; never send the ASA UUID
  to upstream ProjectFetcher.
- No production project/asset runtime endpoint is introduced.

## Acceptance and evidence

`pnpm gate:blocks` is the stable focused gate. Extend `tools/blocks/gate.mjs` with
the new focused/browser test, using `pnpm gate:blocks --browser` in both local
evidence and CI. Do not add another root script or build unrelated modules.

Browser evidence must show valid INIT before mount, visible workspace/stage,
new/existing controlled fixture loads, block run/stop, read-only player, observed
PROJECT_CHANGED after stable load, defensive save failure and no Scratch Foundation
network fallback. Preserve all C protocol/security cases. Refresh/reopen may lose
fixture changes until the separately selected durable-save milestone.

## Forbidden

No branding/File/Extensions work, JWT, real runtime project/asset API, asset/draft
PUT, S3/MinIO, autosave, .sb3, production exposure or activation. Do not rewrite
upstream or move editor/storage responsibilities into the protocol bridge.

## Bounded self-review

Review the adapter/mount diff, mapped contract and actual browser/network evidence.
Confirm that no external fallback or false persistence success exists, C remains
intact, the Scratch gate remains isolated and routes point to actual files.

## Independent review

A reviewer outside the authoring context checks this card, the final diff,
storage-adapter entry, mapped D0 sections and exact-SHA evidence. Verify mount only
after the accepted C boundary, fixture ID semantics, no external fallback, defensive
save failure and no premature runtime APIs.

## Stop

Stop at FIRST VISIBLE SCRATCH. M1-002B is separately selected for product controls
on the actual editor DOM. Readiness never starts the next task automatically.
