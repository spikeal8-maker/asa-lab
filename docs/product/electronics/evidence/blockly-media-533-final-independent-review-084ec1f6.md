# Independent exact-version review — Electronics #533

VERDICT: APPROVE

Boundary: technical acceptance of the selected Blockly media initialization slice only.
Reviewer: NEW independent reviewer `electronics_533_final_combined_exact_independent_review`.
Snapshot: 2026-10-09 10:08:54 UTC. No implementation, Git ref, repository state, CI dispatch or installation operation was performed by this reviewer.

## Canonical task and exact version

- Repository: `spikeal8-maker/asa-lab`; programme #452; selected Issue #533 remains OPEN at review time.
- Canonical controller checkout: `C:/Users/spike/.codex/worktrees/electronics-hygiene-480/ASA-lab`.
- Actual local HEAD, refreshed origin/main and independently queried GitHub main: `c80d06414cd58d123448d1852574cc4c93f6e963`.
- Canonical task: `TASK-ELECTRONICS-BLOCKLY-MEDIA-INIT-001`, `in_review`, checkpoint `final_combined_exact_version_independent_acceptance`.
- Reviewed SOURCE: `084ec1f66ade168ade777eab007c1c608d7bc048`.
- Reviewed source TREE: `1b495572133f7c2a954ca4821166fa93c8ef61d6`.
- Independently queried published source branch `codex/electronics-arduino-noop-publication-534` resolves to that source SHA. Its name does not replace canonical task selection.
- `pnpm agent:preflight --scope electronics --check`: SAFE_TO_START, remote refresh PASS, control plane PASS, dirty paths 0, blockers 0, execution blockers 0, worktree overlaps 0. A subsequent read-only recovery after a console-encoding inspection error also returned SAFE_TO_START. No product or state command was repeated after that error.
- Local divergence HEAD...origin/main: `0 0`; index and worktree clean before report creation. The report is outside the checkout.

I read the root policy/entry route, GitHub-first and change workflow, Electronics router, selected card including its final-version selection, mapped persistence/workbench component entries and CircuitDocument contract, applicable guide evidence/review rules, global review protocol and UI layout contract. Historical current.yaml inside source084 was not used to select work.

Git objects and the GitHub compare API independently show source084 is an ancestor of current main (two controller commits ahead, zero behind). The only source084→main differences are these six documentation paths:

1. `docs/execution/current.yaml`
2. `docs/product/electronics/evidence/arduino-noop-534-acceptance-20261009.md`
3. `docs/product/electronics/evidence/arduino-noop-534-final-raw-receipts.json`
4. `docs/product/electronics/evidence/arduino-noop-534-independent-review-084ec1f6.md`
5. `docs/product/electronics/tasks/TASK-ELECTRONICS-ARDUINO-NOOP-PUBLICATION-001.md`
6. `docs/product/electronics/tasks/TASK-ELECTRONICS-BLOCKLY-MEDIA-INIT-001.md`

There is no runtime, test, workflow, Compose or dependency difference after source084. Reusing its matching final source evidence is justified. It is not Electronics gate evidence for the later documentation HEAD. Main c80 General run37915029851 is still `in_progress`, conclusion null at the snapshot; this review does not call that run PASS or authorize bypass of any required documentation gate.

## Independent source review and challenge checks

The combined source diff from selected baseline `fdb45abadd41530cf4060549e44a5348b83f7892` is exactly seven paths, 738 insertions and one deletion:

- `apps/web/src/electronics/ArduinoCodePanel.tsx`
- `apps/web/vite.config.ts`
- `apps/web/src/electronics/testing/arduino-code-contract.spec.ts`
- `apps/web/src/electronics/use-electronics-workbench.ts`
- `apps/web/src/electronics/testing/arduino-code-panel-persistence.spec.ts`
- `e2e/electronics-simulation.spec.ts`
- `docs/product/electronics/generated/component-coverage.json`

I independently compared bytes of the panel, Vite configuration and focused media contract against original533 source680ab8bf: all three are identical. The no-op publication guard and four mounted cases belong to separately accepted dependency534, whose combined interaction I inspected afresh here. That earlier approval was not used as this review's verdict or proof.

The panel passes a local media directory to `ScratchBlocks.inject` before any workspace image creation. I read the actual pinned scratch-blocks2.1.19 consumer `src/scratch_zoom_controls.ts`: createDom reads `workspace.options.pathToMedia` and immediately constructs zoom-out/in/reset image URLs. The existing `applyScratchMediaAssets` remains a later requestAnimationFrame href rewrite. Supplying the base at injection addresses the demonstrated earlier request cause; the later rewrite alone cannot undo an already initiated request.

