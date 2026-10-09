# Independent exact-version review: Electronics 534

VERDICT: APPROVE
REVIEWER: new independent reviewer /root/electronics_534_new_exact_independent_review
REVIEWED_AT_UTC: 2026-10-09T09:53:10Z
TASK: TASK-ELECTRONICS-ARDUINO-NOOP-PUBLICATION-001
ISSUE: #534, existing programme #452
SOURCE_SHA: 084ec1f66ade168ade777eab007c1c608d7bc048
SOURCE_TREE: 1b495572133f7c2a954ca4821166fa93c8ef61d6
SOURCE_BRANCH: codex/electronics-arduino-noop-publication-534
CANONICAL_MAIN: fdb45abadd41530cf4060549e44a5348b83f7892
ACCEPTANCE: bounded technical acceptance of this combined source, including its inherited 533 media change; no deployment or owner/class/release acceptance.

## 1. Independent entry and actual state

I independently queried GitHub main and source branch, the exact-source workflows and jobs, actual Git source/tree/divergence, working tree, task card and root policies. The source branch is published at the reviewed SHA; main remains fdb45ab. Divergence origin/main...HEAD is 0/9. Both the first preflight and final Git/remote observations identify the same clean source. The canonical lane selects task534, in_progress, checkpoint bounded_latest_document_noop_publication_repair. Preflight returned SAFE_TO_START, dirty paths0, blockers0, execution blockers0, worktree overlaps0, remote refresh PASS and actual control-plane PASS.

Read root AGENTS.md, START_HERE_FOR_AI, GitHub-first/change workflow, Electronics router, selected534 card, exact workbench/persistence component entries, CircuitDocument section5, AGENT_GUIDE scope/risk/evidence/review and global review/layout protocol. The change does not change DOM, CSS, layout breakpoints, labels or electrical runtime; the inherited media URLs supply the existing controls. This review makes no new global layout acceptance claim. Actual original control PNGs and geometry were reviewed for the changed media behavior.

I ran the selected card/routing validator independently: 84/84 validator tests plus selected TASK-ELECTRONICS-ARDUINO-NOOP-PUBLICATION-001 validation PASS. git diff --check passed. No author/root report, preservation helper or derived raw proof was substituted for inspection of source and original evidence. I wrote only this external report; no source, state, refs, CI dispatch or deployment mutation.

## 2. Actual scope and source challenge review

The final534 commit changes four paths, 183 insertions/3 deletions. The entire main-to-combined source changes seven paths, 738 insertions/1 deletion:

- apps/web/src/electronics/use-electronics-workbench.ts: 14 added lines inside updateArduinoProgram only.
- apps/web/src/electronics/testing/arduino-code-panel-persistence.spec.ts: four appended mounted cases, 158 lines; all original five cases preserved byte-for-byte.
- e2e/electronics-simulation.spec.ts: inherited two new533 cases, and the explicit raw-local-key absence adaptation in these new cases only.
- docs/product/electronics/generated/component-coverage.json: canonical browser digest.
- Inherited533 ArduinoCodePanel.tsx, vite.config.ts and arduino-code-contract.spec.ts.

The updater obtains getCurrentDocument() before finding the board. Missing/non-Arduino guards remain unchanged. It compares only supplied properties against the latest board. ProductionStateValue is string | number | boolean | readonly string[]; scalar equality and ordered string-array value equality match those persisted types. Equal supplied values return before commitDocument, so document identity, mutation epoch, local dirty write and persistence transitions are not created. The original immediate merge/commit for real changes remains intact and uses the same newest complete document, preserving other boards, unrelated edits and unsupplied properties. There is no global dirty/save/revision/flush rewrite, new debounce, or exception bypass.

I inspected actual downstream consumers: ArduinoCodePanel persist/updateProgram, project state getCurrentDocument/setDocument/commitDocument/history, and pagehide/unmount safety flush. The original clone-and-commit path changes document identity even when history de-duplicates equal values; this explains the former redundant save without inventing a content-loss cause. The new guard acts before the workbench epoch increment and project local write. Genuine edits still reach the original saveNow/departure path.

Mounted tests exercise production React workbench/project hooks and real panel, local storage, queue/history and Save/departure. Only unused Scratch renderer and API transport are substituted in these tests. Coverage includes clean repeated publication/missing/non-Arduino/empty patch, unchanged identity/epoch/history/no departure save; same-render resistor plus real program edit with entire expected local/server document and exactly two mutation epochs; an already dirty unrelated edit retaining identity/history/undo/redo and saving its full document; and equivalent array vs changed entry/order/length. Original five real text-input/board-switch/deletion/unmount/one-minute-autosave cases remain unchanged. Original local logs show new4 FAIL/original5 PASS before the guard, then9 PASS, and final38 PASS across mounted9/project-state20/autosave9. These logs are supporting regression evidence, not a replacement for exact-source CI.

