# Published Arduino blocks — local implementation evidence, 2026-11-01

Owner explicitly requested completing native read-only Arduino block display after
layout preview. Scope extends the existing publication artifact projection; no new
endpoint, database migration, editor save path, permissions or deployment changes.
Current implementation lives on codex/publication-detail-layout-20261101, not Main.
Baseline converged once with origin/main8d885a5d before shared-contract changes;
unrelated untracked Arduino reports preserved.

## User-visible result

Existing right code panel chooses by saved arduinoCodeMode: blocks renders the
editor's native scratch-blocks2.1.19 with canonical Arduino definitions/theme;
text renders escaped source. blocks-text displays blocks with collapsed generated
text. The renderer is lazy, readOnly, has no toolbox/save/generator/default Blink,
locks block editing/moving/deletion, disposes workspace/ResizeObserver on close.
Native zoom icons use the same pinned assets as the editor. Long stacks can be
panned/zoomed locally. Missing/invalid graphs show a notice, never invented blocks.

The API derives arduinoBlocks only from arduinoWorkspace in the existing immutable
published project-version document. No mutable draft read. Raw editor workspace,
plugins, arbitrary block fields, root metadata and visual comments are omitted.
Block-code comments represented as canonical program fields remain part of code.
Projection is bounded:64KiB,512blocks,64nesting levels,128variables,64fields/inputs
per block, bounded strings/coordinates; unknown executable extension types refused.
Client validates the same projection before loading the real read-only workspace.
The extra display graph is removed from canonical simulation input; existing
published arduinoSource remains the simulation program, no second solver/VM.

## Evidence and checks

-10 projection/security tests PASS: program connections/variables, metadata
  stripping, unknown fields/types, oversized/malformed/deep graphs.
-15 API artifact tests PASS: immutable identity/cache behavior, raw editor state
  exclusion, forged public graph ignored, text mode never returns block graph.
-36 artifact contract tests PASS, including null/boolean/number/invalid graph
  rejection and retained raw arduinoWorkspace exclusion.
-8 native scene component tests PASS;7 runtime tests PASS, including no display
  graph in simulation inputs and no mutation of the published input. Total76.
-Web typecheck, focused ESLint and diff check PASS. Contracts build PASS.
-API+16 prerequisite builds PASS with NX_SKIP_NX_CACHE=true, no cache evidence.
-Native local browser: real API, real isolated PostgreSQL publication, actual
  scratch-blocks SVG (not image/mock); two500 values and HIGH/LOW blocks visible.
  Clicking500 opens no input. Text publication has code/pre and no block viewer.
  Close removes workspace DOM; reopen restores actual blocks. Simulation starts
  with block panel open; no editor/save handler is mounted by the viewer.
-Eight layout checks: blocks/text at1440/1024/390/320; no page overflow, panel begins
  below actual toolbar at every size. Desktop/mobile native screenshots inspected.

Local evidence directory: F:/Asa-Lab/operations/reports/detail-native-20261101
-arduino-blocks-desktop.png; arduino-blocks-1440.png; arduino-blocks-390.png
-arduino-text-desktop.png; arduino-text-1440.png; arduino-text-390.png
-arduino-blocks-layout.json

Public fixture IDs: blocksa246183b-1f0a-41a0-a91d-d1897a37c441;
text2cab18c8-d9e6-4b68-b24d-5ee082c83cac. Synthetic content, real engines/storage.
One superseded bad-number fixture revoked in disposable test state. Existing
Main migration0288 was applied only to asa_detail_preview_test after convergence;
no migration added by this slice. Test API4611/Vite4612 remain loopback only.

## Limits and challenge review

No full repository/publication PostgreSQL CI or built production browser gate run;
this is a locally demonstrated source candidate, not a release claim. Read-only
hybrid display path exists but hybrid native/browser acceptance was not exercised.
Older publication without a saved graph cannot reconstruct blocks from text;
author must republish from an editor retaining its block graph. Existing stored
versions with a graph work without draft exposure or history rewrite.
New UI with old API shows the missing-graph notice. An older strict V3 client does
not recognize the additional optional arduinoBlocks property and may show the inert
fallback until reloaded. Coordinate client/API rollout or capability negotiation
before production acceptance; deployment explicitly NOT_RUN. No separate
independent/release review or Main integration is claimed. API authorization and
fresh-per-request publication/revision revalidation remain unchanged.

POST_STEP_REVIEW: L1 UI plus bounded published-code projection; self/challenge
review performed on metadata disclosure, bounded parsing, immutable/draft boundary,
no editor writes/default programme, native cleanup and client compatibility.
Owner visual acceptance pending. No production database, site update or Yandex action.