Vite groups only four already imported vendor files into a common directory fingerprinted from their ordered filenames and original bytes. Fixed upstream basenames remain intact; selective assetsInlineLimit returns false only for these four paths. The asset resolver checks the scratch-blocks/media path and exact four basenames; unrelated assets retain `assets/[name]-[hash][extname]` and default inlining. No asset bytes, upstream version, public origin, CSS, port or editor architecture changed. The focused test exercises the actual canonical Vite resolver and checks unrelated-package, unsupported filename and owner-supplied negative cases, rather than merely accepting a textual intention.

The534 guard reads the newest document and target component before comparing only supplied persisted properties. ProductionStateValue is `string | number | boolean | readonly string[]`; array comparison preserves entries/order/length. Equal or empty patches return without canonical cloning; genuine changes follow the existing full current-document merge/commit. Missing/non-Arduino guards remain. I read the four mounted production-controller cases: clean canonical reference/epoch/history/no local record/no departure PUT; genuine same-render resistor444.4 plus program/workspace edits with full latest payload; unrelated dirty resistor555.5 and undo/redo preserved through equal publication; changed array entries/order/length remain genuine edits. Original five cases remain a byte-for-byte prefix. Global commit, autosave, safety flush, API, schema and runtime behavior are unchanged by this guard.

I independently removed only the new533 two-mode region and new crypto import from source084's browser file; the result equals the entire baseline file byte-for-byte. Thus all old120 cases, accepted531 readiness and529 fast-input cases are preserved. No workflow, timeout, dependency/lockfile, CSS, package, public/owner asset, engine, physics/parser/runtime or auth path differs from baseline. Browser digest independently matches actual source bytes (`7b3489f75dcfa3173c5e58ae74681a78790fa7785eb30db2f3d869ef149a0c23`). No unrelated suspended candidate was silently integrated.

The new browser observer is installed before editor navigation/pre-mount. Initial200 bodies must match original vendor hashes. A304 reads no body and must link the exact URL and request If-None-Match to an earlier hash-verified200, with matching Last-Modified when supplied; redirects, arbitrary3xx, unlinked cache reuse, unreadable200, missing files and observer failures fail. Immediate rejection handling records errors that are asserted empty at the end. This fixes invalid cache instrumentation without suppressing failures or disabling actual browser caching.

The new fixture uses the existing canonical initialization fixed point (setup/loop x400, existing catalog resistor powerRatingWatt0.25/button released) before its first save. It does not manufacture a new normalization rule or claim schema-valid historical pupil documents were invalid. The later strict full draft equality including revision and updatedAt remains. Clean local null snapshots expressly mean absence only. This source retains original30s test budget, normal Playwright click/reload gestures, real source and block IDs, full server preservation, strict browser failure collection and all seven ordered phases. It introduces no force, sleep, route fulfillment, fake SDK, external-error allowlist or weaker electrical accuracy.

## Actual BEFORE from saved originals

I inspected the already cached original7a79fa51 directed run37897059035/job113710697022, not a new run or another agent's summary. Original log records both blocks/mixed failures for external zoom-in/out/reset with `net::ERR_BLOCKED_BY_ORB`. I additionally decoded each corresponding original trace network stream: each mode really requests all three external demo SVGs with status-1 and that failure; external sprites.png also loads200. This demonstrates creation-time remote dependency in the then-current production panel, not a hypothesis inferred from screenshot appearance.

Original BEFORE ZIP: 86,728,191 bytes, 131 members, CRC test clean; SHA256 `cab189b6af88b11e1534c878b0a3c5d6acfda089aa2d67b93bb595527c5bfdf9`. Its panel at exact532 sourcebd4074fe equals the selected main baseline panel byte-for-byte. The separate text cumulative-timeout failure is test packaging and does not become a product button defect or part of533. No prior-main successful browser run, school frequency or universal explanation of pupil failures is claimed.

## Required exact source CI, independently queried

GitHub API reports both workflows completed SUCCESS, run_attempt1, head_sha084ec1f66ade168ade777eab007c1c608d7bc048:

| Workflow/run | Job | Actual result |
| --- | --- | --- |
| General37910895056 (push) | Governance113755502571 | SUCCESS |
| same | Code113755822121 | SUCCESS |
| same | Access113757125972 | SUCCESS |
| same | PostgreSQL/RLS113757126041 | SUCCESS |
| Ordinary Electronics37911539739 (workflow_dispatch) | Focused113757622546 | SUCCESS |
| same | Benchmark113758637805 | SUCCESS |
| same | Browser113758637703 | SUCCESS |
| same | Review images113764098094 | SUCCESS |

