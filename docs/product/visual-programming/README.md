# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

Post-v2 normative repairs are recorded in
[`VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md`](VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md).
The final M0 runtime-authorisation clarification is
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
→ matching D0 contract(s) and D0 addenda
→ exact implementation package for the selected coding task
→ current code/current main delta
```

A task without a current implementation package and all resolved prerequisites is not
coding-ready. Do not infer implementation from the roadmap or a previous chat.

---

## Stable design contracts

| Contract | Boundary | Status |
| --- | --- | --- |
| `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` | standalone host, reviewed exact upstream pin, branding, File/Extensions controls, iframe/bootstrap | accepted design; pin provenance review complete |
| `VSCR-D0-002-PERSISTENCE-CONTRACT.md` | Project Core async durability guard and bypass prevention | design accepted |
| `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` | Scratch identity, SHA-256 blobs, private S3/MinIO, asset API | architecture accepted; concrete content-validation dependency still required before M1-004 |
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` + `VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` | capability, origin/CORS/CSP/rate limits and current ASA resource authority after token issuance | design accepted; revocation ambiguity closed at M0 boundary |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | design accepted |
| `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` | immutable Gallery version/player and cross-tenant Blocks remix | design accepted for future M2; no M2 coding package yet |
| `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` | canonical ASA media vs legacy `.sb3` BMP/JPEG/GIF compatibility and ZIP safety | safety boundary accepted; exact M1-007 package still required |

`design accepted` fixes architecture. It does not mean implementation exists or the feature
is active.

---

## Clean M0 boundary

Owner instruction on 10 September 2026 explicitly directed the programme to be brought to
a **clean M0 boundary**. The owner-directed closure records acceptance of corrected
`VSCR-M0.1-001` and the completed `VSCR-M0.1-002` provenance review.

Included in M0/M0.1:

```text
accepted master/ADR/design contracts
D0-001…D0-007 + D0-004A
reviewed immutable Scratch upstream pin
isolated reproducible upstream Docker build/health evidence
Blocks provider/document envelope + tests
objectKey removed from persistent Blocks document
module availability remains coming_soon
Scratch-focused CI
repository-convergence rules
```

Explicitly excluded from M0:

```text
@asa-lab/blocks bounded-context extraction
ASA-owned standalone Scratch product host / iframe shell
runtime JWT/CORS implementation
S3/MinIO asset persistence
durable save/load
autosave/recovery/conflict implementation
.sb3 import/export implementation
Gallery/player/remix implementation
sovereign local library/network-deny implementation
backup/restore implementation
activation
```

**PR #177 stops at this boundary. No M1 implementation may be appended to it.**

---

## Repository baseline convergence

The inherited public-entry baseline drift was repaired separately by PR #180 and merged to
`main` as:

```text
74eca75dce44486d473e1db6fa766c382a4fc9cc
```

That baseline repair passed Governance, Code, PostgreSQL/RLS/Data and Access A browser
gates before merge.

Scratch was then reconciled non-destructively with this exact `main` using a true two-parent
merge:

```text
Scratch pre-merge head: b002051ea98b744c4470113031982c63a80e1d96
main baseline:          74eca75dce44486d473e1db6fa766c382a4fc9cc
convergence merge:      2821859ec60775135b4062605a75c7bb2c816c6e
```

At the convergence merge:

```text
main is an ancestor of the Scratch branch
behind_by = 0
PublicEntryHeroV2.css is not a Scratch-specific diff
PublicEntryPage.spec.ts is inherited from main
current.yaml remains the main version and does not select Scratch
accepted dependency/security fixes remain intact
```

---

## M0 closure evidence

After convergence and the M0 design-closure documents, exact-head candidate
`0b920c5579d53428cf6cfde64f96a33378c4dacf` was verified.

Scratch M0 Focused run `34534364571`:

```text
Module contract and API typecheck          PASS
Pinned upstream image and health smoke     PASS
```

Repository run `34534364603`:

```text
Governance contracts                       PASS
Format/lint/types/contracts/build           PASS
PostgreSQL tests and RLS / Data gate        PASS
Access A real browser journeys              PASS
```

Those results are exact evidence for `0b920c55...`. This evidence-bookkeeping change is
documentation-only; GitHub checks on the latest PR head remain authoritative before the PR
is marked ready or merged.

---

## Current coding-readiness matrix

