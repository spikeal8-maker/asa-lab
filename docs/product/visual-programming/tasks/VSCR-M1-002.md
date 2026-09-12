# VSCR-M1-002 — ASA-owned Scratch host milestone router

**Kind:** milestone router; not a single coding slice  
**Risk:** high  
**Prerequisite:** VSCR-M1-001 accepted and the M1-002 milestone explicitly selected.

## Goal

Establish the ASA-owned standalone Scratch host boundary without combining build, branding,
protocol, storage-fixture and acceptance work into one agent run.

M1-002 is complete only after all five sub-slices are separately accepted:

```text
VSCR-M1-002A  standalone build + minimal ASA host shell
→ STOP / evidence / acceptance
VSCR-M1-002B  ASA branding + File/Extensions controls
→ STOP / evidence / acceptance
VSCR-M1-002C  parent/iframe protocol boundary
→ STOP / evidence / acceptance
VSCR-M1-002D  ScratchStorage/GUIStorage fixture adapter
→ STOP / evidence / acceptance
VSCR-M1-002E  integrated browser/Docker acceptance + independent review
→ STOP / owner acceptance of M1-002 milestone
```

Do not execute this router as one coding task.

## Canonical milestone authorization

`VSCR-M1-002` is a milestone router, never a temporary executable `task.id`. When the owner
authorises the milestone and the first executable sub-slice is selected, canonical `main` must
store the authorization beside the visual-programming lane:

```yaml
primary_lane:
  milestone:
    id: VSCR-M1-002
    owner_authorization: accepted
```

The executable task remains the exact sub-slice, for example `VSCR-M1-002A`, and its
`task.status` must be `in_progress`. `tools/validate-blocks-docs.mjs` rejects active M1-002
sub-slices if this milestone marker is absent or malformed. The marker is inherited by B-E;
do not fake milestone authorization through a checkpoint, PR body, roadmap row or chat.

## Components

The milestone covers:

```text
blocks.upstream.pin
blocks.host.build
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
blocks.host.protocol
blocks.host.storage-adapter
```

Each sub-slice loads only the component entries named by its own card.

## Minimal read set

For milestone planning only:

```text
../README.md
../VSCR-M1-FORWARD-PLAN-2026-09-11.md
this router
```

For coding, read the selected A/B/C/D/E card instead. Do not preload all five cards.

## Expected write paths

None. This file routes work only.

## Sub-slice cards

```text
VSCR-M1-002A.md
VSCR-M1-002B.md
VSCR-M1-002C.md
VSCR-M1-002D.md
VSCR-M1-002E.md
```

## Pre-selection card refresh

A/B/C/D/E cards are bounded design snapshots, not permission to ignore interfaces accepted by
an earlier sub-slice.

Before selecting the next sub-slice in `current.yaml`:

```text
read the accepted previous slice component entries
→ compare the next card's planned paths/dependencies with actual accepted interfaces
→ if still exact, select the next task normally
→ if stale, update only that next task/component routing first
→ run node tools/validate-blocks-docs.mjs
→ then select the refined exact task separately
```

Do not expand a stale card during coding. Card refinement is documentation/control work and
must finish before the implementation task becomes active.

## Forbidden

```text
no one-shot implementation of all M1-002 concerns
no automatic A → B → C → D → E progression
no execution from a stale next-slice card
no M1-003 runtime JWT work
no S3/MinIO
no Project Core persistence
no activation
```

## Bounded self-review

At the milestone level, verify only that:

```text
A–D have separate accepted evidence
E reviewed the integrated host boundary
next cards were refreshed against accepted prior interfaces before selection
no sub-slice started automatically
component cards contain actual source/test ownership
M1-003 was not started
```

## Stop

After each sub-slice STOP. After M1-002E STOP again for owner milestone acceptance. Only then
may M1-003 become selectable.
