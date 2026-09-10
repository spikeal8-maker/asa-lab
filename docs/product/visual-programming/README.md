# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

It is not current execution state and does not replace `docs/execution/current.yaml`.

Latest factual readiness review: [`VSCR-AUDIT-2026-09-10-READINESS-NOTE.md`](VSCR-AUDIT-2026-09-10-READINESS-NOTE.md).

## Read order for a coding agent

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ current authorised task from agent:context/current.yaml
→ this readiness index
→ master spec §0–§4 + selected milestone/task
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
| `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` | standalone host, branding, File/Extensions controls, iframe/bootstrap | accepted design; M1-002 waits for upstream-pin correction |
| `VSCR-D0-002-PERSISTENCE-CONTRACT.md` | Project Core async durability guard and bypass prevention | design accepted |
| `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` | Scratch identity, SHA-256 blobs, private S3/MinIO, asset API | architecture accepted; concrete content-validation dependency still required before M1-004 |
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` | project capability, runtime origin/CORS/CSP, rate limits | design accepted |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | design accepted |
| `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` | immutable Gallery version/player and cross-tenant Blocks remix | design accepted for future M2; no M2 coding package yet |

`design accepted` fixes an architectural direction. It does not mean the implementation
exists, the dependency choice has been made, the task is selected, CI is green or the
owner accepted a result.

---

## Coding task packages

Existing first-wave package:

```text
VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md
```

Additional bounded correction package:

```text
VSCR-IMPLEMENTATION-PACKAGE-M0.1-002-UPSTREAM-PIN.md
```

### Current coding-readiness matrix

| Task | Coding-ready now from docs? | Blocker / prerequisite |
| --- | --- | --- |
| `VSCR-M0.1-001` | **YES** | current M0 branch has no durable/public Blocks data |
| `VSCR-M0.1-002` | **YES** | execute as its own upstream-lock slice; official v15.1.1 tag SHA is fixed in package |
| `VSCR-M1-001` | **YES after M0.1-001** | extract context only; no runtime/storage |
| `VSCR-M1-002` | **NO** | first complete M0.1-002, then amend its task package to the new D0-001 branding/File/Extensions patch ledger |
| `VSCR-M1-003` | **NO** | depends on accepted M1-002 host boundary even though D0-004 design is accepted |
| `VSCR-M1-004` | **NO** | exact safe content-validation parser/sniffer set is not yet selected and pinned |
| `VSCR-M1-005` | **NO** | exact server-side Scratch project semantic validator is not yet selected/proven |
| `VSCR-M1-006` | **NO** | write package against accepted M1-005 interfaces |
| `VSCR-M1-007` | **NO** | choose multipart/ZIP implementation and write package after persistence stabilises |
| `VSCR-M1-008` | **NO** | acceptance package after M1-006/007 exist |
| `VSCR-M2-*` | **NO** | requires accepted M1 plus D0-006 and exact M2 packages |
| `VSCR-M3-*` | **NO** | requires accepted M2/runtime deployment plus rights/network/backup evidence packages |
| `VSCR-M4-001` | **NO** | activation only after M3 sovereign + restore acceptance |

`NO` means **STOP before coding**. It never means “choose a reasonable implementation”.

---

## Correct near-term order

The safe order after the 10 September audit is:

```text
A. VSCR-M0.1-001
   remove objectKey from the pre-release Blocks document contract

B. VSCR-M1-001
   extract @asa-lab/blocks bounded context

C. VSCR-M0.1-002 before any host implementation
   normalise upstream lock to official v15.1.1 release SHA

D. revise/accept M1-002 package against current D0-001
   exact two-patch host ledger + canManageFiles=false + Extensions hidden

E. M1-002
   ASA-owned Scratch standalone host

F. M1-003
   runtime capability/origin boundary

G. select/pin M1-004 content-validation stack, then make M1-004 READY

H. select/prove M1-005 semantic Scratch validator, then make M1-005 READY
```

A and C are independent correction slices. Do not combine them into one uncontrolled
change merely because both are small.

---

## Known current-code gaps

Current feature branch intentionally still differs from the target:

```text
BlocksAssetReferenceV1 still contains objectKey
  → owned only by VSCR-M0.1-001

upstream.env points to post-release 82c5fea...
  → owned only by VSCR-M0.1-002

Scratch Docker image serves upstream playground build
  → replaced only by future accepted VSCR-M1-002

no contexts/blocks package exists
  → VSCR-M1-001

no runtime capability, S3/MinIO, durable save/load, recovery or sb3 pipeline exists
  → later bounded tasks only
```

The feature branch is also behind the current `main` baseline. `main` already contains the
`smol-toml 1.8.0` security override that the branch-wide gate lacked. Before any final PR
acceptance/merge, reconcile with current `main` and run the required gates on one exact
resulting SHA. Do not treat a stale-branch dependency failure as a Scratch implementation
failure, and do not treat focused PASS as repository-wide green.

---

## Current `main` versus Scratch feature branch

Until PR #177 is integrated, `main` still has only the historical future `blocks` manifest
(`projectType: block-program`) and does not contain the Scratch-backed module/provider or
these contracts.

Therefore status language must distinguish:

```text
implemented in Scratch feature branch
≠ merged into ASA Lab main
≠ deployed
≠ activated for users
```

---

## Gallery/publication prerequisite discovered by audit

Current ASA Gallery reads/copies current project drafts for published works. That is not
acceptable for Blocks because a published Scratch player must execute the exact immutable
published version and cross-tenant JSON copy would leave tenant-private asset refs broken.

D0-006 therefore requires, before M2 Blocks Gallery integration:

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
→ update the exact D0/task package if needed
→ add exact dependency/version/path/tests
→ change readiness NO → YES only in this file
→ select the task through normal owner/current execution flow
→ implement one task
→ stop after evidence
```

Do not edit an accepted architecture simply because a coding shortcut is easier. A real
architecture change must be explicit and reflected in the relevant D0/master/ADR sources.