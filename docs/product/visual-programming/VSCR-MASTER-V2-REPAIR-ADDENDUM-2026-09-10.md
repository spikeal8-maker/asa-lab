# VSCR Master v2 — repair addendum, 10 September 2026

**Status:** normative addendum to `ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md` v2.0  
**Reason:** post-v2 critical audit and repository-convergence repair

This file changes only the points below. Every master v2 rule not explicitly amended here
remains in force.

---

## A1. D0 contract set is now D0-001…D0-007

Master v2 §0.2 was written before the final audit contracts existed. Its five-file list is
superseded by:

```text
VSCR-D0-001-SCRATCH-HOST-CONTRACT.md
VSCR-D0-002-PERSISTENCE-CONTRACT.md
VSCR-D0-003-ASSET-STORAGE-CONTRACT.md
VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md
VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md
VSCR-D0-006-PUBLICATION-REMIX-CONTRACT.md
VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md
```

D0-006 is mandatory before Blocks Gallery/player/remix implementation. D0-007 is mandatory
before an `.sb3` implementation package is made coding-ready.

---

## A2. Upstream pin provenance

Master invariant "Scratch upstream remains pinned by exact commit" remains unchanged.

The exact reviewed pin is:

```text
82c5fea6d3e60c781f25c09b375045f9b46a43f7
Scratch Editor package version 15.1.1
```

Its correct provenance is **reviewed post-release 15.1.1 snapshot**, nine dependency-
maintenance commits after official tag commit
`99bcc17e0580588f181f8a87577a2f676537a487`.

The reviewed tag→pin compare changes package manifests/lockfile only and no Scratch source
code files. The current pin is intentionally retained. No master rule requires cosmetic
alignment to the tag SHA.

Future pin movement requires an explicit exact-diff compatibility/security/license review.

---

## A3. M0.1 persistent document correction is implemented

Master §6 target is now reflected by feature-branch implementation:

```text
BlocksAssetReferenceV1
  assetId
  dataFormat
  sha256
  sizeBytes
```

`objectKey` remains server-only infrastructure metadata and is rejected from persistent
Blocks project documents. Provider module version is `0.1.1`; schema version remains `1`;
module remains `coming_soon`.

Implementation evidence does not equal merge/deployment/activation or owner acceptance.

---

## A4. Repository convergence precedes shared-file VSCR coding

A new mandatory precondition applies to VSCR work performed in a feature branch:

```text
before editing package.json / lockfile / current execution state / shared infrastructure:
  compare branch to current main
  if behind/diverged → reconcile current main first
  preserve main current.yaml and accepted security/dependency fixes
  run focused + repository gates on the merged exact SHA
  only then start the selected coding slice
```

A task package marked ready cannot override this repository-baseline invariant.

The Scratch branch convergence repair does not select Scratch in `current.yaml` and does not
authorise merging the Scratch PR into main.

---

## A5. `.sb3` compatibility promise is narrowed until M1-007 acceptance

Master's `.sb3` import/export goal remains, but it must not be interpreted as a claim that
all historical Scratch archives are already compatible.

Canonical durable ASA v1 media remains:

```text
svg
png
jpg
wav
mp3
```

The pinned Scratch VM can recognise legacy archive costume formats including BMP/JPEG/GIF.
D0-007 requires the future M1-007 package to select exact ZIP safety limits/dependency,
define deterministic legacy-media normalisation and prove a versioned import→save→reload→
export→reload corpus.

Until that acceptance exists, ASA may state Scratch 3 project compatibility and planned
`.sb3` interchange, but MUST NOT claim universal historical `.sb3` compatibility.

---

## A6. Near-term execution order after repair

```text
M0 foundation
→ M0.1-001 implemented + focused verified
→ upstream pin provenance review complete; current pin retained
→ repository convergence + exact-head gates
→ explicit M0.1 acceptance
→ M1-001 bounded-context extraction
→ amend/accept M1-002 package against current D0-001
→ M1-002 host
→ subsequent M1 tasks only when readiness index says YES
```

M1-004 remains blocked on exact content-validation dependencies. M1-005 remains blocked on
an exact proven Scratch semantic validator. M1-007 remains blocked on D0-007 implementation
details. M2/M3/M4 remain STOP until their preceding accepted interfaces/evidence exist.

---

## A7. Authority order for post-v2 contradictions

For a point explicitly repaired above, use:

```text
current repository fact
→ docs/product/visual-programming/README.md readiness index
→ this repair addendum
→ matching D0 contract
→ original master v2 text
```

For all unaffected product goals/invariants, original Master v2 remains normative.
