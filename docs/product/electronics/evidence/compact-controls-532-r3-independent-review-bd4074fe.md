# NEW independent exact-source review — Electronics #532 R3

VERDICT: REQUEST_CHANGES

TASK: TASK-ELECTRONICS-COMPACT-CONTROLS-001 / Issue #532, programme #452.
Reviewed source: `bd4074fe0326a2f51334991718cdcc544ae7386d`.
Tree: `345df0815be719ac057a8606b4602264f931bb0d`.
Published source ref: `codex/electronics-compact-controls-532-r3`.
Canonical main observed independently at 2026-10-09 07:18 UTC; final CI snapshot 07:20:55 UTC:
`c47b4914c56e89473d5eca7bd61fae3ea62b5cfe`.
Reviewer: NEW independent subagent `electronics_532_r3_new_exact_independent_review`.
No product, repository documentation, execution state, Git history or original evidence was changed by this reviewer. External reviewer scripts, derived observations and this report were written outside the repository. No duplicate logs/artifacts were downloaded, no browser/workflow rerun was requested, no deployment/DB/network action was performed.

## 1. Independent entry, scope and source inspection

Read AGENTS.md, START_HERE_FOR_AI.md, GitHub-first protocol, Electronics router, selected card including R1–R3, review protocol, applicable Electronics guide §§11–15 and UI layout acceptance contract. Actual `pnpm agent:preflight --scope electronics --check` returned SAFE_TO_START: selected #532 `in_progress`, checkpoint `r3_bounded_independent_mode_test_packaging`; source HEAD/tree match above, origin/main c47, dirty paths 0, blockers 0, overlaps 0, remote refresh PASS and control-plane PASS. External transcript: `reviewer-532-r3-preflight.log`.

Inspected the complete new source region and whitespace-insensitive R2→R3 diff; inspected actual Header/Code DOM consumers and relevant CSS. Own executable reviewer analysis, independently authored from actual Git blobs, confirms:

- Main→source changes exactly three allowed files: workbench.css, electronics-simulation.spec.ts, generated component-coverage.json; 611 additions / 1 deletion overall. R3 itself changes only the NEW scenario region and its browser digest.
- Removing the NEW scenario region yields byte-identical main simulation source: old helpers and all prior 120 browser scenarios, including accepted #531 in the other unchanged file, are preserved. No workflow, dependency, lockfile, production TS, API/physics/Arduino/auth/persistence or protected asset change appears.
- CSS is byte-identical preserved R2 `07a396785ea73d06394d29b66917428c0fa23521`. The causal 1373/1374 Header transition and Code toolbar wrapping remain; no new R3 production fix exists.
- The `record` capture/assertion helper and both original width-loop ASTs are strictly equal to R2 despite reindentation. No removal of clipping/text/full-caption/hit/clock/group/source/fixture/resize assertions occurred.
- Source manifests retain text 52, mixed 24, blocks 19 phases in the original order, totaling 95. Actual `playwright --list` registered 123 tests in the two Electronics files, old 120 plus three independent modes.
- Each registered case creates, saves and opens its own real API project, independently captures its own before/after receipts and own Playwright output directory. Both non-text fixtures retain the nonempty serialized setup/loop hats and generated source, rather than converting the text project.
- Full normalized server document equality and revision equality remain strict. Text adds an honest dirty local draft before/after receipt; both non-text cases preserve full dirty local document equality. Draft absence cannot establish a complete mounted document snapshot. Actual production clean load can clear local drafts, while Blockly publication can create them.
- No added timeout, retry, sleep, force, fake event/SDK or timeout bypass exists in the NEW region. Unchanged pinned Playwright/default config retains the 30000 ms test budget and retries 0.
- The generated JSON differs only at `generatedFrom/browserEvidenceSha256`, whose exact source hash is `00c225346b6c8d67307591cf8d88b1f574beaa64f58eb05fb60c59ec67a0fb25`.

Own script `reviewer-532-r3-static.mjs` executed successfully. Derived source-check JSON SHA256 `9d8b8a84362af84b4ca5f56f8e8849f261375443aecd79cf52a9cce895111cda`. `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-COMPACT-CONTROLS-001` completed EXIT0: routing PASS, 84/84 validator regression tests newly executed, no Nx cache involved. This proves static/routing preservation, not browser acceptance.

## 2. Exact GitHub/CI state

Independently queried live GitHub refs: main c47 and source ref bd4074. Checkout remained clean. Source is unintegrated/unaccepted.

