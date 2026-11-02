# Publication author and catalog preview follow-up

Owner scope: real author avatars/names in catalog and detail, exclude chess/checkers
from the projects catalog only, slightly shorter cards, native stage/schematic
previews without workspace backgrounds. No production update.

## Implementation

- Both surfaces use one author avatar component, with initials on missing or failed
  images. The public name remains the existing canonical publication-author label.
  Long card names may wrap to two lines; full names remain in the tooltip/detail.
- Additive migration 0292 selects the current publication revision's author, using
  the same selected Account/Seat avatar sources as comments. Public URLs expose
  publication IDs, not account/principal/seat IDs or embedded profile data.
  Avatar reads require a readable publication and return private/no-store responses.
- The projects catalog opts into a server projection that excludes games before
  pagination. The original general read function, direct game publication links,
  game storage and Games UI are unchanged. Stale games category URLs reset to All.
- Cards use 4:3, matching native Scratch thumbnails and schematic exports. Images
  remain contained in the full card, with author/title/count overlays. No bands,
  vignette, image filters or component cropping were introduced.

## Preview source finding

The native save paths already supply stage-only Scratch thumbnails and white,
content-framed schematic snapshots. The old isolated demonstration publications
had instead been seeded with screenshots containing player chrome/workspace grids.
CSS cannot remove pixels baked into a frozen publication preview.

Only the two disposable demonstration publications were republished with actual
rendered content: the Scratch canvas after starting/stopping the real player, and
the electronics scene exported through `rasteriseSvgStage`, the same exporter used
by the editor. No production rows or historical publication revisions were edited.
Previously published images remain immutable; replacing such an image requires an
author's normal snapshot/update-publication flow.

## Validation and bounded self-review

- 58 focused web/API unit tests passed, including both author surfaces, failed
  avatar fallback and stale games categories.
- 14 real PostgreSQL/API integration tests passed. New checks cover current author
  name/image bytes, absent avatars, revoked-publication avatar denial, filtering
  before pagination, retained general/game reads and invalid catalog rejection.
  Existing Account/Seat comment-avatar guards also pass after sharing the helper.
- Corrected two test-harness assumptions: a profile without a photo has a null
  avatar receipt; application shutdown already closes its runtime pool.
- Focused real-browser regression passed: normal avatar upload, catalog/detail
  photo rendering, 4:3 geometry, no vignette/bands, unchanged stored image bytes,
  no game categories and no overflow at 1440/1024/390/320 pixels.
- Real Scratch/electronics demos were visually inspected at the same widths.
- API build, web typecheck/build, focused ESLint and migration file check passed.

Security challenge: arbitrary avatar URLs cannot be injected into this component;
the endpoint accepts only a UUID publication and resolves its author server-side.
The internal avatar-source helper is not executable by the app role. No profile
or private project lookup capability is added. Old applied migration files were
not rewritten. Game exclusions affect the opted-in catalog query only.

Evidence: `e2e/artifacts/publication-author-preview/`. Local preview uses port 4612
and a disposable test database. The working production site was not updated.

## Owner visual follow-up: compact bottom row and white text halo

The title and counts now share one bottom flex row. Counts keep their width;
the title truncates with an ellipsis and retains its full tooltip. Electronics
uses a teal label without a panel. Author/title/module/date/marks/count text has
a light white shadow; count icons receive a small white drop shadow as well.
The image itself remains unfiltered, without a vignette or added bands.

The seven catalog component tests pass. The focused real-browser check also
passes at 1440/1024/390/320, asserting title/count alignment, no overlap,
ellipsis for a long title and white label shadows. Real demo screenshots were
refreshed. No API, database or production changes were needed for this follow-up.
