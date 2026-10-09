# Independent exact-source review: Electronics 533 R3

VERDICT: REQUEST_CHANGES
STATUS: STOP
TASK: TASK-ELECTRONICS-BLOCKLY-MEDIA-INIT-001
ISSUE: 533; programme 452
SOURCE: b5045472f3a6670f36014cf3ca43d5145e3ed0c6
TREE: 03e2c969795aa07379d08f0309a4469bc93f70df
PARENT: 003a9cf57ad4b50320eb110602db44afadc68b79
PUBLISHED REF: codex/electronics-blockly-media-init-533-r3
CANONICAL MAIN OBSERVED: 76722036a6925e258f9ae855666de6fbd22b4b19
CHECKPOINT: r3_bounded_canonical_media_fixture_test_repair
REVIEWER: NEW independent R3 reviewer; neither author nor prior reviewer.

## Verdict and required action

The R3 fixture repair is bounded and its strengthened initial fixed-point assertion passes in both actual production browser runs. Media initialization, four pinned initial bodies, strict cache revalidation and all seven control phases per mode also pass the observations below. This is nevertheless NOT acceptance: the retained whole server draft equality fails at e2e/electronics-simulation.spec.ts:3285 in BOTH modes, because a page reload commits the same full document again and increases the real server revision from 2 to 3.

F1 / required acceptance blocker / classification C: independently confirmed pre-existing Electronics persistence behavior, outside the media initialization change. Initial Scratch publication commits a new object even when every program property already equals the current document; persistence treats reference inequality as unsaved intent and flushes the identical payload on page exit. The new media fixture exposes that behavior. The actual source consumers responsible for the write are unchanged relative to canonical main, except for the separate four-line media option in ScratchWorkspace. This is not a new media-induced document mutation and not another missing-default or hat-position fixture defect.

A controller must select a separate bounded product repair for this proven no-op initialization/dirty transition before returning to 533 acceptance. Preserve genuine immediate source edits and the page-exit safety save; eliminate only a proved unchanged Arduino-program commit against the latest canonical document. New focused negative and genuine-edit regressions, real unchanged-reload and changed-input save scenarios, exact gates and a NEW independent final-source review are required. This reviewer selects no next task and edits no product code. Do not remove revision equality, move the initial baseline after mounting, add a Save or wait to conceal the write, increase a timeout, or repeat this unchanged code hoping for green.

There is no demonstrated loss or modification of pupil circuit/source data in this run. A redundant revision/updatedAt mutation is proven; its broader classroom frequency and impact are unproven.

### Follow-up contract concern: clean local state after a true no-op

The NEW R3 notNull/localBefore==server assertion currently passes because the unconditional no-op commit itself creates a local draft. A correct separately selected no-op fix may leave the initial local draft genuinely absent: the existing load path clears saved local data when it matches the server. Requiring a redundant local copy is not the pupil intent contract. Do not silently delete this assertion inside the present media-only scope; make the changed expectation explicit in the new baseline repair card and independently review it.

For that separately scoped repair, a clean-saved browser case should assert actual local key absence before interaction and after reload, plus unchanged complete original server draft/revision, actual Code/source/hat state and all ordinary control/media assertions. Preserve the whole existing local comparisons, but report equal null snapshots only as absence of a dirty recovery record, never full local document preservation. Add complementary mounted production controller/hook tests that obtain the REAL current canonical document/reference from the existing controller interface, verify a same-value Arduino update changes neither that reference nor history/save activity, and prove a real source/workspace edit immediately updates/persists the latest document without losing another component's concurrent local intent. Exercise real changed input and final complete server payload in a browser scenario so that no-op filtering cannot accidentally swallow a genuine edit.

Do not add a public export control, browser-global state accessor, alternate writer or test-only runtime branch merely to observe this. Existing controller APIs in a mounted test and real server/user-flow observations provide a narrower proof. No observation of server/local data should be relabelled as direct React/worker mounted-state evidence. This is a recommendation for the controller's separately selected task, not authorization or acceptance of any future change.


