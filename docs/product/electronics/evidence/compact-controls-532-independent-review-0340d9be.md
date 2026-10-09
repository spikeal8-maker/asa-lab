# Independent exact-SHA review — Electronics #532

**REQUEST_CHANGES for `0340d9be50ac04caf34f49206c8f18fab9fc5f9a`.** The preserved text-mode evidence demonstrates improvement of the compact desktop controls. Full acceptance is blocked by a proven defect in the new browser selector and missing evidence for non-text modes and the newly introduced1180/1181 layout transition. No independent production-code defect has been established; do not change product code without further causal evidence.

## Identity and independence

- Repository: spikeal8-maker/asa-lab only; programme452, selected TASK-ELECTRONICS-COMPACT-CONTROLS-001, Issue532 OPEN.
- Canonical current.yaml: in_progress / bounded_compact_desktop_controls_repair. Independently read the task and blockers, not a remembered handoff state.
- Candidate:0340d9be50ac04caf34f49206c8f18fab9fc5f9a; tree:c6220bd80d74679dfd112090c7e106ecda0ba3f6.
- Parent and independently refreshed GitHub/main:7ded5a22ef2feb90e868cdca72577dbaf9c69ab7. Main...candidate divergence0/1.
- Actual published ref:codex/electronics-compact-controls-532 equals candidate. Author checkout C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab clean, empty index. Final remote main remains7ded; candidate is not integrated.
- Independent preflight SAFE_TO_START:0dirty/0blockers/0overlaps, remote refresh PASS, actual control-plane PASS. Final recovery also SAFE_TO_START/clean0340.

Read root policy, START_HERE, GitHub-first/change workflow, Electronics router/guide and mapped UI/persistence entries, selected card, review protocol, UI layout contract, affected CSS/Header/Code/SchematicEditor symbols, full new case and preserved530 review. Independently inspected actual Git objects, remote refs, Issue, CI job conclusions, original logs, archive CRC/hashes, complete partial raw geometry/intent, failed trace DOM and all28 original AFTER PNGs. Implementer/controller reports were context, not proof.

No repository edits, implementation, tests/gate/browser reruns, CI dispatch, local stack, Docker/database/backup/deployment, commit/push/state/Issue closure occurred. Only this external report was written. Read-only tooling corrections: a PowerShell rg wildcard was replaced by supported directory/glob search; Python default Windows encoding was replaced by explicit UTF-8 for raw JSON; a console Unicode printing failure was followed by a fresh recovery and ASCII-safe inspection of cached data. No evidence was redownloaded or altered.

## Actual source and scope

Exact main-to-candidate diff:3paths,473insertions/1deletion.

1. apps/web/src/electronics/workbench.css adds51lines only. At min981 the primary Run has intrinsic width and cannot shrink; the Code toolbar wraps whole controls, has auto flex basis/minimum50px and6px vertical padding, retains control sizes and aligns the board select to the right. At981–1180 the workbench toolbar becomes two explicit48px grid rows: left tools row1, clock/right actions row2; shell height96 feeds the existing main-height formula. There are no added clipping, hidden-control, text-replacement, input-handler or stacking rules.
2. e2e/electronics-simulation.spec.ts receives exactly one421-line case at2834. Independently removing precisely that case restores the byte-identical baseline file. All previous120 registered scenarios, existing deadlines/assertions, accepted531 readiness source and other test files are retained.
3. Parsed component-coverage.json differs only in generatedFrom.browserEvidenceSha256, independently matching canonical Git-LF simulation source digest65c9f342f8f45af021d27cfd7b74fae5beea3d2351abb6b8b18e74d84771ebbf. Every other parsed field is equal to main.

The entire diff excludes Header/Code/SchematicEditor, solver/Worker/Arduino parser/runtime, persistence/auth/RLS/bootstrap/MAX/Portal, assets, dependencies, package commands, workflows, Compose and execution state. Workflow blob21d10e90a8f2d2e15583d2062c2745fa2531359b equals main. CSS134639 Git-LF bytes versus reviewed120669:11.577% growth, below20%.

