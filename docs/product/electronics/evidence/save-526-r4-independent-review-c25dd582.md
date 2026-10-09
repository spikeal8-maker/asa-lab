# NEW independent exact-SHA review — Electronics #526 E01 R4

VERDICT: **REQUEST_CHANGES**

TASK: TASK-ELECTRONICS-SAVE-RECOVERY-001; ISSUE:526; programme:452. One confirmed P1 current-slice test/evidence defect. No new production persistence, authorization or solver defect is established.

COMMIT_SHA: c25dd582e2856220fe893015c99257a186b982d6. TREE:33996f2118cf282ecc3a615f3b63946878150b60. Actual GitHub main:e86550500a9f09087268e6342eb813d0cc58fbb5. Published ref:codex/electronics-save-recovery-526-review-r4. Main0/candidate8 divergence. HEAD/ref/main remained the same at final inspection; checkout clean.

New independent HIGH reviewer: not author, controller or a previous526 reviewer. No source/docs/execution-state edits, pushes, dispatches, runtime/browser/Compose executions, signals or DB/deployment actions. Read original controller-cached receipts independently, without duplicate downloads. Only this external report and one extracted original trace frame were written outside the repository.

## P1 — new toolbar helper confuses JSON absence with a clean saved document

At e2e/electronics-simulation.spec.ts:4055, e01AffectedToolbarLayouts unconditionally requires Save disabled when emergencyCopy=false. The first invocation at4227 occurs before local-storage denial, in the original fixture that deliberately retains an older scoped local document. This document is DIRTY after canonical normalization. JSON absence means a current local copy exists; it does not mean the server has confirmed the document.

The original exact-c25 browser log records Expected disabled / Received enabled /5000ms at4055. Original failed trace frame snapshots explicitly record data-project-save-status="dirty". Error context shows the original Arduino sketch, open Code panel, the visible pending indicator and enabled Save. This is correct production behavior. Source corroborates it: normalizeLoadedDocument adds canonical component defaults; load marks a genuinely migrated document unsaved; WorkbenchHeader disables Save only for busy/saved/saving. Historical original R3 beforeDenialLocal differs from the server50 document in breadboard simulationStatus and resistor powerRatingWatt, and the unchanged fixture reaches the same normalization boundary here.

The failure occurs before anchor geometry, before the original denial injection, and before any R4 toolbar JSON/PNG generation. Thus final-c25 does NOT contain the promised local-denial whole emergency-copy receipt or the56 affected layout receipts. It cannot establish the required JSON-present/absent, Run/Stop, Code-active, neighboring-view, breakpoint or1440/1024/390/320 visual acceptance. The old R3 semantic receipts and images are history, not R4 AFTER evidence.

A second related helper assumption needs correction within the same bounded test repair:4053 always requires the indicator visible. The production indicator deliberately uses visibility:hidden for quiet clean saved state; a genuine saved state need not have transient feedback. In this actual run4053 passed because the fixture was dirty and showing its delayed pending label. Do not change production indicator/save semantics to satisfy either erroneous expectation.

Required correction: make the existing helper explicitly verify the actual controller persistence state and its appropriate action/indicator behavior, while retaining the original older scoped record and denial scenario byte/content requirements. Do not force a Save or clear/adopt a record to manufacture a clean fixture. Preserve full-caption/bounds/hit/pointer/overlap/page/scene/native-dropdown assertions, all widths/states, full emergency JSON and original timeouts. Then obtain ordinary exact-SHA gates and a NEW independent review. The CSS remains unaccepted pending actual affected-UI evidence; no additional production repair is justified by this fixture failure.

Classification:A, current-diff test/evidence defect. HIGH persistence slice with state-machine challenge and L1 affected UI acceptance. This P1 and the failed mandatory browser gate prohibit technical526 closure.

## Other actual browser failure — separate classification required

