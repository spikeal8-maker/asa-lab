---
task_id: TASK-ELECTRONICS-CLASSROOM-D2-D4-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Existing explicit owner instruction for continuous visible classroom slices
  - Actual D13 native acceptance and integration into main recorded before this selection
  - Fresh main, AGENTS, scoped blockers and overlapping-work checks
acceptance_boundary: slice
review: independent
---

# Classroom D2-D4: three visibly ordered LEDs

**SELECTED AFTER ACCEPTED D13 MAIN; D2 ACCEPTANCE PENDING.** Unique issue
`649`, parent Issue546, programme Issue452; selected at
`2026-10-20T01:57:39.410249+00:00`. Actual accepted D13 main base:
`07563687e9a34cf099849e36a02b8e9b3ef9c4c5`. These acceptance and main facts preceded this canonical selection.
No fresh permission is required: the owner explicitly requested this next slice.

## Original source-only phase: reuse the reviewed source

This section records the original preparation selection. The dated bounded repair
below records the earlier native-publication repair. The final orchestration
amendment now freezes production source again; provenance and all acceptance
criteria remain valid.

Reuse the independently approved five-file derivative based on
`07563687e9a34cf099849e36a02b8e9b3ef9c4c5`. Controller-retained source packet:
`d13/d2-d4-075-preparation-r1/d2-d4-complete-on-075.patch`, SHA256
`f77b19c6348e702242057bba4d800c1c2f7c3db06cbc83061992960c288464e7`.
Manifest: `d13/d2-d4-075-preparation-r1/source-manifest.json`, SHA256
`99b726026eaf47fef33cdfada9df1856e01d0c0a71282debfeee622a2667ca74`.
Independent source-only verdict:
`recon/d2-d4-075-source-review/verdict-source-only.json`, SHA256
`028554aa1ccf318540a5aca13914e5b1ef0db0672d596669e59775cbd47e92e7`.
The exact ready base is SHA256
`2a28051d63529fb2424bd187cd9f38fbc8c802aa7dc111efd12117de4b556771`,
Git blob `4d4d3b43e33ff90f9b747c98cfae3a418f36e119`; the proposed ready is
SHA256 `976d3ed56fb4e4555963dce7021b953b8c25a11480120f71cc2e1cf4af4e4fe9`.
Apply only the two literal-title hooks and EOF insertion onto freshly accepted
D13 source, plus the byte-exact teacher files and selected CI deltas. Never
overwrite a later ready file with the saved full proposal. The retained R26/R27
runtime, accepted D13 clock/native implementation, primary observer a84a5f2f and
its qualification pin stay unchanged. This independent source approval is not
actual D2 browser acceptance. All earlier source drafts and reviews remain saved.

## Concrete visible result and fixed acceptance

Use the existing schema4 fixture: one Uno, three330ohm series resistors,
three red ordinary LEDs, seven components and nine wires. D2/D3/D4 each feeds
its own resistor then LED anode; each cathode returns to Uno GND. Use the five
full simple digitalWrite/delay programmes already present in the lesson:
100/100,200/200,300/300,150/150 and100/300. No bitwise programme is required here.

Observe each joint vector in the full ordered sequence
`100 -> 000 -> 010 -> 000 -> 001 -> 000 -> 100`, where positions are D2,D3,D4.
Require eight complete cycles and49 ordered states, including all-off phases,
for each of seven acquisitions: the five programmes, Reset100/300 and
cookies-only saved reopen100/300. Do not replace sequence equality with a set
of LEDs that appeared somewhere in the trace.

Retain the reviewed exact assertions: monotonically ordered median cycles for
100<150<200<300; ratios to100 in[1.2,1.8] for150,[1.6,2.4] for200,[2.4,3.6]
for300. For each branch, symmetric off/on duty lies in[0.8,1.25]; the100/300
programme lies in[2.4,3.6]. Keep source/generation, H0/startup prefix, physical
current and calculation quality, actual loaded native images, same-model-time
three-channel frames, complete raw records, PNG/video and causality. Startup5s,
Stop1s, raw publication50ms, backlog2 and all accepted D13 bounds stay unchanged.
Apply all five complete source edits through the real editor. D2-local Save R2
observes matching actual PUTs before the first edit, including an already completed
autosave. Require PUT200, finished response, independently intended full circuit,
exact request/response/GET revisions and source; no forced dirty or Save click.
Retain Reset generation transition and cookies-only reopen assertions.

