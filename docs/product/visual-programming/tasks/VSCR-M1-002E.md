# VSCR-M1-002E — Integrated host acceptance and independent review

**Kind:** acceptance/review slice; no new architecture  
**Risk:** high  
**Prerequisite:** VSCR-M1-002A, B, C and D each accepted on their own exact evidence.

## Goal

Prove the integrated M1-002 host boundary works as one coherent ASA-owned runtime surface and
perform the required independent review before the M1-002 milestone can be owner-accepted.

## Components

Review the already implemented entries only:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
blocks.host.protocol
blocks.host.storage-adapter
```

Do not load runtime/assets/project/Gallery/sb3 cards unless evidence uncovers a concrete
boundary defect.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.upstream.pin only
../components/host.yaml
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → M1-002 acceptance
accepted A–D evidence and final host diff
```

## Expected write paths

Normally only:

```text
e2e/blocks-host-acceptance.spec.ts
.github/workflows/scratch-m0-focused.yml or focused successor
../components/host.yaml                # actual paths/tests/state after acceptance
```

If acceptance uncovers a defect, fix only the mapped A–D component that owns it and rerun its
focused evidence plus this acceptance. Do not introduce a new concern in E.

## Acceptance

Browser/Docker evidence must prove at least:

```text
exact configured Scratch pin/version reported
shipping standalone dist, not upstream playground root
exactly two authorised patches and no third
canonical ASA logo rendered; no Scratch product logo/navigation
File menu absent
Extensions button absent
no account/share/backpack/cloud/server-save ownership
editor does not render before valid INIT
wrong source/origin/project/nonce/protocol rejected
runtime token absent from URL/persistent browser storage/logs
no postMessage '*'
new fixture does not fetch ASA UUID upstream
no project/library request falls back to Scratch Foundation
PROJECT_CHANGED reaches ASA host after stable load
player fixture mounts read-only
runtime failure leaves ASA parent alive with controlled error state
```

## Independent review

Reviewer receives only:

```text
this acceptance card
A–D task cards
final integrated diff
components/host.yaml + blocks.upstream.pin entry
the M1-002 acceptance section of D0-001
focused/browser/Docker evidence
```

The reviewer checks for scope creep, hidden upstream coupling, token exposure, accidental
persistence claims and missing component-map updates. Full-repository reread is not the
default.

## Tests/evidence

```text
integrated browser acceptance journey
Docker exact-pin build + health/root smoke
network log for external fallback
focused component tests from A–D
node tools/validate-blocks-docs.mjs
required repository gate on exact final SHA
```

## Forbidden

```text
no new M1-002 feature invented during acceptance
no runtime JWT issuance
no S3/MinIO
no Project Core persistence
no autosave
no M1-003 work
no activation
```

## Bounded self-review

Confirm acceptance/review work changed no architecture and all host component cards now point
to actual accepted sources/tests with `state: implemented` only after evidence exists.

## Stop

STOP after independent review and evidence. M1-002 milestone still requires explicit owner
acceptance before M1-003 becomes selectable.
