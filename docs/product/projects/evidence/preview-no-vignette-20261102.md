# Preview vignette removal — local UI check

Owner clarification replaces the rejected card redesign: remove only the dark
top/bottom vignette, use a white electronics background, add no bands or panels.
The rejected author/catalog work was restored to e97af398 before this change;
its draft is archived outside the repository. No rejected API or game-filter
changes are included here.

The card overlay pseudo-element is removed. Existing author/title/statistic
positions are preserved; text uses a dark color with a small white text shadow
for readability, without a background strip. Electronics image containers and the
public electronics viewer use white. Preview pixels remain unmodified, contained
and uncropped; no image filters are applied.

Current card sources are already project snapshots: Scratch's trusted native
thumbnail event saves the stage image, and the electronics editor exports its SVG
through the existing rasterizer with a white canvas. No per-card live editor or
simulator was introduced, and immutable publication images were not rewritten.

Verification: 17 existing page/component tests passed. A new real API-backed
Chromium regression passed in 3.7 seconds: no overlay, no added strip, white
electronics background, contained/unfiltered pixels and unchanged image hash at
1440/1024/390/320. Actual Scratch/electronics demo previews were separately captured
and inspected at those widths; no page overflow. The real electronics viewer's
background was verified white.

POST_STEP_REVIEW: L1_UI_BEHAVIOR, local PASS. Shared card styles affect all catalog
cards and the explicit electronics background affects static/detail viewing;
those consumers were checked. No API, schema, access, game or editor changes.
Production deployment and full release CI are not claimed. Site not updated.

Evidence: `e2e/artifacts/preview-no-vignette/`. Earlier rejected draft migration
remains confined to a disposable test database; no migration history was rewritten.