## Independent entry and source verification

Read policy/root entry, GitHub-first protocol, delivery workflow, Electronics router, ui-assets-persistence component, CircuitDocument contract, AGENT_GUIDE scope/risk/evidence/review sections, review protocol, UI layout contract and the actual 533 R3 card. No author/root report was used as proof. All conclusions below come from Git objects, actual source consumers, live GitHub API or the original cached logs/artifacts.

Executed read-only pnpm agent:preflight --scope electronics --check in C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab. Actual result: SAFE_TO_START; task in_progress; checkpoint R3; source b5045472; origin/main 76722036; dirty paths 0; blockers 0; worktree overlaps 0; remote refresh PASS; control plane PASS. Independent Git/GitHub checks confirm source tree, published source ref, canonical main and divergence 0 behind / 7 ahead. Checkout remains clean. No refs, index, execution state or repository files changed by this reviewer.

Main-to-source diff has exactly five permitted paths, 558 insertions / 1 deletion:

- apps/web/src/electronics/ArduinoCodePanel.tsx: four-line pre-inject local media configuration.
- apps/web/vite.config.ts: existing pinned asset emission/inlining configuration, 27 lines.
- apps/web/src/electronics/testing/arduino-code-contract.spec.ts: new resource contract/import, 52 lines; existing contract assertions preserved.
- e2e/electronics-simulation.spec.ts: two mode instances of the new media test, plus createHash import.
- docs/product/electronics/generated/component-coverage.json: canonical browser digest only.

Final R3 commit changes exactly the latter two paths, 16 insertions / 4 deletions. Actual changes are two hats x330 to x400, existing resistor default powerRatingWatt=0.25, button-0 contactState='released', and two extra initial-local assertions. Fixture fields are set BEFORE first API save, retaining the original pre-mount server baseline. No product changes were made by R3.

Independently removed only the new test region and createHash import in memory: remaining browser source is byte-for-byte canonical main, preserving every prior case including accepted 531. No CSS/Header/runtime/physics/parser/auth/dependency/workflow/state/assets or protected owner data changes. All old R2 observer/final intent assertions remain; new-region expect calls 39 to 41. Default 30000ms and other existing budgets unchanged; no interception, forced clicks, sleeps or timeout extension.

Product and focused-contract files are byte-identical first source 680ab8bf383280ee512ac4eca358290b817c5989:

| File | SHA256 |
| --- | --- |
| ArduinoCodePanel.tsx | 9709c0f6e7750c5f62a4fd16f1d41590c28bb5a5a7f71775d8d3e8bb59ff0fa0 |
| arduino-code-contract.spec.ts | 799d49e880fa88a1067cc77d6be8b764893d85335f5d5dd960b058b11746aa72 |
| vite.config.ts | 753233ad41c1b7a2738699bbfad75b0c9bfef9589b9118143a5fe9fbcf1ccf04 |

Browser source SHA256 independently recomputed: 7e49d90654d3952a10f870ef85f36652aab46828207fd46a92b956b0e3d572e8; generated coverage records exactly this value and all other generated data is unchanged.

Actual production-manifest-adapter.ts:340/367 defaults are resistor 0.25 and button released. normalizeLoadedDocument merges those defaults. keepWorkspaceClearOfFlyout uses width290 / initial scale0.86 +42 = 379.2093..., so x400 avoids the old positional normalization. Both setup/loop IDs, source, values, connections and modes remain intact. The former R2 fixture was schema-valid but not a fixed point of existing initialization; no claim that legacy pupil data was invalid or universally safe.

Pinned ScratchZoomControls reads workspace.options.pathToMedia inside createDom and synchronously builds the separate image hrefs. The source config supplies the local base before inject. Vite limits no-inlining and stable filenames to the four existing scratch-blocks media assets; its common deterministic content directory is verified in actual browser URLs. Other assets retain their existing naming behavior. No new art or vendor bytes are introduced.

