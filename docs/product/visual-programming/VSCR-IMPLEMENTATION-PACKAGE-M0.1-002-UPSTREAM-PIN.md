# VSCR-M0.1-002 — Normalise Scratch upstream pin to the reviewed release commit

**Status:** coding-ready documentation package; execution still requires explicit task selection  
**Scope:** upstream reproducibility only  
**Host contract:** [`VSCR-D0-001-SCRATCH-HOST-CONTRACT.md`](VSCR-D0-001-SCRATCH-HOST-CONTRACT.md)

---

## 1. Why this task exists

Audit on 10 September 2026 established:

```text
latest published Scratch Editor release: v15.1.1
release tag commit: 99bcc17e0580588f181f8a87577a2f676537a487
current ASA M0 pin: 82c5fea6d3e60c781f25c09b375045f9b46a43f7
```

The current ASA pin is nine commits after the release tag. The inspected release-tag → ASA
pin delta consists of dependency-maintenance changes and does not contain an identified ASA
integration requirement.

Therefore the correct conservative baseline is the official v15.1.1 release commit unless
a separately reviewed requirement proves otherwise.

---

## 2. Goal

Change the exact upstream commit lock from the post-release snapshot to the official
`v15.1.1` release commit while keeping the declared version `15.1.1`.

This task does not build the ASA host and does not change Scratch behaviour intentionally.

---

## 3. Preconditions

```text
blocks remains coming_soon
no learner Blocks data exists
M0 focused Docker build currently succeeds on the old pin
D0-001 current revision has been read
```

Do not combine this task with an upstream version upgrade beyond `15.1.1`.

---

## 4. Expected changed paths

Normally only:

```text
infra/scratch-editor/upstream.env
infra/scratch-editor/README.md
```

The focused workflow may change only if it hard-codes the old SHA rather than reading
`upstream.env`.

Documentation that literally repeats the old SHA may be corrected in the same slice, but
no runtime/API/Project Core/module schema code is authorised.

---

## 5. Exact lock

`infra/scratch-editor/upstream.env` becomes:

```env
SCRATCH_EDITOR_REPOSITORY=https://github.com/scratchfoundation/scratch-editor.git
SCRATCH_EDITOR_COMMIT=99bcc17e0580588f181f8a87577a2f676537a487
SCRATCH_EDITOR_VERSION=15.1.1
```

Do not use:

```text
v15.1.1 as a floating Git ref at build time
develop
main
latest
an npm range
82c5fea... without a new explicit exception decision
```

The release tag may be recorded as provenance in documentation, but build reproducibility
uses the immutable commit SHA.

---

## 6. Docker verification

The existing Docker build must continue to verify:

```text
checked-out HEAD == SCRATCH_EDITOR_COMMIT
root package version == SCRATCH_EDITOR_VERSION
npm ci succeeds
expected M0 build output exists
```

This task does not replace the M0 playground with the production standalone host; that is
owned by `VSCR-M1-002`.

---

## 7. Required verification

Run the exact focused Scratch gate/workflow and prove:

```text
1. repository checks out 99bcc17e0580588f181f8a87577a2f676537a487
2. package version check still reports 15.1.1
3. npm ci/build succeeds from the release commit
4. isolated Docker health/root smoke passes
5. module contract/API typecheck remain green
6. no Scratch dependency enters the ASA Web dependency graph
```

Then run the repository-required gate against the branch rebased/merged with the current
main baseline. A stale branch failure caused by dependencies already fixed in main is not
accepted as final evidence.

---

## 8. Forbidden

```text
no upgrade to 15.2/other release
no arbitrary post-release commit
no package.json dependency edits in ASA
no Project Core changes
no object storage
no host branding patch implementation
no module activation
no deployment
no service restart
no current.yaml transition unless this exact task is selected by governance
```

---

## 9. Done

The source lock is an immutable SHA that is exactly the official `v15.1.1` release commit,
the existing M0 focused build/health gate is green on that SHA, and no unrelated code has
changed.

Stop after evidence; do not continue automatically into `VSCR-M1-002`.