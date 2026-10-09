# Independent exact-source review — Electronics #531

**REQUEST_CHANGES for ba1018b4a4ccad7f3e6877aa7fb3ea419981324d.** The new native-image readiness observer is attached to an event target outside the resource-load event path. The single directed diagnostic confirms its assertion fails. This is a defect of the new test observation, not demonstrated product failure. No task acceptance, integration or closure is granted.

## Independent identity and method

Observed 2026-10-09, final GitHub snapshot around04:02UTC. Repository spikeal8-maker/asa-lab only; Issue531 OPEN. Canonical current.yaml selects TASK-ELECTRONICS-BROWSER-READINESS-001/in_progress/bounded_pending_sdk_readiness_repair, owner acceptance pending.

- Published source branch codex/electronics-browser-readiness-531 and local HEAD: ba1018b4a4ccad7f3e6877aa7fb3ea419981324d.
- Source tree: aef0ae18b9c68b5834d208ea964d5bf7dce91a92.
- Source parent and actual canonical main: dc76e97171ca8e44f49dd37d443f82e950e43b76.
- Checkout C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab clean throughout; preflight SAFE_TO_START, zero dirty paths/blockers/overlaps, remote refresh and actual control-plane PASS. Recovery after two read-only reader errors also SAFE_TO_START with unchanged exact source and clean tree.
- Actual preserved refs:53087099554c8227f841718fc052cc24f99f2883d41 and5260dd31b4d97cba4cbda935c66968e180fdc630a04. Neither is merged into this source.

Read root policy/entry, Electronics router, selected531card, review protocol, tracked530independent review/classification, complete one-file diff, full affected fixture, canonical Playwright config and actual ProductionComponentVisual consumer. Independently fetched published refs, exact GitHub run/job conclusions and Issue531 state. Controller/author statements were context; source/GitHub/cache were inspected directly. Did not rerun tests, download logs again, operate browser/stack/Docker/DB/network/backup/deployment, signal processes, edit repository/state/issues, commit or push. Only this external report is written.

## Complete source boundary

Main→source changes exactly e2e/electronics-interactions.spec.ts,192insertions/4deletions. No production DOM/CSS/bootstrap, API/auth/RLS, runtime/Arduino/physics/persistence/art/dependency/generated/config/workflow changes. Layout impact none.

The existing large-board rigid-two-pin case adds exact MAX SDK request holding, request/response/cancellation and navigation receipts, a native SVG load observer, asset/mask readiness, commit-level initial/reopen navigation and complete saved-document equality. The SDK request is intentionally unresolved; no SDK body, window capability, signed MAX data or authentication invention occurs. Existing mocked API fixture is unchanged and explicitly a UI-only fixture, not real server persistence or MAX Mini App acceptance.

Independently compared source text: all cases before the selected case are byte equal after the one Request type import; all cases after it and the full helper are byte equal after removing precisely the declared commit option/callback interface and callback invocation. The existing five physical drag/undo loop is byte equal. Default helper waitUntil remains load. Existing global30000/locator5000 budgets remain; no force, sleeps, assertion deletion or physics precision reduction. Full saved-document and reopened local-document assertions strengthen the selected profile. Pageerror collection remains in the unchanged helper; new console-error collection is asserted empty at final completion, without suppression.

Canonical ordinary workflow blob21d10e90a8f2d2e15583d2062c2745fa2531359b equals main. Separate probe1540eaf4274c6f53be286cf9b98dec3946aa0746 differs from source only at .github/workflows/electronics-r4-m1-focused.yml. Source does not inherit this probe: merge-base --is-ancestor returns1. Its production/test sources are therefore equal; diagnostic conclusions remain partial observation, not an ordinary gate.

## P1 — resource load cannot reach the Window observer

At source line256, addInitScript subscribes using window.addEventListener('load', listener, true). Listener filters SVGImageElement with componentId board and records ownerImageLoads. At lines316–326, requireProductionReady polls that array for the actual board owner-asset path.