Independent byte comparisons confirmed the three inherited533 product/contract files equal their first source680ab8bf. That inherited product change passes the local asset base into ScratchBlocks.inject before synchronous image creation, and selectively emits only the four original pinned media files without inlining, together under a shared content fingerprint. Other assets retain Vite defaults. No protected artwork or newly drawn asset is introduced.

Independent removal of only the new533 region and its new createHash import reproduces the original complete browser file byte-for-byte; all old120 cases including accepted531 and fast sketch durability are preserved. I also independently compared the exact main workflow, lockfile/package, CSS, WorkbenchHeader, project-state and current.yaml bytes: unchanged. No engine/parser/Arduino runtime/code-generation/auth/deployment/state change. Canonical browser SHA256 is 7b3489f75dcfa3173c5e58ae74681a78790fa7785eb30db2f3d869ef149a0c23.

## 3. Independently confirmed BEFORE

Original preserved source533 R3 b5045472 and workflow-only child8b347f15/run37907937816 fail strict whole server draft equality. I independently decoded both original network traces rather than trusting the prior review or controller JSON. In both, the complete actual GET revision2 document equals the exit PUT document with baseRevision2 and the later actual GET revision3 document; updatedAt changes. Exit PUT trace status -1 is not claimed as successful HTTP; GET200 revision3 proves the committed redundant write. This establishes a no-op write baseline defect, not pupil content loss or its school frequency.

Original trace SHA256:

- blocks: 6db6e4bc137aab456ae88d183d4de5997b7e57d214a1e39a0c3fe852d6410f6d
- blocks-text: dd753df67a85f570b431fdd8631ebcb4cb15ed4c945acddd292450980c712a35

## 4. Changed-cause directed production evidence

The single diagnostic child8eabf4ce1abadb0ae304c2b32af3f519e8a1d986 differs from final source only in its workflow. It is outside final-source ancestry. GitHub run37910942738/job113755658556 terminal SUCCESS, actual4 PASS23.5s; this is a directed diagnostic, not the registered ordinary gate. It builds the same canonical production Compose code with frozen dependencies, literal NX_SKIP_NX_CACHE=true, original budgets and 49 fresh build tasks/0 Nx hits.

I independently checked original cached artifact11606846566 ZIP6346393 bytes/46 entries/CRC PASS, SHA256 6ef963314bf4d113963e112bfa60195b22e7a17e2ea9dee429e1da010c9a650c; original log235744 bytes SHA256 26a4644393c9ec1a7d9109c3a67b2360dd1211919618c237e8da039ddc993029.

Both complete intent.json files have equal before/afterZoom/after server drafts, including document, revision2 and updatedAt; all three local snapshots are null. These nulls mean actual absence of a local recovery key, as explicitly asserted by the source. They are NOT a proof of the entire mounted document. Complete server comparisons, real UI/source/block assertions and mounted controller reference/full-document tests provide the separate preservation proof.

Each mode has8 actual same-origin media requests/responses: initial4 hash-verified200 bodies, then4 bodyless304 linked to the corresponding earlier200 by exact request If-None-Match/earlier ETag and verified200At. No external/default-demo request, redirect or observer error. I independently compared expected hashes against installed pinned vendor files, not just the receipt's own expectation. Both modes have the seven ordered phases initial/zoom-in/zoom-out/zoom-reset/reopened-zoom-in/reopened-zoom-out/reopened, four controls with all five hit points and ancestor clipping checks, and all14 original phase PNGs. Normal zoom/reset/reopen assertions pass; scale changes .86 to .946 and returns .86. Full serialized nonempty setup/loop IDs, original generated C++ source and complete schematic remain present. I opened original initial/reopened images for BOTH modes, four images, and saw usable zoom/trash controls and actual blocks/generated mixed source. I do not claim manual inspection of all14.

Unchanged genuine fast-input cases independently show full inputLocal.document == actionLocal.document == expected == single PUT == actual server document, resistor333.3 and full changed source. Manual Save90.7ms; genuine departure78.2ms, both inside original260ms window, with reopen assertions passing. No added sleep/poll before action.

## 5. Final ordinary exact-source evidence

I independently queried final GitHub conclusions. Both workflows below have headSha084ec1f66ade168ade777eab007c1c608d7bc048 and terminal SUCCESS. All eight required jobs succeeded:

| Workflow/run | Job | Result |
| --- | --- | --- |
| General37910895056 | Governance113755502571 | SUCCESS |
| General37910895056 | Code113755822121 | SUCCESS |
| General37910895056 | PostgreSQL/RLS113757126041 | SUCCESS |
| General37910895056 | Access113757125972 | SUCCESS |
| Electronics37911539739 | Focused113757622546 | SUCCESS |
| Electronics37911539739 | Benchmark113758637805 | SUCCESS |
| Electronics37911539739 | Browser113758637703 | SUCCESS |
| Electronics37911539739 | Exact review images113764098094 | SUCCESS |

