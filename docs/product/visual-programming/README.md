# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

Post-v2 normative repairs are recorded in
[`VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md`](VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md).
The final M0 security clarification is
[`VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md`](VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md).

This directory is not current execution state and does not replace `docs/execution/current.yaml`.

Latest factual readiness review: [`VSCR-AUDIT-2026-09-10-READINESS-NOTE.md`](VSCR-AUDIT-2026-09-10-READINESS-NOTE.md).

## Read order for a coding agent

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ current authorised task from agent:context/current.yaml
→ this readiness index
→ master spec §0–§4
→ repair addendum
→ selected master milestone/task
→ ADR-VSCR-001
→ matching D0 design contract(s) and D0 addenda
→ exact implementation package for the selected coding task
→ current code/current main delta
```

A task without a current implementation package **and all resolved prerequisites** is not
coding-ready. Do not infer implementation from the roadmap or from a previous chat.

---

## Stable design contracts

| Contract | Boundary | Status |
| --- | --- | --- |
| `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` | standalone host, reviewed exact upstream pin, branding, File/Extensions controls, iframe/bootstrap | accepted design; pin provenance review complete |
| `VSCR-D0-002-PERSISTENCE-CONTRACT.md` | Project Core async durability guard and bypass prevention | design accepted |
| `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` | Scratch identity, SHA-256 blobs, private S3/MinIO, asset API | architecture accepted; concrete content-validation dependency still required before M1-004 |
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` + `VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` | capability, origin/CORS/CSP/rate limits, current project/publication authority after token issuance | design accepted; revocation ambiguity closed at M0 boundary |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | design accepted |
| `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` | immutable Gallery version/player and cross-tenant Blocks remix | design accepted for future M2; no M2 coding package yet |
| `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` | canonical ASA media vs legacy `.sb3` BMP/JPEG/GIF compatibility and ZIP safety boundary | safety boundary accepted; exact M1-007 package still required |

`design accepted` fixes an architectural direction. It does not mean the implementation
exists, the dependency choice has been made, the task is selected, CI is green or the
feature is active.

---

## Clean M0 boundary

Owner instruction on 10 September 2026 explicitly directed the Visual Programming work to
be brought to a **clean M0 boundary**. For this programme that boundary is now fixed as:

```text
IN M0 / M0.1
  accepted architecture + ADR
  D0-001…D0-007 + D0-004A design closure
  exact reviewed Scratch upstream pin
  reproducible isolated upstream Docker build/health evidence
  Blocks provider/document envelope + tests
  objectKey removed from persistent document
  module remains coming_soon
  focused Scratch CI
  repository-convergence rules for future agents

NOT IN M0
  @asa-lab/blocks bounded context extraction
  ASA-owned standalone Scratch product host
  iframe product shell
  runtime JWT/CORS implementation
  S3/MinIO asset persistence
  durable save/load
  autosave/recovery/conflict implementation
  .sb3 import/export implementation
  Gallery/player/remix implementation
  sovereign library/network-deny implementation
  backup/restore implementation
  activation
```

PR #177 **must stop at this boundary**. No M1 implementation may be appended to it.

The owner-directed M0 closure also constitutes acceptance of the corrected `VSCR-M0.1-001`
contract and completed `VSCR-M0.1-002` provenance review. Acceptance does not waive CI:
PR #177 is integration-ready only after its final exact-head focused and repository gates
are green.

---

## Repository baseline convergence

The inherited public-entry baseline defect was repaired separately in PR #180 and merged to
`main` as:

```text
74eca75dce44486d473e1db6fa766c382a4fc9cc
```

That baseline repair passed Governance, Code, PostgreSQL/RLS/Data and Access A browser
gates before merge.

Scratch was then reconciled non-destructively with that exact `main` using a true two-parent
merge:

```text
Scratch pre-merge head: b002051ea98b744c4470113031982c63a80e1d96
main baseline:          74eca75dce44486d473e1db6fa766c382a4fc9cc
convergence merge:      2821859ec60775135b4062605a75c7bb2c816c6e
```

At that convergence merge:

```text
main is an ancestor of the Scratch branch
behind_by = 0
PublicEntryHeroV2.css is no longer a Scratch-specific diff
PublicEntryPage.spec.ts is inherited from main, not carried as Scratch work
```

Any later `main` movement must be checked again before a shared-file VSCR task.

---

## Coding task packages / completed reviews

First-wave package:

```text
VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md
```

Upstream provenance review record:

```text
VSCR-IMPLEMENTATION-PACKAGE-M0.1-002-UPSTREAM-PIN.md
```

The latter is not a pending rollback task. Review concluded that exact pin `82c5fea...`
should be retained as an explicitly documented post-release Scratch Editor `15.1.1`
snapshot.

### Current coding-readiness matrix

