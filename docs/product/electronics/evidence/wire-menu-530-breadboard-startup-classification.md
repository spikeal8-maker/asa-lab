# Issue 530: bounded classification of unchanged breadboard startup failure

Report kind: read-only CI failure classifier; this is not independent Issue 530 review, acceptance, release evidence, or permission to resume 526.

## Exact manifest and fresh snapshot

Observed remotely on 2026-10-09, final snapshot 03:20 UTC:

- Repository: spikeal8-maker/asa-lab.
- Canonical origin/main: `602f5aabda2c12370d7dda6f6cf46b19fe1817c3`.
- Candidate and published `codex/electronics-wire-menu-layer-530`: `87099554c8227f841718fc052cc24f99f2883d41`.
- Candidate tree: `84d1bda673f13d30734748032e0567a2c5239722`.
- Canonical electronics current.yaml selection: `TASK-ELECTRONICS-WIRE-MENU-LAYER-001`, Issue 530, `in_progress`, checkpoint `bounded_native_menu_layer_repair`, owner acceptance pending.
- Checkout: `C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab`; candidate HEAD, no dirty paths; divergence main/candidate `0/1`.
- Read-only `pnpm agent:recover --scope electronics --check`: `SAFE_TO_START`, exact same task/HEAD/main/branch, dirty paths 0. This grants no extra scope; this classifier made no repo edits.
- Fresh GitHub API Ordinary [run 37876603308](https://github.com/spikeal8-maker/asa-lab/actions/runs/37876603308), attempt 1: completed/failure, exact candidate SHA, updated 03:11:20Z.
- Shared solver/editor/contracts/build job 113646541427: success. Saved log independently shows 633 + 379 tests, Nx cache skipped; 1 SDK build + 42 typecheck/dependency tasks + 27 build tasks = 70 fresh tasks.
- E-OPT benchmark job 113647217649: success; three web build/dependency invocations of 6 tasks = 18 fresh tasks.
- Actual editor browser job 113647217531: failure at `Electronics M1 browser gate`; saved log independently shows 120 passed, one failed, 13.7m. Review-image job 113651257238: skipped.
- Fresh General [run 37876587447](https://github.com/spikeal8-maker/asa-lab/actions/runs/37876587447): completed/success, exact candidate SHA. API independently shows success for all four jobs: governance 113646489227, code 113646654758, Access A browser 113647626510, PostgreSQL/RLS 113647626521.
- New native wire menu test independently found in saved browser log: simulation.spec.ts:2834, PASS, 6.9s, timestamp 03:00:20.714642Z. This classifier did not audit its geometry receipts or substitute it for the whole browser gate.

## Classification and concrete cause

**Primary classification: D — external network dependency / navigation load barrier failure. High confidence causal attribution; not an A or B failure caused by the Issue 530 diff.**

The unchanged test calls `page.goto(..., {waitUntil: 'load'})`. Its navigation remained pending throughout the 30-second test budget while the sole unfinished request was the global deferred script `https://st.max.ru/js/max-web-app.js`. The editor bootstrap, fixture project response, catalog and component assets succeeded. The captured page already contained the intended board and resistor. On context teardown, the navigation unwound and the next assertion was scheduled after the deadline, producing `Received: undefined` in roughly 15ms. This is not evidence that the component count was wrong for five seconds.

The dependency is concrete, not a generic flaky-test label: the served document and unchanged source contain the deferred MAX SDK script, that exact script request has no terminal response in the trace, and the unfinished navigation is specifically waiting for load. An unfinished deferred script is a load barrier. The first failed action is therefore navigation completion, rather than breadboard interaction or component bootstrapping.

This classification does not assert a MAX provider outage, DNS fault, TLS failure, Docker outage, or browser process crash. None is proven. It identifies the observed unfinished resource and resulting wait. The global unconditional SDK include plus the UI fixture's default load wait is an existing coupling/risk in the baseline, which would require a separately selected shared bootstrap/test reliability slice if permanent remediation is needed. That latent baseline risk does not turn this observed external request stall into a candidate-caused B defect. No C product defect has been demonstrated by this run.

E is excluded: workflow and failure are terminal at the current exact candidate SHA, neither stale nor cancelled.

## Trace timing: proven observations

Trace times below are the recorded monotonic milliseconds, not GitHub wall-clock log output. Reference test start is 37142.621.

| Event | Trace time | Consequence |
|---|---:|---|
| Before Hooks starts | 37142.621 | test budget starts around this point |
| goto begins, test call pw:api@36 / browser call@534 | 37256.325 / 37256.486 | about 114ms spent before navigation, not 25s |
| goto log | 37258.124 | explicitly waiting until `load`; navigation timeout parameter is 0 |
| main HTML request | 37259.914, duration 7.038 | HTTP 200 |
| external MAX script request starts | 37305.663 | no response completion, status -1, duration -1, failureText absent |
| intercepted auth/me | 37396.406, duration 8.740 | HTTP 200; API route completed |
| intercepted initial project response | 37646.978, duration 41.847 | HTTP 200; draft.document has exactly board + resistor |
| board/resistor SVG responses | 37869.300 / 37872.062, durations 24.134 / 22.353 | HTTP 200 |
| final captured screencast | 38824.044 | editor chrome, large board and component library visibly rendered only ~1.568s after goto |
| periodic project API reads | 40843..64843 | successful short HTTP 200 responses about every 3s; app continues running |
| After Hooks begins | 67152.399 | test deadline already exceeded |
| context close begins | 67623.661 | teardown, not regular assertion budget |
| goto test step ends | 67627.195 | elapsed ~30370.870ms; no regular browser goto completion record |
| toHaveCount(2) begins / ends | 67628.436 / 67643.038 | elapsed 14.602ms during fixture teardown; Received undefined |
| context close ends | 67643.966 | assertion failure concurrent with context teardown |

The test trace independently records `Test timeout of 30000ms exceeded`. The expect step's parent is the context fixture teardown, whereas goto's stack identifies openEditor line 1029. The expect stack identifies line 1030. Thus the printed 5000ms locator expectation is configured nominally, but no five-second count observation happened here.

Network inventory: 81 records, 80 HTTP 200 (all host web:8080), exactly one unfinished record (MAX SDK host st.max.ru). The unfinished record has status -1 and total duration -1; those are recording sentinels, not a server HTTP response or a diagnosed DNS/TLS error. No page-error/console error event is present in this trace. Absence of such events does not certify all runtime behavior.

Error context independently contains `Макетка 882 точки. Перетащите для перемещения.` at line 60 and `Осевой резистор. Перетащите для перемещения.` at line 944, plus the populated editor/library. The final screencast was extracted locally from the saved trace to `C:/Users/spike/.codex/temp/electronics-e01/530-breadboard-startup-frame-38824.jpeg` and inspected. This proves the application rendered before timeout, not after the assertion. The error context was obtained during failure handling and proves both component semantics were present then. No direct successful DOM count query exists in the trace; a pre-deadline count of two remains an inference from the loaded response/rendering, not a separately measured fact.

## Source comparison and bootstrap chain

Main/candidate diff has precisely three files: 7 inserted CSS lines, new simulation browser scenario, and its generated coverage hash. No interaction test, HTML shell, JavaScript runtime, project state, persistence, physics, Playwright config, or dependency changes.

- workbench.css lines 2202 onward: only `@media (min-width:981px) { .workbench-toolbar:has(.workbench-wire-color[open]) { z-index:46; } }` plus comment. It changes the toolbar layer only with native details open. The failing test has made no interaction before its initial goto/count; captured toolbar menu is closed. No new CSS URL/import/network source is introduced.
- index.html:312: `<script src="https://st.max.ru/js/max-web-app.js" defer></script>`, byte-identical on main/candidate and independently confirmed in trace served HTML. Main application module/other assets succeed while SDK remains outstanding.
- electronics-interactions.spec.ts:184: builds large board + axial resistor, validates two hole bindings synchronously, then openEditor at line 220 before any drag. Lines 952-1030: default navigationWaitUntil load; route intercepts only `**/api/**`, initializes fixture draft, fulfills auth and project context as HTTP 200; the SDK URL is outside that intercept. Goto line 1029 precedes unchanged exact count assertion line 1030.
- ModuleEditorHost.tsx:61 registers lazy electronics editor; project/module resolver uses api.openProject and ready state. The project returns moduleKey electronics.
- use-workbench-project-state.ts:231-289 opens project, normalizes draft.document, updates component state. Trace fixture response has exactly board and resistor; normalization maps components without filtering them out.
- WorkbenchStage.tsx:887-911 renders each supported component as a g with data-testid schematic-component. Both assets and catalog loaded; failure context contains both component semantics.
- WorkbenchHeader.tsx:294 creates native wire-color details with no default open attribute; this test has not opened it.

Canonical git-show bytes independently compared by SHA256, identical on both SHAs:

| Path | SHA256 |
|---|---|
| e2e/electronics-interactions.spec.ts | 0fda1bd0f014ff01b0ad1e9b5e2d81ee17996caf164dd5b62804ee9eb7ad2660 |
| apps/web/index.html | eaa01435384d524b7aa0bdc5efcc454528a4fa19bd3709cad576a55104a67a48 |
| apps/web/src/modules/ModuleEditorHost.tsx | a1180a6e8bc44a4021e729372d9c23893943e89061781c455e76d7856a5f3796 |
| apps/web/src/pages/SchematicEditor.tsx | c2aea50c68e32cbf2f3c32149f36de874ea3ead05928e8a9ba7574e8de89673c |
| apps/web/src/electronics/use-workbench-project-state.ts | 0006a176e73acecec3eaf029b4d8ba0218eb703935af5daf0e6a116264e6e72b |
| apps/web/src/electronics/WorkbenchStage.tsx | 90aad06f30ff7e688de9c5c6f519f5a69b69f7056d60818d462c605565e96fc7 |
| apps/web/src/electronics/WorkbenchHeader.tsx | 8ff71ccf4b345a2d3ccf6282e545910946ad80a1e6ce7c9cf2055a872629dc0d |
| playwright.config.ts | a81ae8af25644836438c5fc898c5045c59a18eedfea799f769be828e791677ed |

## Evidence integrity

No original artifact/log was downloaded again. Parsed original cached inputs:

| Input under run-37876603308 | Bytes | SHA256 |
|---|---:|---|
| browser-job-113647217531.log | 262571 | 2103b15909ecfaafd9e2bf3dda72f880d2d900fe7fa37e6b19879003a1ab8d30 |
| browser-artifact-11593002249.zip | 21266839 | 3babdd9bc47d16fc168d97bb2d3a8d4749e34f0bcead36ca5f54ed7fa1312b69 |
| failure error-context.md | 94075 | 954e87d514783947cb09d3c456d283792fc6859590e6832f876631059854d65d |
| failure trace.zip | 679986 | 0bc3e566f48e823a7f7040784fec45fa3994f91789a9540716ded47a8e8f72bc |

Outer artifact CRC: all 152 entries PASS. Failure trace CRC: all 63 entries PASS. Trace inspected: test.trace, 0-trace.trace, 0-trace.network, served HTML resource, fixture response component metadata, screencast. Auth payloads, user details, passwords, and response/request bodies are not reproduced in this report.

## Unknowns and one next diagnosis, not executed

Unknown: why that external request did not finish (provider reachability, transport, browser/network edge, etc.); exact pre-deadline DOM query result; whether other runs/main encounter the same stall; full ordinary gate after any intervention. No outage claim or assertion of a repaired gate is justified.

Propose ONE controller-selected, isolated CI diagnosis against the same exact candidate: run only the existing large-board/rigid-two-pin scenario using its unchanged assertions and 30000/5000ms limits, with a diagnostic pre-navigation route for exactly `https://st.max.ru/js/max-web-app.js` that fulfills an empty JavaScript response immediately. Keep same-origin API fixture and application build identical. Capture sanitized navigation/request event times and load completion plus existing component count. This is a controlled external-dependency substitution in a diagnostic harness, not production repair or Issue 530 product scope.

Prediction: the SDK request gets a finite terminal response; goto load completes early; the existing toHaveCount(2) executes before teardown and passes, allowing the original breadboard interactions to start. If navigation still stalls with that sole substitution, stop this hypothesis and inspect the new trace for the unfinished load resource; do not increase timeouts or relax assertions. The result can discriminate the load dependency; it cannot by itself replace the required ordinary browser gate or establish permanent baseline reliability.

Controller must formally select this diagnosis before execution. If remediation is required, select a separate bounded bootstrap/test dependency reliability slice with its own review/evidence; do not alter runtime/fixtures in Issue 530. This classifier does not authorize a whole-suite blind retry. Ordinary browser failure remains failure until required exact-SHA evidence is obtained under the repository contract.

## Actions and STOP

Performed: policy/source reads, read-only recovery, Git refs/status/diff/hash comparison, GitHub exact-SHA status metadata, cached artifact/trace/log parsing, one cached screencast extraction/view, external report write.

TESTS_RUN: none. No browser/test/workflow rerun, local stack, Docker, DB, backups, networks, deployment, restart, process kill, commit, push, product/state/fixture edit, or Issue action. DEPLOYMENT and DATABASE_ACTIONS: not requested/not run. WORKING_TREE: clean at final observation. MAP_NODES_CHANGED: none. 526/525/529 and programme 452 are preserved. NEXT_ALLOWED_TASK: controller selection required for the single proposed diagnosis; this classifier makes no next task selection.

STOP. No Issue 530 acceptance or independent-review verdict is claimed.
