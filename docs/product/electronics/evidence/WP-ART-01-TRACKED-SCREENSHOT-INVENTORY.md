# WP-ART-01 — tracked Electronics screenshot and raster evidence inventory

This is the read-only inventory for `TASK-ELECTRONICS-SCREENSHOT-INVENTORY-001` / Issue #404. It proposes lifecycle classes for an owner retention decision; it does not authorize deleting, moving, regenerating, promoting, or repackaging any image. Snapshot source: tracked tree at `dcce23197b4caf85e78b69b027147fdbc8032847` (2026-09-27, before this document). Paths below are repository-relative and exact.

## Reproduce the candidate set

Start with `git ls-files | rg -i '\.(png|jpe?g|webp|gif|bmp|tiff?)$'` (284 tracked raster files at the snapshot). Inspect all `e2e/artifacts/**` names, the screenshot writers and their selected module or course title, references in `README.md`, `docs/**`, the README image manifest, and the owner-audit manifest. The primary inventory below has **58 paths**: 24 protected owner-audit references, 23 Electronics simulation captures, 3 root E2E captures, 3 owner-provided README originals, 4 explicitly named Learning/Electronics course captures, and 1 Learning capture of the actual Electronics editor. The separate cross-surface boundary accounts for another **53 tracked paths**: 19 from Electronics-backed VS-001, VS-002, and M0-007 scenarios, 17 generic course-01 captures, 9 course-sharing captures from a course explicitly titled `Электроника`, 3 classroom-lifecycle captures visibly showing class `Электроника 9Б`, 2 Project Hub captures from an Electronics-seeded journey, and 3 assignment-library captures visibly showing an Electronics environment or assignment. These images primarily document Learning, course-sharing, classroom, Project Hub, or assignment-library controls rather than the Electronics workbench; some generic course-01 bytes cannot be attributed to Electronics. The distinction is based on image purpose and explicit references, not only a seed value or course title.

Useful repeatable checks:

```text
git ls-files 'apps/web/public/assets/electronics/owner-audit/**/*.png' 'e2e/artifacts/**/*.png' 'e2e/artifacts/*.png'
rg -n 'ARTIFACT_DIR|EVIDENCE_DIR|evidenceDir|courseTitle|Электроника|\.screenshot\(' e2e/electronics-simulation.spec.ts e2e/learning-course-01.spec.ts e2e/learning-learner-submits-project-assignment.spec.ts e2e/courses-sharing.spec.ts e2e/classroom-lifecycle.spec.ts e2e/project-hub.spec.ts e2e/assignment-library.spec.ts
rg -n 'docker-electronics|electronics-(desktop|mobile|blocks|cpp|simulation)|real-project-editor|source-reference' README.md docs e2e apps/web/public/landing/assets-manifest.md tools/audit_owner_electronics_assets.py
```

`rg` finds text references, not every visual dependency. A missing text reference is never deletion proof. An exact-name search found no current screenshot assertion consumer for these PNGs. Capture calls are writers, and a tracked PNG is not automatically a golden comparator.

## Field key and evidence

Each primary-inventory row and each of the 17 newly identified cross-surface rows supplies path, provenance/owner, document reference, writer/consumer, proposed class, and unresolved dependency. The earlier 36 cross-surface entries record scope and unresolved retention without an Electronics lifecycle class. Repeated evidence is keyed here to keep the path list auditable.

