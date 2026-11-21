# Community catalog visual follow-up

Owner scope: simplify the heading/search, replace the count row with real sorting,
keep four columns even on phones, single-line author names, date-only hover labels,
and enough local publications to judge the grid. No production deployment.

## Result

- Heading: “Идеи, схемы и программы сообщества ASA Lab”; narrower search.
- Removed “Работы сообщества / Показано …”. Sorting sits on the same toolbar,
  aligned to the right, separate from the module buttons (148px desktop, 132px
  mobile). Module buttons remain horizontally scrollable on narrow screens.
- Newest, oldest, likes and additions sorting is performed before pagination on
  the server. Sort persists in the URL, search, category and load-more requests.
  Existing newest-first callers retain their behavior through the five-argument
  wrapper. Existing games/general publication reads are unchanged.
- Additive migration 0293 preserves publication visibility/module/search guards,
  fixed search_path and restricted execution grants. Sort input is allowlisted;
  no query-supplied SQL fragments are interpolated. Date/ID break ties.
- Four 4:3 cards per row at every width. Phone overlays use smaller spacing and
  type to accommodate the explicitly requested four-column layout; opening a
  project still exposes full-size content. The image itself remains unfiltered.
- Author names use one line and ellipsis with a full-name tooltip. Hover/focus
  reveals only the date, directly underneath the name. Scratch card label is
  “Программа”. Existing white text/icon shadows remain.

## Local demonstration data

The disposable preview now has 16 real publications: two originals and 14
additional API-created examples, split between programs and electronics. These
reuse the originals' real documents and native content previews; examples are
marked as local layout-test work in their descriptions/tags. Project creation,
draft save, snapshot and publication all used normal owner API routes. No
production data, accounts, counters or historical revisions were modified.

## Verification

- 62 focused component/API/PostgreSQL tests passed. They cover URL restoration,
  sort preservation, sorting before pagination, invalid sort rejection and existing
  public author/comment protections.
- Final browser regression passed at 1440/1024/390/320: exactly four grid columns,
  narrow right-aligned sort control in the module toolbar, no horizontal page
  overflow, one-line/ellipsis labels, title/count separation, white shadows,
  date-only hover placement and unchanged preview bytes.
- Separate real-data check verified all 16 cards form four rows of four at those
  widths and confirmed server-side popular ordering against actual reactions.
- API build, web typecheck, focused ESLint and migration file validation passed.
- Images: `e2e/artifacts/publication-catalog-refinement/desktop-16.png` and
  `mobile-16.png`. Screenshots use the actual local application and API.

The working site was not updated. Test credentials and local fixture indexes
remain outside Git.
