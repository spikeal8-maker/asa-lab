# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

Post-v2 normative repairs are recorded in
[`VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md`](VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md).

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
→ matching D0 design contract(s)
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
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` | project capability, runtime origin/CORS/CSP, rate limits | design accepted |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | design accepted |
| `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` | immutable Gallery version/player and cross-tenant Blocks remix | design accepted for future M2; no M2 coding package yet |
| `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` | canonical ASA media vs legacy `.sb3` BMP/JPEG/GIF compatibility and ZIP safety boundary | safety boundary accepted; exact M1-007 package still required |

`design accepted` fixes an architectural direction. It does not mean the implementation
exists, the dependency choice has been made, the task is selected, CI is green or the
owner accepted a result.

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
| `VSCR-M0.1-001` | **IMPLEMENTED + focused verified; owner acceptance pending** | strict asset contract implemented; no durable/public Blocks data |
| `VSCR-M0.1-002` | **REVIEW COMPLETE — NO CODE CHANGE** | current `82c5fea...` retained; provenance wording fixed |
| `VSCR-REPO-CONVERGENCE` | **STRUCTURAL MERGE COMPLETE** | current main is an ancestor of feature branch; latest exact-head focused + repository gates remain required evidence |
| `VSCR-M1-001` | **NO** | explicit M0.1-001 acceptance + latest exact-head convergence gates green required first |
| `VSCR-M1-002` | **NO** | accepted M1-001 + amend/accept exact package against current D0-001 branding/File/Extensions patch ledger |
| `VSCR-M1-003` | **NO** | depends on accepted M1-002 host boundary even though D0-004 design is accepted |
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

## Correct near-term order

```text
A. VSCR-M0.1-001 — IMPLEMENTED + focused verified
   objectKey removed; strict pre-release Blocks asset contract in feature branch

B. upstream provenance review — COMPLETE
   retain exact 82c5fea... post-release 15.1.1 snapshot; do not cosmetic-rollback to tag

C. repository convergence — STRUCTURALLY COMPLETE
   current main merged into Scratch feature branch
   main current.yaml/dependency/security/web/Learning state preserved
   behind current merged main baseline = 0
   latest exact-head focused + repository evidence still required before next shared-file slice

D. after convergence evidence + explicit M0.1-001 acceptance: VSCR-M1-001
   extract @asa-lab/blocks bounded context

E. revise/accept M1-002 package against current D0-001
   exact two-patch host ledger + canManageFiles=false + Extensions hidden

F. M1-002
   ASA-owned Scratch standalone host

G. M1-003
   runtime capability/origin boundary

H. select/pin M1-004 content-validation stack, then make M1-004 READY

I. select/prove M1-005 semantic Scratch validator, then make M1-005 READY
```

Do not combine these into one large implementation merely because several are related.

---

## Current implementation facts

```text
BlocksAssetReferenceV1 no longer contains objectKey
  → VSCR-M0.1-001 implementation complete

upstream.env remains 82c5fea...
  → intentional after completed provenance review; not a defect

Scratch Docker image still serves upstream playground build
  → replaced only by future accepted VSCR-M1-002

no contexts/blocks package exists
  → VSCR-M1-001 only after convergence evidence + M0.1 acceptance

no runtime capability, S3/MinIO, durable save/load, recovery or sb3 pipeline exists
  → later bounded tasks only
```

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

If `main` advances again after a successful convergence, this check repeats. A previous
`behind_by=0` is evidence for that baseline only, not a permanent exemption.

This rule prevents a later Blocks package extraction/storage task from regenerating an
obsolete lockfile and reintroducing a dependency vulnerability that main already fixed.

---

## Main versus Scratch feature branch

Until PR #177 is integrated, `main` still does not contain the Scratch-backed provider or
these contracts.

Status language must distinguish:

```text
implemented in Scratch feature branch
reconciled with a specific main baseline
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
→ implement one task
→ stop after evidence
```

Do not edit accepted architecture simply because a coding shortcut is easier. A real
architecture change must be explicit and reflected in the relevant D0/master/ADR sources.
