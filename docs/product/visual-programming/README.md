# Visual Programming / Scratch implementation contracts

This directory is the implementation-detail layer below
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)
and [`ADR-VSCR-001`](../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

The current post-M0 execution/readiness plan is:

[`VSCR-M1-FORWARD-PLAN-2026-09-11.md`](VSCR-M1-FORWARD-PLAN-2026-09-11.md)

The owner branding decision that fixes the exact ASA Lab logo source for the Scratch host is:

[`VSCR-D0-001A-CANONICAL-ASA-BRAND-ASSET.md`](VSCR-D0-001A-CANONICAL-ASA-BRAND-ASSET.md)

Post-v2 normative repairs remain recorded in
[`VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md`](VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md),
and runtime current-authority semantics remain fixed by
[`VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md`](VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md).

These files are design/readiness contracts. They do not replace `docs/execution/current.yaml`
and do not automatically authorise coding, merge, deployment, restart or activation.

---

## Current baseline

PR #177 was merged to `main` on 11 September 2026 as:

```text
50d2357f1fc157a9434baebcbd5d8c440202127a
```

Therefore M0/M0.1 is no longer a feature-branch candidate. It is the integrated baseline for
future Visual Programming work.

Integrated M0/M0.1 includes:

```text
Blocks provider/document envelope
strict asset references: assetId + dataFormat + sha256 + sizeBytes
objectKey excluded from persistent Project Core JSON
moduleVersion 0.1.1
availability coming_soon
reviewed immutable Scratch Editor pin
D0-001…D0-007 design contracts
D0-004A current-authorisation recheck rule
Scratch-focused CI/repository-gate evidence
```

Still not implemented:

```text
@asa-lab/blocks bounded context
ASA-owned Scratch product host
runtime JWT/CORS implementation
S3/MinIO asset persistence
durable save/load
autosave/recovery/conflict implementation
.sb3 import/export
Gallery/player/remix implementation
sovereign local library/extensions baseline
backup/restore acceptance
activation
```

---

## Read order for a coding agent

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ currently authorised task from the normal execution flow
→ this readiness index
→ VSCR-M1-FORWARD-PLAN-2026-09-11.md
→ master spec §0–§4
→ selected master milestone/task
→ ADR-VSCR-001
→ matching D0 contract(s) and addenda
→ exact implementation package for the selected coding task
→ current code/current main delta
```

A task without resolved prerequisites is not coding-ready. Do not infer implementation from
the roadmap or an earlier chat.

---

## Stable design contracts

| Contract | Boundary | Status |
| --- | --- | --- |
| `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` + `VSCR-D0-001A-CANONICAL-ASA-BRAND-ASSET.md` | standalone host, exact upstream pin, ASA branding, File/Extensions controls, iframe/bootstrap | accepted design |
| `VSCR-D0-002-PERSISTENCE-CONTRACT.md` | Project Core async durability guard and bypass prevention | accepted design |
| `VSCR-D0-003-ASSET-STORAGE-CONTRACT.md` | Scratch identity, SHA-256 blobs, private S3/MinIO, asset API | architecture accepted; exact content-validation stack still required |
| `VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md` + `VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` | capability, origin/CORS/CSP/rate limits and current-resource authority | accepted design |
| `VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md` | LAN/public topology, backup/restore, degradation, activation | accepted design |
| `VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md` | immutable Gallery version/player and cross-tenant Blocks remix | accepted design for future M2 |
| `VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md` | canonical media vs historical `.sb3` compatibility/ZIP safety | accepted safety boundary; exact dependency/corpus package still required |

`accepted design` does not mean implementation exists.

---

## Branding decision

The Scratch logo must not be shown as ASA product chrome.

The canonical ASA Lab mark is:

```text
apps/web/public/asa-lab-mark.svg
```

M1-002 must copy this exact source asset into the runtime image. It must not create a second
independently maintained ASA mark for the Scratch host.

Core-mode editor controls remain:

```text
canSave=false
canCreateNew=false
canEditTitle=false
canManageFiles=false
canShare=false
canRemix=false
backpackVisible=false
canUseCloud=false
extensionsButtonVisible=false
```

The two reviewed minimal upstream patches remain the ceiling: host-supplied logo and
extension-button visibility. A third patch is a STOP condition.

---

## Current coding-readiness matrix

| Task | Readiness now | Prerequisite / note |
| --- | --- | --- |
| `VSCR-M0.1-001` | **COMPLETE / IN MAIN** | integrated through PR #177 |
| `VSCR-M0.1-002` | **COMPLETE / IN MAIN** | reviewed post-release Scratch Editor 15.1.1 snapshot retained |
| `VSCR-M1-001` | **READY FOR OWNER SELECTION** | fresh bounded change; extract `@asa-lab/blocks`; no behaviour change |
| `VSCR-M1-002` | **READY AFTER M1-001 ACCEPTANCE** | host/branding/File/Extensions contract is resolved |
| `VSCR-M1-003` | **READY AFTER M1-002 ACCEPTANCE** | implement D0-004 + D0-004A |
| `VSCR-M1-004P` | **READY AS DESIGN WORK** | select exact image/audio/XML/SVG validation/sniffing stack |
| `VSCR-M1-004` | **BLOCKED** | needs M1-003 + accepted M1-004P dependency decision |
| `VSCR-M1-005P` | **READY AS DESIGN WORK** | select/prove exact Scratch semantic validator strategy |
| `VSCR-M1-005` | **BLOCKED** | needs M1-004 + accepted M1-005P |
| `VSCR-M1-006` | **BLOCKED** | package only after accepted M1-005 interfaces |
| `VSCR-M1-007P` | **READY AS DESIGN WORK** | exact ZIP stack, limits, legacy-media normalisation and corpus |
| `VSCR-M1-007` | **BLOCKED** | needs durable storage/load-save + accepted M1-007P |
| `VSCR-M1-008` | **BLOCKED** | end-to-end gate after M1-006/007 |
| `VSCR-M2-*` | **BLOCKED** | exact packages only after accepted M1 interfaces |
| `VSCR-M3-*` | **BLOCKED** | requires accepted M2 + rights/network/backup evidence |
| `VSCR-M4-001` | **BLOCKED** | activation only after sovereign + restore acceptance |

`READY` does not mean selected. A bot must not start a ready task without owner/current-task
authorisation.

---

## Correct next order

```text
M0/M0.1 merged — COMPLETE
→ VSCR-M1-001 bounded-context extraction
→ STOP / evidence / owner acceptance
→ VSCR-M1-002 ASA-owned Scratch host
→ STOP / evidence / owner acceptance
→ VSCR-M1-003 runtime security boundary
→ dependency-selection gates for binary/semantic/.sb3 validation
→ M1-004 storage
→ M1-005 durable persistence guard/load-save
→ M1-006 autosave/recovery/conflict
→ M1-007 safe .sb3 interchange
→ M1-008 full M1 acceptance
→ M2 product/Gallery/player/remix
→ M3 sovereign/network-deny/backup/deployment
→ M4 activation
```

Do not combine multiple implementation packages into one bot run merely because the next
package is documented.

---

## Gallery/publication invariant

Before Blocks publication/remix in M2:

```text
publication pins exact immutable project_version_id
player reads that exact immutable version
current draft is never substituted for a published Blocks work
cross-tenant remix server-materialises referenced assets into the destination tenant
objectKey is never copied into project JSON
```

Do not modify Gallery opportunistically during M1.

---

## Learning invariant

Do not create a Scratch-specific LMS/submission system.

Once Blocks project versions are durable, reuse the existing ASA Learning model that submits
immutable `project_version_id` values.

---

## Sovereign activation invariant

Before `blocks` may become active:

```text
ASA/right-cleared default project media
local/right-cleared media libraries
controlled extension allowlist
no implicit Scratch Foundation network dependency
network-deny browser evidence
backup/restore evidence for Postgres + object store
failure/degradation evidence
30-concurrent-editor LAN/NAT load evidence
explicit owner activation decision
```

The upstream default Scratch project/assets may be used only as a non-user-facing M1
compatibility fixture while `blocks` remains `coming_soon`.

---

## Repository convergence rule

Before every VSCR implementation slice touching shared files:

```text
fetch current main
→ compare selected branch/worktree to main
→ reconcile if needed without rewriting published history
→ preserve current.yaml unless the owner explicitly changes task selection
→ preserve security/dependency fixes
→ run focused + required repository gates on the exact final SHA
→ stop after the selected task
```

A previous green SHA or previous `behind_by=0` is not evidence for a later head.