Original General archive376078 bytes/61 entries/CRC PASS SHA256 6b739f356d92d9c9a421c2064701406d2162547162ead2a395408ab756f1f089 independently read. Actual3173 Vitest +16 PostgreSQL RLS;652 synthetic +10 Access browser +284 layouts; remote-required control-plane validation PASS and compose:check PASS. Frozen dependency installation and literal NX_SKIP_NX_CACHE=true are present. Fresh Nx tasks166, no hits.

Original focused log106336 bytes SHA256 bdb43231d0e927ccd977906478b60493528a4c878a4aaa2c8ef17a2e7b16ed6b independently read:633 engine +384 web tests PASS,70 fresh tasks/0 hits. Original benchmark log137190 bytes SHA256 f2e156acb32fa6a95d4628adecb9ecadb268115e8c381ceefa51ab2ad0d11861: canonical benchmark command PASS,18 fresh tasks/0 hits. No school performance threshold is inferred.

Ordinary browser original log273148 bytes SHA256 b34e10be7a2bd7203fc694b2684163fa23bf20f5f6247a9e0d2d3ad85c1f9b15 independently read: canonical pnpm gate:electronics-m1:browser,122 PASS12.7m,49 fresh build tasks/0 hits. Original artifact11607134881 ZIP21977489 bytes/151 entries/CRC PASS SHA256 5efec1f724a7c5bf034357804650ce61c718407d1665486bbc744d0b9f7445ba independently verified.

I independently parsed ordinary ORIGINAL full media/intent/fast receipts again, not controller-derived checks. Both media modes retain whole server drafts revision2 to2 and updatedAt, three null local snapshots, strict8 responses with pinned200/linked304, all7 phases per mode, all control clipping/hit checks and14 actual PNGs. I opened the ordinary originals initial/reopened BOTH modes (four images), confirming usable real controls and blocks/generated mixed code. Full final fast receipts show manual Save60.7ms and genuine departure70ms, full inputLocal/actionLocal/onePUT/server equality, resistor333.3 and saved revision3. Reopen/source checks are original awaited test assertions and successful tests, not a fabricated passing trace.

Ordinary raw SHA256:

- blocks-text intent: ff3a9035548017614bc4b4bb02e71066507903621dbc0796584c87a872be68f3
- blocks intent: 7133d3a8fc49addfd17cfaf596fbe6e38366f08bb65636921faa43d5dfb57c41
- blocks-text media: 676d2f10373d8d9218bf63270d6288f8b3acc9595f69f3ae7db4091f5557cb4c
- blocks media: c9feeecb962b2b10624d1a8cedad03030952005580a5fce783771dc40fc5448a
- fast manual Save: a68f01311037fb5cafda6c12e86f6b8942d98d07f875436b2c4bc471b3f1ffe6
- fast genuine departure: 516ab02413dd10e5c8d1376cc6e878ca2efd93f2bbe93eacd7f281578cc6df63

Original packaging log71004 bytes SHA256 3882786030ab38ecd856d72eb542170b03a10d7c625d3556f04f12ebd158f794 independently inspected: exact revision-labelled API/Web build, metadata comparison/export/manifest/upload successful;22 fresh tasks/0 hits. Artifact11607711640 is188039081 bytes, recorded upload digest69a565b1e7d9c7b61418f43499f2830b2f82ca0fbb3ce6c13a4d5387ee481a5e. I did not download or install that large review-image ZIP. Total ordinary General/Electronics fresh Nx task executions325, including22 packaging (303 excluding packaging), no Nx cache hits. These are actual executed-task counts; they do not count directed49 again or claim that dependency-store/Docker layer caches were disabled.

## 6. Review verdict and limits

No actionable findings. Required full combined source, meaningful regression, real production before/after, exact-source ordinary gates and independent acceptance conditions are satisfied. APPROVE is for source084ec1f6/tree1b495572 only. It does not approve an altered merged version or use a prior rejected533 approval; all relevant inherited media behavior was reviewed here against this combined version.

Passing traces are absent under retain-on-failure; I do not claim trace-level timing for screenshots or undocumented mounted state on these successful runs. All ordered phase/gesture assertions finished in successful ordinary tests; original full structured receipts and PNGs were checked. Null local snapshots establish absence only, not a whole-document comparison. All14 original phase PNGs exist and numeric control observations pass; visual inspection covered four originals per run, not all14. No new mobile layout acceptance or proof of every legacy fixture/device is claimed.

School installed version/full backups K0 remain NOT_VERIFIED. Real pupil-computer T3 remains pending owner device evidence. No school/device frequency, universal pupil-data-loss cause, classroom acceptance, owner acceptance, release or deployment claim. No installation/working DB/network/backup/restart action was taken. Existing accepted results and suspended525/532/530/526/505/506 were untouched. Controller owns technical integration/closeout and subsequent canonical task decisions; this reviewer selects or implements no next slice.

NEXT_ALLOWED_TASK: STOP / return exact-version verdict to controller.
STOP
