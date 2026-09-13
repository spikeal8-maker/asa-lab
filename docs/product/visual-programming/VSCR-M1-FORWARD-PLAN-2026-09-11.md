# ASA Lab Visual Programming — post-M0 readiness and order

**Programme:** `blocks` / `Визуальное программирование`  
**Status:** the single Scratch readiness/order source; never execution authorisation.

This file answers only:

```text
what capability comes next?
what is eligible vs blocked?
what prerequisite unlocks it?
```

It does not contain live execution state. Live task selection lives only in
`docs/execution/current.yaml`.

## Planning principle

The programme is ordered by **working product capability**, not by the number of internal
technical layers completed.

Every step must answer one of these questions:

```text
Can the host be built reproducibly?
Can a user actually open and run Scratch inside ASA?
Can ASA control the product chrome without rewriting Scratch?
Can language/default locale behave correctly through Scratch's own localization?
Can a project survive save/reopen?
Can it recover safely?
Can it interchange .sb3 safely?
Can Gallery/Learning use immutable versions?
Can the whole system run sovereignly and restore from backup?
```

Do not spend an owner-acceptance cycle merely because another internal layer exists. Technical
boundaries still get focused evidence and required security review, but owner-visible checkpoints
are reserved for meaningful new capability.

## Baseline

Integrated M0/M0.1 provides the Blocks document/provider contract, strict logical asset references,
`moduleVersion 0.1.1`, `availability coming_soon`, the reviewed exact Scratch pin and accepted D0
architecture contracts.

M1-001 is complete and owner-accepted. M1-002 is owner-authorised. M1-002A and M1-002C are accepted.
The next product capability is FIRST VISIBLE SCRATCH (D). Tooling/documentation normalisation
is ordinary maintenance and adds no product milestone. This roadmap never selects tasks itself.

## Revised strict order

```text
M0/M0.1  COMPLETE
M1-001    COMPLETE / OWNER-ACCEPTED — @asa-lab/blocks bounded context

M1-002    ASA-owned Scratch host milestone
  M1-002A standalone build + minimal ASA host shell
    ↓ technical acceptance / STOP
  M1-002C strict parent/iframe bootstrap boundary
    ↓ security evidence + independent review / STOP
  M1-002D fixture storage adapter + REAL editor mount
    ↓ FIRST VISIBLE SCRATCH checkpoint / STOP
  M1-002B ASA product chrome + localization + identity shell
    ↓ product-chrome/localization evidence / STOP
  M1-002E integrated host acceptance + independent review
    ↓ owner acceptance of M1-002 milestone / STOP

M1-003    runtime capability auth + exact Origin/CORS/CSP + current-authority recheck
M1-004    validated tenant-private assets + S3/MinIO
M1-005    semantic validation + Project Core durable Scratch load/save
M1-006    generation-aware autosave/recovery/conflict + snapshot
M1-007    safe .sb3 import/export
M1-008    end-to-end M1 durability/security acceptance

M2        ASA product UI + immutable Gallery/player/remix + Learning integration
M3        sovereign local media/extensions + network deny + backup/restore/deployment/load
M4-001    explicit coming_soon → active decision
```

The product order is `A → C → D → B → E`.
Branding/control/localization DOM evidence is meaningful only after the editor can actually mount.

No task or sub-slice automatically advances to the next one.

## Capability checkpoints

### Checkpoint 1 — First visible Scratch

Reached by accepted M1-002C + M1-002D evidence:

```text
ASA parent opens the isolated Scratch host
→ valid INIT is required
→ controlled fixture storage is used
→ the real Scratch editor mounts
→ workspace/stage are visible
→ a controlled block programme can run and stop
→ no Scratch Foundation project/library fallback occurs
```

Persistence may still be intentionally non-durable here. The point is to prove that Scratch is
actually usable inside the ASA boundary before spending more work on product chrome.

### Checkpoint 1B — ASA product shell on real Scratch

Reached by accepted M1-002B evidence:

```text
real upstream Scratch remains the editor/runtime
→ ASA logo replaces Scratch product logo
→ ASA product bar uses the existing ASA palette
→ ASA avatar/account remains parent-owned
→ Scratch Settings remains
→ language switching remains inside Settings; no separate Language/Язык button
→ Russian browser opens Russian; English browser opens English; unsupported non-English falls back to ru
→ Scratch File/Edit remain familiar surfaces
→ unsafe .sb3 File items remain unavailable until M1-007
→ Extensions entry point remains visible but local/approved-only
→ Scratch programming-category colours remain unchanged
```

B has exactly three reviewed compatibility patches at the pinned upstream revision: logo prop,
Extensions visibility and File-menu item policy. A fourth patch is not implicitly authorised.

### Checkpoint 2 — Durable ASA project

Reached by M1-005:

```text
open ASA Scratch project
→ edit
→ save
→ close/reopen
→ project JSON + referenced assets are restored from ASA
```

### Checkpoint 3 — Robust editing

Reached by M1-006: autosave, recovery and conflict handling are proven.

