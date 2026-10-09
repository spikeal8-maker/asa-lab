# NEW independent exact-SHA review — Electronics #526 E01 R3

VERDICT: **REQUEST_CHANGES**

TASK: TASK-ELECTRONICS-SAVE-RECOVERY-001; ISSUE: 526; STATUS: independent review complete, one P1 UI finding.
COMMIT_SHA: `0c8a0d5e606e037078e7d8a5bff47b70d299ab23`; TREE: `33825fb81e99188ba992ca21c2d590b8b68355a4`.
CANONICAL_MAIN: `3d38faf6a26ee210caf4ea8583c8a049aa5192a0`; branch: `codex/electronics-save-recovery-526-review-r3`; divergence main0/candidate6.

New independent reviewer, not the author, controller or previous526 reviewer. Reviewed the complete final16-path diff2170+/234−, not only R3 tests. No repository/source/execution-state edits, commits, pushes, deployment, database actions, process signals, local/browser/Compose runs, gate reruns or artifact downloads were performed. Original controller-cached artifacts were read independently. Only this UTF8 report was written outside the repository.

## Required correction — P1: JSON error action clips the adjacent Run action at1024

Actual FINAL original `after-local-denial-1024.png` visibly cuts off the label **Начать моделирование** at the viewport right edge. Original raw `after-local-denial.json`, SHA256 `6dab9b5a09eb4fa5e6ec99d16118775a259ca688215ed1904094ea9e050455f8`, records viewport/pageWidth1024 and the Run button at x892.546875/right1114.546875/width222. Thus90.546875px of the action extends beyond the viewport. The JSON caption itself is complete and clickable, but the adjacent active primary action is visibly clipped.

Source: `apps/web/src/electronics/WorkbenchHeader.tsx:388` adds the conditional JSON button before the existing right-toolbar consumers; `apps/web/src/electronics/workbench.css:2279` gives it intrinsic width/no shrink. This candidate's error state adds94.15625px plus7px gap ahead of the unchanged Code/Save/Run consumers. The ordinary desktop Run width remains222px at CSS3344; the mobile overflow/compact rules start at980px and do not handle1024. Canonical main has no JSON action, and the entire main→candidate CSS diff is the four emergency-copy lines. Historical c15/520 screenshots containing the same clipping are prior E01 candidates, not evidence that canonical main already had this new action.

Counterfactual geometry inferred from the unchanged neighboring widths and flow: subtracting the added101.15625px puts Run right at1013.390625, within1024. This is a source/geometry inference, not a claim of a separately executed main-browser comparison. Independently of that inference, the actual final screenshot establishes a known clipping defect on this changed toolbar. The already offscreen disabled Send action is not selected for repair here.

The UI contract applies to the whole changed surface and its real consumers: ASA_UI_LAYOUT_ACCEPTANCE_SPEC §§2/4.6/6/10A/11 and review-protocol §§2/3 forbid calling a changed UI ready with a known clipped primary CTA. The task's R2 boundary explicitly requires checking all affected right-toolbar consumers. The current browser assertion at `e2e/electronics-simulation.spec.ts:4231` verifies positive neighbor widths and ordering, but never requires their right edges/labels to fit; its PASS does not establish complete toolbar usability.

Required bounded repair: make the JSON-present1024 right toolbar preserve the complete readable/clickable active Run action and the full emergency JSON caption, with meaningful regression evidence for the affected adjacent active actions, both JSON-present/absent and applicable Run/Stop states. Preserve1440/1024/390/320, no page overflow/overlap, whole-document JSON, all successful E01/529 behavior and existing budgets. Do not turn this finding into a whole-editor redesign or unrelated disabled-Send cleanup. Obtain ordinary exact-SHA gates and a NEW independent review for the corrected final combined candidate.

Classification: A, defect of the current combined E01 diff; HIGH persistence review with L2 domain mutation/L1 UI behavior and mandatory state-machine challenge review. No newly established persistence, solver or authorization defect was found.

