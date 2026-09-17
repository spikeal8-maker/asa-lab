# VSCR-D0-008 — Autosave, preview and optimisation contract

**Status:** accepted design contract for M1-006 and future M2 project-card work  
**Master:** [`../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md)

This contract turns autosave/preview/optimisation into measurable behaviour. It does
not authorise coding by itself; `docs/execution/current.yaml` remains execution authority.

---

## 1. Reuse the repository optimisation policy

Scratch MUST use [`REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`](../../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md).

Mandatory cadence for this runtime/media-heavy lane:

```text
every bounded change                  → L0 Change Hygiene
every accepted bounded Scratch slice → L1 Slice Cleanup
every 2 accepted Scratch slices       → L2 Iteration Hygiene Gate
milestone/release/owner acceptance    → L3 Release / Owner-Acceptance Audit
```

Event triggers may require L2 earlier. A bot MUST NOT reset the counter by renaming work
or splitting one result into cosmetic PRs.

---

## 2. Four evidence passes for save/autosave/preview work

Every bounded persistence/autosave/preview slice records four passes:

```text
P0 baseline     → exact requests/bytes/latency/storage growth before change
P1 correctness  → durability, retry, conflict, negative paths
P2 optimisation → batching, dedup, cache, streaming, no-op behaviour
P3 regression   → focused tests, hygiene and before/after evidence
```

P0–P3 are evidence passes inside L0/L1 and do not create a second hygiene counter.

---

## 3. Autosave execution contract

M1-005 establishes explicit durable save/open first. M1-006 adds autosave.
Full project snapshots MUST NOT be transmitted on every Scratch editor action.

```text
VM mutation
→ increment local dirty generation
→ debounce/batch changes
→ normal cadence stays inside the platform 5–15 s active-editing window
→ serialise only when a save/checkpoint is due
→ unchanged canonical fingerprint: no remote draft write
→ ensure only changed/unknown assets are durable
→ one draft PUT
→ confirm revision/fingerprint
→ newer generation, if any, is scheduled next
```

Only one draft PUT may be in flight per editor. The pending queue keeps the newest
generation, not an unbounded list of full snapshots.

---

## 4. Retry, exit and local recovery

Lost response/network retry reuses the same mutationId for the same serialised
generation. A changed VM generation gets a new mutationId.

Page hide/route exit may request an immediate best-effort flush. Browser/process
termination is not a durability guarantee; local recovery keeps the newest unconfirmed
generation until the server confirms an equal/newer state.

On revision conflict remote autosave stops, local recovery stays, current server
metadata is loaded, conflict is shown and no guessed baseRevision is used.

---

## 5. Asset optimisation rules

Canonical Scratch assets are exact compatibility bytes. Do not recompress, resize,
transcode or otherwise rewrite canonical PNG/JPG/SVG/WAV/MP3 bytes in place.

Required optimisation boundary:

```text
tenant-local SHA-256 dedup
immutable alias reuse
streamed upload/download
authoritative DB metadata reuse
private immutable cache only with proven auth semantics
derived preview media stored separately from canonical Scratch assets
```

---

## 6. Automatic draft preview

The owner-facing project card gets an automatic preview representing confirmed durable work.

```text
source = confirmed draft/checkpoint revision
capture = Scratch stage, not editor chrome
generation = asynchronous after successful durable save/checkpoint
coalescing = newer confirmed revision may supersede queued older preview work
failure = keep previous confirmed preview; do not roll back project save
metadata = record source project/revision and generation timestamp
```

Autosave MUST NOT synchronously block on preview processing. Preview is derived media
and never appears in `BlocksProjectDocumentV1.assets[]`.

---

## 7. Preview and card media optimisation

Follow repository image hygiene:

```text
do not use/store a 4K image for a small card without another consumer
generate a card-sized derived variant
normal HiDPI target ≈ 1.5–2× actual CSS display size
avoid duplicate identical preview objects for unchanged source revision/frame
lazy/deferred load offscreen cards where the product shell supports it
```

Exact format/dimensions are selected by the implementation task from current ASA media
primitives and measured browser evidence; no Scratch-specific media backend is allowed.

---

## 8. Publication cover is not draft preview

```text
automatic draft preview → owner-facing current-work card
publication cover        → explicit Gallery/publication metadata
```

The owner can select/capture a stage frame for publication cover. If no manual cover is
set, publication may initialise it once from the confirmed preview for the exact
published version. Later autosave MUST NOT replace that cover.

Changing cover does not change executable `project_version_id`.

---

## 9. Publication card metadata and engagement boundary

Future M2 cards support at least:

```text
title
description / instructions
notes / credits
cover
privacy-safe author label
published_at
exact project_version_id
like count
view count
remix count
```

Likes are authenticated idempotent reactions, one active like per principal/publication.
Views are aggregate analytics/projection, never auth/billing/project truth. Remix count
follows immutable remix/provenance records. Metadata/counter edits never mutate the
published executable version.

---

## 10. Performance budgets

Use `docs/architecture/CAPACITY_AND_SLO.md`. Relevant current targets:

```text
API write P95                    ≤ 700 ms
Project metadata save P95       ≤ 700 ms
Durable checkpoint P95 typical  ≤ 1.5 s
Save error rate                 < 0.1%
Active-edit batching window      5–15 s
```

These are system targets, not claims about an unmeasured developer machine.

---

## 11. Storage growth evidence

For every accepted persistence/autosave slice record new unique bytes, reused/deduped
bytes, blob/alias row delta, observable orphan delta, preview byte/object delta and draft
revision delta.

An unchanged repeated save must produce:

```text
0 new unique asset bytes
0 new blob rows
0 new alias rows
0 redundant draft revision
```

---

## 12. Generated files and Git hygiene

Runtime previews, screenshots, traces, profiles and benchmark outputs are runtime/CI
artifacts by default, not source files. User project/media belongs in object storage,
not Git history. Repository binary thresholds remain authoritative.

---

## 13. Milestone mapping

```text
M1-005 → explicit durable save/open
M1-006 → autosave + recovery + conflict + automatic draft preview
M1-007 → safe ASA .sb3 import/export
M2     → cards + manual cover + metadata + engagement + player/remix
```

---

## 14. Acceptance gate

M1-006 autosave/preview is not accepted until evidence proves:

```text
1. no full snapshot is sent for every editor action
2. only one remote draft save is in flight per editor
3. edits during save coalesce to newest generation
4. identical fingerprint creates no new revision
5. unchanged assets create no new unique bytes
6. lost response retry reuses mutationId
7. conflict never silently overwrites
8. local recovery survives reconnect/browser restart for unconfirmed state
9. confirmed save survives close/open/new browser
10. automatic draft preview references a confirmed revision/checkpoint
11. preview failure does not turn durable save into failure
12. preview work is throttled/coalesced, not generated on every action
13. P0/P1/P2/P3 evidence is recorded
14. L1 is complete and Scratch hygiene counter is updated
15. applicable SLO/load evidence is recorded without unsupported claims
```

M2 additionally proves that manual cover is not overwritten by autosave, metadata
changes do not mutate the executable version, engagement counters keep their defined
semantics and card media passes optimisation evidence.