## Exact CI and diagnostic identity

Source General run 37907895948 is on exact b5045472f3a6670f36014cf3ca43d5145e3ed0c6. Latest independent final API snapshot at 2026-10-09T09:05Z: in_progress, not accepted. Jobs:

| Job | ID | Observed conclusion |
| --- | --- | --- |
| Governance contracts | 113745702589 | SUCCESS |
| Format lint types contracts build | 113746053034 | SUCCESS |
| Access A real browser journeys | 113747536836 | in_progress |
| PostgreSQL tests and RLS | 113747536882 | SUCCESS |

Ordinary exact-source Electronics workflow: NOT_RUN. Do not dispatch a full suite merely to reproduce this now-proven failure. Even a later green General cannot override the failing strict user scenario or replace ordinary exact Electronics acceptance.

ONE directed run 37907937816, job113745852085, completed FAILURE on workflow-only child 8b347f153396e3035b146b76c5188a63060009b8. Independently verified child changes ONLY .github/workflows/electronics-r4-m1-focused.yml and is outside source ancestry. Canonical final source workflow is unchanged. This child is NOT source exact-SHA ordinary gate evidence. It retains canonical isolated production Compose build, frozen dependencies, literal NX_SKIP_NX_CACHE=true, test and job limits. Actual log shows 49 fresh Nx build tasks with 0 hits: Web6 + API16 + test-runner27. Both cases fail in 7.6/7.2 seconds, not at timeout.

## Original evidence identity

Original cache root: C:/Users/spike/.codex/temp/electronics-e01/8b347f15-ci/run-37907937816

Root fetched originals once; this reviewer independently read and hashed existing local originals, not downloaded again. Original artifact ZIP CRC PASS, 46 members; nested trace ZIPs independently CRC PASS.

| Original | Bytes / members | SHA256 |
| --- | --- | --- |
| browser-job-113745852085.log | 243203 | 940cecb75fb7002afe2674e3f50140805ce95f23e27186e49e4136008e6b3c54 |
| browser-artifact-11604943191.zip | 31022028 / 46 | 9d667a1d226fd8517bbf69a73f7b279f9f4298ac844cd90b820bf7678ddf9e43 |
| blocks trace.zip | 12283306 / 182 | 6db6e4bc137aab456ae88d183d4de5997b7e57d214a1e39a0c3fe852d6410f6d |
| mixed trace.zip | 12497747 / 187 | dd753df67a85f570b431fdd8631ebcb4cb15ed4c945acddd292450980c712a35 |
| blocks media.json | 74985 | cd470be9a98cfa11ccc152654b4b4a19b8c87dd237bbb184a55db39ff3573dbd |
| mixed media.json | 75025 | cfdd7d78ece3cd6620b645179e0f1eab1a195d75399ebc5277bb6be45b8fbbd8 |

Actual original folders under extracted/reports/playwright:

- electronics-simulation-Ard-4fb81-rst-initialization-—-blocks
- electronics-simulation-Ard-8e4af-nitialization-—-blocks-text

Each contains electronics-blockly-media-533 with seven original PNGs/media.json; BOTH intent.json files are ABSENT because the retained whole-draft equality stops before writing them. Missing final receipts are not represented as completed acceptance.

## Independent media/control and temporal observations

Each mode has eight media requests and eight matching responses: first four same-origin200 with actual readable bytes, then four same-URL304. Independently decoded actual network resources and hashed each initial response body, matching both original vendor files and expectedHashes. No Blockly demo host requests in either complete trace. For every304, bodyRead=false, verified200At matches that earlier verified200, request If-None-Match exactly matches its actual earlier ETag; response tags retained. ObserverErrors is an empty array. Arbitrary redirects or missing prior bodies cannot pass the retained observer assertions.

