# VSCR readiness audit — 10 September 2026

**Purpose:** factual checkpoint after the critical Scratch repair review.  
**Authority:** this note does not replace `current.yaml`, the master spec, repair addendum,
D0 contracts or task packages.

## What actually exists

In the Scratch feature branch:

```text
M0 Blocks provider/schema/tests
VSCR-M0.1-001 corrected persistent Blocks asset-reference contract
pinned upstream Scratch build boundary
M0 Docker/Nginx playground smoke
Scratch-focused CI workflow
Master v2 + normative repair addendum
D0-001…D0-007 contracts
first-wave implementation packages/readiness index
repository merge-forward to current audited main baseline
```

The Scratch work is still not merged into `main` or deployed. `blocks` remains
`coming_soon` and cannot be created through the ordinary Project Core `getCreatable()`
path.

No implementation exists yet for:

```text
ASA standalone Scratch host
runtime capability/CORS boundary
S3/MinIO Blocks asset storage
durable Scratch save/load
autosave/recovery
.sb3 import/export
immutable Gallery player/remix
sovereign local media/extension baseline
Blocks object backup/restore
production activation
```

---

## Repair conclusions

### M0.1-001

Implemented and focused-verified:

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

Implementation code SHA:

```text
d277c4f71553b6c6ef90e52adb41e3200f036a1b
```

A later feature-head Scratch M0 Focused run passed both jobs, including Docker
build/start/health/root smoke. Explicit owner acceptance remains distinct from CI evidence.

### Upstream pin provenance

The earlier recommendation to roll the pin back to the official `v15.1.1` tag SHA was too
strong and has been withdrawn after a complete delta review.

```text
v15.1.1 tag SHA: 99bcc17e0580588f181f8a87577a2f676537a487
ASA exact pin:    82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The ASA pin is nine commits after the tag. The reviewed compare changes only package
manifests and `package-lock.json`, with no Scratch source-code file delta. Eight commits are
build/test/style dependency maintenance; one updates `scratch-l10n` to `6.1.112`.

Decision:

```text
retain 82c5fea...
call it a reviewed post-release 15.1.1 snapshot
never call it the official v15.1.1 tag commit
```

`VSCR-M0.1-002` is a completed provenance review, not a pending code rollback.

### `.sb3` compatibility

Canonical ASA storage remains:

```text
svg/png/jpg/wav/mp3
```

The pinned Scratch VM can recognise legacy archive costume formats such as BMP/JPEG/GIF.
D0-007 prevents a future import bot from either widening the durable schema casually or
rejecting historical archives while claiming universal Scratch compatibility.

`VSCR-M1-007` remains STOP until exact ZIP limits/library, legacy media normalisation and a
round-trip fixture corpus are specified.

### Gallery

D0-006 remains mandatory: Blocks publication must pin immutable `project_version_id`; a
cross-tenant remix must materialise referenced assets into destination-tenant ownership.
Current draft-copy Gallery semantics are not accepted for Blocks.

---

## Repository convergence repair

The audited Scratch feature branch was four commits behind `main`. The divergent main
changes included:

```text
current execution/Learning control-plane state
package.json dependency-security override
pnpm-lock.yaml dependency graph
current web changes
```

The feature branch was merged forward with main baseline:

```text
043fb7ba2c11829ee5338f29c3ec0d87d15c57be
```

Convergence merge:

```text
263757021bfd977a81270429fb49fc7b7d9353ee
```

The merge tree preserves the exact main blobs for:

```text
docs/execution/current.yaml
package.json
pnpm-lock.yaml
current Learning docs/control-plane files
current main web files
```

and preserves the Scratch feature implementation/docs. At that convergence point,
`main` is an ancestor of the Scratch branch (`behind_by=0`).

The merged `package.json` contains the accepted `smol-toml@<=1.7.0 → 1.8.0` override.
`current.yaml` was not modified to select Scratch work.

Exact-head focused/repository CI remains external evidence: only the actual latest workflow
result may be called PASS. If `main` advances again, convergence must be checked again
before the next shared-file coding task.

---

## Current readiness after repair

```text
VSCR-M0.1-001          IMPLEMENTED + focused verified; owner acceptance pending
VSCR-M0.1-002          REVIEW COMPLETE; current exact pin retained
VSCR-REPO-CONVERGENCE  STRUCTURAL MERGE COMPLETE; latest gates required
VSCR-M1-001            STOP until latest convergence gates + M0.1 acceptance
VSCR-M1-002            STOP until M1-001 accepted + exact host package amended
VSCR-M1-003            STOP until host accepted
VSCR-M1-004            STOP until exact media/XML validation stack selected
VSCR-M1-005            STOP until exact Scratch semantic validator selected/proven
VSCR-M1-006+           STOP
VSCR-M1-007            additionally requires D0-007 exact ZIP/legacy-normalisation package
VSCR-M2+               STOP
```

No M1 host/storage/security work is authorised by this audit note.