| Key | Meaning |
| --- | --- |
| `OA` | Protected owner-supplied source raster imported from `components-zip` by `tools/audit_owner_electronics_assets.py`; exact `importedFile`, SHA-256, `provenance: owner_supplied`, and `acceptance: owner_reference_raster_not_runtime` are in `apps/web/public/assets/electronics/owner-audit/manifest.json`. `tools/validate_electronics_assets.py` validates manifest-listed bytes; `tools/test_validate_electronics_assets.py` covers the validator. No runtime PNG consumer found. `state-family-map.json` additionally names `led-5mm.png`. |
| `SIM` | Browser capture written by `e2e/electronics-simulation.spec.ts` through `ARTIFACT_DIR = e2e/artifacts/electronics-simulation`; directory is named in `docs/execution/current.yaml` and §5.2 of `ASA_ELECTRONICS_MAINTENANCE_EXECUTION_SPEC.md`. No exact-file doc reference or image assertion consumer found. Ordinary test runs can overwrite tracked bytes. |
| `ROOT` | Historical root E2E raster last changed in Git commit `8bdcaab3` (`test(e2e): refresh authenticated browser evidence`, 2026-07-30). Exact current capture writer/consumer and owner attribution were not found. Git history alone does not establish who accepted the image. |
| `READ` | Owner-provided original PNG, byte identity documented by `e2e/artifacts/readme-2026-09-07/README.md` and `manifest.json`; linked directly by root `README.md`. There is no routine test writer or pixel comparison. |
| `LC` | `e2e/learning-course-01.spec.ts` writes the path using `evidenceDir`, with module `electronics` selected by its scenario loop. `docs/review/LRN_E1_MAIN_CONVERGENCE_2026_09_13.md` lists these as historical evidence. No screenshot assertion consumer found. |
| `VS` | `e2e/learning-learner-submits-project-assignment.spec.ts` writes the path from its Electronics project assignment scenarios. `docs/product/learning/execution/LRN-VS-002_EXECUTION_SPEC.md` lists the exact path. No screenshot assertion consumer found. |
| `V1` | `e2e/learning-teacher-assigns-activity.spec.ts` seeds an Electronics assignment and writes six VS-001 Learning-flow paths. Two additional tracked `current-after-*` paths are referenced by `LRN-VS-002_EXECUTION_SPEC.md`, but have no current writer in that spec. |
| `M0` | `e2e/learning-surface-convergence.spec.ts` seeds Electronics assignment/project rows and writes six M0-007 Learning regression paths. `docs/product/learning/current/LRN_M0_SURFACE_CONVERGENCE_REPORT.md` lists each exact path. |
| `CS` | `e2e/courses-sharing.spec.ts` sets `courseTitle = Электроника · ...` at line 117 and writes nine course-sharing captures in `e2e/artifacts/courses/`. No exact-file prose-document reference or image assertion consumer was found. The two `demo-course-published-{desktop,mobile}.png` files in that directory belong to its separate demo-course scenario and have no established Electronics context. |
| `CL` | `e2e/classroom-lifecycle.spec.ts` creates class `Электроника 9Б` and writes the three listed captures in `e2e/artifacts/classroom-lifecycle/`; their tracked bytes visibly include that class. `docs/testing/planned-test-catalog.yaml` names the scenario command and `docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md` names the spec, but no exact-file prose-document reference or image assertion consumer was found. |
| `PH` | `e2e/project-hub.spec.ts` seeds a project with `module: 'electronics'` and writes desktop/mobile captures via configurable `ASA_OWNER_EVIDENCE_DIR`. `docs/review/TASK_R3B_PROJECT_LIFECYCLE_001/EVIDENCE.md` names the exact historical tracked paths. The spec's current default output directory differs from those historical paths, so a normal run does not prove it will overwrite them. No image assertion consumer was found. |
| `AL` | `e2e/assignment-library.spec.ts` writes `brief-preview.png` and `library.png` before creating an `Электроника` folder, but their tracked bytes visibly show an Electronics environment or assignment. It writes `bank.png` after creating that folder. No exact-file prose-document reference or image assertion consumer was found. |

### Protected owner-audit reference rasters (24)

