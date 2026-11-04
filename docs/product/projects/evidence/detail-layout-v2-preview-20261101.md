# Public detail: second visual composition — 2026-11-01

Owner rejected the first local example and requested a complete redesign. This
supersedes its visual proposal, not its source/permission invariants. No deployment
or backend/comment implementation requested.

New composition: full-width project workspace with one enclosing surface, native
viewer on top and an attached bottom action bar. Description/tags and collapsed
publication facts are BELOW the project, no side panel. Public author/date are a
compact line below a stronger title; module label is quiet, unboxed. Secondary
reaction/count/link controls have no heavy button boxes; copy remains one compact
dark primary action. Mobile keeps the same hierarchy with wrap and44px targets.
No card catalog, math/simulation/player implementation, identity/API or permissions
changes. Existing local long-description toggle and loading/error/revocation/
clipboard flows retained. No invented comments controls or owner menu.

Evidence: ten existing/new page component checks PASS after intentional reading
order update for grouped viewer/actions. ESLint PASS (existing Nx graph warning),
format/diff checks PASS. Actual changed component DOM rendered in isolation;
native Chromium at1440/1024/390/320 verifies full-width viewer, flush integrated
command bar, actions inside workspace, description below, no page overflow.
Desktop and390 screenshots visually inspected. Source fixture's existing public
project image and author are real, description/3copies/7likes explicitly synthetic.
Static fallback only, not a functioning player demo or production usage.

F:/Asa-Lab/operations/reports/detail-layout-v2-20261101/
- example-{1440,1024,390,320}.png
- example.html and layout-checks.json

CHANGE_CLASS: L1_UI_BEHAVIOR / layout continuation
LAYOUT_IMPACT: public detail outer composition only
AUTHORITY_IMPACT: none
VIEWPORTS:1440/1024/390/320 isolated PASS
VISUAL_EVIDENCE: paths above
DOC_DRIFT: prior visual proposal rejected; this variant supersedes it
UNVERIFIED: full built-app/native-player interaction in the new frame; full release
CI; Main integration; owner visual acceptance; deployment
VERDICT: local visual example PASS; saved locally, not pushed to Main or installed
