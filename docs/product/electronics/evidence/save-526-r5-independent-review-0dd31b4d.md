# Independent HIGH review — Electronics #526 E01 R5

Verdict: **REQUEST_CHANGES**. Reviewed one published final candidate and stopped. This is an independent review of the whole combined candidate, not an implementer report or a review of only the final two-file repair.

## Exact identity and remote snapshot

- Candidate: `0dd31b4d97cba4cbda935c66968e180fdc630a04`.
- Tree: `759fc80b7a0e423f67a247d3ba663abe363cc888`.
- Published ref: `codex/electronics-save-recovery-526-review-r5` in **spikeal8-maker/asa-lab only**.
- GitHub main and local origin/main: `2c195713b408ea88f2c8d2d5a87c3908bd887ab9`; divergence main...candidate is `0 / 10`.
- Author checkout: `C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab`; clean before and after review. Tree independently read from Git.
- Ordinary merge incorporating main: `fa2f536d9c8c5cd7a4e8895f2b1b8c80dd8d7fb5`.
- Canonical task: `TASK-ELECTRONICS-SAVE-RECOVERY-001`, in_progress, checkpoint `r5_bounded_normal_state_evidence_repair`; owner acceptance pending. GitHub #526 OPEN; #529 CLOSED. #525 remains suspended in canonical state.
- Last actual GitHub HEAD/run snapshot and local recovery: 2026-10-09 approximately 02:24 UTC. Both workflows terminal and on the exact candidate. `agent:preflight` and subsequent `agent:recover --scope electronics --check` reported SAFE_TO_START; no dirty paths. A PowerShell revision-argument quoting error was corrected, recovery repeated, and the quoted tree query succeeded; this was a reader error, not a CI/product failure.

Read actual AGENTS, START_HERE_FOR_AI, GitHub-first/change workflow, review protocol, UI layout acceptance contract, Electronics router, selected task card and R1–R5 requirements, UI/assets/persistence contract, original raw evidence, candidate source, and actual GitHub workflow/jobs. Root and implementer reports/checker PASS were not substituted for evidence. No repository edits, gate reruns, browser launches, local stacks, signals, deployment/database/backup actions, pushes or issue closure occurred in this review. Only the external report and an extracted original trace frame were written.

## Scope and source review

The combined main→candidate diff is 16 paths, 2430 insertions/235 deletions: Electronics persistence/controller/presentation, scoped shared local-draft support and tests, indicator and header, SchematicEditor integration, CSS, existing browser fixtures/cases and canonical coverage digest. Reviewed the complete product change and mounted tests. The R5 commit itself changes only the existing denial case/helper and coverage digest, 97 insertions/22 deletions. No R5 production change.

Independent Git/source comparison found the simulation file prefix preceding the changed helper and the suffix beginning with quiet recovery byte-identical to R4. Thus the other 126 cases, renderer-crash mechanism and #529 budgets were preserved. Coverage parsed fields are unchanged except the source hash, matching the canonical Git LF content SHA256 `c0ce9ffdabf99774e8d314084b8b41bcb5ea1065be659eb38f41a0563cf1ce83`. Workflow blob remains `21d10e90a8f2d2e15583d2062c2745fa2531359b`; workflow, lockfile, package commands, Compose, policy and current.yaml are inherited from main. No acceptance threshold or timeout was weakened.

Product review: schema 3 Electronics drafts are attributed to project and user plus account/seat identity; old unattributed keys are not silently adopted/deleted. Local outcomes use actual normalized read-back, and denied writes cannot claim a durable local copy. Single in-flight persistence serializes edits; bounded transient retry survives quiet periods, while conflict/auth failures stop rather than blindly overwrite. Scope switches invalidate old load/reply callbacks. CAS merge preserves sketch and circuit changes; departure persistence uses captured identity and confirmed revision. Shared non-Electronics schema-2 defaults and existing callers remain compatible. Indicator's actual consumer is WorkbenchHeader. No additional persistence source defect was established in this review.

Residual practical limits: the client identity check across GET→PUT is not an atomic server operation; genuine browser shutdown delivery is best effort; memory-only drafts cannot promise recovery after process loss. The candidate's passing isolated cases do not establish school installation, real class reliability or owner acceptance.

## Actual terminal CI

