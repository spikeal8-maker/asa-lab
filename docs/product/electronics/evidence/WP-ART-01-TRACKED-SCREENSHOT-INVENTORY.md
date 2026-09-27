# WP-ART-01 — tracked Electronics screenshot and raster evidence inventory

This is the read-only inventory for `TASK-ELECTRONICS-SCREENSHOT-INVENTORY-001` / Issue #404. It proposes lifecycle classes for an owner retention decision; it does not authorize deleting, moving, regenerating, promoting, or repackaging any image. Snapshot source: tracked tree at `dcce23197b4caf85e78b69b027147fdbc8032847` (2026-09-27, before this document). Paths below are repository-relative and exact.

## Reproduce the candidate set

Start with `git ls-files | rg -i '\.(png|jpe?g|webp|gif|bmp|tiff?)$'` (284 tracked raster files at the snapshot). Inspect all `e2e/artifacts/**` names, the screenshot writers and their selected module, references in `README.md`, `docs/**`, the README image manifest, and the owner-audit manifest. The primary inventory below has **58 paths**: 24 protected owner-audit references, 23 Electronics simulation captures, 3 root E2E captures, 3 owner-provided README originals, 4 explicitly named Learning/Electronics course captures, and 1 Learning capture of the actual Electronics editor. The separate boundary appendix accounts for another 36 tracked Learning images: 19 from Electronics-backed VS-001, VS-002, and M0-007 scenarios, and 17 generic course-01 captures. Their images primarily document Learning controls or their current bytes cannot be attributed to Electronics. The distinction is based on image purpose and explicit references, not only a `module_key` seed.

Useful repeatable checks:

```text
git ls-files 'apps/web/public/assets/electronics/owner-audit/**/*.png' 'e2e/artifacts/**/*.png' 'e2e/artifacts/*.png'
rg -n 'ARTIFACT_DIR|evidenceDir|\.screenshot\(' e2e/electronics-simulation.spec.ts e2e/learning-course-01.spec.ts e2e/learning-learner-submits-project-assignment.spec.ts
rg -n 'docker-electronics|electronics-(desktop|mobile|blocks|cpp|simulation)|real-project-editor|source-reference' README.md docs e2e apps/web/public/landing/assets-manifest.md tools/audit_owner_electronics_assets.py
```

`rg` finds text references, not every visual dependency. A missing text reference is never deletion proof. An exact-name search found no current screenshot assertion consumer for these PNGs. Capture calls are writers, and a tracked PNG is not automatically a golden comparator.

## Field key and evidence

Every row supplies path, provenance/owner, document reference, writer/consumer, proposed class, and unresolved dependency. Repeated evidence is keyed here to keep the path list auditable.

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

## Cross-surface Learning boundary (36 tracked paths)

These paths are documented so a later retention decision cannot mistake an Electronics seed for a complete Electronics screenshot inventory. Their current purpose is Learning assignment, gradebook, or audience UI. They are **outside the 58-path Electronics lifecycle classification**, despite an Electronics-backed scenario. No deletion or disposable status is inferred; Learning ownership and acceptance remain in force. The final column states what would need to be resolved before any broader cross-surface evidence policy.

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

## Boundary and unresolved scope

- `apps/web/public/landing/electronics-{blocks,cpp,simulation}.png` are tracked **runtime public artwork copies** of the owner README originals according to `apps/web/public/landing/assets-manifest.md`; `apps/web/src/pages/PublicEntryPage.tsx` loads their public URLs. `apps/web/public/social/asa-lab-electronics.png` is a runtime social/SEO image used by `PublicEntryPage.tsx` and `apps/web/public/features/electronics/index.html`. These four are excluded from this screenshot/evidence lifecycle inventory. Their runtime/provenance boundary is WP-ASSET-01; no packaging conclusion is made here.
- `e2e/artifacts/readme-2026-09-07/github-cover.png` is explicitly promotional artwork, not an interface screenshot. Other README, 3D, chess, classroom, and generic portal images are outside this Electronics-specific set unless a writer or document establishes an Electronics capture. Generic `course-01` names can be written by loops over Electronics and 3D; their actual current bytes and owner acceptance cannot be attributed to Electronics by filename alone. This is an unresolved cross-surface scope case, not a deletion proposal.
- `e2e/artifacts/docker-{desktop-1366,mobile-390,tablet-768}.png` and `e2e/artifacts/portal-{desktop,mobile}.png` are written by `e2e/teacher-portal.spec.ts` while showing class/portal UI; the infrastructure manifest requires the three generic Docker frames, and portal evidence is separately validated by `tools/validate-portal-evidence.mjs`. Their names and manifests do not make them Electronics-specific. `docker-electronics.png`, by contrast, is explicitly required as an Electronics artifact and is inventoried above.
- The current Electronics simulation spec also writes untracked names under its artifact directory. Only the 23 currently tracked files above are inventoried. `e2e/electronics-interactions.spec.ts` writes `reports/interactions/**`; no tracked raster in that output path was found. Neither output path is changed here.
- No row is an `obsolete/unreferenced deletion candidate`: missing text references, an old capture date, or a current test writer does not establish disposability. The two root desktop/mobile images remain `unknown`; protected owner-audit references remain protected. Owner retention decisions and any later output separation require a separate selected slice.
