# ASA Lab Visual Programming — post-M0 forward plan

**Date:** 11 September 2026  
**Programme:** `blocks` / `Визуальное программирование`  
**Status:** planning/readiness contract only — not an execution authorisation  
**Baseline:** `main` at `50d2357f1fc157a9434baebcbd5d8c440202127a` (merged PR #177)

This document replaces the stale pre-merge sequencing language that treated PR #177 as an
open M0 candidate. M0/M0.1 is now integrated into `main`. The next development wave is M1,
but each M1 package remains separately selected, implemented, verified and accepted.

This file MUST NOT be treated as permission to advance automatically. The active task still
comes from the normal ASA execution/governance flow plus explicit owner instruction.
`docs/execution/current.yaml` is intentionally not changed by this planning update.

---

## 1. Current factual state

Integrated in `main`:

```text
M0 Scratch-backed Visual Programming foundation
M0.1 strict Blocks document contract
reviewed immutable Scratch Editor pin
D0-001…D0-007 design contracts
D0-004A current-authorisation recheck rule
Scratch-focused CI and repository-gate evidence
```

Current provider facts:

```text
moduleKey      blocks
projectType    scratch-3
moduleVersion  0.1.1
availability   coming_soon
asset ref      assetId + dataFormat + sha256 + sizeBytes
objectKey      server-only; forbidden in Project Core JSON
```

Not implemented yet:

```text
@asa-lab/blocks bounded context
ASA-owned Scratch product host
iframe product shell
runtime capability API
runtime-specific CORS/origin enforcement
S3/MinIO asset persistence
durable Scratch load/save
autosave/recovery/conflict handling
.sb3 product import/export
Gallery/player/remix integration
sovereign local media/extensions baseline
backup/restore acceptance
public activation
```

---

## 2. Owner branding decision — final for M1+

The Scratch logo MUST NOT appear as product chrome in ASA Lab.

The only product logo for the Visual Programming host is the existing canonical ASA Lab
mark:

```text
apps/web/public/asa-lab-mark.svg
```

This file is the source of truth. M1-002 MUST NOT redraw, reinterpret or maintain a second
independently editable "Scratch-specific" ASA logo.

The Scratch runtime Docker build must copy the exact canonical asset bytes into the runtime
image, for example:

```text
apps/web/public/asa-lab-mark.svg
    ↓ deterministic Docker COPY
/usr/share/nginx/html/assets/asa-lab-mark.svg
```

The host supplies that asset to the reviewed host-logo compatibility patch.

Required product result:

```text
Scratch logo in product chrome      absent
ASA Lab logo                        present
Scratch-site logo navigation        absent
Scratch community/account chrome    absent
factual compatibility attribution   allowed where required
upstream license/NOTICE files        preserved
```

The technical wording may say that the editor is compatible with Scratch 3 / `.sb3`; it
must not imply that ASA Lab is an official Scratch product.

### 2.1 Production media boundary

The upstream default Scratch project/assets may remain a non-user-facing M1 compatibility
fixture while `blocks` is `coming_soon`.

Before sovereign/public activation, the default project must use ASA-owned/right-cleared
media (or a deliberately empty stage). Public activation must not depend on Scratch
Foundation trademark media such as the Scratch Cat unless a separate explicit rights
review authorises it.

---

## 3. Product-surface controls fixed before host coding

M1-002 must implement these controls explicitly, not by no-op click handlers:

```text
canSave = false
canCreateNew = false
canEditTitle = false
canManageFiles = false
canShare = false
canRemix = false
backpackVisible = false
showComingSoon = false
canUseCloud = false
extensionsButtonVisible = false
```

Consequences:

- Scratch built-in File import/export is not a second persistence path;
- `.sb3` import/export belongs to ASA product flows in its later package;
- the upstream Extensions button/library is hidden in M1/M2 core mode;
- no Scratch cloud/backpack/account/community ownership is exposed;
- no upstream server save runs in parallel with ASA persistence.

Only the two already reviewed minimal compatibility patches are authorised for the host
boundary: host-supplied logo and extension-button visibility. A third upstream patch is a
STOP condition and requires a contract update.

---

## 4. Revised execution order

The programme now proceeds in the following strict order.

```text
M0/M0.1 merged to main — COMPLETE

M1-001  Extract @asa-lab/blocks bounded context
   ↓ acceptance
M1-002  ASA-owned standalone Scratch host + iframe/message skeleton
   ↓ acceptance
M1-003  Runtime capability auth + exact path-scoped origin/CORS/CSP
   ↓ acceptance
M1-004P Content-validation dependency decision
   ↓ accepted dependency/security/license evidence
M1-004  Tenant-private asset metadata + S3/MinIO + validated upload/download
   ↓ acceptance
M1-005P Scratch semantic-validator decision/proof
   ↓ accepted validator/security/license evidence
M1-005  Generic Project Core persistence guard + durable Scratch load/save
   ↓ acceptance
M1-006  Generation-aware autosave/recovery/conflict + snapshot integration
   ↓ acceptance
M1-007P ZIP/legacy-media dependency + corpus decision
   ↓ accepted dependency/security/license evidence
M1-007  Safe .sb3 import/export + deterministic legacy-media normalisation
   ↓ acceptance
M1-008  End-to-end durability/security acceptance gate
   ↓ acceptance
M2      ASA project UI + immutable Gallery player/publication/remix integration
   ↓ acceptance
M3      Sovereign local libraries/extensions + network-deny + backup/restore/deployment
   ↓ acceptance
M4-001  coming_soon → active activation decision
```

`P` tasks are design/dependency-selection gates. They exist specifically to prevent coding
agents from choosing security-sensitive parsing/validation libraries ad hoc.

---

## 5. Readiness by task

| Task | Readiness on 11 Sep 2026 | Exact next condition |
| --- | --- | --- |
| `VSCR-M1-001` | **READY FOR OWNER SELECTION** | M0 is merged; execute in a fresh bounded change and stop after evidence |
| `VSCR-M1-002` | **READY AFTER M1-001 ACCEPTANCE** | host contract is resolved, including canonical ASA logo, File controls and hidden Extensions |
| `VSCR-M1-003` | **READY AFTER M1-002 ACCEPTANCE** | implement D0-004 + D0-004A against accepted host protocol |
| `VSCR-M1-004P` | **READY AS DESIGN WORK** | select exact image/audio/XML/SVG validation/sniffing stack and versions |
| `VSCR-M1-004` | **BLOCKED** | M1-004P accepted + M1-003 accepted |
| `VSCR-M1-005P` | **READY AS DESIGN WORK** | select/prove exact server-side Scratch semantic validator or a bounded in-house validator contract |
| `VSCR-M1-005` | **BLOCKED** | M1-005P accepted + M1-004 accepted |
| `VSCR-M1-006` | **BLOCKED** | accepted M1-005 persistence interfaces |
| `VSCR-M1-007P` | **READY AS DESIGN WORK** | select exact ZIP stack, bomb limits, legacy BMP/JPEG/GIF normalisation and compatibility corpus |
| `VSCR-M1-007` | **BLOCKED** | M1-007P accepted + durable M1 storage/load-save exists |
| `VSCR-M1-008` | **BLOCKED** | M1-006 and M1-007 accepted |
| `VSCR-M2-*` | **BLOCKED** | M1-008 accepted and exact M2 packages written against real M1 interfaces |
| `VSCR-M3-*` | **BLOCKED** | M2 accepted plus rights/network/backup decisions |
| `VSCR-M4-001` | **BLOCKED** | sovereign, restore and deployment acceptance complete |

`READY` is not the same as selected. A bot MUST NOT start a ready task until the owner/current
execution flow selects it.

---

## 6. M1-001 — first coding slice

Goal: extract the already accepted Blocks subject contract from `apps/api` into the normal
bounded context `@asa-lab/blocks` without behaviour change.

Expected properties after M1-001:

```text
contexts/blocks/** exists
public import is @asa-lab/blocks
apps/api composes the provider
moduleVersion remains 0.1.1
availability remains coming_soon
schemaVersion remains 1
no runtime endpoint added
no DB/S3 change
no Web editor route added
```

This is the first safe implementation step because it creates the architectural home for
all later Blocks domain/application code before runtime/storage complexity arrives.

STOP after focused and repository gates. Do not automatically begin M1-002.

---

## 7. M1-002 — ASA-owned Scratch host

M1-002 becomes the first visible editor-runtime foundation, but still not a usable student
product.

Required host shape:

```text
pinned scratch-editor source
→ verified standalone distribution
→ exactly two reviewed compatibility patches
→ ASA-owned index.html / host.js / host.css
→ canonical apps/web/public/asa-lab-mark.svg copied into image
→ Nginx runtime container
```

Critical acceptance additions from the owner branding decision:

```text
DOM/network screenshot evidence shows no Scratch logo in product chrome
rendered logo bytes originate from canonical ASA asset
logo is not a link to scratch.mit.edu
no second independently maintained ASA logo artwork exists
File menu is absent
Extensions button is absent
Scratch account/community/backpack/cloud UI is absent
```

M1-002 still contains no real server-side durable writes.

---

## 8. M1-003 — runtime security boundary

Implement the already accepted security model:

```text
normal ASA Web        cookie/session authority
Scratch iframe        short-lived bearer capability
runtime routes        /api/blocks/runtime/** only
runtime browser origin exact-match required
credentials           omit
CORS                   exact origin, no wildcard, no credentials
current authority      rechecked on every protected request
```

A valid JWT alone is insufficient. The request must still be authorised against current ASA
project/version/publication authority so revocation takes effect on the next protected
request.

This task must not widen generic cookie-authenticated mutation trust.

---

## 9. M1-004P / M1-004 — binary durability

Do not start M1-004 by saying "use any suitable parser".

M1-004P must produce an exact reviewed table for:

```text
SVG/XML parser + no-network configuration
PNG structural validation
JPEG structural validation
WAV validation
MP3 validation/content sniffing
exact package versions
licenses
known advisories
maximum input sizes
failure behaviour
```

Only after that decision is accepted may M1-004 implement:

```text
blocks_blobs
blocks_asset_aliases
private S3-compatible store
MinIO local/test wiring when required
MD5 Scratch compatibility check
SHA-256 ASA integrity check
tenant-scoped immutable aliases
runtime asset PUT/GET
per-file/project/capability limits
```

Browser code never receives bucket credentials or physical `objectKey` values.

---

## 10. M1-005P / M1-005 — semantic project persistence

M1-005P must settle the exact server-side semantic validation strategy. The coding agent
must not silently add an old/unreviewed Scratch parser dependency.

The accepted approach must prove at least:

```text
supported Scratch 3 projectJson form is validated server-side
referenced asset set is derived from projectJson, not trusted from submitted assets[]
unsupported/external reference shapes fail closed
validator dependency/license/security posture is known
fixtures cover official/pinned supported projects and malformed cases
```

M1-005 then adds the generic asynchronous Project Core durability guard and the Blocks
implementation of that guard. Both generic Project Draft PUT and Blocks runtime save must
hit the same durability rule.

No draft becomes durable while one referenced asset is missing/unverified.

---

## 11. M1-006 — autosave/recovery/conflict

Implement generation-aware save ownership in ASA, not upstream Scratch server-save HOCs.

Minimum states:

```text
LOADING
CLEAN
DIRTY
SAVING
OFFLINE/RETRYING
CONFLICT
FATAL
```

Required properties:

- edits during an in-flight save are not lost;
- optimistic revision conflicts never become silent last-write-wins;
- token refresh does not destroy editor state;
- confirmed revisions can produce snapshots;
- close/reload/reopen proves the same durable project;
- recoverable local state is bounded and never becomes the canonical database.

---

## 12. M1-007P / M1-007 — `.sb3` interchange

`.sb3` remains interchange, never autosave storage.

The pre-task decision must fix:

```text
exact ZIP library/version
entry-count and expanded-size ceilings
path traversal/duplicate-entry rules
compression-ratio limits
supported project.json expectations
legacy BMP/JPEG/GIF normalisation path
compatibility corpus and round-trip assertions
```

Only after these are fixed may product import/export be implemented.

Built-in Scratch File import/export remains disabled; ASA owns the user-facing flow.

---

## 13. M1-008 — M1 acceptance gate

M1 is not complete because unit tests pass individually. M1-008 must prove the full chain:

```text
create ASA Blocks project
→ acquire runtime session
→ open ASA-branded editor
→ edit blocks/media
→ assets durable
→ projectJson durable
→ autosave
→ reload/reopen same state
→ revision conflict handled safely
→ export .sb3
→ re-import supported .sb3
→ runtime/object-store outage does not break unrelated ASA modules
```

The module still remains `coming_soon` after M1-008.

---

## 14. M2 — product integration prerequisites

M2 must be written against accepted M1 interfaces, not guessed now.

Mandatory architecture already known:

### 14.1 Immutable Gallery publication

A Blocks publication must pin an immutable `project_version_id` (or an equivalent genuinely
immutable canonical version). The player must never substitute the author's current draft
for the published work.

### 14.2 Cross-tenant remix

Current plain JSON cross-tenant copy is insufficient for Blocks because asset aliases are
tenant-scoped.

A Blocks remix must perform server-side controlled re-materialisation:

```text
freeze exact published source version
→ authorise source publication
→ resolve referenced source assets
→ ensure/copy identical bytes into destination tenant blob namespace
→ create immutable destination aliases
→ create destination Blocks project/document/version
→ preserve provenance
```

`objectKey` is never copied into project JSON.

### 14.3 Learning

Do not create a Scratch-specific LMS/submission subsystem. Reuse ASA Learning's existing
immutable `project_version_id` submission semantics once Blocks versions are fully durable.

---

## 15. M3 — sovereign school baseline

Before activation the supported baseline must work without Scratch Foundation services.

M3 includes:

```text
ASA/right-cleared default project media
ASA/right-cleared local sprite/costume/backdrop/sound library
approved local extension allowlist
external-service/hardware extensions classified separately
no implicit Scratch-host fallback
network-deny browser evidence
LAN/public deployment topology
backup/restore evidence for Postgres + object store
failure/degradation evidence
30-concurrent-editor LAN/NAT load run >= 5 minutes
```

Scratch trademarks/media are not the product brand.

---

## 16. M4 activation

Only M4-001 may change:

```text
availability: coming_soon → active
```

Activation requires explicit owner acceptance after M3 sovereign/network/restore evidence.
It is not implied by completing M1 or M2.

---

## 17. Non-negotiable bot rules

For every subsequent VSCR task:

```text
one selected task only
state expected changed paths before editing
preserve current main/security fixes
no opportunistic neighbouring refactors
no current.yaml rewrite unless explicitly authorised
no hidden route/public activation as a side effect
no deploy/restart/restore without explicit owner authorisation
run focused + required repository gates on the exact final SHA
report code state, CI state, deployment state and owner acceptance separately
STOP after the selected task
```

A task that discovers an unresolved architecture/dependency choice must stop at that choice;
it must not invent one merely to keep coding.

---

## 18. Immediate next action

The next coding task is **VSCR-M1-001**, but only after explicit owner selection.

Do not start M1-002 in the same change. The intended cadence is:

```text
select M1-001
→ implement
→ exact-SHA gates
→ owner review/acceptance
→ stop
→ separately select M1-002
```
