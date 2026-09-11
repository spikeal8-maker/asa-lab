# VSCR-M1-002A — Standalone Scratch build + minimal ASA host shell

**Kind:** executable implementation slice  
**Risk:** medium  
**Prerequisite:** VSCR-M1-001 accepted; M1-002 milestone owner-authorised.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002A`.

## Goal

Replace the M0 playground root with a reproducible ASA-owned static shell around the pinned
Scratch shipping standalone distribution. Do not add branding patches, iframe protocol or
storage adapter yet.

## Components

```text
blocks.upstream.pin
blocks.host.build
```

Read only the matching entries in `components/module.yaml` and `components/host.yaml`.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.upstream.pin
../components/host.yaml → blocks.host.build
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Upstream provenance + Host layout
infra/scratch-editor/upstream.env
current infra/scratch-editor/Dockerfile
current infra/scratch-editor/nginx.conf
```

## Expected write paths

```text
infra/scratch-editor/Dockerfile
infra/scratch-editor/nginx.conf.template
infra/scratch-editor/README.md
infra/scratch-editor/host/index.html
infra/scratch-editor/host/main.js
infra/scratch-editor/host/host.css
.github/workflows/scratch-m0-focused.yml
../components/host.yaml → blocks.host.build only
```

## Acceptance

```text
exact upstream SHA/version still verified
shipping standalone distribution is built
/ serves ASA host shell, not upstream build/index.html
/healthz remains available
main.js remains composition-only
Scratch GUI/VM is not added to apps/web dependencies
```

## Tests/evidence

```text
Docker build exact pin
container /healthz
root document has ASA host marker
standalone vendor bundle exists
upstream playground root is not served
node tools/validate-blocks-docs.mjs
```

## Forbidden

```text
no logo patch
no Extensions patch
no File/menu product controls
no parent/iframe protocol
no ScratchStorage adapter
no JWT/runtime API
no persistence/storage
```

## Bounded self-review

Check final diff only against `blocks.upstream.pin` + `blocks.host.build` and the Host layout
contract. Confirm no later M1-002 component was started.

## Stop

STOP after evidence. VSCR-M1-002B requires separate owner-authorised selection in
`current.yaml` after A is accepted.