| Task | Coding-ready now from docs? | Blocker / prerequisite |
| --- | --- | --- |
| `VSCR-M0.1-001` | **ACCEPTED AT M0 BOUNDARY** | corrected strict asset contract exists; final PR integration still requires exact-head gates |
| `VSCR-M0.1-002` | **REVIEW COMPLETE — NO CODE CHANGE** | current `82c5fea...` retained; provenance wording fixed |
| `VSCR-REPO-CONVERGENCE` | **STRUCTURALLY COMPLETE** | reconciled with `main` `74eca75...`; final exact-head gates remain integration evidence |
| `VSCR-M1-001` | **NO** | do not add M1 to PR #177; first finish/integrate M0, then create a fresh branch/PR and explicitly select M1-001 |
| `VSCR-M1-002` | **NO** | accepted M1-001 + amend/accept exact package against current D0-001 branding/File/Extensions patch ledger |
| `VSCR-M1-003` | **NO** | depends on accepted M1-002 host and must implement D0-004 + D0-004A current-authority semantics |
| `VSCR-M1-004` | **NO** | exact safe content-validation parser/sniffer set is not yet selected and pinned |
| `VSCR-M1-005` | **NO** | exact server-side Scratch project semantic validator is not yet selected/proven |
| `VSCR-M1-006` | **NO** | write package against accepted M1-005 interfaces |
| `VSCR-M1-007` | **NO** | exact ZIP library/limits + legacy media normalisation strategy/corpus still require a package under D0-007 |
| `VSCR-M1-008` | **NO** | acceptance package after M1-006/007 exist |
| `VSCR-M2-*` | **NO** | requires accepted M1 plus D0-006 and exact M2 packages |
| `VSCR-M3-*` | **NO** | requires accepted M2/runtime deployment plus rights/network/backup evidence packages |
| `VSCR-M4-001` | **NO** | activation only after M3 sovereign + restore acceptance |

`NO` means **STOP before coding**. It never means “choose a reasonable implementation”.

---

## Correct next order after M0 closure

```text
A. finish exact-head M0 evidence on PR #177
   Scratch focused + repository gates must be green on the same final feature HEAD

B. review PR #177 as M0-only
   no PublicEntry baseline files
   no M1 host/storage/security/persistence code
   blocks still coming_soon

C. integrate PR #177 only through a separate owner-authorised merge decision

D. after M0 exists in main, create a NEW branch/PR for VSCR-M1-001
   do not continue development on PR #177

E. explicitly select VSCR-M1-001
   extract @asa-lab/blocks bounded context without behavioural expansion

F. subsequent M1 tasks remain individually gated by this readiness index
```

Do not combine these stages merely because the architecture is already documented.

---

## Current implementation facts

```text
BlocksAssetReferenceV1 no longer contains objectKey
  → VSCR-M0.1-001 accepted at the M0 contract boundary

upstream.env remains 82c5fea...
  → intentional after completed provenance review; not a defect

Scratch Docker image still serves upstream playground build
  → M0 evidence only; replaced by future accepted VSCR-M1-002

no contexts/blocks package exists
  → correct at M0; extraction belongs to fresh M1-001 work

no runtime capability, S3/MinIO, durable save/load, recovery or sb3 pipeline exists
  → correct at M0; later bounded tasks only
```

---

## Current-authorisation invariant

A future runtime token is not a ten-minute frozen authorisation snapshot.
`VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` requires:

```text
valid runtime JWT
+ exact token permission/resource binding
+ current ASA project/version/publication authority
= request allowed
```

Revoking project authority must deny the next protected runtime request even if the JWT has
not expired. Core v1 does not require a Scratch-specific JWT blacklist.

---

## Repository convergence invariant

The Scratch feature branch must not begin a task that edits workspace dependencies,
`pnpm-lock.yaml`, execution state or other shared infrastructure while it is behind current
`main`.

Before every new VSCR coding slice that touches shared files:

```text
fetch current main
→ compare feature branch to main
→ if behind/diverged, reconcile first
→ preserve main's current.yaml exactly unless owner explicitly changes task selection
→ preserve security/dependency fixes
→ run exact-head focused + repository gates
→ only then start the selected VSCR task
```

A previous `behind_by=0` is evidence for one baseline only, not a permanent exemption.

---

## Main versus Scratch feature branch

Until PR #177 is integrated, `main` still does not contain the Scratch-backed provider or
these contracts.

Status language must distinguish:

```text
accepted at M0 feature boundary
reconciled with a specific main baseline
integration gates green
≠ merged into ASA Lab main
≠ deployed
≠ activated for users
```

---

## `.sb3` compatibility invariant

Canonical ASA asset formats remain:

```text
svg/png/jpg/wav/mp3
```

Pinned Scratch VM can recognise some legacy archive costume formats (`bmp`, `jpeg`, `gif`).
This does not authorise widening the durable ASA asset schema. D0-007 requires a future
M1-007 package to prove deterministic legacy normalisation, ZIP safety and round-trip
compatibility using a versioned fixture corpus.

Until that package is accepted, do not claim universal historical `.sb3` compatibility.

---

## Gallery/publication prerequisite

Current ASA Gallery draft-copy semantics are not acceptable for Blocks publication.
D0-006 requires before M2:

```text
publication pins exact project_version_id
player reads that immutable version
cross-tenant remix server-materialises every referenced asset into destination tenant
current draft is never substituted for the published Blocks version
```

Do not modify Gallery opportunistically during M1.

---

## Rule for extending readiness

When a blocker is resolved:

```text
inspect actual accepted interfaces/current main
→ update exact D0/task package if needed
→ add exact dependency/version/path/tests
→ change readiness NO → YES only in this file
→ select the task through normal owner/current execution flow
→ implement one task in its own bounded branch/PR
→ stop after evidence
```

Do not edit accepted architecture simply because a coding shortcut is easier. A real
architecture change must be explicit and reflected in the relevant D0/master/ADR sources.