All rows in this table have provenance `OA`, document reference `OA manifest`, writer/consumer `OA importer/validator`, proposed class **golden/reference input**, and unresolved dependency **protected source bytes and owner provenance must remain intact; runtime-packaging questions belong to WP-ASSET-01**. `golden/reference input` means a provenance reference, not evidence of a pixel-diff test.

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Proposed class | Unresolved dependency |
| --- | --- | --- | --- | --- | --- |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/arduino-uno.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/battery-1.5v.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/battery-3v.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/battery-6v.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/battery-9v.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/battery-holder-aa-3.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/breadboard-small.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/button-tactile-6mm.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/dc-motor.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/electrolytic-capacitor.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/incandescent-lamp.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/led-5mm.png` | OA | OA manifest + `state-family-map.json` | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/multimeter.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/photoresistor.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/piezo.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/potentiometer.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/regulated-power-supply.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/resistor-axial.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/rgb-led.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/scale-sheet.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/servo-motor.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/seven-segment-display.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/switch-spdt.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |
| `apps/web/public/assets/electronics/owner-audit/components/source-reference/transistor-npn.png` | OA | OA manifest | OA importer/validator | golden/reference input | Protected; packaging decision open |

### Electronics simulation E2E captures (23)

Each row has provenance `SIM` (ASA browser test), document reference `SIM directory`, writer/consumer `SIM spec / no image assertion found`, proposed class **generated/reproducible output**, and unresolved dependency **owner must decide whether the tracked historical frame is accepted evidence before any output separation or retention change**. Reproducible describes the screenshot *path and browser capture operation*, not byte-for-byte image stability across browser environments.

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Proposed class | Unresolved dependency |
| --- | --- | --- | --- | --- | --- |
| `e2e/artifacts/electronics-simulation/electronics-direct-led-166.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-empty.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-incandescent-lamp-runtime.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-isolated-source-diagnostics.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-led-burnout.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-led-warning.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-multimeter-dc-current.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-multimeter-dc-voltage.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-multimeter-resistance.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-multimeter-reversed-probes.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-photoresistor-runtime.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-reload.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-resistance-changed.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-reverse-polarity.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-rgb-green-blue-equal-220.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-rgb-led-compact-controls.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-rgb-led-math-6e-runtime.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-rgb-mixed-common-cathode.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-rgb-red-blue-3v.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-running.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-seven-segment-compact-controls.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-seven-segment-math-6e-runtime.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |
| `e2e/artifacts/electronics-simulation/electronics-wired.png` | SIM | SIM directory | SIM spec / none found | generated/reproducible output | Retention decision open |

### Root E2E and README images (6)

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Proposed class | Unresolved dependency |
| --- | --- | --- | --- | --- | --- |
| `e2e/artifacts/docker-electronics.png` | ROOT; exact author unknown | `docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` required artifact | Current writer/consumer unknown | accepted historical evidence | Reconfirm infrastructure evidence retention and original capture route |
| `e2e/artifacts/electronics-desktop.png` | ROOT; exact author unknown | No exact-file text reference found | Current writer/consumer unknown | unknown | Owner acceptance and capture route unknown; no deletion inference |
| `e2e/artifacts/electronics-mobile.png` | ROOT; exact author unknown | No exact-file text reference found | Current writer/consumer unknown | unknown | Owner acceptance and capture route unknown; no deletion inference |
| `e2e/artifacts/readme-2026-09-07/electronics-blocks.png` | READ; owner original | Root `README.md`; README image manifest | No routine writer; root README consumer | accepted historical evidence | Preserve owner original and documented hash |
| `e2e/artifacts/readme-2026-09-07/electronics-cpp.png` | READ; owner original | Root `README.md`; README image manifest | No routine writer; root README consumer | accepted historical evidence | Preserve owner original and documented hash |
| `e2e/artifacts/readme-2026-09-07/electronics-simulation.png` | READ; owner original | Root `README.md`; README image manifest | No routine writer; root README consumer | accepted historical evidence | Preserve owner original and documented hash |

### Learning images explicitly documenting Electronics (5)

The four `LC` paths have the explicit `electronics` module suffix. The `VS` image shows the Electronics workbench and resistor control in the real project editor. These are cross-surface Learning evidence, not owned by the Electronics maintenance task.

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Proposed class | Unresolved dependency |
| --- | --- | --- | --- | --- | --- |
| `e2e/artifacts/learning/course-01/account-course-electronics-completed.png` | LC / Learning | E1 convergence review | LC spec / none found | accepted historical evidence | Learning owner retention; test can overwrite |
| `e2e/artifacts/learning/course-01/account-course-electronics-submitted.png` | LC / Learning | E1 convergence review | LC spec / none found | accepted historical evidence | Learning owner retention; test can overwrite |
| `e2e/artifacts/learning/course-01/electronics-exact-submission.png` | LC / Learning | E1 convergence review | LC spec / none found | accepted historical evidence | Learning owner retention; test can overwrite |
| `e2e/artifacts/learning/course-01/gradebook-accepted-electronics.png` | LC / Learning | E1 convergence review | LC spec / none found | accepted historical evidence | Learning owner retention; test can overwrite |
| `e2e/artifacts/learning/vs-002/real-project-editor.png` | VS / Learning | VS-002 execution spec | VS spec / none found | generated/reproducible output | Learning owner retention; visible Electronics workbench |