The [WHATWG DOM Standard, Document interface](https://dom.spec.whatwg.org/#interface-document) specifies that Document's get-parent algorithm returns null for an event of type load. Its [event dispatch algorithm](https://dom.spec.whatwg.org/#concept-event-dispatch) builds the path from these parent results. Thus a resource load dispatched on a mounted SVG image can reach Document during capture, but Window is outside that path. capture=true does not bypass this termination. This is stronger than merely observing that load does not bubble.

Actual production consumer confirms the required event belongs to the mounted SVG image: ProductionComponentVisual.tsx:1783–1799 renders image with ownerImage.href, onLoad={ownerImage.onLoad}, onError and optional native-failure badge. The hook explicitly distinguishes mounted native onLoad success from preflight Image readiness (398–399), preserving real resource-consumer semantics. The new Window observer cannot record this event even if rendering succeeds.

The complete diagnostic's raw log and trace corroborate the faulty observer and exact assertion. Classification A: newly introduced test-observation defect. No production repair, changed Portal/MAX bootstrap or loosened asset proof is justified by it. Increasing5000 or30000 cannot correct an event-path mistake.

### Original directed diagnostic observations

[Run37881376880](https://github.com/spikeal8-maker/asa-lab/actions/runs/37881376880), exact probe1540eaf4, terminalFAILURE; job113661605613 terminalFAILURE. Isolated production image build, PostgreSQL/migrations and API/Web startup steps SUCCESS; directed single profile fails5.8s, not a full browser gate.

Raw job log contains exactly two BREADBOARD_READINESS receipts, parsed independently rather than trusting the derived JSON:

| Observation | Original value |
|---|---|
| Navigation commit | elapsed56.29282ms; browser26ms/readyState loading; no components/holes; DOMContentLoaded/load completion0 |
| Controlled SDK | id1 requested42.808871ms/held43.236588ms; no responseStatus/finishedMs/failedMs at both receipts |
| Application mounted | elapsed464.806162ms; browser419.2ms/interactive; exactly board/resistor, both hitMask ready, bindings0/2,882holes, zero owner-error badges |
| Owner asset responses | actual board URL HTTP200 at267.20489ms; resistor HTTP200 at305.74702ms |
| New image observer | ownerImageLoads[] at both receipts; subsequent5000ms poll remains[] and fails expecting board SVG path |

Trace CRC and network independently verified. SDK resource status−1/time−1 confirms no terminal response at recording; these are recording sentinels, not server HTTP codes. Board resource HTTP200 is recorded. The assertion stack identifies requireProductionReady316/test389; raw error reports predicate timeout5000, not original30s navigation failure. Source observers were installed before navigation. The standard plus source prove why Window cannot see a board resource event. The trace does not separately record a native board-load event, so this report does not claim it measured that event or its decode timestamp.

Initial commit navigation demonstrably avoids the previously observed external load barrier and permits real components/masks to mount while the SDK is pending. This does not accept the completed profile. Production-ready receipt, all five gestures/undo samples, complete save, actual reopen, old-request cancellation/new-request distinction, final errors/console assertions and BREADBOARD_PROFILE metrics are NOT_RUN because the assertion stops first. No school/T3 timing comparison is claimed.

## Exact CI, kept separate

Canonical main dc76e971 General37880628011 terminalSUCCESS/all4, independently fetched. It is baseline evidence, not source acceptance.

Exact source ba1018b4 General37881323469 remains in_progress at final snapshot: governance113661437473 SUCCESS, code113661687316 SUCCESS, Access113662538108 in_progress and data113662538184 in_progress. These running jobs are neither PASS nor FAIL. Ordinary final Electronics focused/benchmark/browser/review-images run is NOT_RUN; all required eight-job acceptance is unavailable. Even later General SUCCESS would not repair the concrete diagnostic failure or complete the unexecuted profile.

Diagnostic workflow is deliberately partial. No cached Nx/dependency result or author-local test count is promoted to fresh final evidence. This reviewer did not run gates or claim an Nx fresh-task count not independently audited from complete final logs.

## Original evidence integrity

Base C:/Users/spike/.codex/temp/electronics-e01/1540eaf4-ci/run-37881376880/. Independently computed bytes/SHA256 and verified all ZIP CRCs. Originals were downloaded once by controller; reviewer reused them.

| Original | Bytes/members | SHA256 |
|---|---|---|
| browser-job-113661605613.log |233192|2c29ed9b401b3601aa828036752f9559733222af50758894dd4bcd2130ffeffe|
| browser-artifact-11594931202.zip |4370867/28|7710861de5a02317e439afc256cb7549be600e56a887bdf57e4e7813d937ffa0|
| failure trace.zip |559656/61|4d34168486f1f476c9bacc6b72cd8165156993f32283731c3edfe260ea938c9f|
| failure error-context.md |94075|954e87d514783947cb09d3c456d283792fc6859590e6832f876631059854d65d|

Trace streams test.trace/0-trace.trace/0-trace.network inspected narrowly for failure/network evidence; no auth payloads or user data reproduced. Error context hash matches preserved530 context; that identity alone is not new product proof.

## Bounded correction and STOP

Controller should formally select a separate bounded repair of this test observer, then assign a fresh implementer. Minimal causal correction may capture native load at Document (or reliably bind the actual native image before loading), keeping SVGImageElement/board/path filtering and actual mounted-event assertion. Keep the same pending SDK scenario, component/mask/HTTP/error/full-document/reopen assertions, native gesture loop, limits, source scope and canonical final workflow. Do not substitute HTTP200, mask readiness or a separate preflight Image for mounted native-image success. Require original post-correction receipts and final required exact-source gates plus NEW independent review. A further directed observation must have explicit separate repair authority and a new causal hypothesis, not blind rerun of this source.

Preserve530/526/525/accepted529 and other accepted slices. Existing981 Run/font clipping remains its separate product dependency; this review does not waive it. SchoolK0/version/full backups and real pupil-deviceT3 remain pending, no deployment/owner/class/release claim.

**REQUEST_CHANGES / STOP.** Controller continues the authorized452programme after formal bounded correction; this reviewer makes no next task selection and performs no repair.
