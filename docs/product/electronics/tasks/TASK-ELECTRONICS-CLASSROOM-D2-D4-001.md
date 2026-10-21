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
implementation, fixtures, lesson, workflows, global observer APIs and pin are
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
4. Use lossless capture-and-rotate only in the existing D2-local helper wrappers.
   The global immutable probe has11 push-only arrays and no clear API; leave its
   implementation, pin and API unchanged. In ONE synchronous `page.evaluate`,
   clone ALL11 arrays completely before the existing local `length = 0`
   operations, with no await/callback interleave in that JavaScript turn. Keep
   the clone private, immutable and pending with absolute offsets, counts, time,
   generation and cutoff manifest. Later records append to active buffers.
   Block another rotation until Node writes the FULL clone and verifies readback
   SHA, counts and contiguous coverage, then ACK. ACK deletes ONLY the pending
   clone, never the active tail. On failure STOP with no acceptance or lossy
   fallback. Never drop/cap/truncate raw data or reset an unarchived buffer.
5. Preserve ALL in-window causal rows for existing offline checks against explicit
   closed acquisition windows; no filtering of causal violations. Archive every
   late/Stop/Reset row through an explicit final observation cutoff. Report any
   tail after that cutoff as NOT observed; do not claim context-complete capture.
   Clone mutable `paintRuns` before clearing: a new segment may split one vector
   run, so document segment splits and full `paintFrames`/`witnessAt` coverage,
   without pretending run indices describe one globally unsplit stream.
6. Fifth100/300 Run→Reset remains uninterrupted, with no heavy clone or
   serialization between them. After Reset's existing Stop, archive fifth and
   Reset together as two explicit acquisition windows sharing one complete
   contiguous segment. Six archive groups for seven captures are permitted;
   do not create seven duplicated cumulative exports. All six existing Stops
   and their active-observer1s checks remain unchanged.

### Bounded memory clarification, 2026-10-20

Historical150/150 raw export is159332055 bytes for61.5719s. Extrapolating seven
nominal acquisitions gives approximately1.34GB serialized: an estimate, NOT
measured heap or proof of a performance cause. The earlier literal ban on clearing
arrays and one-export-per-capture wording is superseded ONLY by the atomic
capture-before-clear/verified-ACK protocol above. Complete lossless evidence is
still mandatory; no observer or product semantics change is selected. Actual
memory/performance improvement remains unproven. Publish this two-document
clarification on main and obtain independent review before this code delta.

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


## 2026-10-20 — bounded LED publication follow-up

Owner authorizes a clean-tree LED publication slice while preserving PR652 and
its retained24c4acf source. The owner explicitly grants the narrow exception for
WAITING_HANDOFF on teacher-pr582-redesign/.github/workflows/classroom-owner.yml;
that foreign file and checkout remain untouched. Preflight stays enabled and
its WAITING_HANDOFF output is retained, not relabelled SAFE_TO_START. The stopped
D13 author has been handed off by the owner; its dirty checkout is not rewritten
or used as a source of uncommitted changes.

This single bounded LED repair supersedes the earlier orchestration-only
production freeze only as follows. First prove the actual-presenter BEFORE:
H0 native/layout ACK at wall0; same-generation HIGH receipt at wall1ms with
edge537us/window6250us; RAF40/80/120ms. Predicted null/null/HIGH means119ms,
but this prediction is not yet executed evidence. A NEW independent proposal
review must confirm that H0/native ACK remains preserved. Only if that review
and discriminating BEFORE both succeed, permit canPublishDistinctFrame threshold
>2 to >0 plus targeted regressions: same RAF blocked, next RAF allowed, H0 held
without ACK, Reset, foreign generation and joint frame. No separate canonical
selection cycle is required for this exact conditional repair. If the regression
does not distinguish the cause, use passive receipt/preparation/React/RAF/ACK
instrumentation instead; do not guess a fix or rerun unchanged CI hopefully.

The saved case200 generation3 first HIGH is64915.7, DOM65052.7 and paint65075.4;
the asset was already warm. These observations alone do not prove the barrier
is the sole cause. Source: GitHub run39455455432/artifact12283505079 selected-member receipts
(not whole-ZIP digest verification), local receipt
Temp/asa-39455455432-range/REPORT.txt. Blockly1ms
delta375.7315ms versus250ms remains separately unresolved, not repaired or waived.