| Media | SHA256 of original vendor and actual initial200 body |
| --- | --- |
| sprites.png | 1818e665c0ef16301f0e36cb05727727c4064a065938de307d6225f85a22de5c |
| zoom-in.svg | c384c0c03cca7ededeec1330a95bc5f17f41be10ddbbe9b207d3b777cc39e8c0 |
| zoom-out.svg | 525427509ed6e060359d90c65eeb2eba35a66bf51b6145217b9cd484d5a3ddfc |
| zoom-reset.svg | 02e1a5f57a418421d6b988f6c7282d917db8ea9d0fb229a510ea4e37ec075253 |

All seven phase rows per mode exist: initial, zoom-in, zoom-out, zoom-reset, reopened-zoom-in, reopened-zoom-out, reopened. All four control bounds fit recorded viewport/ancestor clips; five real hit points per control hit inside the intended control. Original normal click/scale assertions execute. Recorded scale sequence each mode: 0.8600000143, 0.9460000396, 0.8600000143, 0.8600000143, 0.9460000396, 0.8600000143, 0.8600000143. Changes in transform reflect ordinary zoom and centering; persisted serialized block positions remain x400.

Independently joined each screenshot call to its completion in the SAME browser trace, then compared to its corresponding test After Hooks. All seven screenshot calls per mode finish before teardown:

| Mode | Last screenshot start / end (trace ms) | After Hooks (ms) |
| --- | --- | --- |
| mixed | 9318.075 / 9425.176 | 9495.150 |
| blocks | 17915.463 / 18020.966 | 18086.579 |

Personally opened four ORIGINAL PNGs using view_image: initial and reopened in both modes. Zoom controls/trash are visible and inside their Code workspace, and mixed source is present. This is a bounded desktop media usability observation, not broad responsive layout or school acceptance. No image editing or montage.

Four viewed original SHA256 values: blocks initial cbd19880482387c0e19c9764625446796702bbf895e99d88b751e778f096eabe; blocks reopened 56f0be84f2a29d0760cf1611fc4b714a0492c51972b5536a28dca54f2869b7ec; mixed initial 35a729b49b722c3e26d4b63f1047c98fdc6b1825e582de534f06b41d7a303126; mixed reopened d6e59a3688ae5fc07dec9bd5876890aad9365b74715f30d2a6511a94eeadfd8d.

## Independent complete intent and causality proof

Decoded full actual original server GET resources, full page-exit PUT resources referenced through postData._sha1, and all three localStorage documents from browser evaluate results. Did NOT compare just revision/digest/selected fields or a truncated log. Did NOT compare raw fixture PUT with later normalized server payload. The initial persisted server document is the canonical baseline.

For each mode:

1. Pre-mount server GET has revision2; new initial notNull and complete local==before.document assertion passes before the first gesture.
2. Full localBefore, localAfterZoom and localAfter documents are real non-null objects and each equals that full original server document.
3. Actual afterZoom server GET still has revision2 and whole draft equals original baseline.
4. Reload starts; page-exit PUT uses baseRevision2 and contains exactly the same whole document as the original server GET and every local snapshot.
5. A subsequent real GET200 reports revision3 with identical whole document and identical full preview/digest. Only draft revision and updatedAt differ. This proves a committed redundant write.
6. The exit PUT's trace HTTP status is -1, so this review does NOT claim a received200 or transport success from that request itself. The real next GET proves server state advancement.