## Cross-surface boundary (53 tracked paths)

These paths are documented so a later retention decision cannot mistake an Electronics seed, course title, or visible class/environment for a complete Electronics screenshot inventory. The first 36 paths document Learning assignment, gradebook, or audience UI. The further 17 document course-sharing, classroom, Project Hub, or assignment-library UI with explicit Electronics context in the scenario or tracked pixels. They are **outside the 58-path Electronics lifecycle classification** because their captured surface is not the Electronics workbench or an explicitly named Electronics evidence frame. No deletion or disposable status is inferred; each surface owner's retention decision remains open. The final column states what would need to be resolved before any broader cross-surface evidence policy.

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Scope conclusion and unresolved dependency |
| --- | --- | --- | --- | --- |
| `e2e/artifacts/learning/vs-001/current-after-start.png` | V1 / Learning | VS-002 execution spec | Current writer unknown / no image assertion found | Learning state capture; verify historical author and retention |
| `e2e/artifacts/learning/vs-001/current-after-submit.png` | V1 / Learning | VS-002 execution spec | Current writer unknown / no image assertion found | Learning state capture; verify historical author and retention |
| `e2e/artifacts/learning/vs-001/dialog-two-learners.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning assignment dialog; owner retention open |
| `e2e/artifacts/learning/vs-001/dialog-whole-class.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning assignment dialog; owner retention open |
| `e2e/artifacts/learning/vs-001/learner-third-excluded.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning audience exclusion; owner retention open |
| `e2e/artifacts/learning/vs-001/learner-whole-class.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning assignment row; owner retention open |
| `e2e/artifacts/learning/vs-001/teacher-two-learners.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning assignment row; owner retention open |
| `e2e/artifacts/learning/vs-001/teacher-whole-class.png` | V1 / Learning | VS-001 scenario | V1 spec / none found | Learning assignment row; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-a-learner-submitted.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning submission row; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-a-teacher-gradebook.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning gradebook; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-b-changes-requested.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning grading state; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-c-learner-result.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning result row; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-c-teacher-result.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning result row; owner retention open |
| `e2e/artifacts/learning/m0-007/regression-d-unknown-grading.png` | M0 / Learning | M0 convergence report | M0 spec / none found | Learning gradebook; owner retention open |
| `e2e/artifacts/learning/vs-002/learner-excluded.png` | VS / Learning | VS-002 execution spec | VS spec / none found | Learning audience exclusion; owner retention open |
| `e2e/artifacts/learning/vs-002/learner-in-progress.png` | VS / Learning | VS-002 execution spec | VS spec / none found | Learning assignment row; owner retention open |
| `e2e/artifacts/learning/vs-002/learner-not-started.png` | VS / Learning | VS-002 execution spec | VS spec / none found | Learning assignment row; owner retention open |
| `e2e/artifacts/learning/vs-002/learner-submitted.png` | VS / Learning | VS-002 execution spec | VS spec / none found | Learning submission row; owner retention open |
| `e2e/artifacts/learning/vs-002/teacher-submitted.png` | VS / Learning | VS-002 execution spec | VS spec / none found | Learning assignment row; owner retention open |

The remaining 17 generic `course-01` paths are owned by Learning and can be generated in flows that create an Electronics activity, but they show course/assignment/gradebook controls rather than the Electronics editor. Some capture functions are called for both `electronics` and `three-d`, so the current committed bytes are **unknown** as to module. The writer is `e2e/learning-course-01.spec.ts` where a current screenshot call exists; `account-course-completed.png` has no exact current writer found. `docs/review/LRN_E1_MAIN_CONVERGENCE_2026_09_13.md` lists the historical course-01 image set. These paths stay outside the Electronics-specific lifecycle table, under Learning retention ownership:

```text
e2e/artifacts/learning/course-01/account-course-completed.png
e2e/artifacts/learning/course-01/author-teaching-same-material.png
e2e/artifacts/learning/course-01/authored-material-published.png
e2e/artifacts/learning/course-01/course-authored-published.png
e2e/artifacts/learning/course-01/dialog-two-learners.png
e2e/artifacts/learning/course-01/dialog-whole-class.png
e2e/artifacts/learning/course-01/graded-correction-history.png
e2e/artifacts/learning/course-01/graded-stale-correction-denied.png
e2e/artifacts/learning/course-01/learner-third-excluded.png
e2e/artifacts/learning/course-01/learner-whole-class.png
e2e/artifacts/learning/course-01/matrix-30x10-desktop.png
e2e/artifacts/learning/course-01/matrix-30x10-mobile.png
e2e/artifacts/learning/course-01/muted-inbox-queue-independent.png
e2e/artifacts/learning/course-01/named-audience-withdrawn.png
e2e/artifacts/learning/course-01/teacher-two-learners.png
e2e/artifacts/learning/course-01/teacher-whole-class.png
e2e/artifacts/learning/course-01/ungraded-official-review.png
```

The other four `course-01` paths outside the primary inventory are explicitly named for 3D: `account-course-three-d-completed.png`, `account-course-three-d-submitted.png`, `gradebook-accepted-three-d.png`, and `three-d-exact-submission.png` in that directory. Thus all 25 tracked course-01 PNGs have been considered: 4 included Electronics paths, 17 generic Learning boundary paths, and 4 explicit 3D exclusions.

### Courses, classroom lifecycle, Project Hub, and assignment-library boundary (17 tracked paths)

The nine `CS` captures are produced by the `Электроника` course journey, but show authoring, preview, classroom, catalogue, or student course UI. The three `CL` captures visibly show class `Электроника 9Б` in the classroom register. The two `PH` captures show the Project Hub with an Electronics project seed. The three `AL` captures show an Electronics environment or assignment in the tracked pixels; only `bank.png` is captured after the test creates the `Электроника` folder. This is explicit Electronics context for inventory completeness, while the captured controls belong to other surfaces. `CS`, `CL`, and `AL` describe repeatable capture operations, not byte-stable image output. `PH` appears in historical R3B evidence, but that document does not establish owner acceptance of the PNG bytes, so its lifecycle class remains `unknown`. Exact-file prose-document references were not found for `CS`, `CL`, or `AL`; their current test writers are the available references. No row implies permission to regenerate or discard tracked bytes.

| Exact tracked path | Provenance / owner | Document reference | Writer / consumer | Proposed class | Unresolved retention dependency |
| --- | --- | --- | --- | --- | --- |
| `e2e/artifacts/courses/catalogue-preview-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/catalogue-preview-mobile.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/classroom-course-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/course-editor-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/course-editor-mobile.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/course-preview-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/course-published-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/student-course-desktop.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/courses/student-course-mobile.png` | CS / Courses surface; acceptance owner unconfirmed | No exact-file doc reference found | CS spec / no image assertion found | generated/reproducible output | Courses owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/classroom-lifecycle/sorted.png` | CL / Classroom surface; acceptance owner unconfirmed | Scenario in planned-test catalog and Learning architecture; no exact-file doc reference found | CL spec / no image assertion found | generated/reproducible output | Classroom owner must decide retention of tracked frame visibly showing `Электроника 9Б` before output separation |
| `e2e/artifacts/classroom-lifecycle/renamed.png` | CL / Classroom surface; acceptance owner unconfirmed | Scenario in planned-test catalog and Learning architecture; no exact-file doc reference found | CL spec / no image assertion found | generated/reproducible output | Classroom owner must decide retention of tracked frame visibly showing `Электроника 9Б` before output separation |
| `e2e/artifacts/classroom-lifecycle/bulk-menu.png` | CL / Classroom surface; acceptance owner unconfirmed | Scenario in planned-test catalog and Learning architecture; no exact-file doc reference found | CL spec / no image assertion found | generated/reproducible output | Classroom owner must decide retention of tracked frame visibly showing `Электроника 9Б` before output separation |
| `e2e/artifacts/project-hub/r3b-project-lifecycle/01-project-hub-desktop.png` | PH / R3B Project Hub evidence; acceptance owner unconfirmed | R3B evidence document, exact path | PH spec with configured evidence dir / no image assertion found | unknown | R3B owner must confirm retention; current default writer path differs |
| `e2e/artifacts/project-hub/r3b-project-lifecycle/02-project-hub-mobile.png` | PH / R3B Project Hub evidence; acceptance owner unconfirmed | R3B evidence document, exact path | PH spec with configured evidence dir / no image assertion found | unknown | R3B owner must confirm retention; current default writer path differs |
| `e2e/artifacts/assignment-library/bank.png` | AL / Assignment Library surface; acceptance owner unconfirmed | No exact-file doc reference found | AL spec / no image assertion found | generated/reproducible output | Assignment Library owner must decide whether this tracked frame is accepted evidence before output separation |
| `e2e/artifacts/assignment-library/brief-preview.png` | AL / Assignment Library surface; acceptance owner unconfirmed | No exact-file doc reference found | AL spec / no image assertion found | generated/reproducible output | Assignment Library owner must decide retention of tracked Electronics-environment frame before output separation |
| `e2e/artifacts/assignment-library/library.png` | AL / Assignment Library surface; acceptance owner unconfirmed | No exact-file doc reference found | AL spec / no image assertion found | generated/reproducible output | Assignment Library owner must decide retention of tracked Electronics-assignment frame before output separation |