### Checkpoint 4 — Compatible interchange

Reached by M1-007: bounded/safe `.sb3` import/export round-trip is proven and the existing File-menu
import/export entries may then be enabled under the accepted policy.

### Checkpoint 5 — Product integration

Reached by M2: immutable player/publication/remix and Learning submission use existing ASA project
version semantics.

### Checkpoint 6 — Sovereign production readiness

Reached by M3: network-deny, rights-cleared/local media policy, backup/restore, deployment and load
are proven.

## Conditional design-decision rule

`M1-004P`, `M1-005P` and `M1-007P` are no longer mandatory pre-created milestones.

Before M1-004, M1-005 or M1-007 implementation:

```text
inspect accepted prerequisite interfaces
→ is the exact dependency/security/compatibility choice already sufficiently resolved?
  yes → record the decision in the implementation card and proceed when selected
  no  → STOP and create/select a separate bounded design-decision task
```

A design task exists because a real decision is unresolved, not because the roadmap mechanically
requires an extra ceremony.

## Readiness matrix

| Task           | Readiness                     | Unlock condition                                                                                             |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `VSCR-M1-001`  | **COMPLETE / OWNER-ACCEPTED** | merged accepted bounded context                                                                              |
| `VSCR-M1-002A` | **COMPLETE / ACCEPTED**       | accepted standalone host foundation                                                                          |
| `VSCR-M1-002C` | **COMPLETE / ACCEPTED**       | accepted strict parent/iframe boundary                                                                       |
| `VSCR-M1-002D` | **READY FOR SELECTION**       | A/C accepted; D card maps the current host/protocol interfaces; separate owner selection                     |
| `VSCR-M1-002B` | **BLOCKED**                   | M1-002D accepted and real editor DOM available; refresh B card; separate selection                           |
| `VSCR-M1-002E` | **BLOCKED**                   | A+C+D+B accepted; separate review-task selection                                                             |
| `VSCR-M1-003`  | **BLOCKED**                   | M1-002E + owner acceptance of M1-002                                                                         |
| `VSCR-M1-004`  | **BLOCKED**                   | M1-003 accepted; create a design-decision task only if an exact validation/storage choice remains unresolved |
| `VSCR-M1-005`  | **BLOCKED**                   | M1-004 accepted; create a semantic-validation design task only if still genuinely unresolved                 |
| `VSCR-M1-006`  | **BLOCKED**                   | M1-005 durable interfaces accepted                                                                           |
| `VSCR-M1-007`  | **BLOCKED**                   | durable load/save accepted; create a ZIP/compatibility design task only if still genuinely unresolved        |
| `VSCR-M1-008`  | **BLOCKED**                   | M1-006 + M1-007 accepted                                                                                     |
| `VSCR-M2-*`    | **BLOCKED**                   | M1-008 accepted                                                                                              |
| `VSCR-M3-*`    | **BLOCKED**                   | M2 accepted + rights/network/backup decisions                                                                |
| `VSCR-M4-001`  | **BLOCKED**                   | M3 sovereign/restore/deployment acceptance                                                                   |

`BLOCKED` means coding STOP. `READY FOR SELECTION` means the card exists and prerequisites are met,
but coding still requires exact `current.yaml` selection with `status=in_progress`.

## Acceptance granularity

Use the smallest acceptance ceremony that matches risk and capability:

```text
technical foundation (A)       focused evidence + bounded self-review
security boundary (C)          focused/browser evidence + independent review
first visible editor (D)       focused/browser evidence + owner-visible checkpoint
product shell (B)              focused DOM/browser/network evidence + bounded self-review
integrated host (E)            integrated evidence + independent review + owner milestone acceptance
```

## Task-card refresh rule

Before selecting the next sub-slice:

```text
prerequisite accepted
→ inspect actual accepted interfaces/tooling
→ compare next card planned paths/dependencies with reality
→ update only the next card/routing if stale
→ run node tools/validate-blocks-docs.mjs
→ select the exact task separately in current.yaml
```

Do not pre-write exact source/test paths for distant work.

## Stable cross-milestone invariants

```text
Scratch logo is not ASA product chrome
canonical ASA logo is apps/web/public/asa-lab-mark.svg
language selector remains inside Scratch Settings; no duplicate top-level language button
Scratch built-in localization remains authoritative; no ASA translation fork
ASA theme affects product chrome, not Scratch programming-category colours
ASA avatar/account remains parent-owned, not Scratch-origin identity
built-in Scratch account/community/cloud/server-save ownership is not ASA product flow
Gallery publication binds exact immutable project_version_id
cross-tenant remix re-materialises referenced assets server-side
Learning reuses immutable project_version_id submission semantics
school baseline has no implicit Scratch Foundation dependency
only M4-001 may activate blocks
```

## Planning vs maintenance

Milestone planning may read this file. Bounded maintenance after implementation does not read the
roadmap by default; it routes through `README.md → COMPONENT_MAP.yaml → one component card → mapped
source/test/contract → bounded self-review`.
