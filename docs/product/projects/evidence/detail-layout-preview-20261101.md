# Public project detail: local layout example — 2026-11-01

Owner explicitly requested critical analysis, markup and a visual example. This is
one local presentation slice, not a new discussion backend or deployment.

## Critical findings and corrections

- Back navigation consumed a separate row above title. Loaded detail now groups
  exactly one real back link with the existing accessible expandable title.
- Public identity was mixed into unrelated badges. Initials fallback, existing
  public author name and date form one row; module/editorial badges are secondary.
  No new private avatar/profile projection. Date is not repeated in technical facts.
- Main project, information and actions lacked a coherent hierarchy. Viewer is
  about70% on desktop with a bordered notes panel alongside; current copy/like/
  copy-count/share actions stay in a compact row below the viewer.
- A permanently empty side column would waste space when no description/tags
  exist. Such publications retain a full-width viewer with compact facts below.
- Long descriptions stretched the page. Existing full text is retained and can
  be expanded/collapsed with a linked accessible control; no nested text scroller.
- Static mobile fallback preview had excessive vertical dead space. It now uses
  its natural4:3 card ratio; native Scratch/Simulation renderers remain unchanged.
- Comments and owner settings do not have the required current page API/state.
  No decorative/nonfunctional comment tabs, switches or ellipsis menu were added.

## Evidence

Ten real page component tests PASS, including existing loading/error/unavailable,
clipboard fallback, immutable artifact revocation and the new single-header/
identity/date/count and accessible long-description toggle cases.
ESLint PASS (existing uncached Nx graph warning), format and diff checks PASS.

Native Chromium inspected actual changed React DOM and current CSS at1440/1024/
390/320, with example, long content and no-description cases:12 layout PASS.
Assertions include no page overflow, single back link, header sharing a row,
viewer/actions order, desktop sidebar ratio, absence of empty sidebar, and compact
mobile fallback. Desktop/mobile example screenshots visually inspected; first
mobile screenshot exposed excess fallback height and was corrected before final
capture. No blanket overflow hiding, native player changes or new data requests.

Evidence directory: F:/Asa-Lab/operations/reports/detail-layout-20261101/
- example-{1440,1024,390,320}.png
- long-{1440,1024,390,320}.png
- no-description-{1440,1024,390,320}.png
- layout-checks.json and corresponding HTML snapshots

Preview uses an existing real publicly available electrical project image and
public author, with explicitly synthetic description, tags and3copy/7like metrics
to illustrate composition. Its renderer intentionally uses static fallback.
It is NOT production usage, a functional simulator demonstration or a complete
built application acceptance. Temporary local capture harness removed.

CHANGE_CLASS: L1_UI_BEHAVIOR (local text expansion plus scoped layout)
AUTHORITY_IMPACT: none
STATE_IMPACT: local description expansion only, reset on publication reload
LAYOUT_IMPACT: public detail; catalog and native player implementation unchanged
VIEWPORTS:1440/1024/390/320
VISUAL_EVIDENCE: paths above
DOC_DRIFT: none; unavailable comments/profile-avatar API explicitly recorded
UNVERIFIED: complete application/browser gate, native interactive players under
new outer layout, source Main integration, production deployment, owner approval
VERDICT: local layout example PASS; no release or deployment claim

Product source is retained locally for owner visual review; not pushed to Main.