Root assigns one led_publication_repair_author and NEW independent reviewers
who did not author this change. Publish canonical selection on main before
product writes. Require the proposal review above, then independent exact-SHA
source/evidence review and unchanged gates before integration. No core, physics,
pace, timeout, workflow, renderer, asset, dependency or infrastructure changes.

Preserve all171 scenarios,50ms publication,pace0.125,6250us cap, existing budgets,
archive protocol and full raw evidence, all required focused/benchmark/classroom/
strict/general gates, histories and acceptance blockers. No old source approval,
partial browser run or this document amendment grants integration, acceptance,
Issue closure, release or deployment. The author stops after its one stage and
review handoff; root retains responsibility for subsequent selection.


## 2026-10-20 — necessary private-field composition-budget repair

The completed focused job118871744009 on the exact914 candidate reports the
SchematicEditor bundle at218.32kB against the unchanged218000-byte cap. The log
does not provide exact bytes. Local receipt:
Temp/asa-led-914-ci/strict-focused.log, SHA256
fd424864e82e4efec1e8c2f57ba69beb54d70d8028e9d200d5bbe731d98ef44c.
This is a necessary composition-budget repair within649, not general cleanup.
Canonical amendment base is main13ab3635587a201bc2cc78e88b9a9f66fce72102;
product branches do not authorize themselves.

Root selects ONLY six private-field renames and their internal references in
LedTemporalPresentation: presentedFrame→shown, pendingFrame→pending,
animationFrame→raf, committedAnimationFrame→ackRaf,
indicatorHistories→indicators and frameSequence→sequence. This explicitly extends
the earlier threshold-only scope solely for this proved composition failure.
Preserve the existing >0 publication repair. Public keys, getters and returned
frame objects remain unchanged. No algorithm, physics, pacing, precision, native
lease, ACK, Reset, workflow, dependency, foreign-source or budget-threshold change.

After canonical main publication, led_publication_repair_author implements this
one bounded change. Prove there are no external repository references; require
AST equivalence modulo these six private renames, all100 presenter tests,
targeted types and a production Vite bundle at most218000 bytes before main
integration, verified by exact file bytes or a proved UTF-8 Vite upper bound
below the cap. Branch publication for required CI remains permitted. The approximate384-byte source reduction is not bundle evidence.
Root assigns a NEW independent reviewer after exact source freeze. Preserve all
previous gates, histories, blockers, teacher exception and stopped D13 handoff;
this amendment grants no product acceptance, release, deployment or Issue closure.


## 2026-10-21 — committed-horizon repair and original real-time goal

This amendment supersedes the preceding completed private-field authoring step
only for the following bounded repair. Canonical selection base is
main7d4b00b74094076676b2af82dd0226ec24cc72aa. PR652 source was integrated at
628a5b5a999998b008e18e5ab61e843cb5d8b25b by explicit owner instruction; it is
not technical or owner acceptance. The final classroom result is220PASS18FAIL;
strict is211PASS27FAIL. The actual production bundle is217938 bytes against the
unchanged218000-byte cap. Preserve exact-source run/raw bindings and all failures.

The final D2 failure is the Reset pre-H0 oracle. It does not by itself prove a
product publication lag above50ms. A separate read-only raw intake must establish
the lifecycle/oracle cause before selecting any related repair. The earlier
case200 latency receipt remains historical and must not be substituted for this
final failure. Neither failure is waived or accepted by this amendment.

The owner has resumed the original Issue546 goal: real-time Arduino and visibly
correct LED output. The common0.125 pace above is a versioned intermediate
classroom boundary, not full-real-time acceptance. Preserve it and the6250us
lookahead during this selected repair; changing a pace constant without proved
compute headroom is not a solution. Historical classroom approvals do not accept
2000/100/50/1ms real-time, independent ports, Reset or the complete original goal.

Select ONE bounded host/controller repair: suppress unjustified requests for an
already committed horizon. The saved Blockly1ms trace contains149 such requests
among602, with627.6ms compute and1463.5ms roundtrip. These are a measured causal
input, not proof that deduplication alone will achieve1x or fix every failure.
One NEW author assigned by root owns only use-electronics-workbench.ts,
live-simulation-worker-controller.ts and their existing clock/controller tests.
Do not change presenter, solver, interpreter, physics, workflow, assets or
foreign modules. Preserve legitimate yielded continuation, initial H0, pending
inputs, same-horizon lifecycle work, source/document/generation identity and
all canonical Arduino, capacitor, heat, damage and other runtime state.

