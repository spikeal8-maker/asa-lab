# VSCR-M1-002D — FIRST VISIBLE SCRATCH

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted M1-002A standalone host and M1-002C protocol boundary.  
**Status:** accepted and integrated into `main`  
**Integration PR:** #225  
**Accepted source SHA:** `a2d0cd6d8fd2c39945b91e289cbdb02e43924675`  
**Integrated merge SHA:** `143e280510e64dd93026298bc7713eecaac52124`

## Goal

Mount the pinned real Scratch editor through ASA-owned fixture storage after valid
INIT. A user can see the workspace/stage and run/stop a controlled block programme.
This checkpoint makes no durable-save claim.

## Accepted implementation

The accepted implementation is now part of `main` through PR #225. It keeps the
M1-002C protocol/security boundary intact and adds only the D runtime/storage slice.
The older D branch was not merged wholesale; newer canonical product documents for
Settings, language, File/Edit, Extensions, theme and ASA identity remain authoritative.

Actual accepted interfaces:

- `infra/scratch-editor/host/main.js`: `requiredExports` checks the pinned standalone
  `GUI` API; `onInit` mounts the real GUI through
  `infra/scratch-editor/host/editor.js` only after validated INIT.
- `infra/scratch-editor/host/editor.js`: composes the real standalone GUI and the
  ASA-owned fixture storage adapter without moving editor/storage responsibility into
  the protocol bridge.
- `infra/scratch-editor/host/storage.js`: owns the fixture ScratchStorage/GUIStorage
  adapter. It has no Scratch Foundation project/asset fallback and does not pretend
  that fixture writes are durable.
- `infra/scratch-editor/host/protocol.js`: `createChildProtocol` retains exact source,
  Origin, version, project, nonce, memory-only capability and terminal teardown.
  Its `onInit` callback deliberately receives no token.
- `infra/scratch-editor/host/status.js`: `createStatusReporter` retains bound status,
  flush and FATAL message ownership; D does not introduce a production durable-save
  transport.
- `apps/web/src/blocks/runtime-protocol.ts`: `BlocksRuntimeBridge` remains the
  parent-side binding/session pairing boundary; D does not move storage/editor logic
  into it.

The browser acceptance journey is `e2e/blocks-host-storage.spec.ts`, with reusable
browser setup under `tools/blocks/browser/`. Existing C protocol/security scenarios
remain separate in `tools/blocks/browser/scenarios.mjs`.

Fixture semantics accepted by D:

- ASA creates ScratchStorage/GUIStorage; library assets use ASA/local fixture bytes.
- `saveProject()` rejects defensively; there is no false durable-save success.
- No backpack or cloud provider is introduced by D.
- A new technical fixture uses internal Scratch project ID `0`; the ASA UUID is not
  sent to upstream ProjectFetcher.
- Existing controlled fixture loading uses the internal `asa-controlled-fixture` ID.
- Unknown fixture/library assets fail explicitly instead of falling through to
  Scratch Foundation network storage.
- The standalone new-project bootstrap dispatches exported `setProjectId('0')` after
  render.
- Player mode uses `isPlayerOnly`; `isEmbedded` remains omitted because the pinned
  standalone helper would force every session into a fullscreen player.
- No production project/asset runtime endpoint is introduced by this checkpoint.

## Acceptance and evidence

The integration candidate `a2d0cd6d8fd2c39945b91e289cbdb02e43924675`
passed the required checks before merge:

- `Scratch Focused` run #64 — success, including the focused Scratch gate and the
  standalone host/browser smoke journey.
- `Scratch Documentation Routing` run #228 — success.
- `ASA Lab Governance and Code Gates` run #2516 — success.

Browser evidence covers valid INIT before mount, visible workspace/stage,
new/existing controlled fixture loads, block run/stop, read-only player, observed
PROJECT_CHANGED after stable load, defensive save failure and absence of Scratch
Foundation project/asset fallback. C protocol/security cases remain intact.
Refresh/reopen may still lose fixture changes until the separately selected durable
save milestone.

## Explicitly not delivered by D

No branding/File/Extensions implementation, JWT, real runtime project/asset API,
asset/draft PUT, S3/MinIO, autosave, `.sb3`, production exposure or public module
activation is claimed by this checkpoint. The `blocks` module remains governed by
its existing activation state.

## Stop

D is complete at FIRST VISIBLE SCRATCH. `VSCR-M1-002B` is a separately selected
product-controls checkpoint and has **not** been started by this acceptance or merge.
Readiness never starts the next task automatically.
