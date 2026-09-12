# VSCR-M1-002B — ASA branding + File/Extensions controls

**Kind:** executable implementation slice  
**Risk:** medium  
**Prerequisite:** VSCR-M1-002A accepted.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Apply only the accepted ASA product-branding and editor-control boundary to the working host
shell: canonical ASA logo, no Scratch product logo/navigation, no built-in File ownership and
no upstream Extensions surface in core mode.

## Components

```text
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
```

Open only those entries in `components/host.yaml`.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/host.yaml → three selected entries
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Branding + Product controls + Extensions
apps/web/public/asa-lab-mark.svg
actual host shell accepted in M1-002A
```

## Expected write paths

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/patches/0002-extension-button-visibility.patch
infra/scratch-editor/host/branding.js
infra/scratch-editor/host/editor-config.js
infra/scratch-editor/host/main.js             # composition wiring only
infra/scratch-editor/Dockerfile               # deterministic patch/logo copy only
infra/scratch-editor/README.md
e2e/blocks-host-controls.spec.ts
.github/workflows/scratch-focused.yml       # only if focused command needs it
../components/host.yaml → selected entries only
```

## Acceptance

```text
canonical apps/web/public/asa-lab-mark.svg bytes are the logo source
Scratch product logo/navigation is absent
canManageFiles=false and File menu is absent
extensionsButtonVisible=false and Extensions button is absent
account/share/remix/backpack/cloud ownership remains absent
exactly two upstream patches exist and apply cleanly
no second independently editable ASA logo is introduced
```

## Tests/evidence

Use actual DOM/browser evidence, not source grep only:

```text
ASA logo rendered
no Scratch logo/link to scratch.mit.edu
File menu absent
Extensions button absent
no extra upstream patch
Docker rebuild succeeds on exact pin
node tools/validate-blocks-docs.mjs
```

## Forbidden

```text
no iframe protocol
no runtime token
no ScratchStorage adapter
no save/load
no S3/MinIO
no third upstream patch
no mass rebranding upstream strings
```

## Bounded self-review

Check only the selected controls, final diff and browser evidence. Verify `main.js` did not
absorb branding/control logic and no third patch was added.

## Stop

STOP after evidence. VSCR-M1-002C requires separate owner-authorised selection in
`current.yaml` after B is accepted.