Require a discriminating regression, complete result/state preservation and
saved-sequence before/after request counts, reached model time and compute/elapsed
evidence. No incomplete/yielded result may become a ready electrical frame.
Native readiness, joint LED history and ACK, independent ports, Reset, Stop,
cancellation and stale/failure handling remain mandatory. Keep all existing
50ms/timing/precision/assertion bounds and required gates; do not rerun unchanged
heavy suites hoping for success. Root reviews the actual bounded diff, then a
NEW independent reviewer checks the exact SHA, followed by the required
exact-source built-editor evidence and gates. Further pace changes require
proved compute headroom and an explicit canonical selection, never an implicit
extension of this author invocation.

Preserve all earlier histories and acceptance blockers, the teacher-workflow
limited exception and stopped D13 handoff; neither foreign dirty tree is touched.
No school installation, Docker, network, database, deployment or Issue closure
is selected. The author and reviewer each STOP after their assigned stage; root
continues the authorized programme using the actual result.


## 2026-10-21 — separate Reset acquisition-boundary oracle repair

Canonical selection base: main39cd72afdd0291763eb18772f5d4dda9bd07623b.
Saved raw report Temp/asa-final06-range/reset-cause.json, SHA256
5b45a8d4d62ab9d0d3f94ff1ba0472bab818e7f65599713c429f579ce219922d,
binds exact06fdd: the oracle selects a pre-Reset generation9 receipt as active
before generation10 H0. All11 dark/native startup fields pass in the affected
prefix. This proves the acquisition-boundary error; it does not waive startup
or establish that every publication-latency failure is an oracle defect.

Select ONE separate test repair in existing e2e/electronics-ready-cadence.spec.ts
and, only if it exercises this oracle, the existing adversarial suite
 tests/electronics/classroom-qualification.spec.ts. Choose the active request
within the current acquisition boundary, retaining source/generation/receipt
causality. Do not simply skip pre-H0 frames. Preserve all11 dark/native startup
fields, mandatory new H0 with solved finite quality and matching source,
loaded images and all existing50ms assertions. Actual saved Reset replay must
pass without borrowing generation9. Negative old-generation receipt after Reset
MUST FAIL; bright before new H0 MUST FAIL; missing new H0 MUST FAIL. Preserve
all other assertions, captures, timeouts, pace, observer pins and raw history.

The separately authored deduplication candidate
a37cc1c78163cc41dd0ba587a77e7e759fa5054b remains pending integration, with
independent source approval and63 own tests reviewed. Its exact classroom run
39510050928 reports219PASS19FAIL; all12 ordinary Arduino journeys pass at
pace0.125, which is not1x acceptance. General is blocked by the known independent
C baseline with3 HIGH findings. No source approval or test-only fix accepts the
whole product, closes649/546 or clears any blocker.

Root assigns a NEW bounded oracle author after this canonical amendment reaches
main and a different NEW independent reviewer for the frozen exact test SHA.
No product code is selected. Keep oracle and deduplication repair in separate
commits, authorship and reviews; do not bring the product candidate into an
oracle-author commit. Root selects later composition and necessary exact-source
verification after reviewing the actual result. Preserve teacher limited
exception, stopped D13 handoff and every foreign lane. No installation, Docker,
network, database or deployment action. Author and reviewer STOP after their
single assigned stage.


## 2026-10-21 — D13 viewport test precondition only

Select one separate test repair in e2e/electronics-classroom-timing.spec.ts:
after resize invoke the real Fit UI before acquisition and assert the whole
board is inside the viewport. Saved Temp/asa-767-d13-range/d13-cause.json,
SHA256c20fa87e09dd77928dd453d3d24c29b845e03b6e9e99ce9dcd1cacf64f91687c,
shows x-41.816,width363 clipping despite56 actual LED/L edges and assetsReadyfalse;
corrected x39 passes the visibility predicate. This is a test precondition,
not authority to repair product Fit without evidence. Prove corrected framing
passes and clipped framing fails. Preserve native readiness/visibility,50ms,
45s and8 cycles; no skips, timeout/assertion weakening or pace/physics changes.
Stop above1s remains unresolved for separate diagnosis. Root assigns a NEW
bounded author and different independent exact-SHA reviewer; retain separate
oracle/deduplication commits and every historical failure/blocker. This repair
grants no product acceptance, real-time claim, deployment or closure. STOP after
the assigned stage and return the exact result to root.