Independently proved source continuity870→7ded→0340: Header, ArduinoCodePanel and SchematicEditor are byte-identical;870 CSS differs from7ded only by the7 unaccepted530 open-menu stacking lines. Original production-built530981-before/after PNGs were independently opened and hashed ac9b1f3147b532ed0ecfcdf1e45b97589d4b3d5cc814d61ee39ef9f604023ec3 /86fa54cb56f6d6ca3a7e88ee0c1d05086059fc82fda27f4d10c55c6d0ca2bf62. They really show cropped Run text/font control, including closed menu. This is actual preserved candidate BEFORE plus source continuity, not an executed main-before browser comparison.

Impact radius: shared WorkbenchHeader in breadboard/schematic/BOM; running clock; ArduinoCodePanel text/blocks-text/blocks toolbars. Existing max980 mobile presentation remains byte-identical. The current mobile icon/hidden rendered primary caption is explicitly preserved by this bounded card; no new mobile full-caption or whole-product visual acceptance is claimed.

The existing drawer clamp remains source-identical: maximum=max(460,viewport−420), minimum=min(620,maximum). At1024/981 it deliberately fixes width604/561. Normal input retaining those exact widths is correct; actual width change at1440 and mobile height changes are required. These particular compact equal-min/max assertions must not be generalized to1180/1181 without checking the different clamp range.

## P1 — new test searches the wrong DOM child; full browser gate fails

Actual ordinary browser113683269662 fails only the NEW case,17.9seconds. Original log identifies e2e/electronics-simulation.spec.ts:3186–3187:

```text
getByTestId('arduino-block-workspace').locator(':scope > svg.blocklySvg')
Expected visible; Received element(s) not found; existing timeout5000ms
```

Original trace independently establishes the causal mismatch BEFORE the assertion:

```text
after@call@2164, timestamp115651.723:
DIV.arduino-scratch-host[data-testid=arduino-block-workspace]
  > DIV.injectionDiv.scratch-renderer.asa-arduino-theme
    > svg.blocklySvg width499px height678px
```

The same actual subtree contains loaded fixture block IDs setup-532 and loop-532. The failing expect call@2170 starts116111.343 and ends121117.682; thus the SVG already exists about460ms before the expect begins. Error-context shows the actual blocks-text project and generated editor. This is not evidence that the workspace failed to load or needed more than five seconds. The direct-child combinator cannot match the actual injected grandchild.

Classification:A, defect of the added test. Repair the scoped selector to the real production subtree while retaining meaningful visible workspace/block assertions and normal input. Do not replace the workspace check with a generic host, delete the check, increase timeout, fake a VM or change product/Scratch injection structure. Then obtain the previously unreached non-text mode geometry/normal font behavior/full document/revision/local-intent evidence on a new exact SHA. The saved text evidence is not acceptance of blocks-text/blocks.

## P2 — new1180/1181 layout transition has no directed evidence

CSS at4820–4843 introduces a new structural boundary:1180 uses two rows/96px;1181 returns to the original one-row48px layout. The new case's loops at3075 and3192 cover1440/1024/981/980/390/320; original raw geometry contains only those widths. No1180/1181 run, geometry or screenshot exists. This is a concrete coverage gap against UI layout contract§3 for a significant new breakpoint, separate from the covered981/980 boundary.

The relevant state is RUNNING breadboard with Code open: full Russian clock, full Stop caption and all left/right actions. Actual1440 raw clock spans568–812.546875px (width244.546875), and Stop spans1102.234375–1345px (width242.765625). These are measurements at1440, not proof of clipping or fit at1181; flex intrinsic minima/shrink prevent a valid unmeasured sum-to-failure claim. Do not call an inferred1181 product defect proved.

Add a bounded directed transition check at1180 and1181, stopped/running, ordinary controls/normal font input, full rendered captions/clock, whole Header controls, clipping/hit targets, toolbar/main/Code geometry and original screenshots. Preserve physics, timeouts and existing assertions. Change CSS only if that directed scenario establishes a product failure. Broad restyling, arbitrary breakpoint changes or another blind same-code whole-suite run are not justified.