[General 37872258062](https://github.com/spikeal8-maker/asa-lab/actions/runs/37872258062): **SUCCESS**, all four jobs on exact 0dd31b4d. Governance, code, PostgreSQL/RLS, Access A browser all succeeded. Original whole job logs show 3192 Vitest tests +16 RLS; 652 synthetic +10 Access journeys +284 layouts. Fresh Nx execution: code 96, data 43, Access build 27 = **166**, zero Nx hits.

[Ordinary Electronics 37872270511](https://github.com/spikeal8-maker/asa-lab/actions/runs/37872270511): **FAILURE** on exact 0dd31b4d.

| Mandatory job | Actual conclusion | Original evidence |
| --- | --- | --- |
| Focused 113632827663 | SUCCESS | 633 engine +399 editor tests; 70 fresh Nx tasks, zero hits |
| Browser 113633262620 | FAILURE | 126 passed, 1 failed, 12.2 minutes; 49 fresh build tasks, zero hits |
| Benchmark 113633262687 | SUCCESS | Registered quick suite, three web builds with five dependencies each: 18 fresh Nx tasks, zero hits |
| Review images 113637026662 | SKIPPED | Not approval evidence |

Combined required eight jobs: six SUCCESS, one FAILURE, one SKIPPED. Frozen dependencies, Node 22, pnpm 9.15.9 and literal `NX_SKIP_NX_CACHE=true` confirmed in original logs. Dependency/tool caches are distinct from Nx result caching. Successful general CI does not override the required red Electronics browser gate. No retry or rerun was requested or performed.

## P1 — native wire menu is obstructed by the open Code panel

**Current candidate actual UI failure**, `e2e/electronics-simulation.spec.ts:4243` in the denial case starting at 4251 (first helper call at 4288). At 1024×900 with Code active, the native wire dropdown's “Цвет провода: Фиолетовый” button is covered by the Arduino drawer resize handle. The existing trial click times out at 120000 ms. This is a real pointer obstruction, not the previous R4 mistaken Save-disabled assumption.

Original browser log repeatedly identifies `<div class="arduino-drawer-resize-handle" role="separator" aria-valuenow="604">` as intercepting pointer events. Original trace first succeeds at 1440 (`call@3564`, dispatched trial point 430,146), then fails at 1024 (`call@3602`, starts 198762.074; first interception 198815.166, last 314976.181, 222 interception entries). Original 1024 trace frame at timestamp 198781.171 visibly shows the violet swatch behind the Code pane. During the subsequent long wait the legitimate autosave moves dirty→saving→saved; final disabled Save is not the initial dirty normal state.

The recorded 1024 layout has toolbar bottom and scene top at y=144, including the 48px header, versus y=96 at 1440. Actual drawer width is 604. Unchanged clamp/viewport geometry gives drawer left 420 and a 12px resize handle. The violet menu center near x=430,y=146 intersects that edge. The exact 1024 center is a **source/screenshot geometry inference**, not a dispatch coordinate recorded by the failed click; the trace contains the actual successful 1440 point.

Ancestor stacking explains the obstruction: `workbench-toolbar` is positioned with z-index 28 (`workbench.css:202`); its wire menu's z-index 80 (`:2204`) remains inside that context. The absolute Code panel has z-index 45 (`:3401`); its handle z-index 120 (`:3434`) is inside the panel context. `workbench-main` introduces no separate stacking context. Comparing 80 directly with 120, or merely increasing the dropdown child's z-index, misses the relevant ancestor ordering.

**Classification: provisional C, an independent existing UI baseline defect, supported by source comparison; actual main-browser reproduction was NOT_RUN.** All declaration blocks for wire menu, Code panel, handle and workbench-main are identical to main; wire `<details>` DOM and entire ArduinoCodePanel.tsx are identical. R4's rows move the scene down at 1024 and reduce, rather than introduce, the dropdown/pane intersection. This supports a baseline counterfactual, not a claim that main was executed or causal diagnosis/frequency conclusively proved. No source evidence establishes an R5-caused layer regression. Regardless of classification, the current candidate's required affected-UI contract fails.

Needed resolution: a separately selected bounded baseline diagnosis/repair with actual native selection and exact final CI/review, followed by restored #526 acceptance. Do not mask it by forced clicks, closing Code in the required state, skipping menus, dropping widths, timeout increases or blind same-code reruns. This reviewer did not select or implement the dependency.

## Missing final denial and UI acceptance evidence

The helper records state/geometry before asserting, correctly preserving failure evidence. `after-toolbar-local-draft-run.json` contains only two normal-state breadboard Run layouts: 1440 and 1024, JSON action absent. Both have retained normalized local draft, dirty presentation, Save enabled and Code pressed. Quiet-hidden status at 1440 and visible delayed saving at 1024 are legitimate states. Full action captions, bounds, hit checks, no overlap/page overflow and matching scene edges pass for these two recorded layouts. Independently opened original 1440/1024 PNGs and the original failed menu frame.

Only **2/56** required layouts are recorded, and the second native-menu trial fails. There is no final denial injection receipt, no final denied-write/error/export JSON, no complete Run/Stop × JSON absent/present × ten-width matrix, and no schematic/BOM affected-consumer matrix. Remaining widths, mobile 390/320, breakpoint transitions and the full denied status/export layout acceptance are **NOT_RUN**. The two PNG filenames contain “denial” but represent pre-injection normal state; filenames do not establish denied-write execution. Original status/geometry recording is a useful R5 repair, not full acceptance.

## Original whole-document semantic comparisons

Independently parsed the original receipts and compared complete CircuitDocument/sketch/local/server objects, not only resistance snippets or implementer summaries:

| Contract | Exact-run evidence and conclusion |
| --- | --- |
| Quiet recovery / second profile | 6023 ms after restoration; two identical whole-document PUTs, one 200; latest166.7 + changed sketch, saved DOM, server revision3, local cleared; full second-profile document/revision/sketch identical. PASS |
| Renderer crash | 27 ms accepted injection; traced unique renderer ancestry and actual crash; no lifecycle PUT. Full recovered local and server match177.7 + changed sketch, revision3. PASS |
| Reauthentication | Exactly one post-reauth PUT; full local188.8 + changed sketch = server revision3; expired-session no-PUT assertions passed. PASS |
| Late response / real departure | Three full PUT documents111.1/222.2/333.3 with bases2/3/4; full latest = server revision5 and changed sketch. PASS |
| Two-tab conflict | Full local666.6 and remote555.5 retain original sketch/connections, server revision3; passing case preserves hard error through edit. PASS |
| Project/account isolation | Distinct actors, same renderer timeOrigin; actual route/UI stable; old draft bytes preserved through project/account/logout/late bootstrap; two held replies delivered and zero old-browser B-phase PUT. Full B local=server888.8 revision3; A resources403/404. PASS |
| Accepted #529 regression | Manual Save62.7 ms and genuine departure74.2 ms, each strict<260; full expected=input local=action local=single PUT=server333.3 revision3, reopen assertions passed. Five inherited mounted cases unchanged. PASS |

SAV01–06 and08–10 have the above passing exact-run evidence. SAV07 denied-local copy/export remains NOT_RUN. Existing Run/Stop persistence semantics passed, while new 56-layout Run/Stop acceptance is incomplete. SAV12 continuous edits across the next one-minute deadline are covered by mounted controlled-clock tests (`workbench-project-state.spec.ts:519`) and scheduler tests. The production-browser minute case performs one edit with Playwright controlled time, not sustained real-time class editing. These prove mechanisms, not school save frequency or class reliability.

## Historical evidence and acceptance limits

Tracked original BEFORE denial bytes still prove local=null/server50 while UI166.7 falsely claimed a copy; original BEFORE quiet bytes preserve 69235 ms without successful retry (one failed PUT/server50/local166.7). They were not regenerated. R3's green workflow remains historical and its original 1024 image shows clipped Run; it cannot accept this candidate. R4's wrong normal Save-disabled assertion is truthfully corrected here, as the two new partial states demonstrate.

The separate R4 permanent-missing asset badge failure now passes in this exact browser run, but its cause is not established or fixed. The historical classification report and canonical earlier accepted459/residual462 observations remain history; they do not prove frequency, a specific unknown run association or permission to rerun. No asset repair belongs to this #526 review.

School K0 installed version/full backups remain NOT_VERIFIED, T3 actual pupil-device evidence and owner/class acceptance pending. No deployment, release candidate, #526 closure, programme completion or next E04 activation is justified by this report. #529 accepted status and #525 suspension remain intact. Strict full e2e typecheck was not independently run here; a reported 8→8 error delta is not a full PASS.

## Original evidence identity manifest

Base cache: `C:/Users/spike/.codex/temp/electronics-e01/0dd31b4d-ci/`. All originals were cached once by the controller, then independently read/hash-checked; ZIPs independently CRC-tested. No redownload.

| Original | Bytes / integrity | SHA256 |
| --- | --- | --- |
| run-37872258062/general-logs.zip | 368381 /61 CRC PASS | 409e6f8b583eacf0697f1bb9c4a3d1b87e708b7a62ccf402ab80b1e888388e0d |
| run-37872270511/focused-job-113632827663.log | 100096 | d1cbc53b8c5a1b8507376a4c8579ebf1296acd10e32ca4131944567c6ddabd35 |
| run-37872270511/browser-job-113633262620.log | 267122 | 13072edecedceebe92e417ff20f385a23fff599e33cda54a4da81097ad0b67fc |
| run-37872270511/benchmark-job-113633262687.log | 131451 | f175072487745ca5d261e8c410bafc17693bd7550a8de348c133a17443dcede6 |
| run-37872270511/browser-artifact-11590344675.zip | 30751450 /147 CRC PASS | 8c5786856d6fefa963ef2fb1265b7e4619a4a7b3a3b71d3ce9ccaf0af229e4a2 |
| failure error-context.md | 60902 | ae958370bb91351ceaa421d90820c99d4fbcb71b8eb210336739d3d4973c04ff |
| failure trace.zip | 10826885 /157 CRC PASS | 3bc304cffefc50ff72bd9db4ad9339ea7a68fc9475371a20f45351a16ba3d200 |
| electronics-e01/after-toolbar-local-draft-run.json | 6220 | e4821d086502fb4652bb5d8d18615e440c148af40248e70a148339e21f8328ec |

Extracted receipts reside under `run-37872270511/extracted/reports/playwright/electronics-e01/`; failure context/trace under adjacent `electronics-simulation-ELE-1610b-claims-a-durable-local-copy/`.

| Receipt | SHA256 |
| --- | --- |
| after-quiet-recovery.json | 439235a036458c6f7f54791e2a33114785b1a69bc50b7a8011e266d5a855c350 |
| after-second-profile.json | c6b7e1881e23b5dd2be78f315f40cd0d387e372c46f9231188dcaf1bc9a1c6aa |
| after-renderer-crash.json | ca00deca190ab7826bf06c38e6f3ecbf42d3e336dcf377e0195b6d2523dbaa01 |
| renderer-crash-injection.json | 7ccc4e6a18af452a54ba2a87798c5319739d7787991f86b824bdeb9cbf3b8535 |
| after-reauth.json | 8596e4f5143ea9058dd91e9fc57151f14cf70563878b3d54c112664c54ab8b81 |
| after-late-reply-departure.json | 8e65ea66b2b079da1a44fcf69e628211164401e628ed210d5944b2292616af52 |
| after-two-tabs-conflict.json | a75bfc9c0c9c832eb42c4fe5ad48e29370afa0ad0d31108eac790b1ce7dc11e1 |
| after-project-account-isolation.json | 8686fcb9d46f68e8721109eae337c69dfed90c5bec6e994646a1d8cb7685bef8 |
| sketch-529/after-manual-Save.json | 13b0a1e20537d97903ed69a4c3948c06ed63c26880346f69455981195ff7683b |
| sketch-529/after-genuine-departure.json | d4767203d9c17bee7b6e574e0196f31229d13a680ad0b3a070e747883c55d852 |

Reviewer-extracted ORIGINAL failed trace JPEG: `C:/Users/spike/.codex/temp/electronics-e01/r5-independent-original-wire-menu-frame.jpeg`, SHA256 `4affc2f570929b9d76bbb73b7afcb3ad54e944011aa937f20c9719ee8fdadb76`; trace timestamp198781.171, viewport1024×900. It is extraction, not a new browser run.

Tracked BEFORE denial SHA256 `eb2e44af4a18f91270c26791ae106a356e632325db5e3fbbc9269592f29c04e5`; BEFORE quiet SHA256 `8bcc0ac77000845082d4519ec4998f76fecc357a7b989ae0df50cdef16f0e4bc`. Historical separate catalog classification file SHA256 `50c3d8bdf77bcfad665e233a1b774805c6d08114c24e76d32bf0e8cb977b5acf`.

## Final decision

**REQUEST_CHANGES for exact 0dd31b4d/tree759fc80b.** P1 actual native-menu obstruction leaves the mandatory browser gate red and final denied-write/export plus 54 remaining UI layouts unexecuted. Passing whole-document persistence, general CI and benchmarks remain useful evidence; they do not complete the selected acceptance contract. Provisional baseline classification requires separate bounded resolution, not scope expansion or weakened checks. Candidate publication preserved. Independent reviewer **STOP**; controller retains programme responsibility.
