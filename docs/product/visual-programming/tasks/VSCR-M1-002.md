# VSCR-M1-002 — ASA-owned Scratch host milestone router

**Kind:** milestone router; not a single coding slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-001 accepted and the M1-002 milestone explicitly selected.

## Goal

Establish the ASA-owned standalone Scratch host boundary without combining build, trust boundary,
fixture mount, product controls and integrated acceptance into one uncontrolled agent run.

The milestone is ordered by **working capability**, not by UI polish first:

```text
VSCR-M1-002A  standalone build + minimal ASA host shell
→ technical evidence / STOP
VSCR-M1-002C  strict parent/iframe bootstrap boundary
→ security evidence + independent review / STOP
VSCR-M1-002D  fixture storage adapter + real editor mount
→ FIRST VISIBLE SCRATCH checkpoint / STOP
VSCR-M1-002B  ASA branding + File/Extensions controls on the real editor DOM
→ product-chrome evidence / STOP
VSCR-M1-002E  integrated browser/Docker acceptance + independent review
→ owner acceptance of M1-002 milestone / STOP
```

Do not execute this router as one coding task. Do not restore the historical `A → B → C → D`
order: B needs a real mounted editor DOM, which only exists after C/D.

## Canonical milestone authorization

`VSCR-M1-002` is a milestone router, never a temporary executable `task.id`. When the owner
authorises the milestone and an executable sub-slice is selected, canonical `main` stores:

```yaml
primary_lane:
  milestone:
    id: VSCR-M1-002
    owner_authorization: accepted
```

The executable task remains the exact sub-slice and its `task.status` must be `in_progress`.
`tools/validate-blocks-docs.mjs` rejects active M1-002 sub-slices if this milestone marker is
absent or malformed.

## Components

The milestone covers:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.protocol
blocks.host.storage-adapter
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
```

Each sub-slice loads only the component entries named by its own card.

## First visible Scratch capability

M1-002C + M1-002D together create the first meaningful user-visible result:

```text
ASA parent
→ valid INIT
→ isolated Scratch host
→ ASA-controlled fixture storage
→ real Scratch editor mounts
→ workspace/stage visible
→ controlled block programme runs/stops
→ no Scratch Foundation project/library fallback
```

Durable save is intentionally later. Product branding/controls are intentionally after this
checkpoint so their browser evidence observes a real editor.

## Minimal read set

For milestone planning only:

```text
../README.md
../VSCR-M1-FORWARD-PLAN-2026-09-11.md
this router
```

For coding, read only the selected A/C/D/B/E card. Do not preload all five cards.

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

Task cards are bounded design snapshots, not permission to ignore interfaces accepted by an earlier
sub-slice.

Before selecting the next sub-slice in `current.yaml`:

```text
read the accepted previous slice component entries
→ compare the next card's planned paths/dependencies with actual accepted interfaces
→ if still exact, select the next task normally
→ if stale, update only that next task/component routing first
→ run node tools/validate-blocks-docs.mjs
→ then select the refined exact task separately
```

Do not expand a stale card during coding.

## Acceptance granularity

Not every internal layer needs an owner-visible ceremony:

```text
A  technical foundation
C  high-risk security boundary; independent review required
D  first visible editor capability; owner-visible checkpoint
B  product controls on accepted real DOM
E  integrated high-risk acceptance; owner milestone acceptance
```

Each task still has its own exact evidence and STOP boundary. The distinction is that owner-visible
product checkpoints are tied to meaningful capability, not to every internal layer.

## Forbidden

```text
no one-shot implementation of all M1-002 concerns
no automatic A → C → D → B → E progression
no return to branding-before-mount order
no execution from a stale next-slice card
no M1-003 runtime JWT work
no S3/MinIO
no Project Core persistence
no activation
```

## Bounded self-review

At the milestone level, verify only that:

```text
A/C/D/B have separate accepted evidence
D proves the first visible working editor
B productises the already mounted editor
E reviewed the integrated host boundary
next cards were refreshed against accepted prior interfaces before selection
no sub-slice started automatically
component cards contain actual source/test ownership
M1-003 was not started
```

## Stop

After each selected sub-slice STOP. After M1-002E STOP again for owner milestone acceptance. Only
then may M1-003 become selectable.