## Independently verified partial AFTER —28 text phases only

Raw geometry has28ordered phases, ending320-resized. No non-text phase or non-text intent receipt exists because the first blocks-text check fails before its capture loop. All28 original PNGs were independently opened; all required1440/1024/390/320 and981/980 text states, resized drawers, native summary and desktop schematic/BOM/breadboard consumers were inspected.

Independent UTF-8 reparse asserted the full text-mode captions/aria, positive desktop font/text Range, all seven Code controls, selected-font text width, five owned hit points for each control, viewport/clipping/text bounds, no page overflow, clock placement, Code/body/main geometry and exact original sketch. All28 partial assertions pass. This is PARTIAL28_PASS, not FULL43_PASS or selected-slice acceptance.

| Raw action/state | Actual result |
|---|---|
|981 stopped/running|Full Start/Stop text visibly readable; toolbar96px; primary stopped x664–886, running643.234375–886; full running clock fits to419.84375. Font selector fully visible/ordinary font change captured. Code toolbar91px, body below it.|
|1024 stopped/running|Full captions/clock and font/control bounds fit; toolbar96, Code toolbar91; precise604px drawer retained through ordinary gesture.|
|1440 ordinary width input|835→803px; all controls remain usable. Full caption/clock fit measured viewport.|
|981 compact width input|561→561px under canonical clamp, controls and aria-width assertions pass.|
|980/390/320 height input|403→435,435→467,467→499px respectively, exact+32. Mobile font/control bounds and existing icon presentation remain as scoped.|
|Text pupil intent|Full original before/after server document equal, revision2→2, sketch unchanged across Run/Stop/font/view/resize actions.|

The native menu open image does not establish530 Purple acceptance; its residual layer dependency is explicitly separate. Blocks-body/full Arduino semantics are not repaired or claimed. No entire school save-recovery/frequency claim follows from the text fixture.

## Required exact-head CI independently fetched