## Boundary and unresolved scope

- `apps/web/public/landing/electronics-{blocks,cpp,simulation}.png` are tracked **runtime public artwork copies** of the owner README originals according to `apps/web/public/landing/assets-manifest.md`; `apps/web/src/pages/PublicEntryPage.tsx` loads their public URLs. `apps/web/public/social/asa-lab-electronics.png` is a runtime social/SEO image used by `PublicEntryPage.tsx` and `apps/web/public/features/electronics/index.html`. These four are excluded from this screenshot/evidence lifecycle inventory. Their runtime/provenance boundary is WP-ASSET-01; no packaging conclusion is made here.
- `e2e/artifacts/readme-2026-09-07/github-cover.png` is explicitly promotional artwork, not an interface screenshot. Other README, 3D, chess, and generic portal images remain outside this Electronics-specific set without explicit captured Electronics context; incidental Electronics wording in award text alone does not establish that context. The `courses`, classroom-lifecycle, Project Hub, and assignment-library captures with explicit Electronics context are accounted for in the cross-surface boundary above. Generic `course-01` names can be written by loops over Electronics and 3D; their actual current bytes and owner acceptance cannot be attributed to Electronics by filename alone. This is an unresolved cross-surface scope case, not a deletion proposal.
- The two tracked `e2e/artifacts/courses/demo-course-published-{desktop,mobile}.png` files come from the separate demo-course scenario in `e2e/courses-sharing.spec.ts`, before `courseTitle = Электроника · ...` is set. No Electronics context for those two tracked files was established; they are explicit exclusions, not retention decisions. The timing of the `brief-preview.png` and `library.png` captures before the `Электроника` folder creation does not erase the Electronics environment or assignment visibly present in their tracked pixels.
- `e2e/artifacts/docker-{desktop-1366,mobile-390,tablet-768}.png` and `e2e/artifacts/portal-{desktop,mobile}.png` are written by `e2e/teacher-portal.spec.ts` while showing class/portal UI; the infrastructure manifest requires the three generic Docker frames, and portal evidence is separately validated by `tools/validate-portal-evidence.mjs`. Their names and manifests do not make them Electronics-specific. `docker-electronics.png`, by contrast, is explicitly required as an Electronics artifact and is inventoried above.
- The current Electronics simulation spec also writes untracked names under its artifact directory. Only the 23 currently tracked files above are inventoried. `e2e/electronics-interactions.spec.ts` writes `reports/interactions/**`; no tracked raster in that output path was found. Neither output path is changed here.
- No row is an `obsolete/unreferenced deletion candidate`: missing text references, an old capture date, or a current test writer does not establish disposability. The two root desktop/mobile images remain `unknown`; protected owner-audit references remain protected. Owner retention decisions and any later output separation require a separate selected slice.