The same run fails unchanged e2e/electronics-interactions.spec.ts:1925: the battery-holder-aa catalog card has no accessible "Изображение детали не загрузилось" status after a controlled ordinary-image404. Stage status passed. Original asset failure trace/error context were independently read. Its test body is unchanged; the changed attributed fixture reader is not called by this assertion, and no production asset/recovery code or protected artwork is in the diff. The observed failure is real, but its root cause is not established by this review. Do not silently label it infrastructure, repair assets inside526, weaken the assertion or blindly rerun. Controller must classify it separately under AGENTS§2.1 before choosing any repair. It remains an additional mandatory-browser blocker.

## Actual state and complete source review

Read root AGENTS/START_HERE, GitHub-first/delivery workflow, Electronics router/task card/mapped persistence and workbench entries, CircuitDocument contract, agent invariants/risk/review, global review protocol and UI acceptance contract. Independent scoped preflight returned SAFE_TO_START:dirty0/blockers0/overlaps0, canonical526/in_progress/r4_bounded_affected_toolbar_ui_repair, control-plane PASS. The delegated Electronics scope is authoritative; a targeted global path lookup for this internal persistence source reports unmapped, so review used its explicit component entry rather than inventing a Surface Map route.

Reviewed all16 main→candidate paths,2355 insertions/235 deletions, including the complete persistence diff and test semantics. R4 itself changes exactly3 paths,261+/77−: toolbar CSS, the existing denial-case helper/evidence, and canonical derived digest. Current.yaml, task card and tracked R3 review equal main. API/Auth/RLS/migrations/dependencies/solver/Arduino runtime/protected owner assets have no diff. Ordinary workflow blob21d10e90a8f2d2e15583d2062c2745fa2531359b equals main; no temporary workflow change is in candidate ancestry. Other browser source before the inserted helper and from quiet-recovery onward is byte-identical to178d7cff; registration/timeouts/other126 scenarios are preserved.

Canonical LF browser-source SHA256098ced9a336190f05c7edc2ec96c89a62cf47d0b28aa4e33b8c467903a2188c4 equals generatedFrom.browserEvidenceSha256. All other parsed coverage fields equal main; no capabilities claim was generated.

Challenge checks: one existing serial queue and CAS/three-way merge; latest document and exact confirmed revision tracked separately; stale load/save/retry generations cannot mutate another scope; obsolete queued snapshots drop after merges. Transient failures rearm at5/10/20/40/60 seconds then at most one attempt/minute; permanent/auth/conflict errors stop automatic attempts and new edits cannot erase unresolved failure. Manual/safety writes preserve serialization and genuine-unmount confirmation. Current-document local durability requires exact successful write/readback, retracts on a later failure or other-tab removal, catches storage-getter/quota/no-op failure, and exposes the complete in-memory document only while the editor remains available. Emergency JSON carries schema and Arduino sketch. Scoped schema3 binds required verified user/project/account-or-seat namespace; schema1/2 legacy bytes are neither adopted nor deleted. Unchanged Chess/Checkers defaults remain schema2/original keys, and shared indicator has only the Electronics production consumer.

R3 crash guards remain intact: unique current-page timing mark, one CDP renderer PID, actual own-browser renderer membership, safe Linux PID and fresh bounded synchronous PPid/NSpid ancestry ending at that same browser, with no await before the single signal. Actual page.crash and crashed evaluation rejection remain mandatory. SAV10 uses real canonical native Back/Forward traversal in the same renderer, held replies, real logout/revocation/editor absence, distinct B session and negative A-project access. No auth policy or physics protection was weakened.

## All8 ordinary exact-head jobs

General37869131311, final-c25, terminal SUCCESS:

| Job | ID | Conclusion |
|---|---|---|
|Governance contracts|113622864432|SUCCESS|
|Format/lint/types/contracts/build|113623144140|SUCCESS|
|Access A browser journeys|113623752978|SUCCESS|
|PostgreSQL tests/RLS|113623753012|SUCCESS|

Electronics37869145318, final-c25, terminal FAILURE:

| Job | ID | Conclusion |
|---|---|---|
|Shared solver/editor contracts/build|113622912455|SUCCESS|
|E-OPT benchmark integrity|113623386069|SUCCESS|
|Actual editor simulation journey|113623386055|FAILURE —125PASS/2FAIL|
|Exact-head review images|113627509542|SKIPPED, not PASS|