The one common event-history pace remains0.125. Selected finite D2 budgets:
150000ms per acquisition,20000ms for the required native joint vector,
840000ms for the one new case. The seven nominal captures total518400ms;
this is arithmetic, not measured execution. No new timing exceptions, qualifiers,
skips, retries, fitted pace or synthetic visual timer are selected.

## Original source-only phase: exact source scope

- e2e/electronics-ready-cadence.spec.ts
- docs/product/electronics/examples/D2_D4_3x330ohm_red_LED.schematic.json
- docs/product/electronics/lessons/D2_D4_CLASSROOM.md
- docs/execution/current.yaml (this own lane only)
- docs/product/electronics/tasks/TASK-ELECTRONICS-CLASSROOM-D2-D4-001.md
- .github/workflows/electronics-r4-m1-focused.yml (only browser35 to50 minutes)
- tools/test_ci_image_transport.py (only the reviewed D2 browser-budget projection and its fixed-value negatives)

The immediate controller-completion slice has exactly three documents: current,
D13 completion card and this D2 card. It conditionally replaces only the active
D13 acceptance blocker after the external actual controller receipt and new
review; all other blockers remain byte-identical. Owner acceptance of D13 remains
pending until personally given. The accepted tested source reaches main first.
This transition documentation adds no new D2 kernel or qualification change.
The seven-path D2 scope explicitly selects only `jobs.browser.timeout-minutes`
from35 to50 in the focused workflow, plus the reviewed
`d2_classroom_budget_contract` consumer projection and four fixed-value negatives
inside the existing self-test route. The immutable original545 receipt retains35;
the named projection copies that contract and changes only its browser budget.
The existing35min allocation plus the14min D2 case equals49min;50min is a finite
prospective allocation, not a measured completion result. Actual prior D13 job
elapsed time is `26m41s (1601s; 2026-10-20T01:00:04Z to01:26:45Z)`, final recorded selection
`Select browser50min with actual D13 job26m41s and the existing14min D2 case budget; preserve review-images35min and immutable545 receipt via reviewed narrow consumer projection; actual D2 duration remains pending`.
Preserve all other workflow jobs, steps, profiles, images, retries, security and
commands; coordinate fresh shared-path overlaps. The separate review-images job
stays35min. The D13 primary observer, qualification pin, runner and registry are
outside this source change.

## Existing checks, publication and continuation

Preserve the existing focused, benchmark, classroom and General gates exactly;
report the separate strict result for the same SHA honestly. The unchanged full
runner is expected to discover171 cases: all170 previous cases plus the single exact title
`Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen`.
The twelve existing qualification ledgers,42 core entries and11 discoveries keep
their registry and assertions; the new case uses its existing dedicated D2 ledger.
No new qualification profile or new gate is introduced. Strict discovery of all
171 cases is now observed in the run below; full classroom171 remains pending.
Original preparation and source-only review did not run the browser.

Keep source author and independent reviewer separate. Before accepted integration,
retain native evidence from the built editor and actual exact-source CI; verify
the coherent final source through the repository's existing permitted main route.
The original source-only phase required actual evidence before selecting a
product repair. The dated observation below now supplies that evidence.

Record the observed BEFORE honestly (now recorded below), the complete
AFTER joint-state/native result (`pending - not yet observed/accepted`), exact source SHA,
review, CI and actual main SHA in this task. No completed D2 runtime/browser/main outcome is
claimed by this selection. A source-only unit result is insufficient.
After acceptance, integrate this useful slice without waiting for later indicators
and continue D0-D13 and all ordinary LED colours in their own visible slices.
Issue546's full-realtime boundary and hygiene history remain intact. Main
integration and school deployment are separate; this selection performs no
installation, DB, Docker, network or protected-data operation.

## Historical bounded native publication repair selected 2026-10-20

The owner explicitly requested completing Electronics through checked publication
to `main`. At `2026-10-20T11:17:28Z`, GitHub main was
`16cbed5d981989528f2d1bd8f62e2a1c4063781f`; draft PR652 was open at
`d0b0f4259f4dd3f62bfed71d3a72571a0d2547ec`. This selection is prospective:
publish these two selection documents on main before product writes, then inherit
that canonical selection in the candidate branch. It does not accept the repair.

