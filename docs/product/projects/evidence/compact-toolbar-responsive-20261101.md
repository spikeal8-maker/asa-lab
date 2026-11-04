# Compact publication toolbar and responsive layout — 2026-11-01

Owner rejected oversized controls/mobile layout and requested proper comments.
This bounded implementation changes the local detail viewer shell only. No public
comments endpoint/storage/settings exists; confirmed by scoped source inspection.
Comments were not just hidden by a permission. Owner learner policy clarification
is recorded in DECISION_LEDGER. No nonfunctional discussion/form was inserted.
PROJ-R8-04 requires accepted prerequisites and explicit execution selection; its
full implementation is not claimed by this UI result.

Desktop electronics toolbar now42px high, compact32px controls with secondary
icons and accessible labels/tooltips. Touch layout retains44px targets in a49px
main row: Start, Code and More. More reveals a second49px row containing actual
reset/zoom/fit/fullscreen controls; code pane stays below both rows. No run/stop,
solver, document or permissions behavior changed. Social buttons reduced on desktop;
mobile title/back hierarchy improved. At1100px sidebar moves below the viewer;
601/600 transitions preserve full text and useful working area.

Published blocks fit initial horizontal scale to the real container width on
resize, preserving a readable minimum and existing zoom/pan. Native Scratch iframe
height now follows its actual4:3 stage plus44px controls using its scoped container;
no permanent mobile min-height forcing blank stage margins. Fullscreen sizing is
excluded from that normal-mode rule.

Checks:15 focused scene/runtime tests PASS; web typecheck and focused ESLint PASS;
new toolbar open/close in native browser; no overflow and pane below toolbar.
1440/1024/390/320 geometry checks plus1101/1100 and601/600 breakpoint checks PASS.
Actual stage widths884/992/358/288; title widths remain readable. Browser mobile
Scratch width356/height311 equals267px stage+44px toolbar; native flag launches.
No claim of exhaustive device/browser compatibility or release CI acceptance.

Evidence in F:/Asa-Lab/operations/reports/detail-native-20261101:
compact-final-desktop.png (1280x800) and compact-final-mobile.png (390x800),
compact-layout-checks.json, compact-breakpoints.json. Final native screenshots
visually inspected. Oversized CDP captures above the physical window dimensions
produced tiled/cropped capture artifacts; those are NOT accepted screenshots or
used as proof. Final screenshots use sizes fitting the real browser surface.

TASK remains local detail preview, owner acceptance pending. No Main integration,
production update, production database write, migration, backup or Yandex action.
Existing unrelated untracked Arduino reports preserved. Comments remain outstanding,
including real records/pagination, class/learner permissions, owner close and admin
moderation; do not imply they are finished from this layout.
