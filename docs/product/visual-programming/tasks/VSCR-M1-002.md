# VSCR-M1-002 — ASA-owned Scratch host milestone router

**Kind:** milestone router; not a single coding slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-001 accepted and the M1-002 milestone explicitly selected.

## Goal

Establish the ASA-owned standalone Scratch host boundary without combining build, trust boundary, real-editor mount, product shell and integrated acceptance into one uncontrolled agent run.

Product order:

```text
VSCR-M1-002A  standalone build + minimal ASA host shell
→ technical evidence / STOP
VSCR-M1-002C  strict parent/iframe bootstrap boundary
→ security evidence + independent review / STOP
VSCR-M1-002D  fixture storage adapter + real editor mount
→ FIRST VISIBLE SCRATCH / STOP
VSCR-M1-002B  preserve native Scratch shell + ASA logo/colour/avatar
→ product-shell evidence + independent review / STOP
VSCR-M1-002E  integrated browser/Docker acceptance + independent review
→ owner acceptance of M1-002 / STOP
```

Do not execute this router as one coding task. B only happens after real DOM exists through C+D.

## Canonical milestone authorization

`VSCR-M1-002` is a router, never a temporary executable `task.id`.

Selected implementation slice requires:

```yaml
primary_lane:
  milestone:
    id: VSCR-M1-002
    owner_authorization: accepted
```

and exact selected `task.id` with `task.status: in_progress` in `docs/execution/current.yaml`.

## Components

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

## First visible Scratch capability

C+D prove:

```text
ASA parent
→ valid INIT
→ isolated Scratch host
→ controlled fixture storage
→ real Scratch editor
→ workspace/stage
→ run/stop
→ honest non-durable fixture behaviour
```

## B product-shell capability

B does **not** redesign Scratch.

```text
Scratch product logo → ASA logo
верхняя product bar → ASA colour
правый account/avatar area → ASA parent-owned avatar/account
D forced locale='en' → removed
```

Everything else stays native Scratch unless a separately reviewed technical/security defect proves otherwise:

```text
Settings stays Scratch
language selector stays inside Settings
browser locale stays upstream Scratch behaviour
File/Edit stay Scratch
New / Load from computer / Save to computer stay Scratch local functions
Extensions catalogue stays Scratch
native external-service/hardware integrations stay available
semantic category colours stay Scratch
```

No ASA `ru` fallback, no second language UI, no B extension allowlist, no blanket network deny, no File-menu patch merely to simplify the host.

Core ASA project/asset/editor loading must not secretly depend on Scratch project/asset backends. Explicit traffic from an extension the user intentionally selects is a different and legitimate case.

## Minimal read set

For planning:

```text
../README.md
../VSCR-M1-FORWARD-PLAN-2026-09-11.md
this router
```

For coding, read only the selected A/C/D/B/E card and mapped component/contract.

## Expected write paths

None. This file routes work only.

## Sub-slice cards

```text
VSCR-M1-002A.md
VSCR-M1-002C.md
VSCR-M1-002D.md
VSCR-M1-002B.md
VSCR-M1-002E.md
```

## Pre-selection card refresh

Before selecting the next slice:

```text
prerequisite accepted
→ inspect actual accepted interfaces
→ compare next card with reality
→ if stale, fix the card/routing first
→ validate docs
→ select exact task separately
```

Do not let an old branch/issue overwrite newer canonical B policy.

## Acceptance granularity

```text
A  technical foundation
C  security boundary + independent review
D  first visible real editor
B  ASA product chrome while preserving native Scratch shell
E  integrated acceptance + owner milestone acceptance
```

## Forbidden

```text
no one-shot A/C/D/B/E implementation
no automatic next-task progression
no stale branch/document policy overwrite
no Scratch rewrite
no Settings redesign
no second language button/translation fork
no blanket filtering of native Extensions/external integrations
no File/Edit replacement in B
no M1-003 JWT work
no S3/MinIO in B
no activation
```

## Bounded self-review

Verify D proves a working real editor, B changes only ASA product chrome/identity plus removes forced English, E verifies the integrated boundary, and no old restrictive File/Extensions/language policy was reintroduced.

## Stop

STOP after each selected sub-slice. M1-003 becomes selectable only after M1-002E and explicit owner acceptance of M1-002.