### Actual BEFORE and one required result

Exact-source strict run `39399518741`, browser job `118551800881`, discovered
171 cases and finished `160 PASS / 11 FAIL`; all five D13 cases passed. The D2
case failed its unchanged temporal-paint causality assertion. Independent replay
of artifact `12256121930` reproduced two stable all-off native frames after the
matching physical HIGH witness: D2 `64.6 ms` and D4 `65.7 ms`, above `50 ms`.
The exact mounted HIGH images first loaded after `70.7 ms` and `69.1 ms`,
respectively. Source/generation matched; the record reported no Worker errors or
reanchors. These are observed native publication failures. Cold loading alone is
not established as the complete cause of every delay.

Required result: publish the actual joint D2/D3/D4 native vector from accepted
physical history within the existing deadline, including first use, while
preserving all seven acquisitions and the complete lifecycle contract. Preparing
real mounted images earlier from already solved history is permitted; preparation
must not itself publish a state, acknowledge a display frame or advance its
cursor. Detached-image decoding cannot substitute for a mounted native lease.

### Exact bounded runtime scope

Primary component: `electronics.ui.workbench`. Additional selected source paths:

- `apps/web/src/electronics/led-temporal-presentation.ts`
- `apps/web/src/electronics/use-electronics-workbench.ts`
- `apps/web/src/electronics/ProductionComponentVisual.tsx` (only if required for actual mounted readiness)
- `apps/web/src/electronics/testing/led-temporal-presentation.spec.ts`
- `apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts`
- `apps/web/src/electronics/testing/asset-recovery.spec.ts` (only if its renderer boundary changes)

Three focused specs are prospectively justified by three distinct boundaries:
accepted-history presentation, host lifecycle and real mounted-node readiness.
Use only the ones needed by the implemented repair. The existing five D2 source
files remain selected; their fixed assertions, qualification contract and finite
budgets must not be weakened. Preserve the original source-only review as history;
obtain new independent review of every changed runtime path and the final evidence.

Keep the common pace `0.125`, `6250 us` lookahead cap, raw `50 ms` publication,
backlog `2`, startup `5 s`, Stop `1 s`, source/generation isolation, same-model-time
joint commits, fail-closed native leases, rollback, Reset and saved reopen.
Keep all 171 cases, the immutable observer/qualification pin, required
`classroom-d13-v3`, and separately reported strict outcome. No scheduler/kernel,
Portal, PR651, owner SVG, infrastructure, working-data or deployment change is
selected. Preserve every foreign lane and acceptance blocker.

### Verification and stop boundary

Source author and independent reviewer remain separate. Run scoped preflight and
Electronics task validation, meaningful focused regressions, existing focused and
benchmark gates, full classroom171 with native evidence, separately reported
strict, and the unchanged General gate on the final source. General run
`39399518744` failed in four Portal participants PG timeouts also observed on
main `16cbed5d` in run `39373841387`; that foreign baseline is recorded separately
and is not permission to weaken General or repair Portal inside this task.

The author stops after this bounded repair and its evidence. The controller
continues independent acceptance and authorized normal integration to main.
AFTER source/native/CI/main results remain pending until actually obtained.
`ELECTRONICS-CLASSROOM-D2-D4-ACCEPTANCE` remains active until those criteria are
satisfied. D13 owner acceptance and Issue546 full-realtime work remain separate.


## Active test-only orchestration amendment, 2026-10-20

Prospective controller choice under the existing owner mandate, Issue649 and
programme452: publish this amendment on main before any test-source writes.
Compose retained draft PR652 `24c4acf6c369ba695bf74684ec1bd7f26a70266b`
(branch `codex/electronics-classroom-d2-d4-649`) forward with fresh accepted main;
observed base `cdb3fdecdcbf8ff771d88253db73105a65a902cf`. Preserve original
source, reviews, failures, attempt counters and budgets; no force or reset.
This supersedes earlier runtime write permission. The existing production
implementation, fixtures, lesson, workflows, helper APIs and observer pin are
frozen. The only new code change is the D2 subsection of
`e2e/electronics-ready-cadence.spec.ts`; controller changes are this card and its
own lane in `docs/execution/current.yaml`. No product semantics change is selected.

