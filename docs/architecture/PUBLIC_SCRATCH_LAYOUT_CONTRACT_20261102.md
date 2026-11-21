# Public Scratch browser layout contract, 2026-11-02

Programme909 bounded test-only repair on canonical integration baseline
e9bd584844ba2fb8b584b51d472549d76dc631b5. Product UI, native Scratch, database,
authorization, source persistence and timeouts are unchanged.

The baseline Scratch focused run41361813434 public-player step passed its three
real PostgreSQL tests, then failed public-project-scratch-viewer.spec.ts at the
desktop alignment assertion: player top versus description top differed by
111.1875px. The downloaded public-player artifact13106235698 was inspected once;
its trace screenshot shows an executing native Scratch player aligned with the
top of the author/date sidebar, followed by module label and project description.

Accepted Publications markup places `Просмотр проекта` next to the entire
`aside[aria-label="Об авторе и проекте"]`. `О проекте` is a child after the author
header, so equating the player top with that child is obsolete. Accepted CSS and
the existing public-projects.spec.ts geometry contract place the sidebar below
the player at widths≤1100px; an older900px breakpoint in the Scratch test also
disagreed with that accepted layout.

The repaired test measures these semantic regions directly. It retains strict
<2px top alignment of the player and sidebar on desktop, non-overlap, a full-width
stacked player at widths≤1100px, positive region dimensions and sufficient player
width. It additionally verifies description containment and author/description
order. The composed accepted CSS uses side-by-side author/description only at
601–1023px: an existing min-width:1024px rule pins `.public-project-about` to the
first column, below the author, including the1024–1100px stacked workspace.
Original widths1440/1120/1024/390/320 remain;1101/1100 and1024/1023 cover both
responsive boundaries. Rectangle evidence is added to the existing native-player
receipt.

The first test repair40c8ac4a incorrectly assumed a two-column author/description
arrangement across601–1100px. Its exact CI41363678713 failed at1100px with
author.right364 and description.left16. Artifact13106597483 was inspected once;
the trace screenshot and the composed min-width:1024px/grid-column:1 CSS explain
this test-only mismatch. The follow-up retains the strict top alignment of player
and sidebar, containment, non-overlap, positive dimensions and all runtime/privacy
checks. At1024–1100px it now positively checks author-before-description and equal
left edges (<2px), while1023px exercises the adjacent side-by-side arrangement.

Guest and active Seat execution/stop, native stage/counter containment,4:3 stage,
fullscreen, reload, exact private asset bytes, blocked write capabilities,
unpublish denial and unchanged saved source remain in the original test. No
assertion is skipped, timeout/tolerance increased, API or VM mocked, or privacy
check removed. Required real PostgreSQL/native-browser evidence is the exact-SHA
Scratch Focused workflow for this child PR; local syntax/diff checks alone do not
prove browser PASS or a completed release. Existing unrelated deployment blockers
remain in force.
