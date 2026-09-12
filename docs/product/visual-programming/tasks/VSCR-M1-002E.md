# VSCR-M1-002E — Integrated host acceptance and independent review

**Kind:** acceptance/review slice; no new architecture  
**Risk:** high  
**Prerequisite:** VSCR-M1-002A, C, D and B each accepted on their own exact evidence.  
**Execution:** review starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002E` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Prove the integrated M1-002 host boundary works as one coherent ASA-owned runtime surface and
perform the required independent review before the M1-002 milestone can be owner-accepted.

## Components

Review the already implemented entries only:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.protocol
blocks.host.storage-adapter
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
```

Do not load runtime/assets/project/Gallery/sb3 cards unless evidence uncovers a concrete boundary
defect.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.upstream.pin only
../components/host.yaml
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → M1-002 acceptance
accepted A/C/D/B evidence and final host diff
```

## Expected write paths

Acceptance/review normally changes no product implementation. Allowed writes are limited to
acceptance evidence/tests or routing corrections discovered by the review:

```text
e2e/blocks-host-acceptance.spec.ts
.github/workflows/scratch-focused.yml or focused successor
../components/host.yaml                # evidence/routing correction only; no new implementation ownership
```

If acceptance uncovers a product defect, mark this slice `FAIL` and STOP. Do not repair the
product inside M1-002E. Create/select a separate bounded repair task for the owning A/C/D/B
component, rerun its focused evidence, then rerun M1-002E from a clean acceptance state.

## Acceptance

Browser/Docker evidence must prove at least:

```text
exact configured Scratch pin/version reported
shipping standalone dist, not upstream playground root
exactly two authorised patches and no third
real editor mounts only after valid INIT
workspace/stage render and controlled programme can run/stop
canonical ASA logo rendered; no Scratch product logo/navigation
File menu absent
Extensions button absent
no account/share/backpack/cloud/server-save ownership
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

The reviewer must be a different agent/context or a human, never the authoring execution context.
Reviewer receives only:

```text
this acceptance card
A/C/D/B task cards
final integrated diff
components/host.yaml + blocks.upstream.pin entry
the M1-002 acceptance section of D0-001
focused/browser/Docker evidence
```

The reviewer checks for scope creep, hidden upstream coupling, token exposure, accidental
persistence claims and missing component-map updates. Full-repository reread is not the default.

The reviewer must not silently repair product code while reviewing. A product defect is a review
failure and routes back to the owning bounded component task.

## Tests/evidence

```text
integrated browser acceptance journey
Docker exact-pin build + health/root smoke
network log for external fallback
focused component tests from A/C/D/B
node tools/validate-blocks-docs.mjs
required repository gate on exact final SHA
```

## Forbidden

```text
no new M1-002 feature invented during acceptance
no product-code repair hidden inside the review slice
no runtime JWT issuance
no S3/MinIO
no Project Core persistence
no autosave
no M1-003 work
no activation
```

## Bounded self-review

Confirm acceptance/review work changed no product architecture and all host component cards already
point to actual accepted sources/tests with `state: implemented`. If routing itself is wrong,
correct only the routing metadata and re-run validation; if product behaviour is wrong, FAIL/STOP
and route to a separate repair task.

## Stop

STOP after independent review and evidence. M1-002 milestone still requires explicit owner
acceptance before any M1-003 design/card work becomes selectable.