[General37888088058](https://github.com/spikeal8-maker/asa-lab/actions/runs/37888088058) SUCCESS/all4. [Ordinary Electronics37888099694](https://github.com/spikeal8-maker/asa-lab/actions/runs/37888099694) FAILURE. Both actual GitHub head_sha equal0340d9be50ac04caf34f49206c8f18fab9fc5f9a.

| Job | ID | Actual conclusion |
|---|---|---|
|Governance|113682521905|SUCCESS|
|Code|113682787648|SUCCESS|
|PostgreSQL/RLS|113683672148|SUCCESS|
|Access browser|113683672203|SUCCESS|
|Electronics focused|113682559528|SUCCESS|
|Electronics benchmark|113683269658|SUCCESS|
|Electronics browser|113683269662|FAILURE|
|Review images|113686915948|SKIPPED|

Browser120PASS/1FAIL,12.2minutes; all previous120 pass, including unchanged531 large-board readiness9.6seconds. Seven original531 receipts remain in the log. No old531 repair/measurement or same-code rerun is required by this selector failure.

Original logs independently confirm exact checkout/build revision, frozen dependencies including Docker offline --frozen-lockfile, literal NX_SKIP_NX_CACHE=true and fresh execution. Focused633engine+379editor. General3168Vitest+16RLS,652synthetic+10Access+284layouts. Actual remote control-plane PASS and compose:check PASS are present, distinct from fixture SKIPPED_FOR_FIXTURE. Fresh Nx:focused70(1+42+27),benchmark18(3×6),General166(96Code+43Data+27Access),browser49(16API+6Web+27runner)=303tasks, zero Nx result-cache hits. Review images skipped; no22 package executions or image/deployment claim.

## Original evidence identities

Base C:/Users/spike/.codex/temp/electronics-e01/0340d9be-ci/. Controller cached originals once; reviewer independently guarded actual GitHub run/job/artifact association and exact head, then recomputed SHA/CRC and read the originals without a second download.

| Original | Bytes/members | SHA256 |
|---|---|---|
|run-37888088058/general-logs.zip|368305/61|f2bebacd904a3b082d0adb848aab1efe4a848a2a158e69970f39a28ca5c90073|
|run-37888099694/focused-job-113682559528.log|103224|4b3f9bbc9a220b56ec6b3587d2c9e1e6b867cf8a5a1c0b1a0d5e9d6a50537b74|
|benchmark-job-113683269658.log|132507|edbf9a4bec626676e4a67afeff5d87f915fd7511e3b49e63011f3dba17a1fd28|
|browser-job-113683269662.log|267894|93af802b33f7ffb28eb959b94a24faee6a52bb4a67619915ba1b52b8c283c77d|
|browser-artifact-11597546971.zip|39127012/165|ef5575975da3f28078169b60315902c2e572e7c706c3d1df1b1b03aed653f118|
|failed trace.zip|18450438/403|36146e6b3345b53dd5aecd01cb64a2d3ef670d4100e9b647a1cca50bcaa7add1|
|failed error-context.md|27849|30995317eccb93c227ec14f043217237ee91e494e24b97afd977de8b0388b88e|
|geometry.json,28phases|522090|9a2cb02c6b2ea876c359c99325323bae02ca7b5f035f882fda50bf71269eb8cc|
|intent.json|46022|74be7c2ffcd00725f9e334c1050d7221783f14f4688ea3af9ab79f10f829fe6c|

Trace/error context:run-37888099694/extracted/reports/playwright/electronics-simulation-com-6b829-rols-at-actual-drawer-sizes/. Geometry/intent/28PNGs are in its electronics-compact-controls-532 child. All28 PNGs independently hashed and opened. Representative originals:1440-running17ae79ab9697d9cbaef165a1dace5c2441f8e84312d52cf3e5d7da8b608c45b5;1024-running570f3ec12f51f280cc02cbda21f1b69654eaa46a5c2d135f911b1f744a23c577;981-running7e8b9d7e6129c31f2b4501a6b5b592f5186372bb126cec9f6255b7e3a2e68ed8;390-stopped77f7a78e5551306b0d8f2fd7e601f8c88a4a0e1a231b496af801bc6e23f7e8ec;320-resized5157218e93e36d71b0b3b016b71341339a6f2b34637f46a3f25ce7103bf1ddd3. Remaining PNG identity is covered by the independently CRC-verified original archive and complete raw phases; no generated/edit/montage substitute.

Copied author strict differential JSON f9ec70844c15ab34c8ff73cd0595ea3bcabe4bb008e37d7c6068117e5e928c0b was independently hashed and completely parsed:8baseline/8candidate diagnostic arrays exactly equal. It was not independently rerun and is not a full strict typecheck PASS. Headless fixture report is not substituted for the actual mounted DOM/trace.

## Required bounded continuation and STOP

Preserve exact0340 source, partial text evidence and failed originals. Controller should canonically select a separate532 repair, appoint another bounded author to correct the proven selector and add the missing directed boundary evidence; production changes require a newly proved product defect. Preserve existing budgets, ordinary input and all prior tests. Final changed exact SHA requires ordinary gates plus a NEW independent reviewer; this review cannot be carried forward as approval.

Selected532 remains unaccepted, so530/526 final convergence/acceptance is not granted. Suspended525 and all accepted results stay unchanged. K0 actual school installed version/full backups and actual-pupilT3 remain pending separately. No owner/class/release/deployment or full programme acceptance is claimed.

**VERDICT:REQUEST_CHANGES. GATES:FAIL. TEXT_CONTROLS:PARTIAL_FUNCTIONAL_AND_VISUAL_PASS. NON_TEXT_MODES_AND1180/1181:NOT_RUN. PRODUCTION_DEFECT:NOT_ESTABLISHED. REVIEWER:STOP.** Controller continues programme452 under the separate bounded repair/review contract.