## Actual remote/state/source verification

Actual GitHub repository is only `spikeal8-maker/asa-lab`. Independently queried main and candidate refs at entry and immediately before this report; exact SHAs above remained unchanged. Checkout remained clean on the published branch. Canonical current.yaml selects526/in_progress/R3 bounded crash-and-scope evidence repair; applicable execution blockers absent, unrelated scoped acceptance blockers remain. Candidate current.yaml is byte-equal main. Suspended525 remains `ed4ee96949c5dd5a2fde035e2f7d9e61d5ba88df` and was untouched.

Read AGENTS, START_HERE_FOR_AI, Electronics router/task/card/component map, owner registry E01/K1/SAV01–12/section10, global review protocol and UI contract. Reviewed every production/test path in the16-file diff and exact R3 two-path176+/28− change. `git diff --check` clean. Workflows, dependencies, lockfile, API/auth/RLS/migrations, solver/Arduino runtime and protected owner artwork have no main→candidate diff. Ordinary Electronics workflow blob is `21d10e90a8f2d2e15583d2062c2745fa2531359b`, byte-equal main. Independently compared parsed generated coverage: sole change is generatedFrom/browserEvidenceSha256, equal to actual LF browser-source SHA256 `a664f9d93bd643abe93bb5ac6c2f21c96192cb609ab434f1a6df62a431a4d4a5`; all other fields equal main.

Challenge review: verified account/seat/project schema3 namespaces and identity validation, no adoption/deletion of unscoped schema1/2 legacy bytes, compatible unchanged Chess/Checkers default schema2 callers, getter/quota/readback failure handling, exact-current-document local durability and emergency export. Serial queue/CAS/three-way merge retain newer edits and confirmed revisions; stale load/save/retry work cannot mutate another scope. Auth/permanent/conflict errors halt automatic sending; editing does not erase unresolved failures. Transient backoff5/10/20/40/60 seconds then at most one attempt/minute, with one request in flight and original60-second dirty deadline. Manual/safety saving and local simulation remain intact.

R3 crash targeting fails closed before signaling: actual current-page unique performance.mark; one trace renderer PID; fresh own-browser CDP renderer membership; safe distinct Linux PID; synchronous bounded /proc PPid/NSpid ancestry ending at the same browser, with no await before the one signal. Assertions still require actual page.crash, crashed evaluate rejection, no pagehide/safety PUT, complete recovery/server confirmation. SAV10 uses canonical native same-document history traversal, equal timeOrigin and pending reply preservation, real logout/session revocation/editor absence, actual distinct B login and denied A-project access. Removing the old visible-A-editor expectation follows actual logout semantics and strengthens privacy; it is not a weakened isolation condition.

## All required ordinary CI jobs — exact0c8, terminal SUCCESS

