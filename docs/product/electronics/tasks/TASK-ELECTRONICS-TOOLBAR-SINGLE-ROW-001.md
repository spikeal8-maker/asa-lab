---
task_id: TASK-ELECTRONICS-TOOLBAR-SINGLE-ROW-001
kind: repair
risk: low
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# One toolbar row at Windows125 and Save to the right of Run

Owner explicitly requests this layout correction FIRST, then analog input/Serial
Monitor work. FullHD1920x1080 at Windows125 has roughly1536x864 CSS available;
test actual viewport and deviceScaleFactor combinations, not only DPR screenshot.
Current CSS explicitly forces96px/two rows at981-1373,981-1280 and1281-1536 with
simulation time+emergency copy. Prove current actual Header BEFORE first.

Allowed production: existing WorkbenchHeader.tsx and workbench.css ONLY narrow
toolbar layout and Run/Save ordering. Run before Save, Save at right of action
group; preserve other controls and every handler/disabled/touch/ARIA behavior.
No refactoring or file moves. Necessary positional CSS selector adaptation is
part of this repair, not permission for a CSS cleanup. No persistence/runtime
or global stylesheet changes. No source edits before concise causal proposal.

Keep ONE toolbar row at every supported width, including running clock, save
error/emergency-copy, long title, code/library/alternate view. At narrow widths
existing tools may scroll horizontally, but Run/Save stay reachable and visible;
no overlapping, clipping, content loss, inaccessible focus or accidental double
touch actions. Do not hide emergency recovery to make layout fit. Existing phone
single-row design/targets must remain usable. Keep stage offset aligned with
actual toolbar height, no blank second-row strip.

Native actual Header with unchanged controller ports: BEFORE/AFTER1920/1536/1374/
1373/1281/1280/1024/981/980/390/320 widths and relevant125/150DPR, stopped/running,
save states and keyboard/touch. Save/Run callback exactly once; clock and recovery
visible or explicitly reachable, menus and focus not clipped. Screenshots and
DOM geometry assertions, not injected CSS or replacement renderer.

Focused relevant regression/native/types/build/bundle, NEW independent finalSHA
review. Fixed222000/2000000 caps; if fit impossible report exact measured blocker,
no unrelated refactoring/budget changes. Fresh uncached gate electronics-m1 when
source changes require it, actual counts and completion exit. No foreign CI repair.
No Docker/server/DB/deployment/assets/dependencies/workflows/other product edits.
One bounded candidate, final convergence and source/UI report then STOP. Full
repository/release/installed/SaveCAS/owner acceptance remain separate.
