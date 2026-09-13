# VSCR-M1-002E — Integrated host acceptance and independent review

**Kind:** acceptance/review slice; no new architecture  
**Risk:** high  
**Prerequisite:** VSCR-M1-002A, C, D and B each accepted on their own exact evidence.  
**Execution:** review starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002E` and its status is `in_progress`; milestone `VSCR-M1-002` must remain owner-authorised.

## Goal

Prove that the complete M1-002 Scratch host works as one coherent ASA-owned product surface after the accepted A/C/D/B slices, then perform independent review before owner acceptance of the M1-002 milestone.

## Components

Review only the already implemented entries:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.protocol
blocks.host.storage-adapter
blocks.host.branding
blocks.host.localization
blocks.host.theme
blocks.host.identity-shell
blocks.host.file-menu
blocks.host.extensions
```

Do not load runtime/assets/project/Gallery/sb3 cards unless evidence exposes a concrete boundary defect.

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

Acceptance normally changes no product implementation. Allowed writes are limited to evidence/tests or routing corrections:

```text
e2e/blocks-host-acceptance.spec.ts
.github/workflows/scratch-focused.yml or focused successor
../components/host.yaml                # evidence/routing correction only
```

If acceptance exposes a product defect, mark E `FAIL` and STOP. Repair it in a separately selected bounded task owned by A/C/D/B, rerun that evidence, then restart E from a clean acceptance state.

## Integrated acceptance

Browser/Docker/network evidence must prove at least:

```text
exact configured Scratch pin/version is reported
shipping standalone dist is used, not upstream playground
exactly three authorised upstream patches apply; no fourth exists
real editor mounts only after valid INIT
workspace/stage render; controlled programme runs/stops
canonical ASA logo rendered; Scratch product logo/navigation absent
ASA product header uses canonical ASA colour
Scratch semantic programming-category colours remain unchanged
ASA avatar/account surface is parent-owned and does not grant Scratch-origin ASA account authority
Settings remains and contains the built-in Scratch language selector
no separate top-level Language/Язык control exists
ru-RU/ru opens Russian; en-US/en opens English; unsupported non-English locale falls back to ru
Russian → English → Russian switching uses upstream Scratch localization
File menu remains visible
Edit menu remains visible
Save now remains unavailable before M1-005
Load/Save .sb3 items remain unavailable before M1-007
Extensions entry point remains visible, ASA-themed and local/approved-only
no Scratch account/share/remix/backpack/cloud/server-save ownership is exposed
wrong source/origin/project/nonce/protocol is rejected
runtime token is absent from URL/persistent browser storage/logs
no postMessage '*'
new fixture does not fetch ASA UUID upstream
no project/library/extension request falls back to Scratch Foundation
PROJECT_CHANGED reaches ASA host after stable load
player fixture mounts read-only
runtime failure leaves ASA parent alive with controlled error state
```

## Independent review

Reviewer must be a different agent/context or a human, never the authoring execution context. Reviewer receives only:

```text
this acceptance card
A/C/D/B task cards
final integrated diff
components/host.yaml + blocks.upstream.pin entry
M1-002 acceptance section of D0-001
focused/browser/Docker/network evidence
```

Reviewer checks scope creep, hidden upstream coupling, token exposure, accidental persistence claims, duplicate language UI, accidental recolouring of Scratch semantic categories, identity-boundary weakening, unapproved patch growth and stale component routing.

Reviewer must not silently repair product code. A product defect is a review failure and routes back to the owning bounded task.

## Tests/evidence

```text
integrated browser acceptance journey
Docker exact-pin build + health/root smoke
network log proving no Scratch Foundation fallback
localization cases: ru-RU, en-US, unsupported non-English, Russian→English→Russian
product-chrome checks: ASA logo/header/avatar, no duplicate language control
File/Edit/Extensions policy checks
semantic block/category colour baseline check
focused component tests from A/C/D/B
node tools/validate-blocks-docs.mjs
required repository gate on exact final SHA
```

## Forbidden

```text
no new M1-002 feature invented during acceptance
no product-code repair hidden inside E
no fourth upstream patch
no new language control or translation fork
no runtime JWT issuance
no S3/MinIO
no Project Core persistence
no autosave
no premature .sb3 support
no M1-003 work
no activation
```

## Bounded self-review

Confirm E changed no product architecture and all accepted host component cards point to actual accepted sources/tests with `state: implemented`. Routing defects may be corrected and revalidated; product-behaviour defects require FAIL/STOP and a separate repair task.

## Stop

STOP after independent review and exact-SHA evidence. M1-002 still requires explicit owner acceptance before M1-003 becomes selectable.