I read actual original logs and canonical workflow commands: governance, gate:code, gate:data in isolated PostgreSQL, gate:electronics-m1, benchmark:electronics:ci and gate:electronics-m1:browser. Repository coverage is the actual declared governance/code/data jobs, not a local database-free PASS. Actual control-plane validation PASS and compose:check PASS are present; SKIPPED_FOR_FIXTURE inside validator fixtures is not substituted for real control-plane status.

Observed actual results: General3173 Vitest +16 RLS; Access652 synthetic +10 journeys +284 layout cases; focused633 engine +384 web (including9 mounted persistence tests); ordinary browser122 passed in12.7m. The two new media cases pass6.1/6.0s; the unchanged two genuine fast-edit cases pass3.0/2.8s. Normal build uses frozen lockfiles, including offline frozen Docker installs. NX_SKIP_NX_CACHE is literally true. Actual successful fresh Nx work: General166 (code27+42+27, data16+27, Access27), focused70 (1+42+27), benchmark18 (three web+5 builds), browser49 (16+6+27), packaging22 (16+6), total325 fresh task executions, zero Nx hits;303 excluding packaging. Dependency installation caches are not claimed as fresh test evidence. No same-code gate, measurement or hopeful rerun was dispatched by this reviewer.

Original General ZIP independently hashed and CRC checked:376,078 bytes/61 members, SHA256 `6b739f356d92d9c9a421c2064701406d2162547162ead2a395408ab756f1f089`.

Ordinary source log hashes independently recomputed:

- Focused106,336B: `bdb43231d0e927ccd977906478b60493528a4c878a4aaa2c8ef17a2e7b16ed6b`
- Benchmark137,190B: `f2e156acb32fa6a95d4628adecb9ecadb268115e8c381ceefa51ab2ad0d11861`
- Browser273,148B: `b34e10be7a2bd7203fc694b2684163fa23bf20f5f6247a9e0d2d3ad85c1f9b15`
- Packaging71,004B: `3882786030ab38ecd856d72eb542170b03a10d7c625d3556f04f12ebd158f794`

Browser artifact11607134881:21,977,489B/151 members, CRC clean, independently recomputed ZIP SHA256 `5efec1f724a7c5bf034357804650ce61c718407d1665486bbc744d0b9f7445ba`. Its actual remote GitHub artifact digest/size/head_sha match this original cache. I compared every extracted533 media/intent/PNG and529 fast-edit receipt byte-for-byte to the ZIP member, avoiding trust in derived root receipts.

Packaging log checks exact API/Web revision labels against source084. Remote artifact11607711640 is188,039,081B, digest `69a565b1e7d9c7b61418f43499f2830b2f82ca0fbb3ce6c13a4d5387ee481a5e`, not expired, linked to this source/run. I did not download/install that large archive or claim deployment from it.

## Independent ordinary AFTER raw comparisons

I computed the following vendor hashes from actual pinned local scratch-blocks2.1.19 bytes (unchanged frozen dependency graph), compared them to both original receipts and independently reconstructed common directory002c0b316c9c399c:

- sprites.png: `1818e665c0ef16301f0e36cb05727727c4064a065938de307d6225f85a22de5c`
- zoom-in.svg: `c384c0c03cca7ededeec1330a95bc5f17f41be10ddbbe9b207d3b777cc39e8c0`
- zoom-out.svg: `525427509ed6e060359d90c65eeb2eba35a66bf51b6145217b9cd484d5a3ddfc`
- zoom-reset.svg: `02e1a5f57a418421d6b988f6c7282d917db8ea9d0fb229a510ea4e37ec075253`

Each mode has exactly8 actual media requests/responses: four same-origin initial200 bodies and four same-URL validator-linked304 after reload. All URLs use `http://web:8080/assets/arduino-blockly-002c0b316c9c399c/`; no external demo media or redirect; observerErrors empty. This is production CI's internal same-origin address, not a new school public address.

For each mode I independently checked seven ordered phases: initial, zoom-in, zoom-out, zoom-reset, reopened-zoom-in, reopened-zoom-out, reopened. Scale0.8600000143→0.9460000396→0.8600000143; reset and reopened reset return to the original scale. Each phase contains four usable controls, positive actual bounds, all ancestor/viewport clips respected and five real DOM hits per control (140 hits per mode). All14 original PNGs exist and match ZIP bytes. Trash bounds use actual SVG clipped body/lid rather than the spritesheet rectangle.

