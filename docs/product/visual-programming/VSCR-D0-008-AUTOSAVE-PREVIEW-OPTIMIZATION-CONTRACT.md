# VSCR-D0-008 — Autosave, preview and optimisation contract

**Revision:** 1.1  
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

### 3.1. Client save state machine

The UI/runtime state must be explicit rather than inferred from button state:

```text
clean
dirty
saving
saved
offline_pending
retry_wait
conflict
recovery_available
fatal_error
```

Transitions are driven by confirmed server/recovery events. The UI MUST NOT display
`saved` merely because serialization finished or a request was queued.

There is no permanent bottom status bar. Save state may appear in the existing
editor chrome/account area as a compact status and becomes prominent only for
offline, conflict, recovery or fatal error.

### 3.2. Classroom load shaping

Hundreds of editors opened in one lesson MUST NOT synchronize their autosave bursts.

Within the normal 5–15 s active-editing window the client applies bounded randomized
jitter. Exact distribution is fixed by the M1-006 task after browser/load evidence.

Retry policy:

```text
network / 5xx / retryable dependency error
→ exponential backoff with bounded jitter
→ respect Retry-After when present
→ keep only newest pending generation

validation / authorization / conflict error
→ no blind automatic retry
→ enter explicit error/conflict flow
```

Reconnect MUST NOT trigger every queued historical generation. Reconnect sends the newest
recoverable generation after current authority/revision is re-established.

---

## 4. Retry, exit and local recovery

Lost response/network retry reuses the same mutationId for the same serialised
generation. A changed VM generation gets a new mutationId.

Page hide/route exit may request an immediate best-effort flush. Browser/process
termination is not a durability guarantee; local recovery keeps the newest unconfirmed
generation until the server confirms an equal/newer state.

On revision conflict remote autosave stops, local recovery stays, current server
metadata is loaded, conflict is shown and no guessed baseRevision is used.

### 4.1. Recovery-store minimum contract

Project recovery payloads MUST use an origin-scoped structured browser store such as
IndexedDB. `localStorage` and `sessionStorage` are forbidden for project payloads.

Every recovery record is keyed/bound by at least:

```text
principal identity
tenant/workspace identity
projectId
baseRevision
dirty generation
document fingerprint
createdAt / updatedAt
```

Runtime capability/JWT, object-store credentials and session secrets are never persisted
inside recovery records.

The implementation task MUST choose and test explicit finite TTL/quota values before coding
is accepted. Recovery data is purged after a confirmed equal/newer server save and on
logout/account switch according to the selected privacy policy. Shared-school-computer
tests are mandatory.

If quota/storage write fails, the editor reports degraded recovery; it MUST NOT claim that
the unconfirmed work is protected.

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

### 6.1. Preview must match one durable generation

A preview may be captured from the stage while the matching generation is still local,
but it becomes the current server preview only after that exact generation/revision is
confirmed durable.

Required binding:

```text
projectId
sourceRevision
sourceDocumentFingerprint
capture generation
preview object identity
createdAt
```

If generation N saves successfully and generation N+1 is already dirty, preview N may
still be committed as the latest confirmed preview; preview N+1 replaces it only after
N+1 becomes durable. A failed save MUST NOT publish the frame of failed/unconfirmed work
as if it were durable.

### 6.2. Preview scheduling

Preview generation is coalesced separately from autosave:

```text
confirmed save N
→ preview job N queued

confirmed save N+1 before N renders
→ N may be dropped
→ render newest confirmed generation

same source revision/fingerprint/frame identity
→ no duplicate preview object
```

There is at most one active preview job and one newest pending preview generation per
project/editor context.

---

## 7. Preview and card media optimisation

Follow repository image hygiene:

```text
capture the Scratch stage aspect, not editor chrome
do not use/store a 4K image for a small card without another consumer
generate a card-sized derived variant
normal HiDPI target ≈ 1.5–2× actual CSS display size
avoid duplicate identical preview objects for unchanged source revision/frame
lazy/deferred load offscreen cards where the product shell supports it
```

The Scratch stage logical aspect ratio is preserved. Exact encoded format and derived
dimensions are selected by the implementation task from current ASA media primitives and
measured browser evidence; no Scratch-specific media backend is allowed.

Preview evidence records:

```text
source revision/fingerprint
capture dimensions
derived dimensions
encoded bytes
generation latency
card-load bytes/request count
```

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

A cover operation is explicit and auditable enough to identify the target publication and
source project/version evidence. It cannot silently point at a newer mutable draft.

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

Descriptions/instructions/credits use an existing ASA text/markup primitive when available.
Raw unsanitized HTML is forbidden.

Likes are authenticated idempotent reactions, one active like per principal/publication.
A toggle/unlike reverses that principal's active reaction without rewriting project history.

Views are aggregate analytics/projection, never auth/billing/project truth. Rendering a
card in a gallery list MUST NOT itself count as a view. A view is recorded only by the
future explicit published-project/player open flow, with normal abuse/rate controls.

Remix count follows immutable remix/provenance records. Metadata/counter edits never mutate
the published executable version.

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

### 10.1. Required benchmark scenarios

M1-006 evidence includes at least:

```text
A. unchanged project: repeated autosave ticks
B. blocks-only edits: project JSON changes, no new asset bytes
C. one new costume/image
D. one new sound
E. rapid edit burst while one save is in flight
F. weak network / lost response / reconnect
G. object-storage delay/failure
H. two-tab revision conflict
I. classroom burst profile with jitter enabled
J. close/reopen/new browser recovery path
```

Every scenario reports the environment/profile and measured request count, bytes, latency
and revision/storage deltas that apply. No percentage improvement claim is accepted without
the same fixture/profile before and after.

---

## 11. Storage growth evidence

For every accepted persistence/autosave slice record:

```text
submitted asset bytes
new unique asset bytes
deduplicated/reused bytes
blob row delta
alias row delta
observable orphan candidate delta
preview object/byte delta
draft revision delta
object-store request count
```

An unchanged repeated save must produce:

```text
0 new unique asset bytes
0 new blob rows
0 new alias rows
0 redundant draft revision
```

A blocks-only editing session may create draft revisions but MUST create zero asset-storage
growth unless the serialized Scratch state actually introduces different asset bytes.

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

M1-006 MUST NOT opportunistically implement public likes/views/remix. M2 MUST NOT invent a
second save backend or publish mutable drafts.

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
7. retry uses bounded backoff/jitter and does not storm on reconnect
8. conflict never silently overwrites
9. local recovery survives reconnect/browser restart for unconfirmed state
10. recovery store is identity/project isolated, finite and contains no capability secrets
11. confirmed save survives close/open/new browser
12. automatic draft preview references the exact confirmed revision/fingerprint
13. failed/unconfirmed generation cannot become the durable preview
14. preview failure does not turn durable save into failure
15. preview work is throttled/coalesced, not generated on every action
16. classroom burst evidence shows save jitter rather than synchronized spikes
17. P0/P1/P2/P3 evidence is recorded
18. L1 is complete and Scratch hygiene counter is updated
19. applicable SLO/load evidence is recorded without unsupported claims
20. no permanent bottom save-status panel is introduced
```

M2 additionally proves:

```text
manual cover is not overwritten by autosave
cover is bound to explicit publication/version evidence
metadata changes do not mutate the executable version
gallery-card render alone does not increment view count
likes are idempotent per principal/publication
remix count follows immutable provenance
card media passes optimisation evidence
```
