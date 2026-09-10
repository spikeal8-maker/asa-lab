# VSCR readiness audit — 10 September 2026

**Purpose:** final factual checkpoint for the clean M0/M0.1 boundary.  
**Authority:** this note does not replace `current.yaml`, the master spec, repair addendum,
D0 contracts or task packages.

## Final M0 boundary

Owner instruction on 10 September 2026 directed the Visual Programming programme to be
brought to a **clean M0 boundary**. This records owner acceptance of corrected
`VSCR-M0.1-001` and the completed `VSCR-M0.1-002` provenance review.

PR #177 is deliberately limited to foundation/design work:

```text
M0 Blocks provider/schema/tests
corrected persistent Blocks asset-reference contract
reviewed immutable upstream Scratch pin
M0 Docker/Nginx upstream build/health evidence
Scratch-focused CI
Master v2 + repair addendum
D0-001…D0-007 contracts
D0-004A current-authorisation recheck closure
readiness/task-package control plane
repository convergence with repaired main baseline
```

It contains no M1 product implementation. `blocks` remains `coming_soon`; the feature is not
merged into `main`, deployed or activated.

Explicitly absent at this M0 boundary:

```text
@asa-lab/blocks extracted bounded context
ASA-owned Scratch standalone product host
iframe product shell
runtime JWT/CORS implementation
S3/MinIO Blocks storage
durable save/load
autosave/recovery/conflict implementation
.sb3 import/export
immutable Gallery player/remix implementation
sovereign local media/extension baseline
Blocks object backup/restore
activation
```

No M1 implementation may be appended to PR #177.

---

## M0.1-001 — accepted

Persistent Blocks references are fixed to:

```text
assetId     lowercase 32-hex Scratch compatibility identity
dataFormat  svg/png/jpg/wav/mp3
sha256      lowercase 64-hex ASA integrity digest
sizeBytes   positive safe integer
```

`objectKey` is forbidden in persistent Project Core JSON and remains future server-side
storage metadata. `moduleVersion = 0.1.1`; `availability = coming_soon`.

Implementation originated at:

```text
d277c4f71553b6c6ef90e52adb41e3200f036a1b
```

Owner acceptance is recorded at this M0 closure boundary.

---

## M0.1-002 — provenance review complete

```text
v15.1.1 tag SHA: 99bcc17e0580588f181f8a87577a2f676537a487
ASA exact pin:    82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The ASA pin is intentionally retained as a reviewed post-release `15.1.1` snapshot nine
dependency-maintenance commits after the tag. The reviewed delta contains no Scratch source
file changes. Do not cosmetic-rollback to the tag and do not call `82c5fea...` the tag
commit.

---

## D0-004A — current authority after token issuance

The final critical review found an ambiguity in future capability revocation semantics.
`VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md` closes it without adding M1 code:

```text
verify JWT signature/claims/resource/permission
→ recheck current ASA project/version/publication authority
→ perform protected runtime operation only if still authorised
```

A valid runtime JWT is not a frozen ten-minute authorisation snapshot. Revoking project
access must deny the next protected runtime request. No Scratch-specific process-local JWT
denylist is required by core v1.

---

## Baseline repair

The previous repository-gate failure after Scratch/main convergence was inherited public
landing drift, not a Scratch, migration, PostgreSQL or RLS regression.

PR #180 repaired only:

```text
PublicEntryHeroV2.css              Prettier-only selector wrapping
PublicEntryPage.spec.ts            two stale exact-copy assertions
```

PR #180 exact-head gates passed Governance, Code, PostgreSQL/RLS/Data and Access A browser,
then it was squash-merged to `main` as:

```text
74eca75dce44486d473e1db6fa766c382a4fc9cc
```

---

## Final repository convergence

Scratch was reconciled with repaired `main` through a true two-parent non-rewrite merge:

```text
Scratch pre-merge head: b002051ea98b744c4470113031982c63a80e1d96
main baseline:          74eca75dce44486d473e1db6fa766c382a4fc9cc
convergence merge:      2821859ec60775135b4062605a75c7bb2c816c6e
```

At that convergence point:

```text
behind_by = 0
main is an ancestor of Scratch
PublicEntryHeroV2.css is no longer Scratch-specific
PublicEntryPage.spec.ts is inherited from main
current.yaml remains the main version and does not select Scratch
security/dependency baseline fixes remain intact
```

---

## Green M0 closure evidence

After convergence plus M0 design closure, exact-head candidate
`0b920c5579d53428cf6cfde64f96a33378c4dacf` passed all required evidence.

Scratch M0 Focused run `34534364571`:

```text
Module contract and API typecheck          PASS
Pinned upstream image and health smoke     PASS
```

ASA Lab Governance and Code Gates run `34534364603`:

```text
Governance contracts                       PASS
Format/lint/types/contracts/build           PASS
PostgreSQL tests and RLS / Data gate        PASS
Access A real browser journeys              PASS
```

This audit update only records those results. GitHub checks on any later PR head remain the
final authority before ready/merge decisions.

---

## `.sb3` and Gallery remain future work

Canonical durable media remain `svg/png/jpg/wav/mp3`. Historical BMP/JPEG/GIF compatibility
requires the future M1-007 ZIP/normalisation/corpus package under D0-007.

Blocks publication still requires D0-006 immutable `project_version_id` pinning and
cross-tenant asset materialisation before M2. Current Gallery draft-copy semantics are not
accepted for Blocks.

---

## Readiness at M0 closure

```text
VSCR-M0.1-001          ACCEPTED AT M0 BOUNDARY
VSCR-M0.1-002          REVIEW COMPLETE; exact pin retained
VSCR-REPO-CONVERGENCE  COMPLETE for main 74eca75...
M0 CLOSURE EVIDENCE    GREEN on 0b920c55...; latest PR-head checks remain authoritative
VSCR-M1-001            STOP in #177; requires M0 integration + fresh branch/PR + explicit selection
VSCR-M1-002            STOP until accepted M1-001 + amended exact host package
VSCR-M1-003            STOP until host accepted; must implement D0-004 + D0-004A
VSCR-M1-004            STOP until exact media/XML validation stack selected
VSCR-M1-005            STOP until exact Scratch semantic validator selected/proven
VSCR-M1-006+           STOP
VSCR-M1-007            additionally requires exact ZIP/legacy-normalisation package
VSCR-M2+               STOP
```

## Integration rule

The M0 feature is ready for review only when the **latest** PR #177 head also remains green.
Merging #177 into `main` is a separate owner-authorised decision. No deployment, restart or
`blocks` activation is implied.

After M0 is eventually integrated into `main`, `VSCR-M1-001` begins from a new branch and
new PR. Do not continue M1 development on #177.
