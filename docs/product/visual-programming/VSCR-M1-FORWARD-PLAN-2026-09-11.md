# ASA Lab Visual Programming — post-M0 forward plan

**Date:** 11 September 2026  
**Programme:** `blocks` / `Визуальное программирование`  
**Status:** readiness/order only — not execution authorisation

This file answers only:

```text
what milestone/task comes next?
what is ready vs blocked?
what prerequisite unlocks it?
```

It does **not** duplicate implementation details. Exact implementation belongs in:

```text
tasks/<selected-task>.md
→ COMPONENT_MAP.yaml
→ one components/*.yaml subsystem card
→ matching D0 contract section
```

Live task selection remains in `docs/execution/current.yaml` + explicit owner instruction.

## Current baseline

Integrated M0/M0.1 provides:

```text
Blocks project envelope/provider
strict asset references
objectKey excluded from project JSON
moduleVersion 0.1.1
availability coming_soon
reviewed exact Scratch upstream pin
accepted D0 architecture contracts
```

Current main planning baseline after PR #182:

```text
post-M0 Scratch M1 plan integrated
canonical ASA logo decision integrated
blocks remains coming_soon
no M1 implementation selected by this document
```

## Strict order

```text
M0/M0.1  COMPLETE

M1-001    Extract @asa-lab/blocks bounded context
  ↓ accept exact result
M1-002    ASA-owned standalone Scratch host + iframe/message skeleton
  ↓ accept exact result
M1-003    Runtime capability auth + exact path-scoped origin/CORS/CSP
  ↓ accept exact result
M1-004P   Select exact content-validation stack
  ↓ accept dependency/security/license decision
M1-004    Tenant-private asset metadata + S3/MinIO + validated asset API
  ↓ accept exact result
M1-005P   Select/prove exact Scratch semantic validation strategy
  ↓ accept decision
M1-005    Project Core durability guard + durable Scratch load/save
  ↓ accept exact result
M1-006    Generation-aware autosave/recovery/conflict + snapshot
  ↓ accept exact result
M1-007P   Select ZIP/legacy-media stack, limits and corpus
  ↓ accept decision
M1-007    Safe .sb3 import/export
  ↓ accept exact result
M1-008    End-to-end M1 durability/security acceptance

M2        ASA product UI + immutable Gallery/player/remix
M3        sovereign local media/extensions + network deny + backup/restore/deployment
M4-001    explicit coming_soon → active decision
```

No task automatically advances to the next one.

## Readiness matrix

| Task | Readiness | Unlock condition / exact card |
| --- | --- | --- |
| `VSCR-M1-001` | **READY FOR OWNER SELECTION** | `tasks/VSCR-M1-001.md` |
| `VSCR-M1-002` | **BLOCKED** | M1-001 accepted → `tasks/VSCR-M1-002.md` |
| `VSCR-M1-003` | **BLOCKED** | M1-002 accepted; create/refine exact card against accepted host interfaces |
| `VSCR-M1-004P` | **SELECTABLE DESIGN WORK** | exact parser/sniffer/version/license/security decision |
| `VSCR-M1-004` | **BLOCKED** | M1-003 + M1-004P accepted |
| `VSCR-M1-005P` | **SELECTABLE DESIGN WORK** | exact semantic-validator strategy/proof |
| `VSCR-M1-005` | **BLOCKED** | M1-004 + M1-005P accepted |
| `VSCR-M1-006` | **BLOCKED** | M1-005 accepted interfaces |
| `VSCR-M1-007P` | **SELECTABLE DESIGN WORK** | exact ZIP stack/limits/legacy-media corpus decision |
| `VSCR-M1-007` | **BLOCKED** | durable M1 storage/load-save + M1-007P accepted |
| `VSCR-M1-008` | **BLOCKED** | M1-006 + M1-007 accepted |
| `VSCR-M2-*` | **BLOCKED** | M1-008 accepted; write exact cards against real M1 interfaces |
| `VSCR-M3-*` | **BLOCKED** | M2 accepted + rights/network/backup decisions |
| `VSCR-M4-001` | **BLOCKED** | M3 sovereign/restore/deployment acceptance |

`READY` / `SELECTABLE DESIGN WORK` means eligible for a separate owner selection, not active.
`BLOCKED` means coding STOP.

## Immediate next coding slice

Only:

```text
VSCR-M1-001
```

Its exact implementation scope is:

```text
tasks/VSCR-M1-001.md
```

After implementation/evidence/self-review:

```text
STOP
→ owner review/acceptance
→ only then M1-002 may become selectable
```

## Stable cross-milestone invariants

These do not change the readiness table but must remain true:

```text
Scratch logo is not ASA product chrome
canonical ASA logo is apps/web/public/asa-lab-mark.svg
built-in Scratch File/server-save/account/community/cloud ownership is not ASA product flow
Gallery publication must bind immutable project_version_id
cross-tenant Blocks remix must re-materialise referenced assets server-side
Learning reuses existing immutable project_version_id submission semantics
M3 must prove a school baseline without implicit Scratch Foundation dependency
only M4-001 may activate blocks
```

## Task-card creation rule

Do not pre-write detailed executable cards for distant tasks against speculative interfaces.

Create/refine the exact card only when its prerequisites are accepted:

```text
inspect accepted interfaces
→ resolve stable component IDs
→ record minimal read/write/test scope
→ set risk/review profile
→ select task separately
```

This is intentional token and correctness control: a future bot must not implement M1-006
from an old plan written before M1-005 exists.

## Planning vs maintenance

Milestone planning uses this file.

A future bounded maintenance request after implementation does **not** read this file by
default. It uses:

```text
README.md
→ AGENT_GUIDE.md
→ COMPONENT_MAP.yaml
→ one subsystem card
→ mapped source/test/contract
```

That keeps small fixes independent from the full roadmap.
