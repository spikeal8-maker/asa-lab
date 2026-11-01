# Catalog wide-screen verification and Main integration

Owner requests a complete phone/desktop catalog check, fluid wide-screen sizing,
and source integration into Main, without updating the working site.

## POST_STEP_REVIEW

- CHANGE_CLASS: L1_UI_BEHAVIOR for this final width correction.
- CHANGED: catalog-only width selectors; regression coverage through 3840px.
- USER_RESULT: four cards now expand with the available window width instead of
  staying inside the former 1180px reading container.
- LAYOUT_IMPACT: only `portal-content.public-projects` (guest and authenticated
  catalog, normal/collapsed sidebar). Project details, account pages, games and
  other portal reading widths retain their existing selectors.
- VIEWPORTS: 320, 390, 600, 601, 899, 900, 1023, 1024, 1440, 1920, 2560, 3840.
- VISUAL_EVIDENCE: real 16-publication preview, both guest and Account session;
  `e2e/artifacts/publication-catalog-wide/`.
- NEGATIVE_CHECKS: no horizontal page overflow, author/module overlap,
  title/counter overlap or counter spill. Four equal columns at every width.
- WIDE_GEOMETRY: guest at 3840px has 3808px content / 940px cards; at 2560px,
  2528px content / 620px cards; at 1920px, 1888px content / 460px cards.
- UNVERIFIED: production deployment and production browser sessions; not requested.
- VERDICT: PASS for the local catalog width/layout check.

The persistent browser regression also verifies sorting alignment, single-line
author/title labels, date-only hover placement, avatar rendering and unchanged
preview bytes. Local test data and credentials remain outside Git. Main source
integration must not be described as a deployment or a successful cloud CI run.

## Integration repair: read-only Arduino block dependency

The full publication build found that `PublicArduinoBlocks` imported the editor
registry, its controls and the broad electronics package, making solver/runtime
modules reachable from public viewing. The emitted-graph guard was retained.

Shared block definitions, workspace serialization defaults/migration, theme/help
and static support metadata now have presentation-only modules. The editor keeps
its existing exported APIs and imports those same definitions; the public viewer
imports only presentation. Code generation, connection controls, text diagnostics
and electrical/Arduino runtime calculations remain in their original modules.
No duplicated block registry, changed mathematical algorithm or stored program
rewrite was introduced.

The repair passed web typecheck/lint, 74 focused support/value/serialization tests
and the editor Arduino suites (215 tests, including the unchanged contract
assertions updated to read the new canonical source files). The final publication
build/graph gate is run against the resulting integration commit before Main push.

## Final local verification

- Product build and emitted graph passed on `ef850cf8`: 19 public chunks,
  2,917,275 bytes, zero forbidden editor/runtime sources. Pure static block
  metadata has its own chunk; the Worker admission list adds that exact metadata
  module only, without broadening executable-module rules.
- Publication/API/PostgreSQL suites: 725 tests passed; creator portal: 51 passed.
- Installed-prefix upgrade: 4 passed after extending the explicit migration list
  through 0293 and independently checking the four newly added discussion defaults.
  The strict comparison of every old field/row remains intact. Only this failed
  migration-fixture phase was rerun; the already green 776 tests were not repeated.
- Catalog/detail browser checks passed on seven widths, including real loading,
  connection-error, empty search and keyboard focus/title expansion scenarios.
  Legacy expectations were updated to the owner's four-column, 4:3, single-footer
  design and the existing 1100px detail-sidebar breakpoint.
- Separate final catalog check: guest + Account, all 12 widths through 3840px,
  16 actual publications. API/web builds and typechecks passed.

The final follow-up modifies tests/documentation only; product sources remain the
verified `ef850cf8` build. Cloud CI and production deployment are separate facts;
the owner requested Main integration only, not a site update.