Original General ZIP373581bytes SHA256bd5bfa018676662c4c229b0601dba621cf5b7ba09243edae7bf754a3af0cf9b6:61members/CRC PASS. Read original job logs: actual control-plane validation PASS is distinct from SKIPPED_FOR_FIXTURE; full Compose check PASS;3192 Vitest/16 RLS/652 synthetic/10 Access/284 layout PASS. Code96+Data43+Access27=166 fresh Nx tasks, zero hits.

Focused original log100363bytes SHA25614132049be4707163cbe469a88ac8f7a44b84506b244c2f29d86d2dae9b01f31:633 engine/399 editor PASS; module1/types42/build27=70 fresh Nx tasks, zero hits. Browser original log268466bytes SHA2560ba77ea061388aa330bb0d8ee2f5873c7acaf6348718dbfa2ad079d2755f18c2: ordinary registered browser gate,125PASS/2FAIL/13.2minutes, exact images, isolated cleanup;49 fresh image-build tasks/zero hits. Frozen lockfile and literal NX_SKIP_NX_CACHE=true independently confirmed in source/logs. Author local checks are not relabeled full gate/typecheck PASS.

Original browser ZIP30395895bytes SHA256e6c48f82e755488795c7f7692727a1584340f4d05a0bbf5ac30eb21cf403e00b:146members/CRC PASS. Original E01 failed trace10200070bytes SHA2566edfbe36495dc23be6fb0849ec228cdf3cab259b16edb09c772bcc2031830586, nested CRC PASS; context60403bytes SHA25630829edd61db89e289028717b4c4306f8291a228eb771a98dda875d1a7240c3d. Asset trace607688bytes SHA256c9395ed6f63d66ea8cf8dfec4a034afb94602a147c139e1e9d0fdcf6615071f9 and context55417bytes SHA2566fa81a7be8f3365f794acf35c95505669a63b3c48c495f58c4db93baf3770923, nested CRC PASS.

## Independently read final raw outcomes — limited by failed denial/UI case

Read all8 original E01 JSON files and both529 JSON files; comparisons use complete documents, not just titles/resistors. No retained Playwright success trace is claimed for passing scenarios; failure traces exist for the two actual failed cases. Crash-specific CDP/process receipt is present.

| SAV boundary | Exact-c25 outcome |
|---|---|
|01 normal save/new profile|PASS: last PUT=server=second-profile full document; revision3, changed sketch.|
|02 departure/crash|PASS: genuine departure; actual renderer crash31ms after guarded signal, no pagehide/safety PUT.|
|03 quiet recovery|PASS:2 requests/oneHTTP200; retry5043ms and capture6027ms after restored transport; no new edit/focus/online/fake clock/reload; full latest document/revision3.|
|04 expired session/relogin|PASS: registered test forbids PUT before same-user relogin; retained full local document equals confirmed server. Final raw puts contains the subsequent successful authorized save, not an unauthorized pre-login request.|
|05 late response|PASS: newer local copy remains dirty after old reply; final full request equals server.|
|06 real two tabs/409|PASS: explicit conflict persists after another edit; local666.6/server555.5/revision3.|
|07 local failure/emergency copy|NOT_COMPLETED on final-c25: new helper fails before denial injection. Older green semantic evidence is preserved history.|
|08 newer local/crash restore|PASS: entire attributed local=recovered local=confirmed server; revision3.|
|09 in-flight departure|PASS:3 serial requests, full final PUT=server/latest333.3/changed sketch; revision5.|
|10 user/project isolation|PASS: equal timeOrigin and actual canonical second path/title; both held replies delivered; old A bytes preserved, revoked editor absent, zero old-page B-phase PUT; full B local=server/revision3, both A projects403/404.|
|11 Stop/Run|Existing semantics retained in source/passing registered coverage. New R4 action-layout Run/Stop evidence NOT_RUN. Future E04 power-supply setpoint persistence is outside526 acceptance.|
|12 sustained cadence|Existing mounted first60s deadline/serial/backoff checks PASS and minute case PASS with its declared fake clock; quiet recovery above uses real time. No long classroom/hardware/frequency claim.|
|accepted529|PASS: manualSave82.8ms/genuine-departure102.1ms, strictly<260ms; expected=inputLocal=actionLocal=single PUT=server full document/revision3; actual reopen assertions PASS; five mounted assertions preserved.|

