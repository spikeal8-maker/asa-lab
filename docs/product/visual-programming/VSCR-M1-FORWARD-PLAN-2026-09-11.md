# ASA Lab Visual Programming — post-M0 readiness and order

**Programme:** `blocks` / `Визуальное программирование`  
**Status:** the single Scratch readiness/order source; never execution authorisation.

This file answers only:

```text
what comes next?
what is eligible vs blocked?
what prerequisite unlocks it?
```

It does not contain implementation details. Those live only in exact task cards, subsystem
component cards and canonical D0 contracts.

Live task selection lives only in `docs/execution/current.yaml`. An owner instruction may
authorise selecting/updating the exact task there, but does not replace that state transition.

## Baseline

Integrated M0/M0.1 provides the Blocks project envelope/provider, strict logical asset
references, `moduleVersion 0.1.1`, `availability coming_soon`, the reviewed exact Scratch pin
and accepted D0 architecture contracts.

No M1 implementation is selected by this document.

## Strict order

```text
M0/M0.1  COMPLETE

M1-001    Extract @asa-lab/blocks bounded context
  ↓ owner acceptance

M1-002    ASA-owned Scratch host milestone
  M1-002A standalone build + minimal ASA host shell
    ↓ STOP / acceptance
  M1-002B ASA branding + File/Extensions controls
    ↓ STOP / acceptance
  M1-002C parent/iframe protocol boundary
    ↓ STOP / acceptance
  M1-002D ScratchStorage/GUIStorage fixture adapter
    ↓ STOP / acceptance
  M1-002E integrated host acceptance + independent review
    ↓ owner acceptance of M1-002 milestone

M1-003    Runtime capability auth + exact Origin/CORS/CSP + current-authority recheck
  ↓ owner acceptance
M1-004P   Select exact content-validation stack
  ↓ accepted dependency/security/license decision
M1-004    Tenant-private asset metadata + S3/MinIO + validated asset API
  ↓ owner acceptance
M1-005P   Select/prove exact Scratch semantic validation strategy
  ↓ accepted decision
M1-005    Project Core durability guard + durable Scratch load/save
  ↓ owner acceptance
M1-006    Generation-aware autosave/recovery/conflict + snapshot
  ↓ owner acceptance
M1-007P   Select ZIP/legacy-media stack, limits and corpus
  ↓ accepted decision
M1-007    Safe .sb3 import/export
  ↓ owner acceptance
M1-008    End-to-end M1 durability/security acceptance

M2        ASA product UI + immutable Gallery/player/remix
M3        sovereign local media/extensions + network deny + backup/restore/deployment
M4-001    explicit coming_soon → active decision
```

No task or sub-slice automatically advances to the next one.

## Readiness matrix

| Task | Readiness | Unlock condition / exact card |
| --- | --- | --- |
| `VSCR-M1-001` | **READY FOR OWNER SELECTION** | owner authorises selection; then `current.yaml` must select `VSCR-M1-001`; exact card `tasks/VSCR-M1-001.md` |
| `VSCR-M1-002` | **BLOCKED** | M1-001 owner-accepted; use milestone router `tasks/VSCR-M1-002.md` |
| `VSCR-M1-002A` | **BLOCKED** | M1-001 accepted + M1-002 milestone selected + `current.yaml` selects exact sub-slice |
| `VSCR-M1-002B` | **BLOCKED** | M1-002A accepted + `current.yaml` selects exact sub-slice |
| `VSCR-M1-002C` | **BLOCKED** | M1-002B accepted + `current.yaml` selects exact sub-slice |
| `VSCR-M1-002D` | **BLOCKED** | M1-002C accepted + `current.yaml` selects exact sub-slice |
| `VSCR-M1-002E` | **BLOCKED** | M1-002A–D each accepted + `current.yaml` selects exact acceptance slice |
| `VSCR-M1-003` | **BLOCKED** | M1-002E + owner acceptance of M1-002; then write exact M1-003 card against accepted interfaces |
| `VSCR-M1-004P` | **DESIGN CARD REQUIRED** | create/review exact design-decision card before owner selection; no implementation coding from roadmap |
| `VSCR-M1-004` | **BLOCKED** | M1-003 + M1-004P accepted |
| `VSCR-M1-005P` | **DESIGN CARD REQUIRED** | create/review exact semantic-validator decision card before owner selection |
| `VSCR-M1-005` | **BLOCKED** | M1-004 + M1-005P accepted |
| `VSCR-M1-006` | **BLOCKED** | M1-005 accepted interfaces + explicit recovery-store/TTL/isolation decision in its card |
| `VSCR-M1-007P` | **DESIGN CARD REQUIRED** | create/review exact ZIP/limits/corpus decision card before owner selection |
| `VSCR-M1-007` | **BLOCKED** | durable M1 storage/load-save + M1-007P accepted |
| `VSCR-M1-008` | **BLOCKED** | M1-006 + M1-007 accepted |
| `VSCR-M2-*` | **BLOCKED** | M1-008 accepted; write exact cards against real M1 interfaces |
| `VSCR-M3-*` | **BLOCKED** | M2 accepted + rights/network/backup decisions |
| `VSCR-M4-001` | **BLOCKED** | M3 sovereign/restore/deployment acceptance |

`READY FOR OWNER SELECTION` means eligible for owner-authorised selection into `current.yaml`,
not active by itself. `DESIGN CARD REQUIRED` means the roadmap is insufficient even for the
design gate: create an exact bounded card first, then select that card through the control
plane. `BLOCKED` means coding STOP.

## Immediate next coding slice

Only:

```text
VSCR-M1-001
```

Exact card:

```text
tasks/VSCR-M1-001.md
```

It may start only after `docs/execution/current.yaml` selects that exact task. After its
evidence and bounded self-review: STOP for owner acceptance.

## Task-card creation rule

Do not pre-write exact source/test paths for distant work.

For M1-003+ implementation/design cards:

```text
prerequisites accepted
→ inspect actual accepted interfaces
→ resolve component IDs
→ record the smallest real read/write/test scope
→ set ownership/risk/review profile
→ select the exact card separately in current.yaml
```

Blocked component cards therefore describe purpose, ownership, canonical contract and
dependencies, but do not freeze speculative filenames/tests.

## Stable cross-milestone invariants

```text
Scratch logo is not ASA product chrome
canonical ASA logo is apps/web/public/asa-lab-mark.svg
built-in Scratch server-save/account/community/cloud ownership is not ASA product flow
Gallery publication binds exact immutable project_version_id
cross-tenant remix re-materialises referenced assets server-side
Learning reuses immutable project_version_id submission semantics
school baseline has no implicit Scratch Foundation dependency
only M4-001 may activate blocks
```

## Planning vs maintenance

Milestone planning may read this file.

A bounded maintenance request after implementation does not read the roadmap by default. It
still requires an exact bounded maintenance task/scope selected in `current.yaml`, then uses:

```text
README.md
→ COMPONENT_MAP.yaml
→ one subsystem card
→ mapped source/test/contract
→ bounded self-review
```
