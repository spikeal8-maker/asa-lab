# VSCR-D0-007 — `.sb3` import/export compatibility boundary

**Status:** accepted safety boundary; exact `VSCR-M1-007` implementation package still required  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)  
**Asset contract:** [`VSCR-D0-003-ASSET-STORAGE-CONTRACT.md`](VSCR-D0-003-ASSET-STORAGE-CONTRACT.md)

This contract prevents the future `.sb3` task from silently equating "current ASA asset
formats" with "every historical archive Scratch can open".

---

## 1. Canonical ASA Blocks asset formats remain unchanged

Durable ASA Blocks documents v1 use only:

```text
svg
png
jpg
wav
mp3
```

This is the canonical storage/API surface. `bmp`, `jpeg`, `gif`, generic ZIP and arbitrary
binary types are not added to `BlocksAssetReferenceV1` merely to make import easier.

---

## 2. Why import needs a compatibility boundary

The pinned Scratch Editor exposes canonical storage formats including `svg`, `png`, `jpg`,
`wav` and `mp3`.

Its normal GUI upload path also canonicalises some user inputs:

```text
BMP upload → PNG
GIF upload → one or more PNG costumes
JPEG upload → JPG
PNG upload → PNG
SVG upload → SVG
```

However the pinned VM's legacy `.sb3` deserialisation path can recognise existing costume
formats including:

```text
bmp
jpeg
jpg
gif
png
svg
```

Therefore a historical Scratch archive may be loadable by Scratch while containing media
that is outside ASA's canonical five-format durable contract.

Rejecting such an archive as "invalid Scratch" would be inaccurate; blindly persisting the
legacy format into ASA would violate D0-003.

---

## 3. Product promise before M1-007

Before `VSCR-M1-007` is accepted, ASA MUST NOT promise universal `.sb3` compatibility.

Correct language is:

```text
Scratch 3-compatible project model
.sb3 import/export planned and gated by compatibility acceptance
```

Public activation cannot claim "opens every Scratch project" without corpus evidence.

---

## 4. Required import architecture

The future M1-007 package must separate four stages:

```text
bounded ZIP intake
→ project.json + archive inventory validation
→ Scratch compatibility/normalisation stage
→ canonical ASA durability commit
```

No durable Project Core document may be committed until every referenced asset has a
canonical ASA representation allowed by D0-003.

The normalisation stage may use the pinned Scratch runtime and its tested media conversion
surface or another explicitly reviewed deterministic converter. A coding agent MUST NOT
choose converters ad hoc while implementing ZIP handling.

If normalisation changes asset bytes, it must also update all affected Scratch identities:

```text
assetId = MD5(canonical bytes)
md5ext = assetId + '.' + canonical format
sha256 = SHA-256(canonical bytes)
sizeBytes = canonical byte length
project.json asset references = canonical identity
```

The resulting project must load in the exact pinned Scratch runtime before it is accepted
as a successful import.

---

## 5. GIF semantics are not a trivial extension rename

A GIF can contain multiple frames. The current Scratch GUI upload path can turn GIF frames
into multiple PNG costumes.

Therefore `gif → png` must not be implemented as an extension rename or a byte copy.
The future compatibility package must define and test the exact sprite/costume result.

Likewise `bmp → png` and `jpeg → jpg` require decoded/re-encoded canonical bytes when the
chosen normalisation path does so; the server must recompute identities after conversion.

---

## 6. Security boundary

The import path must treat `.sb3` as an untrusted ZIP container.

The future package must select exact libraries and limits for at least:

```text
compressed archive byte limit
uncompressed total byte limit
entry count limit
per-entry limit
path traversal / absolute path rejection
symlink/special entry rejection
compression-ratio/zip-bomb protection
duplicate-name handling
project.json count/name rules
asset filename/identity consistency
no executable extraction to filesystem paths
```

No ZIP implementation is selected by this D0 contract. Until the exact dependency and
limits are reviewed, `VSCR-M1-007` remains not coding-ready.

---

## 7. Compatibility corpus required before acceptance

M1-007 acceptance must include a versioned fixture corpus covering at least:

```text
current Scratch-generated canonical sb3
SVG costume
PNG costume
JPG costume
WAV sound
MP3 sound
legacy BMP costume archive
legacy JPEG costume archive
legacy GIF costume archive, including animated GIF
multiple sprites/costumes/sounds
unknown/missing referenced asset
asset filename/digest mismatch
malformed project.json
zip-slip path
oversized/zip-bomb fixture
```

For every successful fixture prove:

```text
import
→ durable save
→ close/reload
→ exact pinned runtime opens project
→ export sb3
→ exported archive opens again in pinned runtime
```

Where normalisation changes media representation, tests must assert the deliberately
chosen semantic result rather than byte equality with the legacy input.

---

## 8. Export boundary

Export uses one immutable/durable ASA project revision or `ProjectVersion`. It must never
mix current draft JSON with assets from another revision.

Every archive entry is reconstructed from canonical ASA references; physical `objectKey`,
bucket names and credentials never enter the archive.

Exported asset filenames follow Scratch compatibility identity:

```text
{assetId}.{dataFormat}
```

---

## 9. Readiness consequence

`VSCR-M1-007` remains **NO / STOP** until a dedicated package fixes:

```text
exact ZIP library/version
exact limits
exact legacy media normalisation strategy/dependencies
fixture corpus
API/streaming shape
round-trip tests
failure ordering
```

Do not widen `BlocksAssetReferenceV1` as a shortcut.

---

## 10. Done for this D0 step

The architecture now explicitly distinguishes canonical ASA media from historical Scratch
archive compatibility. No `.sb3` production code is authorised by this document.