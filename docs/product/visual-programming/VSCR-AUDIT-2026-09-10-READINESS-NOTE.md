# VSCR readiness audit — 10 September 2026

**Purpose:** concise factual checkpoint after the second critical Scratch audit.  
**Authority:** this note does not replace `current.yaml`, the master spec, D0 contracts or task packages.

## What actually exists today

In the Scratch feature branch:

```text
M0 Blocks provider/schema/tests
VSCR-M0.1-001 corrected persistent Blocks asset-reference contract
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

1. `VSCR-M0.1-001` has been implemented in the feature branch: `objectKey` is removed from
   the persistent Blocks document, canonical asset keys/formats/digests/sizes are strict,
   module version is `0.1.1`, and the focused module contract/API job passes. Explicit owner
   acceptance remains separate from implementation evidence.
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

## M0.1-001 evidence

Implemented code SHA:

```text
d277c4f71553b6c6ef90e52adb41e3200f036a1b
```

The final task delta from the pre-task documentation head changes only:

```text
apps/api/src/blocks-module.ts
apps/api/src/blocks-module.spec.ts
```

At that SHA, the focused `Module contract and API typecheck` job passed formatting, lint,
internal builds, Blocks contract tests and API typecheck. The independent pinned upstream
Docker smoke is reported from GitHub Actions separately and must not be assumed from this
note.

The repository-wide branch gate still sees the feature branch's old `smol-toml 1.6.1`
lock and therefore is not integration-green until the branch is reconciled with current
`main`, which already contains the `1.8.0` override.

## Next safe execution

Do not auto-advance from implementation evidence.

```text
VSCR-M0.1-001 → implementation complete; explicit acceptance pending
VSCR-M0.1-002 → separate coding-ready upstream-lock correction
VSCR-M1-001   → wait for explicit M0.1-001 acceptance
```

`VSCR-M0.1-002` must be complete before `VSCR-M1-002`. No M1 host/storage/security work is
authorised by this audit note.