Important raw SHA256s: quiet b173ca1a693469da90f1d20e7a61e2910bae355aec0d83ac47e063c738d823ce; second-profile80377cb60557971c8e6eda2822b93d9b5daee755b1a7efa4f557095815e40235; crash d15bc47215e1f20f47828c373ea4fa963df3aecea11d734c81f16bd84e213e7b; injection41011487b7e99eafaf10f81a66cb926070b9f5403e086f5468cf904242414220; isolation b0a3671c1701eb3a900ab5081cf792cb6695f5caa898e39aaa9a1783f31731bc; reauth c5715a4f30f0d35c3776a085a73b1a45df554fead927ece68da25291deb32602; departure83a4b1b7866cf9f719fd38857f8a97d0bdad3cfa14e91d72b6a7e0d34ed0f67d; conflict4860635fce023b45c3b9d2d9d530ad1836bbfd8ccc5ece4db10316d2bc02420b;529Save eb636691c1ca14c5d956dd2165f241a5e276c649153e7f93560490fe9210290b;529departure f588a8e56c4348b17762127fb22e8946abbca32acd9d6690cd4252706d06aa79.

## UI visual review and limits

Independently opened original R3 denial1024 PNG: adjacent Run is visibly clipped, confirming historical causal finding. R4 source provides intrinsic Run width and two48px rows at981–1280, conditional on clock at1281–1536; mobile/larger desktop retain existing flow. This is source inference about the repair, not final browser acceptance.

Opened original final E01 failed-frame JPEG1440 (from its failure trace) and final quiet-recovery1440 PNG. They show JSON-absent normal/pending or quiet UI; they do not exercise JSON-present1024 or the new Run/Stop states. No final56 arrays or four-width denial images exist. Full R4 affected UI visual acceptance therefore remains unverified; the known R3 defect cannot be declared corrected from this run.

Failed-frame SHA25650787aece07e8ccfb2cc82d64dd8089c4f71a22904ad977ec6a0385f84c5a8d8. Quiet1440 PNG SHA256375ccd7a1a5b572c90cd7b031886169008085b13757620136af887fcca51a8a2. Cache root:C:/Users/spike/.codex/temp/electronics-e01/c25dd582-ci/run-37869145318/.

Tracked causal BEFORE hashes independently match eb2e44af4a18f91270c26791ae106a356e632325db5e3fbbc9269592f29c04e5 and8bcc0ac77000845082d4519ec4998f76fecc357a7b989ae0df50cdef16f0e4bc; original R3 review hash a6b620fee6c81616ea2b02cb790e6f11cc4477f8e607b4e3c8f7e50b0d60462a matches. BEFORE was not rerun. Historical/directed runs are not final evidence.

Residual limits: one local slot per actor/project; session GET→PUT is not an atomic server-side actor binding; actual shutdown server transmission remains best effort; memory-only data cannot promise crash recovery. No new retained success trace or full-strict e2e typecheck is invented. Existing school K0/version/full backups, real-pupil T3, owner/class acceptance and incident frequency remain pending; suspended525 and accepted529 preserved. No release candidate, deployment, technical526 closure, next-E04 activation or programme completion is granted by this report.

TESTS_RUN by reviewer:none. Evidence inspection includes source, actual GitHub metadata, original logs/ZIP/CRC/hash/full-document comparisons and visual review. MAP_NODES_CHANGED:none; canonical derived browser digest only. WORKING_TREE:clean. PORTS:unchanged. DEPLOYMENT:NOT_RUN. DATABASE_ACTIONS:NONE. NEXT_ALLOWED_TASK:**STOP for this reviewer**; controller owns any separately bounded repair/classification and NEW review.
