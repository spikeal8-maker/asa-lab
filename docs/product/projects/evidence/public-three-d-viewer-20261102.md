# Public 3D viewer and on-demand card previews

Owner-selected `TASK-PROJ-R7-04A-3D-001`. Source implementation and isolated
demonstration only; no production deployment, database writes or owner acceptance.

## Implemented boundary

- Schema 4 is an owned, geometry-only public projection of the exact immutable
  publication revision. It does not transport private editor documents, camera,
  grid/ruler state, project IDs, credentials or authoring metadata.
- Existing server authorization runs before every artifact response, including
  cache hits. Draft edits cannot update a publication; republishing invalidates
  the old revision and revocation denies later reads. No migration is required.
- Strict plain-object/field/primitive/number validation, maximum 256 nodes,
  512 KiB artifact and 2048 sketch points. Empty/unsupported/oversized models keep
  the native image fallback. No arbitrary remote textures or executable content.
- The lazy presentation reuses canonical geometry, boolean operations and camera
  navigation. The authoring React application, panels and save hooks are not
  mounted. `SceneRuntime(..., true)` has no pickable editing entries and guards
  selection/transform callbacks. The existing editor default remains unchanged.
- Public page: rotate, zoom, reset, fullscreen, keyboard and touch. WebGL failure
  leaves the genuine saved preview visible. This is a viewer, not a download grant.
- Public catalog, Creator Home and My Projects: pointer movement rotates a real
  model after a 180 ms hover delay. One global hover lease synchronously disposes
  the previous renderer. Leave, hidden tab, preference change and unmount cancel
  pending fetches and release frame, Worker, listeners and GPU context. Stale
  responses cannot resurrect a stopped preview. Reduced-motion and touch cards
  retain static previews; touch rotation is available on the full project page.
- Private cards use the existing authenticated project read. Public cards use
  only the public artifact endpoint and verify publication/revision provenance.
  Neither hover path calls a project writer.
- The 3D editor now opens the canonical publication panel after capturing the
  current saved geometry's real snapshot. Existing ownership/class/learner
  publication rules still apply; opening the panel does not publish automatically.

## POST_STEP_REVIEW / CHALLENGE_REVIEW

- CHANGE_CLASS: L3_CRITICAL, new bounded public projection/read-only runtime.
- USER_RESULT: a genuine 3D publication can be inspected, and its card responds to
  pointer movement in all three requested surfaces.
- LAYOUT_IMPACT: scoped `three-d-*` presentation styles and preview wrappers;
  existing catalog grid, titles, avatars, counters, Electronics, Scratch and Games
  layouts remain unchanged. Shared `ProjectPreview` covers Home/My Projects.
- VIEWPORTS: 1440, 1024, 390, 320. Actual mobile touch/fullscreen also checked.
  No horizontal page overflow in catalog, Home, My Projects or public model view.
- VISUAL_EVIDENCE: `e2e/artifacts/public-three-d-viewer/`; four real editor-created
  publications in the disposable preview, including a boolean hole. No fabricated
  canvas, mocked artifact response or production identity.
- TESTS: 84 focused contract/API/real PostgreSQL/preview/toolbar/page tests passed;
  173 3D domain/editor and provenance tests passed (overlapping suites, not additive).
  Persistent real-editor browser regression passes publication, preserved snapshot
  bytes, public rotate, public hover, private Home/My Projects hover, reduced-motion,
  disposal and unchanged private draft/no project writes. External browser checks
  additionally prove lease transfer between two cards, touch, fullscreen, four
  different real models, WebGL-unavailable fallback and compact layout.
- NEGATIVE_CHECKS: private/revoked/stale revision denied; public provenance mismatch
  rejected before mounting; unsupported geometry falls back; public card never reads
  `/api/projects/`; all editor tests retain their original writable-mode behavior.
- COMPATIBILITY: no SQL/state-machine/permissions change. Older clients may retain
  the static preview for schema 4; existing display families are unchanged.
- NEW_DEPENDENCIES: none. Reuses installed Three.js and canonical geometry Worker.
- HYGIENE: bounded new schema/adapter/presentation, no copied geometry mathematics;
  one hover context instead of one per card. Largest existing touched files are
  ThreeDEditor, SceneRuntime and the publication browser regression.
- DOC_DRIFT: task preparation header is historical; live selection remains in
  `docs/execution/current.yaml`. This evidence is not milestone/release acceptance.
- UNVERIFIED: production/browser sessions and low-end hardware performance under
  sustained school load. Unsupported very complex models deliberately stay static.
- VERDICT: focused implementation checks PASS. Product build and emitted dependency
  inspection are the final integration gate before pushing this slice to Main.

## Local examples

Preview catalog: `http://127.0.0.1:4612/#/explore` (20 real isolated publications).
House model: `http://127.0.0.1:4612/#/public-projects/94686ae6-f667-4bcd-ba9f-5321597ddaec`.
The examples are local, not working-site content. Account state, test credentials
and full run logs stay outside Git in the operations report directory.

## Final integration receipt

Product build and emitted graph passed on
`2452b85545ab172edc04a5109d757b7b5b10412b`, after conflict-free convergence with
Main `c3537033`. Web typecheck and changed-source lint passed. The package now
exports pure `document` and `operations` subpaths, avoiding module-provider/SDK
side effects in the public viewer. The emitted-graph guard was not weakened.

- Existing publication/Worker graph: PASS, 27 chunks, 5,953,263 raw bytes,
  zero forbidden executable editor/electronics sources. This graph conservatively
  includes both viewer families and shared application dependencies, not initial
  page transfer size.
- 3D viewer static closure: nine chunks, 3,770,150 raw bytes including shared React/
  bootstrap and Three.js. Geometry/fonts account for the largest lazy runtime chunk.
  No authoring shell, toolbar, panels or project persistence hooks in that closure.
- Initial application entry contains neither `SceneRuntime` nor `ThreeDPresentation`.
  Heavy 3D rendering starts only for a requested project view/hover.
- Focused regression after import isolation: selection-model, hover lease and
  publication provenance tests passed. The public/private pointer browser regression
  passed before this import-only isolation; the canonical algorithms were unchanged.

Owner visual acceptance remains pending. Cloud CI and working-site deployment
are separate from these completed local checks.