### Actual historical evidence, not AFTER acceptance

Run `39422409394`, original artifact `12266831251`, on exact24c timed out at
`840 s`. Verified read-only transport `39444735624` / compact artifact
`12275550889` produced ZIP SHA256
`e2c9f8d65d569e78571de69331728b5602b947b0f5d9639c21d6343a4e8128ad`.
Its ledger records four completed captures100/100,200/200,300/300,150/150:
`40.0235 / 77.5756 / 132.4755 / 61.5719 s`, total `311.6465 s`, each eight
cycles,49 ordered states plus startup, backlog1 and no recorded causal violations.
Five real autosaves advanced revisions2 through7 with full intended circuit and
request/response/GET proof; seven historical native PNGs cover the required joint
vectors. The fifth100/300 capture, Reset and reopen were not completed. HTTP
response durations `32.641–202.340 ms` are not measurements of entire autosave
waits. Nominal captures518.4s plus a five-times60s save-wait estimate total818.4s
before other work; those wait estimates are not measured delays. This arithmetic
motivates orchestration, but does not prove
the cause of every measured pause. Historical partial evidence is never a live
AFTER result or a PASS declaration.

### One bounded repair, unchanged scenario and assertions

1. Arm actual response observation before each real edit, then overlap each
   of the five existing autosave-check waits with its corresponding real capture. Every unchanged
   PUT200/finished-response/full intended request/response/GET/source/revision
   assertion must finish before the next edit or cookies-only reopen. No forced
   dirty state, Save click, omitted save or acceptance of a pending promise.
2. Acquire the same seven native PNGs during the300/300 capture after the needed
   real LOW/HIGH references exist. Preserve actual loaded native images,
   same-generation joint frames, physical and temporal witnesses and every
   native assertion; do not replace them with older transport images.
3. At each acquisition, record a cheap explicit terminal boundary with indices,
   time and generation once the unchanged49-state/eight-cycle conditions pass.
   Preserve the six existing Stop boundaries: first four programmes, Reset
   capture and reopened capture. Invoke Stop immediately at those boundaries,
   retaining the active observer and unchanged1s all-off proof. Fifth100/300
   remains uninterrupted Run→Reset exactly as24c: freeze its acquisition boundary
   before Reset, preserving the new-generation/H0 flow. This is preservation of
   the accepted scenario, not an extra Stop or a relaxed lifecycle requirement.
4. Export one full frozen raw record per capture after its lifecycle boundary
   and run the existing full checks offline against its explicit closed
   acquisition window. Preserve every required worker/UI/paint/temporal record,
   including late, Stop and Reset rows. Never clear, cap, truncate or drop raw
   arrays. Window selection must not discard any causal violation within that
   window. No observer pin, helper API semantics or assertion changes.

All seven captures,49 ordered states/eight cycles each, five actual saves,
Reset/reopen, seven native PNGs and complete raw evidence remain mandatory.
Keep171 cases,50ms publication,150s acquisition,20s native-vector and840s case
budgets, pace0.125,6250us cap,backlog2,start5s,Stop1s and every existing ratio,
duty, quality and causality assertion. No retry, skip, qualifier or budget reset.

### Actors, gates and stop

Root assigns `/root/d2_source_review` as the sole test author, only after his
FET smoke STOP and canonical main publication. `/root/fet_runtime_author`, who
has not authored D2, independently reviews source and evidence; root integrates.
Fresh fetch main, scoped preflight and overlap checks precede writes. Preserve
all foreign lanes, accepted D13 history, old R27 stop/resume rule and every
acceptance blocker; this does not accept Issue546, PR651 or D2.

Required checks remain unchanged: task validation, meaningful focused regression,
`pnpm gate:electronics-m1`, `pnpm benchmark:electronics:ci`, full
`pnpm gate:electronics-classroom-d13-v3:browser`, separate exact-source
`pnpm gate:electronics-m1:browser` strict report, and General
`pnpm gate:repository`. Require fresh complete exact-source native/browser
AFTER evidence and independent acceptance, not historical partial results.
The author stops after the bounded change and evidence. Root may update PR652
by ordinary forward composition after review and gates; main integration and
owner acceptance remain pending. No deployment, working DB or infrastructure
operation is selected.