| Task | Coding-ready now from docs? | Blocker / prerequisite |
| --- | --- | --- |
| `VSCR-M0.1-001` | **ACCEPTED AT M0 BOUNDARY** | corrected strict asset contract exists; integration remains subject to latest PR checks |
| `VSCR-M0.1-002` | **REVIEW COMPLETE — NO CODE CHANGE** | exact `82c5fea...` retained as reviewed post-release 15.1.1 snapshot |
| `VSCR-REPO-CONVERGENCE` | **COMPLETE for main `74eca75...`** | repeat if `main` advances before integration/new shared-file work |
| `VSCR-M1-001` | **NO** | do not add M1 to PR #177; integrate M0 first, then create a fresh branch/PR and explicitly select M1-001 |
| `VSCR-M1-002` | **NO** | accepted M1-001 + amend/accept exact host package against D0-001 |
| `VSCR-M1-003` | **NO** | depends on accepted M1-002 and must implement D0-004 + D0-004A |
| `VSCR-M1-004` | **NO** | exact safe content-validation parser/sniffer set not selected/pinned |
| `VSCR-M1-005` | **NO** | exact server-side Scratch semantic validator not selected/proven |
| `VSCR-M1-006` | **NO** | package only after accepted M1-005 interfaces |
| `VSCR-M1-007` | **NO** | exact ZIP library/limits + legacy-media normalisation + corpus required |
| `VSCR-M1-008` | **NO** | acceptance package after M1-006/007 exist |
| `VSCR-M2-*` | **NO** | requires accepted M1 and exact M2 packages |
| `VSCR-M3-*` | **NO** | requires accepted M2/runtime plus rights/network/backup evidence |
| `VSCR-M4-001` | **NO** | activation only after M3 sovereign + restore acceptance |

`NO` means **STOP before coding**. It never means “choose a reasonable implementation”.

---

## Correct next order after M0 closure

```text
1. latest PR #177 checks must remain green
2. inspect #177 as M0/M0.1-only and mark ready for review
3. merge #177 only through a separate owner-authorised decision
4. after M0 exists in main, create a NEW branch/PR for VSCR-M1-001
5. explicitly select and implement one M1 slice at a time
```

Do not continue M1 development on PR #177.

---

## Current implementation facts

```text
BlocksAssetReferenceV1 = assetId + dataFormat + sha256 + sizeBytes
objectKey is server-only future storage metadata
moduleVersion = 0.1.1
availability = coming_soon
upstream.env = exact reviewed 82c5fea... post-release 15.1.1 snapshot
current Docker image = M0 upstream playground build evidence, not ASA product host
no contexts/blocks package exists — correct at M0
no runtime/storage/save-load/sb3 implementation exists — correct at M0
```

---

## Current-authorisation invariant

A future runtime token is not a ten-minute frozen authorisation snapshot.
D0-004A requires:

```text
valid runtime JWT
+ exact token permission/resource binding
+ current ASA project/version/publication authority
= request allowed
```

Revoking project authority must deny the next protected runtime request even when the JWT
has not expired. Core v1 does not require a Scratch-specific JWT blacklist.

---

## Repository convergence invariant

Before every new VSCR slice touching shared files:

```text
fetch current main
→ compare feature branch to main
→ if behind/diverged, reconcile first without rewriting published history
→ preserve main current.yaml unless owner explicitly changes task selection
→ preserve dependency/security fixes
→ run exact-head focused + repository gates
→ only then start the selected task
```

A previous `behind_by=0` applies only to its named baseline.

---

## `.sb3` compatibility invariant

Canonical ASA formats remain `svg/png/jpg/wav/mp3`. Historical Scratch archives may contain
legacy BMP/JPEG/GIF media. Do not widen durable storage as an import shortcut and do not
claim universal historical `.sb3` compatibility until M1-007 proves deterministic
normalisation, ZIP safety and round-trip corpus evidence.

---

## Gallery/publication invariant

Before Blocks publication/remix in M2:

```text
publication pins exact project_version_id
player reads that immutable version
cross-tenant remix server-materialises referenced assets into destination tenant
current draft is never substituted for the published Blocks version
```

Do not modify Gallery opportunistically during M1.

---

## Rule for extending readiness

```text
inspect accepted interfaces/current main
→ update exact contract/package if needed
→ resolve dependency/version/path/tests
→ change readiness NO → YES only deliberately
→ select task through owner/current execution flow
→ implement it in its own bounded branch/PR
→ stop after evidence
```