General [37865142075](https://github.com/spikeal8-maker/asa-lab/actions/runs/37865142075), attempt1:

| Job | ID | Conclusion |
|---|---|---|
| Governance contracts |113609964629|SUCCESS|
| Format/lint/types/contracts/build |113610230393|SUCCESS|
| PostgreSQL tests/RLS |113610904181|SUCCESS|
| Access A browser journeys |113610904164|SUCCESS|

Original General ZIP373623bytes, SHA256 `279953622eb79babf05cf2c4f1f193336517d1cf17dd1638ceb9c9d6a67276a7`,61members, independently CRC PASS. Actual registered governance/code/data commands, required GitHub control-plane PASS, full Compose check PASS, frozen dependencies and literal NX_SKIP_NX_CACHE=true verified. Logs show3192 Vitest/16 RLS/652 synthetic/10 Access/284 layout PASS. Code96 + Data43 + Access27 =166 fresh Nx tasks, zero hits. Validator fixture SKIPPED_FOR_FIXTURE is not the actual control-plane result.

Ordinary Electronics [37865154341](https://github.com/spikeal8-maker/asa-lab/actions/runs/37865154341), attempt1:

| Job | ID | Conclusion |
|---|---|---|
| Shared solver/editor contracts/build |113610005629|SUCCESS|
| E-OPT benchmark integrity |113610651128|SUCCESS|
| Actual editor simulation journey |113610651130|SUCCESS|
| Exact-head review images |113614923124|SUCCESS|

Independently verified final run/jobs/head and successful review-image revision-label/export/upload steps from actual GitHub metadata. Read original review-image log70960bytes SHA256 `0e7dfe276c9752b4549da89ff00514dd5775a0196cedc70455a36a7fdff2be16`; exact API/Web label comparisons succeeded. Large image archive was not downloaded or deployed.

Focused original log101183bytes SHA256 `9812a87ca4dcf85610bc88ebdff93e82e8154df4d11df0137a42b020173bb95a` proves633 engine/399 editor PASS; module1/types42/build27 =70 fresh Nx tasks, zero hits. Browser original log259140bytes SHA256 `9661f073eac96959855da04984a5ba5d3ca7371c4c8fa569d5b037763d917df0` proves127 PASS/13.2minutes, ordinary registered browser command, exact0c8 images and isolated cleanup;49 fresh image-build tasks/zero hits. Final browser ZIP20118875bytes SHA256 `224cbe820b3b367c00b052abc49b410535155359b001589944c52a4e6e5b9439`,149members, independently CRC PASS. No workflow exception or old directed run substitutes for these results.

## Independently verified original final outcomes

Read all11 original E01 JSONs and both529 JSONs directly from the cached final ZIP; deep comparisons include full documents, not only a resistor/title. Successful run retained no Playwright trace ZIP. The original renderer-crash-injection JSON contains the actual CDP timing event and process ancestry; source/logs/raw network/reply receipts and PNGs were inspected. No missing success trace is represented as a retained Playwright trace.

| SAV boundary | Actual final outcome |
|---|---|
|01 normal save/reopen|PASS: full last PUT=server=second-profile server, revision3, changed sketch/schema preserved.|
|02 exit/abrupt termination|PASS: genuine departure and actually observed renderer crash; abrupt crash29ms after signal, no lifecycle/safety PUT.|
|03 quiet network recovery|PASS:2 requests/1 HTTP200, successful response5089ms after restored transport; capture6017ms later; no edit/focus/online/fake clock/reload during recovery, latest schema/sketch and revision3.|
|04 expired session/relogin|PASS: no unauthorized PUT, same actor's retained full draft equals confirmed server188.8/changed sketch, revision3.|
|05 stale reply|PASS: newer local document survives the older response and remains dirty until confirmed; final departure full last PUT=server.|
|06 two tabs/409|PASS: explicit unresolved conflict persists after edit, local666.6/server555.5/revision3; CAS/merge focused checks preserved.|
|07 denied local storage|PASS persistence semantics: older50/original-sketch raw bytes retained, latest166.7/changed sketch memory-only warning; whole emergency JSON equals pre-attempt copy and attempted PUT. UI compact adjacent Run FAIL as above.|
|08 local newer than server|PASS: entire attributed local=recovered local=confirmed server, revision3; no old server overwrite.|
|09 in-flight exit queue|PASS:3 serial requests, latest333.3/changed sketch, complete final PUT=server, revision5; genuine unmount coverage retained.|
|10 project/user isolation|PASS: same-renderer canonical project switch while first reply held; full A bytes preserved; revoked old editor absent before/after late reply; zero old-page B-phase PUT; full B local=server/revision3; both A projects403/404; actual B bootstrap.|
|11 Stop/Run|Retained existing semantics PASS in source/ordinary suite. Future E04 power-supply setpoint persistence is not implemented or accepted by this slice.|
|12 sustained cadence|PASS within registered coverage: continuous mounted edits retain first60s deadline; bounded backoff/serial behavior; real API minute case passes with its declared fake clock. No class-frequency/load or hardware claim.|
|accepted529|PASS: manualSave82.1ms/genuine departure73.3ms, both strictly<260ms; expected=inputLocal=actionLocal=single PUT=server full documents/revision3; exact reopen assertions PASS. All five mounted behavioral assertions preserved.|

Important raw SHA256s: crash `a44de674634ce9aa2c944517964c9bfde6a7c0aa9fc2a004f5a0a5587321b5ac`; injection/CDP trace `c2b722e0f629a3c79b01ae8cdef53252a988f5e1999ab38f4551d3badaa9db7a`; isolation `9cb9dabf8719114dc619a40ee42f1265748f4eee77c9e0a820fee0d32469f9ee`; quiet `42f7e59c6db8a419e8ca476d50b2416a17b46298338b3cc7a7e8bdcd86b695b6`; emergency/pre-attempt identical `9fa067da50641ab9e15b3b5ca3d131553c88fd8b07538e7e539d82a16f59742b`;529 Save `586d1d4d51728e6b0b9426fc209b6d18cadfcb2c206f5cb72fae9fe6eacee5f2`;529 departure `6b64cec9766193a9a96248e2cc5a942c09e30353ff3ccae01ae960413693f324`.

Original causal BEFORE tracked JSON hashes independently match `eb2e44af4a18f91270c26791ae106a356e632325db5e3fbbc9269592f29c04e5` and `8bcc0ac77000845082d4519ec4998f76fecc357a7b989ae0df50cdef16f0e4bc`. Content establishes local-null/server50/UI166.7 with false local claim, and quiet69235ms/one failed PUT/no successful retry/server50/local166.7. BEFORE was not rerun. Old520 REQUEST_CHANGES and directed936 evidence remain history; none is final acceptance.

## UI evidence and disposition

Independently opened all four original denial PNGs. At1440/390/320 emergency JSON is fully readable/clickable; raw checks confirm no page overflow, no indicator overlap and no adjacent-button overlap at every width. At1024 JSON fits but Run is clipped. Therefore changed UI acceptance is **FAIL**, not whole-editor visual acceptance or a purely cosmetic provisional state. Real changed shared consumers are the single WorkbenchHeader/EditorPersistenceIndicator surface and Code/Save/Run actions; no other production indicator consumer exists.

Screenshot directory: `C:/Users/spike/.codex/temp/electronics-e01/0c8a0d5e-ci/run-37865154341/extracted/reports/playwright/electronics-e01/`.
1024 PNG SHA256: `cd9512bcde5b0d8abe9a18683e0d087828d99dafc4ced6134c2ecb35add3d489`.

All positive semantic evidence and the complete published0c8 candidate must be preserved. Technical526 closure remains prohibited by this independent P1, despite all ordinary gates being green. No owner acceptance/release/programme completion is granted. Shared draft storage remains one slot per actor/project; session GET→PUT is not an atomic server-side actor binding; actual shutdown server sending is best effort; memory-only data cannot promise process-death recovery. Historical local full-focused asset-hashing timeout FAIL is not relabeled PASS; this new remote full focused gate passed. No separate full-strict e2e-typecheck PASS is claimed.

School K0 version/backups, real-pupil T3 hardware, class incident frequency, owner/class acceptance and subsequent E04 remain separate pending work. No school deployment is demanded to review this technical slice.

TESTS_RUN by reviewer: none; read-only source/metadata/raw evidence/CRC/hash/deep-document comparisons and visual inspection only. CI commands and fresh counts above are actual remote evidence. MAP_NODES_CHANGED: no registry/map node edits; canonical derived browser digest only. WORKING_TREE: clean at final inspection. PORTS: unchanged; DEPLOYMENT: NOT_RUN; DATABASE_ACTIONS: NONE; DEMO_URLS: none.

NEXT_ALLOWED_TASK: **STOP for this reviewer**. Controller owns a separately bounded correction/selection and a NEW independent exact-SHA review; this report does not activate another task or resume525.