General source run [37896979603](https://github.com/spikeal8-maker/asa-lab/actions/runs/37896979603), exact head bd4074, reached terminal **SUCCESS** in the independent final GitHub query at 07:20:55 UTC:

| Job | ID | Observed state |
| --- | --- | --- |
| Governance | 113710446798 | SUCCESS |
| Format/lint/types/contracts/build | 113710779444 | SUCCESS |
| PostgreSQL tests/RLS | 113711850454 | SUCCESS |
| Access real browser | 113711850499 | SUCCESS |

These are actual exact-source General workflow/job conclusions, independently queried. General success does not resolve the proved diagnostic blockers. Ordinary Electronics focused workflow on final source was **NOT_RUN**. No all-eight acceptance exists; raw General logs were not redundantly downloaded by this reviewer.

ONE changed-cause directed diagnostic [37897059035](https://github.com/spikeal8-maker/asa-lab/actions/runs/37897059035), job `113710697022`, terminal **FAILURE**, ran exactly the three NEW cases in the real isolated production build. Its head `7a79fa5194dac7a075cc591d0499e9c46f100303` differs from source only in temporary workflow, is outside final source ancestry, and is not the ordinary browser gate. Actual log confirms frozen dependencies, literal `NX_SKIP_NX_CACHE=true`, 0/6 + 0/16 + 0/27 Nx hits (49 fresh build tasks), one worker and three failures. It supplies directed diagnostics, not source CI acceptance.

## 3. Finding A — text case remains too large for its unchanged global budget

Priority P1, classification **A / NEW test packaging**, `e2e/electronics-simulation.spec.ts:2835`, text loop 3192–3284; surfaced at Stop click `3217`.

Actual result is text 32.1 s, `Test timeout of 30000ms exceeded`. It must not be presented as a proved product Stop/button failure. Independent parsing of both `test.trace` and browser trace shows:

- First real screenshot begins at 5560.851 ms; the last browser-traced screenshot `call@711` is the 45th phase, `980-running`, 32070.982→32175.685 ms, without error. All its hit points belong to the visible primary control.
- `After Hooks` starts at 32688.419 ms and context teardown starts at 32705.882 ms. At this point the test budget is exhausted while the resize gesture after `980-running` is being completed.
- The still-running test body produces six further raw rows/PNGs during teardown: `980-resized`, all three 390 phases, `320-stopped`, `320-running`. They exist, but cannot be counted as normally completed phases inside the test budget. Browser trace has only 45 screenshots; test trace has 51 and shows the last six after teardown begins.
- Reported final Stop `pw:api@14109` starts 34453.82 ms, ends 34813.684 ms, **after** timeout/teardown. Its generic locator timeout cannot establish defective product actionability.
- There is no preceding failed geometry assertion and no single long selector wait establishing a product cause. The text case executes 13,681 individual traced expects; aggregate trace assertion duration is approximately 3932.506 ms. Repeated real gestures/viewport phases and capture/assertion work cumulatively consume the fixed budget.
- `320-resized`, final text server document/revision and final local draft intent receipt are NOT_RUN; `intent.json` is absent. Earlier server GET is not a final intent receipt.

Required repair boundary: separately selected test-only packaging repair of this NEW text journey into shorter independently registered viewport segments with the original 30000 ms per-test budget and unchanged action/expect/navigation/screenshot limits. Preserve all 52 text phases, all assertions, native actions, actual resize intervals, mode/fixture intent, real own saved projects and final server/local/source receipts for every independent segment. Retain mixed/blocks coverage and old120 unchanged. Do not raise timeout, reduce assertions/snapshots, introduce sleeps/retries/force or declare post-timeout screenshots acceptance. A new exact source, changed-cause directed evidence and NEW final independent review are required.

## 4. Finding C — actual product workspace starts default external media requests before local rewrite

Priority P1 acceptance blocker, classification **C / existing Electronics product baseline resource dependency**, separate from CSS/text packaging. Both blocks-text 18.6 s and blocks 14.1 s complete their respective 24/19 layout phases and final intent comparisons, then fail unchanged browser-failures assertion `e2e/browser-failures.ts:130`, called at new scenario `3389`.

Actual trace network, not just implementer log, records three failed GETs in **each** non-text project:

`https://blockly-demo.appspot.com/static/media/zoom-out.svg`
`https://blockly-demo.appspot.com/static/media/zoom-reset.svg`
`https://blockly-demo.appspot.com/static/media/zoom-in.svg`

Failure text is `net::ERR_BLOCKED_BY_ORB`; status -1, no readable response/content. Mixed requests begin around 39081.277/39081.460 ms; blocks around 59861.875 ms. The same external `sprites.png` is separately fetched successfully (200, image/png) in both projects; this further proves a genuine external production dependency. No claim is made about the vendor server response body behind ORB or school incident frequency.

Actual causal source inspected independently:

- `apps/web/src/electronics/ArduinoCodePanel.tsx:541` calls `ScratchBlocks.inject` with zoom controls enabled but **no `media` option**.
- Pinned `scratch-blocks@2.1.19/dist/main.mjs` defaults its media path to `https://blockly-demo.appspot.com/static/media/` unless `options.media` is supplied.
- Existing local pinned-vendor imports already exist at ArduinoCodePanel 19–22 for sprites/three zoom images.
- `applyScratchMediaAssets` at 214–225 replaces `href`/`xlink:href`, but is invoked only in a later `requestAnimationFrame` at 701–704, after workspace injection has created images and initiated the default external requests. Final original PNGs can show local glyphs even though earlier failed external requests remain real.
- This product file, imports, lockfile and injection path are byte-unchanged between canonical main and reviewed bd4074. R3/CSS did not introduce the dependency; the stricter completed new scenarios expose it. It is not grounds for changing failures collector/allowlisting ORB or weakening tests.

Required boundary: controller should separately select one bounded production resource initialization repair that gives the workspace a valid same-origin pinned upstream media source **before** injection/request creation. Reuse approved upstream bytes and existing packaging; no generated/new artwork, owner SVG replacement, auth/CSP/ORB weakening, external-network workaround, owner deployment or scope expansion. Directed production browser evidence must show actual three zoom/trash assets loaded from intended same-origin sources and ordinary controls usable with no default vendor-host requests/failures, while preserving serialized workspace/source/circuit intent. Obtain its own exact SHA/gates/NEW independent review, then return to preserved #532 candidate for remaining packaging repair and final combined acceptance. The reviewer does not activate or implement that dependency.

## 5. Independently checked raw evidence and its limits

Original cached once by controller; reviewer inspected local originals without modifying them:

`C:/Users/spike/.codex/temp/electronics-e01/7a79fa51-ci/run-37897059035/`

| Original | Bytes / CRC entries | SHA256 |
| --- | --- | --- |
| browser-job-113710697022.log | 243851 | ebbdea6f9549512da314aa4582993635785960190de2c47cefb25f5b2716ab64 |
| artifact11600747219 ZIP | 86728191 / 131, CRC all valid | cab189b6af88b11e1534c878b0a3c5d6acfda089aa2d67b93bb595527c5bfdf9 |
| text trace.zip | 25561856 / 529, CRC valid | 303978dd0704c03c8b855dbbbd3dbe0484a8e2ad3f068f39914c122ae1521103 |
| mixed trace.zip | 25874790 / 361, CRC valid | d204092935d361efcf1cafd4610ee41542acee652b7967369b4654696bf0fcc0 |
| blocks trace.zip | 21276459 / 311, CRC valid | 599b120647a56ffa12f0d3bc51c3a905377626908ec8786df8a526b52a1e60b8 |

Separate actual Playwright output folders are identifiable by mode suffix and unique slugs `6b8b5` text / `1ac60` mixed / `b0bbe` blocks. Independently authored raw checker reparsed the original ordered manifests, finite numbers, page bounds, primary captions and accessible labels, rendered text ranges, five owned hit points, overflow ancestors, Header groups/full icons/control counts/clock, Code mode/control/font width, source/real component/hats, all original PNG signatures/dimensions and strict available full intent receipts. No visual inference substitutes for numeric checks.

| Mode | Raw rows / PNG files | Completed before timeout | Geometry SHA256 | Final intent |
| --- | --- | --- | --- | --- |
| text | 51 / 51 | 45 | e20c352504408b488c9b118f302e7a83ed5af98d908baa0f49c10810c9be2423 | absent, NOT_RUN |
| blocks-text | 24 / 24 | 24 | 06cced8da031bfea75726c3d5bc5cb123d28fef64c80cb27086bafb8c87a0e48 | e3552c8cffd25155082c8fc9de6309d7896af081901db25c7dbc40b58037d83b |
| blocks | 19 / 19 | 19 | 27a4faecde875ccff542294b29d0d83c6233392536741ff10226341f7d74eeba | 9dadf8ddfe9de19b71dbfc13e1b12b33fd475160e7adb7a0e66bc3ffc3b64dde |

All 94 recorded numeric rows satisfy those captured geometry/source checks, but only **88 phases** (45+24+19) completed before text timeout/teardown. This is **REJECTED_PARTIAL_ONLY**, not 95 PASS. Two complete non-text receipts independently prove server full document equality and revision 2→2. Own projects are mixed `d709d4fa-7711-4259-9a83-ea8be5a52b88`, blocks `3d662bdc-e557-4ae7-913d-d59daa09d743`; text earlier server GET project `34c87078-bbe1-40ae-992b-67a67906b03d` proves its saved fixture before, not preservation after.

Both non-text localBefore/localAfter are **actual full document dictionaries**, with viewport/components/simulation/connections/schemaVersion, strictly equal before→after and matching captured connections/source intent. They are **not null** and not identical to normalized server snapshots. An earlier intermediate reviewer message incorrectly said null/null; corrected by directly checking actual original receipt types/values, without changing any original. Full server equality and full dirty local equality are separate claims; neither creates a mounted React document capture. Final text local/server preservation remains unknown.

Derived independent partial checker `reviewer-532-r3-rejected-partial-raw.json` SHA256 `69bdee3af968f8791cd116cc7b8dc7b4c3d25398cc328820fb55561333f781f6`; result explicitly REJECTED_PARTIAL_ONLY. External helpers parse original failures rather than rerunning the product. Text before document was separately recovered from original network resource c36fe182c9d89acefbcb8c7641136c6ba07b4ccb.json; it is explicitly not synthesized final evidence.

## 6. Original visual subset actually opened

Opened eight original PNGs directly with view_image; no montage/edit/regeneration. File names below are relative to each actual mode folder's `electronics-compact-controls-532/`:

| Mode / original PNG | SHA256 |
| --- | --- |
| text / 1440-running.png | eea756a874a668218b4f6d081d2606293d5c9b448b56f4db5b845e75575ffb95 |
| text / 1374-running.png | 9cf1a2cb9d3abe80497bebe6b77aeb41ebddd8a9101a0cccf353e21494e5116b |
| text / 1373-running.png | fd4b9739e79dcd1356f900e7bd54589dbe33c78b9ca1683001b89b74de2bdd4e |
| text / 1024-resized.png | 158848154c8a2045c031d5b513de5c9e67182a46fdeda3cc73760a8c22bd2775 |
| mixed / 1373-blocks-text-font.png | bf4a6b6f6538801839d6daf9fc6466e89fd01c9c0261f561a8ef494c83c5ca4f |
| mixed / 390-blocks-text.png | 0c3eab4d878f29e1c6c97ba88f1a443bcba48afd6f103da08b41c7ca116629db |
| blocks / 1440-blocks.png | c234c9220d9fb107b2457829b3e7859adcedb8c550ad240f0c23946d02fc6374 |
| blocks / 320-blocks.png | 6098afb4ba77cb19e2321c2ffa832347ce4e5e94e7a48b5f73fde417366f502d |

These performed originals corroborate full desktop Start/Stop captions, 1374 single Header row versus 1373 two rows, usable full text-size selector and all Code modes with real circuit/hats, and preserved mobile presentation. No new layout defect in the selected Header/Code toolbar controls was found in this subset. Existing intentional drawer coverage/local source horizontal scroll and narrow block canvas are not a new proven product defect of this slice. Eight viewed originals do not mean all 94 were visually opened, and missing text completion/real external failures prohibit approval regardless of this visual subset.

## 7. Disposition and residual limits

FUNCTIONAL_ACCEPTANCE: incomplete / blocked.
CI_EXACT_SOURCE: General terminal all4 SUCCESS at 07:20:55 UTC; ordinary Electronics NOT_RUN.
INDEPENDENT_REVIEW: REQUEST_CHANGES.
INTEGRATION / ISSUE_CLOSE / OWNER_ACCEPTANCE: not authorized by this review.

Preserve published bd4074 and R2/source history, its causal CSS and partial original receipts. Separately repair the proved existing media initialization dependency with its own selected bounded author/review, then perform the selected test packaging repair and new final exact combined review. No same-code hopeful full-suite rerun; no broader asset cleanup or Arduino/physics semantics change. Preserve accepted #531/#529 and suspended/unaccepted #525/#526/#530 and other bots.

School installed version/full backups K0 NOT_VERIFIED, actual pupil device T3 pending, school frequency and whole-class/owner acceptance not established. No school installation, DB, backup or network action occurred. This rejection does not claim every school failure has this cause.

REVIEWER_STOP: this one exact-SHA independent review is complete. Programme controller may continue #452 through separately selected bounded dependencies under AGENTS.md §2.1. The reviewer selects and implements no next task.
