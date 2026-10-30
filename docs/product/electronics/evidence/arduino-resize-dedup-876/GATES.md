# Arduino desktop resize deduplication — author evidence

Selected task876, baseline a34a4129f57d50e70b2d8506f91a410615f9e8e3.
The initial21eb baseline differs only in canonical task metadata. Production source
was unchanged by that metadata correction. The selected-task docs validator PASS
was rerun directly after the controller's114 validator tests and control-plane PASS.
Preflight/recovery report only preserved untracked report trees and unrelated
workflow overlap warnings; tracked product overlap is zero.

## Result and measured limits

One in-file HorizontalResizeHandle now serves drawer (populated and empty states)
and palette. Drawer supplies direction-1 and steps16/48; palette+1 and12/40.
Pointer arithmetic retains the exact previous operation order, including fractional
coordinates. Selectors, labels, separator attributes, primary-button filtering,
pointer identity, start anchoring, capture/release and cancellation cleanup remain.
MobileCodeHandle is byte-for-byte unchanged. No imports, CSS, storage, generation,
server, dependencies, ports, Docker, deployment or protected assets changed.

Fresh production command: `NX_SKIP_NX_CACHE=true pnpm nx run web:build --skip-nx-cache`.
PASS seven fresh Nx tasks, cache skipped. `pnpm bundle:check` PASS all eight caps:
initial382841/570000; editor187859/222000; chess244236/255000;
checkers158901/160000; 3D2870467/2900000; Three vendor602992/620000;
Arduino1998988/2000000; initial JS/CSS graph555957/600000.

Accepted873 historically measured Arduino1999925, editor187859. Arduino source
and dependency baseline were unchanged before this slice; actual AFTER is937 bytes
below that historical measurement. No new heavy BEFORE build was repeated. Foreign
AI main changes have their own baseline; no broader identical-bundle claim or
additive fit claim for prepared865/789 is made. An initial attempted build was
interrupted before task execution after a local fixture-edit encoding error;
`build-after.log` is the one completed candidate build.

## Native and regression evidence

Production SchematicEditor/controller/Arduino panel, genuine Chromium mouse/key
input and capture, real Scratch renderer; only API/static transport is in memory.
No listener ports. Actual native positives and synthetic negatives are identified
separately in receipts. Both handles cover signed drag, original start anchoring,
normal/Shift arrows both directions, trusted right-button rejection, trusted
primary down preventDefault/capture, synthetic unrelated pointer move/up/cancel,
synthetic cancellation, native capture release/lost-capture, both clamps, and
localStorage persistence through reload. Drawer620..1180 at1600; palette220..500
with drawer800. BEFORE and AFTER receipts compare deeply equal, including DOM.
Populated1440/1024/390/320 screenshot/DOM/overflow records match; mobile grip stays
visible only at390/320. Author inspected all four AFTER screenshots.

Correction preserved: the original main harness's nominal `?empty` case restored
an existing local draft and was actually populated. Its original empty claim is
RETRACTED; the original receipts/screenshots remain in the archive. The separate
native-empty harness uses a unique project ID and asserts zero document components,
zero palette handles and `.arduino-code-panel.empty.open`. Read-only immutable21eb
panel source BEFORE and current candidate AFTER both835→819→867 by right16/Shift
left48; DOM receipts agree except explicit source label. These are the actual
empty-branch proofs. The original populated handle and viewport proofs are valid.

Run current candidate native proof:
`node docs/product/electronics/evidence/arduino-resize-dedup-876/native-harness.mjs --after`
and
`node docs/product/electronics/evidence/arduino-resize-dedup-876/native-empty.mjs`.
Immutable empty BEFORE additionally uses `--baseline-panel`.

Targeted Vitest: Arduino code contract, program state, code-panel persistence and
workbench project state:90PASS across4files. Initial89PASS/1FAIL was a source-name
contract still naming DrawerResizeHandle; updating that assertion exposed the same
test's old PaletteResizeHandle assertion. Only those two symbol expectations were
updated; all layout, legacy, program-state and persistence oracles are preserved.
Final90PASS. Targeted ESLint PASS; direct web tsc --noEmit PASS; final targeted
Prettier PASS; git diff --check PASS. Initial format warning was normalized.

## POST_STEP_REVIEW

L1_UI_BEHAVIOR, nonsemantic refactor; layout impact none: emitted handle DOM and
all CSS unchanged. Direct consumers: populated drawer, empty drawer, palette.
Mobile component unchanged; representative mobile screens checked. No new source
of truth, permission/persistence/domain/API change or compatibility bridge.
Exactly one product file and two existing stale symbol assertions changed.
Canonical source remains active; the duplicate component was removed only after
all consumers moved, with native replacement coverage and no public export or
persistence dependency. No dead code, cap increase, module split or adjacent
cleanup. Self-review PASS for bounded author proof.

Fresh independent source/native review, unchanged-SHA uncached canonical electronics
gate and final controller qualification remain PENDING. No full canonical gate,
General success, repository/release readiness, owner acceptance,865/789 composition,
server or deployment claim. Author stops after candidate publication.

The manifest pins product SHA256, measured bytes and archive hash. The archive
retains both original and corrected evidence, failed/rerun logs and screenshots.
