# VSCR-M1-002A — Standalone Scratch build + minimal ASA host shell

**Kind:** executable implementation slice  
**Risk:** medium  
**Prerequisite:** VSCR-M1-001 accepted; M1-002 milestone owner-authorised.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002A` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Replace the M0 playground root with a reproducible ASA-owned static shell around the pinned
Scratch shipping standalone distribution. This is a technical foundation slice: it does **not**
need to provide a user-visible editor yet.

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
current infra/scratch-editor/nginx.conf or nginx.conf.template
```

## Expected write paths

```text
infra/scratch-editor/Dockerfile
infra/scratch-editor/nginx.conf.template
infra/scratch-editor/README.md
infra/scratch-editor/host/index.html
infra/scratch-editor/host/main.js
infra/scratch-editor/host/host.css
.github/workflows/scratch-focused.yml
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
real browser host-shell bootstrap has no fatal page/runtime error
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

STOP after evidence. The next planned executable slice is `VSCR-M1-002C`, not branding. C must be
refreshed against the accepted A interfaces and selected separately in `current.yaml`. Do not start
C automatically.
