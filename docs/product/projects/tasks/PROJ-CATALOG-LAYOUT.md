# TASK-PROJ-CATALOG-LAYOUT-001

Owner requested compact canonical public Projects catalog. Apply UI/UX specification
sections4–7,21,70–72 to supported current data, not the entire concept wishlist.
Current catalog has full-width search, a separate large My Projects action and
a hidden module select. Prior owner direction keeps Games separate.

## One bounded slice

Compact title/short introduction, modest secondary My Projects entry and bounded
search with accessible submit. Horizontal module chips, current filter state and
honest newest-first indication. Preserve unknown module URL recovery. Use only
existing supported module entries; do not reclassify or remove game data here.
No claims of author/tag/studio search beyond actual API support.

Responsive image-first cards: four columns wide desktop, three intermediate,
two tablet/mobile375–430, one very narrow320 if needed. Small module marker,
two-line title, single-line author, real like count/date and at most compact
existing editorial/pinned signals. No fake views/comments/remixes, no viewer
inside card, no fabricated featured project. Retain existing featured/pinned
ordering; separate editorial banner is deferred absent a dedicated featured DTO.

Search/filter URL behavior, debounce/submit contract, pagination dedupe/error/
stale-response guard, immutable links and visibility permissions stay intact.
Preserve existing detail-page/owner-dialog/player styles by catalog scoping.
No DB/API changes, 3D viewer, downloads, global shell changes or deployment.

## Evidence and delivery

One bounded author, focused checks once per meaningful change, independent exact
Code review (security review only if real boundary changes). Actual built-browser
catalog screenshots320/390/768/1024/1440, multiple real test publications, search,
category navigation, long text, keyboard focus, loading/empty/error and pagination.
No horizontal page overflow; chips may scroll within their own row. Functional
regressions must be checked, no blanket test weakening. Existing public gate and
General source checks before Main. Heavy builds/PG/browser only GitHub, no local
dependency repair. Report source SHA, tests, visual evidence and deployment not_run.
