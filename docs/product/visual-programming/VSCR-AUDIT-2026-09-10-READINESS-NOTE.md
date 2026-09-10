# VSCR readiness audit — 10 September 2026

**Purpose:** factual checkpoint at the clean M0/M0.1 boundary after repository repair and
final design closure.  
**Authority:** this note does not replace `current.yaml`, the master spec, repair addendum,
D0 contracts or task packages.

## M0 boundary result

Owner instruction on 10 September 2026 directed the Visual Programming programme to be
brought to a clean M0 boundary. That instruction records owner acceptance of the corrected
M0.1 contract while preserving the normal requirement for final exact-head CI before the
PR is considered integration-ready.

The Scratch feature branch contains only foundation/design work:

```text
M0 Blocks provider/schema/tests
VSCR-M0.1-001 corrected persistent Blocks asset-reference contract
VSCR-M0.1-002 reviewed upstream pin provenance
pinned upstream Scratch build boundary
M0 Docker/Nginx playground smoke
Scratch-focused CI workflow
Master v2 + normative repair addendum
D0-001…D0-007 contracts
D0-004A current-authorisation recheck closure
first-wave implementation packages/readiness index
repository merge-forward to the repaired current main baseline
```

The Scratch work is still not merged into `main` or deployed. `blocks` remains
`coming_soon` and cannot be created through the ordinary Project Core `getCreatable()`
path.

No M1+ implementation exists in this boundary:

```text
no @asa-lab/blocks extracted bounded context
no ASA standalone Scratch product host
no runtime capability/CORS implementation
no S3/MinIO Blocks asset storage
no durable Scratch save/load
no autosave/recovery
no .sb3 import/export
no immutable Gallery player/remix implementation
no sovereign local media/extension baseline
no Blocks object backup/restore
no production activation
```

PR #177 must not receive any of those M1+ implementations.

---

## M0.1-001 — accepted contract correction

Implemented and owner-accepted at the M0 boundary:

```text
objectKey removed from persistent Blocks document
assetId = lowercase 32-hex
formats = svg/png/jpg/wav/mp3
sha256 = lowercase 64-hex
sizeBytes = positive safe integer
strict asset keys
moduleVersion = 0.1.1
availability = coming_soon
```

Implementation code originated at:

```text
d277c4f71553b6c6ef90e52adb41e3200f036a1b
```

Later feature-head Scratch M0 Focused evidence passed provider/API checks and the pinned
Docker build/start/health/root smoke. The final M0 closure still requires a fresh exact-head
run after the convergence/documentation closure commits.

---

## M0.1-002 — upstream provenance review complete

```text
v15.1.1 tag SHA: 99bcc17e0580588f181f8a87577a2f676537a487
ASA exact pin:    82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The ASA pin is intentionally retained. It is a reviewed post-release `15.1.1` snapshot nine
dependency-maintenance commits after the tag. The reviewed compare changes package
manifests/lockfile and no Scratch source-code files. Do not roll it back merely for cosmetic
tag alignment and do not call it the release-tag commit.

---

## D0-004A — current authority after token issuance

The final M0 critical review found one security ambiguity: the original D0-004 wording could
be read as allowing an editor capability to retain project access until its ten-minute
expiry even after the actor's project authority was revoked.

`VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` closes that ambiguity without adding M1
code:

```text
verify JWT signature/claims/resource/permission
→ recheck current ASA project/version/publication authority
→ only then perform the protected runtime operation
```

A valid token is not a frozen authorisation snapshot. Revoking project authority must deny
the next protected runtime request. Core v1 does not require a Scratch-specific JWT
blacklist or process-local denylist.

M1-003 and later runtime slices must implement/reuse this boundary.

---

## Baseline repair and final repository convergence

The previous Scratch repository gate exposed an inherited `main` defect, not a Scratch or
PostgreSQL/RLS regression:

```text
PublicEntryHeroV2.css failed Prettier
PublicEntryPage.spec.ts retained two stale exact-copy expectations
```

The repair was isolated in PR #180. Exact-head PR #180 evidence passed:

```text
Governance contracts                    PASS
Format/lint/types/contracts/build       PASS
PostgreSQL tests + RLS + Data gate      PASS
Access A unit + real browser journeys   PASS
```

PR #180 was then squash-merged to `main` as:

```text
74eca75dce44486d473e1db6fa766c382a4fc9cc
```

Scratch was reconciled with that repaired baseline using a true two-parent, non-rewrite
merge:

```text
Scratch pre-merge head: b002051ea98b744c4470113031982c63a80e1d96
main baseline:          74eca75dce44486d473e1db6fa766c382a4fc9cc
convergence merge:      2821859ec60775135b4062605a75c7bb2c816c6e
```

At that merge:

```text
behind_by = 0
main is the merge base/ancestor
PublicEntryHeroV2.css disappears from the Scratch-specific diff
PublicEntryPage.spec.ts is inherited from main rather than carried as Scratch work
current.yaml remains the main version and does not select Scratch
accepted dependency/security fixes remain intact
```

Any later movement of `main` must be checked again before a new shared-file VSCR slice.

---

## `.sb3` compatibility remains future work

Canonical ASA storage remains:

```text
svg/png/jpg/wav/mp3
```

The pinned Scratch VM can recognise legacy archive costume formats such as BMP/JPEG/GIF.
D0-007 prevents a future import bot from either widening the durable schema casually or
rejecting historical archives while claiming universal Scratch compatibility.

`VSCR-M1-007` remains STOP until exact ZIP limits/library, legacy media normalisation and a
round-trip fixture corpus are specified.

---

## Gallery remains future work

D0-006 remains mandatory: Blocks publication must pin immutable `project_version_id`; a
cross-tenant remix must materialise referenced assets into destination-tenant ownership.
Current draft-copy Gallery semantics are not accepted for Blocks.

No Gallery code belongs in PR #177.

---

## Current readiness at the clean M0 boundary

```text
VSCR-M0.1-001          ACCEPTED AT M0 BOUNDARY
VSCR-M0.1-002          REVIEW COMPLETE; current exact pin retained
VSCR-REPO-CONVERGENCE  STRUCTURALLY COMPLETE against main 74eca75...
M0 FINAL EVIDENCE      PENDING exact-head focused + repository gates after closure docs
VSCR-M1-001            STOP in PR #177; requires M0 integration + fresh branch/PR + explicit selection
VSCR-M1-002            STOP until M1-001 accepted + exact host package amended
VSCR-M1-003            STOP until host accepted; must implement D0-004 + D0-004A
VSCR-M1-004            STOP until exact media/XML validation stack selected
VSCR-M1-005            STOP until exact Scratch semantic validator selected/proven
VSCR-M1-006+           STOP
VSCR-M1-007            additionally requires D0-007 exact ZIP/legacy-normalisation package
VSCR-M2+               STOP
```

---

## Integration rule

The clean M0 endpoint is:

```text
final PR #177 HEAD
→ Scratch M0 Focused PASS
→ repository governance/code/data/browser gates PASS
→ PR #177 contains M0/M0.1 only
→ PR may be marked ready for review
```

Merging PR #177 into `main` remains a separate owner-authorised decision. No deployment,
restart or `blocks` activation is implied.

After M0 is eventually integrated into `main`, `VSCR-M1-001` must begin from a new branch
and new PR. Do not continue M1 development on PR #177.
