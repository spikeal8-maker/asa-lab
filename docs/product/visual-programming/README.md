# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

It is not current execution state and does not replace `docs/execution/current.yaml`.

## Read order for a coding agent

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ current authorised task from agent:context/current.yaml
→ master spec §0–§4 + selected milestone/task
→ ADR-VSCR-001
→ matching D0 design contract(s)
→ exact implementation package for the selected coding task
→ current code
```

A task without a current implementation package is **not coding-ready**. Do not infer its
implementation from the roadmap.

## Stable design contracts

| Contract | Boundary | Status |
| --- | --- | --- |
| `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` | pinned Scratch standalone distribution, ASA host, iframe/message/bootstrap | design accepted |
| `VSCR-D0-002-PERSISTENCE-CONTRACT.md` | Project Core async durability guard and save bypass prevention | design accepted |
| `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` | Scratch alias identity, SHA-256 blob metadata, S3/MinIO and asset API | design accepted |
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` | project capability, runtime origin/CORS/CSP, rate limits | design accepted |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | design accepted |

`design accepted` means the architecture is fixed for later authorised tasks. It does not
mean the implementation exists or has owner acceptance.

## Coding task packages

Current package file:

```text
VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md
```

Coding readiness:

| Task | Coding-ready from docs? | Important prerequisite |
| --- | --- | --- |
| `VSCR-M0.1-001` | YES | current M0 branch has no durable/public Blocks data |
| `VSCR-M1-001` | YES | M0.1 accepted |
| `VSCR-M1-002` | YES | M1-001 + D0-001/D0-004 |
| `VSCR-M1-003` | YES | M1-002 + D0-004 |
| `VSCR-M1-004` | YES | M1-003 + D0-003/D0-005 |
| `VSCR-M1-005` | YES | M1-004 + D0-001…004 |
| `VSCR-M1-006` | NO | write package against accepted M1-005 interfaces |
| `VSCR-M1-007` | NO | write package after save/storage interfaces stabilise |
| `VSCR-M1-008` | NO | acceptance package after M1-006/007 exist |
| `VSCR-M2-*` | NO | write packages only after M1 acceptance |
| `VSCR-M3-*` | NO | write packages against accepted M2/runtime deployment |
| `VSCR-M4-001` | NO | activation package only after M3 acceptance evidence |

This is intentional progressive elaboration. `NO` does not mean “agent may choose”; it
means **STOP before coding**.

## Known current-code gaps after the documentation convergence

The current M0 implementation intentionally still differs from v2 in two places that have
explicit owner tasks:

```text
current BlocksAssetReferenceV1 still contains objectKey
  → fixed only by VSCR-M0.1-001

current Scratch Docker image serves upstream playground build
  → replaced only by VSCR-M1-002 after M1-001
```

Because `blocks` remains `coming_soon`, these are gated implementation gaps, not approved
production persistence behaviour.

## Rule for extending this directory

When a preceding task is accepted:

```text
inspect accepted interfaces
→ write/review the next exact task package
→ remove its NO readiness state only when paths/contracts/tests/stop conditions are clear
→ then and only then select it for coding
```

Do not edit an existing accepted D0 contract merely to make an implementation easier. A
real architecture change must be explicit, reviewed and reflected in master/ADR as
necessary.