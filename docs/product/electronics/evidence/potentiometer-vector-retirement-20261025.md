# Hidden potentiometer payload retirement

Bounded task: TASK-ELECTRONICS-POTENTIOMETER-HYGIENE-001, Issue752. Source baseline
43198e8b; owner retains the222000byte editor budget. This is source/build evidence,
not deployment, installed save acceptance or acceptance of toolbar751.

## Deletion proof

- Runtime/import: the two private TINKERCAD_POTENTIOMETER constants had exactly
  one consumer each, two path nodes inside the display-none legacy group.
  Repository searches found no consumers of their path children. They were not
  exported. Keep the group marker, angle attribute and visibility unchanged.
- Persistence/schema: no serialized path data, component property or document
  version is changed. The renderer only consumes the same component values.
- Historical contract: visual-source-responsibility-518-20261007 explicitly
  preserved the hidden potentiometer contract without retirement proof. Keep
  that historical report and its diagnostic group/angle intact. This narrower
  change retires only hidden geometry, not the diagnostic DOM contract.
- Ownership: private inline source strings are not protected owner artwork.
  No asset, original, catalog, manifest or owner audit byte changes.
- Replacement: visible OwnerPotentiometerVisual still loads the actual catalog
  owner SVG and calls unchanged potentiometerRuntimeMarkup. Its body, selection
  image, loader, runtime helpers, pin geometry and interaction code are untouched.
- Native proof: the legacy group computes to display:none under actual
  workbench.css. Its hidden geometry contributes no visible pixels. BEFORE and
  AFTER use the actual production renderer, catalog and existing owner SVG bytes.

## Reproducible native evidence

Run the dedicated route-fulfilled browser fixture with --before then without it.
BEFORE reads ProductionComponentVisual from43198e8b; AFTER reads current source.
There is no listening server. Output: test-results/potentiometer-vector-retirement.

Both runs pass48 cases:1440/390viewport, wiper0/0.5/1, rotations0/90/180/270 and
both mirror states. For every matching case, visible owner SVG markup, screenshot
SHA256, diagnostic angle and complete fixture serialized document are identical.
The real browser range adapter receives one native pointer callback and supports
keyboard ArrowRight; save/reopen preserves its document byte-for-byte. This
adapter is supporting renderer proof, not production Sidebar or server SaveCAS.
Actual before/after screenshots were inspected; no owner artwork is redrawn.

## Actual production size

Fresh NX_SKIP_NX_CACHE=true web builds ran all6 targets without cache reuse.
Baseline:221965bytes, SchematicEditor-DJiTEOTV.js,
SHA256c41dab27da5e4d774ab838e3466611c18150b1a7fb09f0d49e155f220b0900d0.
Candidate:217414bytes, SchematicEditor-D9eyqUk8.js. Actual saving4551bytes;
SHA2564556a77a9ca2801037c4078a9140ff337c03c838d4e0de7cb6d6fcbf0f73def4.
headroom4586bytes against unchanged222000. This is a full production build,
not an esbuild/minifier proxy. Initial JS/CSS537647bytes is unchanged; all other
bundle caps also pass. No lazy import, chunk policy or checker change.

The previously measured tooltip delta2445bytes would fit arithmetically, but a
future composition still requires its own fresh actual build and final review.

Focused production-state-contracts, workbench-presentation and owner-runtime-assets:
35tests PASS. Dedicated native48before/48after PASS. Scoped lint PASS. Final
selected gate/type/routing results accompany the executor receipt; GitHub CI and
independent final-SHA review remain separate acceptance steps.

Selected gate: gate:electronics-m1 PASS after repairing only this worktree's
dependency layout. First run had a Vite denied-ID collection failure because
reused dependency junctions resolved Scratch media outside the worktree; it is
retained as categoryD infrastructure evidence, not a product PASS. Frozen offline
installation reused822existing packages with no downloads or tracked lock/config
change. The justified retry passed938domain tests plus973UI tests, typecheck for
27projects plus15dependencies and build for27projects. NX_SKIP_NX_CACHE=true
was literal; every Nx stage reported Cache:Skipped. Routing, scoped lint,
formatting, diff-check and final bundle:check PASS. No local PostgreSQL/data gate.

Remaining loader/instrument/family decomposition debt in ProductionComponentVisual
is retained. This one concern does not reset any unrelated hygiene checkpoint.
