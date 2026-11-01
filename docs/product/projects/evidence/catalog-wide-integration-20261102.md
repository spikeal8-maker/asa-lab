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
