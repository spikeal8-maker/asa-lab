# VSCR-M0.1-002 — Scratch upstream pin provenance review

**Status:** REVIEW COMPLETE — current pin retained; no code/config change required  
**Scope:** upstream reproducibility and provenance only  
**Host contract:** [`VSCR-D0-001-SCRATCH-HOST-CONTRACT.md`](VSCR-D0-001-SCRATCH-HOST-CONTRACT.md)

---

## 1. Why this review exists

The 10 September 2026 audit established two different immutable revisions associated with
the declared Scratch Editor version `15.1.1`:

```text
official v15.1.1 release tag commit
  99bcc17e0580588f181f8a87577a2f676537a487

current ASA M0 pin
  82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The second revision is nine upstream commits after the release tag. Calling it the
"v15.1.1 release commit" would therefore be inaccurate, but changing it merely to make the
SHA equal the tag would also be unjustified without inspecting the delta.

This review resolves that ambiguity before M1 host work.

---

## 2. Evidence reviewed

GitHub compare for:

```text
99bcc17e0580588f181f8a87577a2f676537a487
...
82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

shows:

```text
ahead_by: 9
source-code files changed: 0
changed files: package-lock.json + package manifests only
```

The nine upstream commits are:

```text
b5be4a3 fix(deps): update scratch-l10n to v6.1.112
01ef390 style(deps): update eslint-config-scratch to v14.1.62
cdd2a10 chore(deps): update unplugin-dts to v1.1.0
d933a9a chore(deps): update jest to v30.5.1
a2b34a9 style(deps): update eslint-config-scratch to v14.1.64
d4eb487 style(deps): update eslint-config-scratch to v14.1.65
320c5e9 chore(deps): update tap to v21.8.0
0c78f15 style(deps): update eslint-config-scratch to v14.1.66
82c5fea chore(deps): update playwright monorepo to v1.63.0
```

Eight are build/test/style dependency maintenance. `scratch-l10n 6.1.112` is the only
runtime-facing dependency change in the inspected manifest delta; it is an upstream
localisation dependency update, not a Scratch editor source patch.

The existing ASA M0 Docker build already verifies the exact current SHA and package version
and the current pin has passed the pinned-image/health smoke.

---

## 3. Decision

**Retain the current immutable ASA pin:**

```env
SCRATCH_EDITOR_REPOSITORY=https://github.com/scratchfoundation/scratch-editor.git
SCRATCH_EDITOR_COMMIT=82c5fea6d3e60c781f25c09b375045f9b46a43f7
SCRATCH_EDITOR_VERSION=15.1.1
```

Do **not** roll back to `99bcc17...` solely because it is the tag commit.

The correct provenance wording is:

```text
Scratch Editor package version: 15.1.1
ASA exact pin: 82c5fea...
provenance: reviewed post-release snapshot, nine dependency-maintenance commits after v15.1.1
source-code delta from v15.1.1 tag: none in the reviewed compare
```

This is intentionally different from saying that `82c5fea...` *is* the release-tag commit.

---

## 4. Reproducibility rule

Builds continue to use an immutable commit SHA, never a floating ref:

```text
allowed: exact reviewed SHA
forbidden: develop / main / latest / mutable tag-only checkout / npm range
```

`SCRATCH_EDITOR_VERSION` remains an independent package-version assertion. The Docker build
must continue to fail if either the Git SHA or package version differs from the declared
lock.

---

## 5. Future upstream updates

A future pin change is a new reviewed change, not an automatic Renovate-style movement in
ASA.

For every candidate pin:

```text
1. identify nearest official Scratch release/tag
2. compare exact tag SHA -> candidate SHA
3. enumerate changed source files and dependency manifests
4. review runtime-facing dependency changes
5. review license/trademark-relevant changes
6. verify D0-001 integration coupling/patch contexts
7. build exact Docker image
8. run browser/runtime compatibility evidence
9. record exact accepted SHA and provenance
```

If a candidate contains source-code changes after the nearest release tag, the review must
name why ASA needs them. "Newer" is not sufficient.

---

## 6. Effect on milestone readiness

This review removes the **upstream-provenance blocker** from `VSCR-M1-002`.

It does **not** make M1-002 coding-ready by itself. M1-002 still requires its exact task
package to be amended/accepted against the current D0-001 branding/File/Extensions patch
ledger and must start from a branch reconciled with current `main`.

`infra/scratch-editor/upstream.env` therefore requires no change from this review.

---

## 7. Forbidden interpretations

```text
NO claim that 82c5fea is the official v15.1.1 tag commit
NO automatic rollback to 99bcc17
NO automatic movement to a newer upstream commit
NO Scratch dependency added to apps/web
NO host implementation in this review
NO Project Core/storage/security work
NO activation/deployment/restart
```

---

## 8. Done

The provenance ambiguity is resolved when documentation consistently identifies
`82c5fea...` as the reviewed post-release `15.1.1` snapshot, the exact lock remains
immutable, and later host work no longer depends on a cosmetic rollback to the release-tag
SHA.

**Review result: COMPLETE. Current pin retained.**