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

PR #177 stopped at this boundary and is now integrated. M1 starts only from a fresh branch/PR.

---

## Repository baseline convergence

The inherited public-entry baseline drift was repaired separately by PR #180 and merged to
`main` as:

```text
74eca75dce44486d473e1db6fa766c382a4fc9cc
```

Scratch M0/M0.1 was then squash-integrated through PR #177 into `main` as:

```text
50d2357f1fc157a9434baebcbd5d8c440202127a
```

Post-merge push evidence on that exact main SHA is green:

```text
Scratch M0 Focused run 34566000421
  Module contract and API typecheck      PASS
  Pinned upstream image and health smoke PASS

ASA Lab Governance and Code Gates run 34566000465
  Governance contracts                   PASS
  Format/lint/types/contracts/build       PASS
  PostgreSQL tests and RLS / Data gate    PASS
  Access A real browser journeys          PASS
```

The selected M1-001 branch is created directly from this verified main SHA. If main advances
before M1-001 integration, convergence must be repeated before integration.

---

## Current coding-readiness matrix

| Task | Coding-ready now from docs? | Blocker / prerequisite |
| --- | --- | --- |
| `VSCR-M0.1-001` | **ACCEPTED + INTEGRATED** | merged through PR #177; `blocks` remains `coming_soon` |
| `VSCR-M0.1-002` | **REVIEW COMPLETE — NO CODE CHANGE** | exact `82c5fea...` retained as reviewed post-release 15.1.1 snapshot |
| `VSCR-REPO-CONVERGENCE` | **COMPLETE for main `50d2357...`** | post-merge focused + repository push gates green |
| `VSCR-M1-001` | **YES — SELECTED** | M0 integrated and green; fresh branch `feat/scratch-visual-programming-m1-001`; owner selected the next bounded slice with the 11 September 2026 instruction `продолжай` |
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

## Selected VSCR-M1-001 boundary

M1-001 is a behaviour-preserving package-boundary extraction only:

```text
apps/api local Blocks provider
→ @asa-lab/blocks bounded context
→ apps/api composes the package through module-registry
```

It may move the existing document types, structural validation, module assembly and tests,
add the workspace dependency/link, and update the focused workflow to follow the moved
files. It MUST NOT add host/runtime API/storage/persistence/Web functionality or activate
`blocks`.

The authoritative implementation package is the `VSCR-M1-001` section of
`VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md`. Stop after exact-head focused and repository
evidence; do not advance to M1-002 in the same branch/PR.

---

## Current implementation facts at M1-001 start

```text
main baseline = 50d2357f1fc157a9434baebcbd5d8c440202127a
BlocksAssetReferenceV1 = assetId + dataFormat + sha256 + sizeBytes
objectKey is server-only future storage metadata
moduleVersion = 0.1.1
availability = coming_soon
upstream.env = exact reviewed 82c5fea... post-release 15.1.1 snapshot
current Docker image = M0 upstream playground build evidence, not ASA product host
contexts/blocks does not exist yet — M1-001 owns only this extraction
no runtime/storage/save-load/sb3 implementation exists
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
