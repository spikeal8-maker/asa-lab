# VSCR readiness audit — 10 September 2026

**Purpose:** concise factual checkpoint after the second critical Scratch audit.  
**Authority:** this note does not replace `current.yaml`, the master spec, D0 contracts or task packages.

## What actually exists today

In the Scratch feature branch:

```text
M0 Blocks provider/schema/tests
pinned upstream Scratch build boundary
M0 Docker/Nginx playground smoke
Scratch-focused CI workflow
Master v2 / ADR / D0 design contracts
first-wave implementation packages
```

In `main` these Scratch changes are **not integrated yet**. `main` still exposes the old
future `blocks` manifest and ordinary users cannot create a Scratch-backed project.

No current implementation exists yet for:

```text
ASA standalone Scratch host
runtime capability/CORS boundary
S3/MinIO Blocks asset storage
durable Scratch save/load
autosave/recovery
.sb3 import/export
immutable Gallery player/remix
sovereign local media/extension baseline
Blocks object backup/restore
production activation
```

## Corrections produced by this audit

1. `VSCR-M0.1-001` remains the first safe schema correction: remove `objectKey` from the
   persistent Blocks document.
2. Added `VSCR-M0.1-002`: normalise the upstream lock from post-release `82c5fea...` to the
   official `v15.1.1` release commit `99bcc17...` before M1 host implementation.
3. D0-001 now explicitly owns branding/File/Extensions controls. M1 host uses exactly two
   enumerated minimal compatibility patches if pinned upstream still lacks native controls:
   host-supplied logo and Extensions-button visibility. `canManageFiles=false` is mandatory.
4. Upstream default Scratch assets are technical M1 fixtures only. M3 activation requires a
   rights-cleared ASA-owned default project/asset baseline unless rights are explicitly
   established.
5. Added D0-006 because current Gallery reads/copies current drafts. New Blocks publication
   must pin immutable `project_version_id`; cross-tenant remix must server-materialise asset
   ownership into the destination tenant.
6. Readiness was corrected: M1-002/003/004/005 are currently `NO` until their exact
   prerequisites are closed. Old detailed task text cannot override the readiness index.
7. Branch-wide historical dependency failure for `smol-toml 1.6.1` is stale relative to
   current `main`, which already pins `smol-toml 1.8.0`. Final integration evidence must be
   rerun after reconciliation with current `main`.

## Next safe execution

The documentation/convergence step is complete when exact-head documentation/focused CI is
checked. The first coding slice remains:

```text
VSCR-M0.1-001 only
```

It must not auto-advance into M1. `VSCR-M0.1-002` is a separate small upstream-lock slice
and must be complete before `VSCR-M1-002`.