| Evidence | Mixed | Blocks |
| --- | --- | --- |
| Project ID | df23c015-314b-4d11-896e-485a0c03d7e8 | c1d9228a-1646-4113-b441-516809188f49 |
| Initial local read start/end | 5315.533 / 5332.116 | 14028.484 / 14043.890 |
| Post-zoom local read start/end | 7132.630 / 7142.960 | 15830.999 / 15840.742 |
| Final local read start/end | 9467.143 / 9478.031 | 18058.900 / 18069.214 |
| Last pre-reload GET (ms) | 7154.741 | 15853.118 |
| Reload start (ms) | 7172.961 | 15867.846 |
| Exit PUT start (ms) | 7193.077 | 15888.280 |
| First revision3 GET200 (ms) | 7366.029 | 16042.229 |
| Exit PUT original resource SHA256 | 22f2802ff6cfaf0349cf34fd89c50e54c7fd31a609cbe30e223c6926235e90ec | 3c461c5020a647fb4ef761b80926045199b1d061a2df9c19e3a1b2b7b96c95e5 |

The non-null local documents are actual browser storage snapshots, not an observation of React/worker mounted state. Source strings, full serialized workspace with both hats x400, all physical component properties, connections and all remaining document fields equal the pre-mount server baseline; no field was removed for this equality.

Actual causal source chain:

- ArduinoCodePanel.tsx:709-714 ScratchWorkspace publish serializes current workspace and unconditionally calls changeRef; this happens on initialization.
- ArduinoCodePanel.tsx:1318-1322 updateProgram always calls persist, even when the supplied source/workspace/mode properties equal the current values.
- use-electronics-workbench.ts:1281-1305 updateArduinoProgram reads the newest document correctly but always constructs a new component/document object and calls commitDocument without a no-op check.
- use-workbench-project-state.ts:382-389 commitDocument calls setDocument before pushHistory. pushHistory can skip an equal serialized history entry, but this does not undo the dirty/reference transition already made.
- use-workbench-project-state.ts:200-226 setDocument replaces documentRef and writes a local snapshot. It does not check equality with existing canonical intent.
- use-workbench-project-state.ts:633-647 flush guards use object-reference inequality against savedDocumentRef/savingDocumentRef, then call persist(current,true,true). That explains the observed page-exit same-content PUT and revision increment.

use-electronics-workbench.ts, use-workbench-project-state.ts and production-manifest-adapter.ts are independently byte-identical canonical main. Their SHA256 values respectively: 99ad2f80fa82a4ba41388e4f0e24cf91e7c739984bf7f5a2cd74ac0781ce119c; 0006a176e73acecec3eaf029b4d8ba0218eb703935af5daf0e6a116264e6e72b; dca4b038898cee7f54a3f0e444f9399154ce5faa03566501d42f244282ca8940. The corresponding panel publication/update logic is unchanged by the four-line pre-inject media change. This establishes classification C at the code/actual-trace boundary; no separate browser run on main was performed or claimed.

## Limits, unrun work and stop

The final failures.assertEmpty() and localAfter equality assertion after the failing server assertion are not executed; their conditions were not counted as test PASS. Independent raw comparison establishes local document equality separately. Complete traces also contain aborted lifecycle analytics/diagnostics requests; an empty media observer error list is not a claim of zero errors across all browser traffic.

Reviewer ran no unit/browser suite, CI dispatch/rerun, build, install, Docker operation, Git mutation, database/backup/network/deployment operation or next task. Only preflight, bounded reads, Git/GitHub snapshots, original CRC/hashes and read-only in-memory independent verification were performed. One exploratory source-proof helper mistakenly counted regex .test calls as test registrations and asserted incorrectly; the helper was corrected to anchored Playwright registrations and passed. No repository edit or test relaxation followed that helper error. Two exploratory guessed vendor/source paths were absent; read-only lookups were corrected using actual mapped paths. Neither event is hidden as a product failure.

Preserve all accepted and suspended work, especially 531, candidate 532/530/526, suspended525 and existing 505/506. School installed version/full backup availability K0 and actual pupil-device T3 remain pending; no owner/class/release/deployment acceptance is implied.

NEXT_ALLOWED_TASK: STOP / controller independently selects the proved no-op baseline repair, then returns to exact combined-source acceptance of 533.
