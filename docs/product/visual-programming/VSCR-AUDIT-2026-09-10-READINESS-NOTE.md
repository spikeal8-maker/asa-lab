# VSCR readiness audit — 10 September 2026

**Purpose:** factual checkpoint after the critical Scratch repair review.  
**Authority:** this note does not replace `current.yaml`, the master spec, D0 contracts or task packages.

## What actually exists

In the Scratch feature branch:

```text
M0 Blocks provider/schema/tests
VSCR-M0.1-001 corrected persistent Blocks asset-reference contract
pinned upstream Scratch build boundary
M0 Docker/Nginx playground smoke
Scratch-focused CI workflow
Master v2 / ADR / D0 design contracts
D0-006 Gallery/publication/remix boundary
D0-007 sb3 compatibility boundary
first-wave implementation packages/readiness index
```

The Scratch work is still not merged or deployed. `blocks` remains `coming_soon` and cannot
be created through the ordinary Project Core `getCreatable()` path.

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

A later exact feature-head Scratch M0 Focused run passed both jobs, including Docker
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

`VSCR-M0.1-002` is therefore a completed provenance review, not a pending code rollback.

### `.sb3` compatibility

Canonical ASA storage remains:

```text
svg/png/jpg/wav/mp3
```

The pinned Scratch VM can recognise legacy archive costume formats such as BMP/JPEG/GIF.
D0-007 now prevents a future import bot from either widening the durable schema casually or
rejecting historical archives while claiming universal Scratch compatibility.

`VSCR-M1-007` remains STOP until exact ZIP limits/library, legacy media normalisation and a
round-trip fixture corpus are specified.

### Gallery

D0-006 remains mandatory: Blocks publication must pin immutable `project_version_id`; a
cross-tenant remix must materialise referenced assets into destination-tenant ownership.
Current draft-copy Gallery semantics are not accepted for Blocks.

---

## Repository convergence finding

The Scratch feature branch diverged from current `main`. Main contains shared changes that
must not be regenerated or overwritten from the stale Scratch baseline, including:

```text
current execution/Learning control-plane state
package.json dependency-security override
pnpm-lock.yaml dependency graph
current web changes
```

In particular current main fixes the repository HIGH advisory by pinning
`smol-toml 1.8.0`, while the stale Scratch branch gate still sees `1.6.1`.

Therefore the next technical repair is **repository convergence**, before M1-001 or any
other task touching shared dependencies/lockfiles.

Convergence invariant:

```text
current main → Scratch feature branch
preserve main current.yaml exactly
preserve main dependency/security fixes exactly
preserve Scratch M0/M0.1/docs
inspect merged tree
Scratch focused gate on exact merged SHA
repository gate on exact merged SHA
```

No `current.yaml` transition to Scratch is implied.

---

## Current readiness after repair

```text
VSCR-M0.1-001      IMPLEMENTED + focused verified; owner acceptance pending
VSCR-M0.1-002      REVIEW COMPLETE; current exact pin retained
VSCR-REPO-CONVERGENCE  REQUIRED NOW
VSCR-M1-001        STOP until convergence + M0.1 acceptance
VSCR-M1-002        STOP until M1-001 accepted + exact host package amended
VSCR-M1-003        STOP until host accepted
VSCR-M1-004        STOP until exact media/XML validation stack selected
VSCR-M1-005        STOP until exact Scratch semantic validator selected/proven
VSCR-M1-006+       STOP
VSCR-M1-007        additionally requires D0-007 exact ZIP/legacy-normalisation package
VSCR-M2+           STOP
```

No M1 host/storage/security work is authorised by this audit note.