I personally opened original initial and reopened PNGs in both modes (four1440×900 images). Zoom controls/trash are visible within the workspace, setup/loop blocks are present and the mixed source panel shows real generated setup/loop source. Save is visibly clean/disabled. No all14-images manual visual claim is made; other10 are independently verified original files with structured geometry. Passing traces are absent under retain-on-failure: I do not invent trace call times. The ordered awaited screenshots/assertions and completed passing cases establish completion; failure-time teardown images from older candidates are not reused as acceptance.

Full original intent comparisons: `before.draft == afterZoom.draft == after.draft`, including document, projectId, revision2, updatedAt and preview in both modes. This is a whole draft comparison, not a digest/selected field check. Actual serialized workspace contains setup-533/loop-533 at x400 and expected source; the case independently checks real visible block IDs and exact mixed source before and after reopen. All three actual local snapshots are null; source also asserts raw local key absence at each stage. Null is only clean recovery-record absence, not a full mounted-document claim. The meaningful mounted production-controller cases and genuine fast-edit full payloads provide complementary canonical-state/edit coverage.

Original ordinary533 receipts:

| Mode/file | Bytes | SHA256 |
| --- | ---: | --- |
| blocks-text/media.json | 75025 | `676d2f10373d8d9218bf63270d6288f8b3acc9595f69f3ae7db4091f5557cb4c` |
| blocks-text/intent.json | 66857 | `ff3a9035548017614bc4b4bb02e71066507903621dbc0796584c87a872be68f3` |
| blocks/media.json | 74985 | `c9feeecb962b2b10624d1a8cedad03030952005580a5fce783771dc40fc5448a` |
| blocks/intent.json | 66822 | `7133d3a8fc49addfd17cfaf596fbe6e38366f08bb65636921faa43d5dfb57c41` |

I independently compared the unchanged529 ordinary browser receipts: complete expected document equals inputLocal.document, actionLocal.document, the sole actual PUT document and real server draft.document. Both preserve latest source plus unrelated resistor333.3; server revision3. Actual manual Save60.70000000001164ms and genuine departure70ms are below the inherited260ms window. Real reopen assertions pass in those original cases; no mock is substituted for the browser server evidence. Raw genuine-departure receipt58,331B SHA256 `516ab02413dd10e5c8d1376cc6e878ca2efd93f2bbe93eacd7f281578cc6df63`; manual-Save58,304B SHA256 `a68f01311037fb5cafda6c12e86f6b8942d98d07f875436b2c4bc471b3f1ffe6`. These validate genuine edits under this combined source; they are not a new implementation of accepted529 or a new guarantee for every device.

## Layout impact, preservation and limits

Layout impact of533: none to CSS, DOM/text structure, breakpoint or visual geometry rules; media URL/emission timing changes only. Shared build selection is restricted to four media files. Actual changed media usability is checked in both code modes at1440; full desktop/compact/mobile layout or programme UI acceptance is not claimed. Known compact/981px layout dependency532 and its52-text/95-total test packaging remain separately pending. Approval here neither declares those surfaces ready nor weakens that future gate.

No review finding requires repair in this selected slice. Previous rejected candidates and their reports remain historical evidence; their partial results/old approvals do not supply this verdict. No protected owner art, owner ZIP, backups, foreign worktree changes, PR29/372/506, accepted repairs, suspended525 or unaccepted532/530/526 refs were edited, reverted, hidden or committed by this reviewer. Source scope independently excludes their product paths; preserving them does not mean accepting them.

Residual limits: demonstrated cause is initial remote Blockly media loading, not the sole cause of classroom failures or proof of their frequency. The no-op dependency prevents redundant dirty publication in the tested paths; no universal save-loss fix is claimed. K0 school installed version/full backups remain NOT_VERIFIED; pupil-device T3 waits for real school access. Dev-PC, GitHub runner and current screenshots do not replace it. Owner/class/programme/release acceptance and deployment remain unclaimed. Working installation, DB, containers, network and backups were not touched. No strict full browser-error probe PASS beyond the actual canonical suite is invented.

Technical #533 acceptance at exact084 is supported by independent source/raw/GitHub checks above. Controller must handle canonical closeout and any required documentation gate separately. Accepting533 makes529+534+533 three counted production slices, so mandatory bounded hygiene precedes another production-changing slice; this reviewer does not select or execute it.

NEXT_ALLOWED_TASK: STOP. No next slice, CI rerun, deployment or owner acceptance is authorized by this review.
