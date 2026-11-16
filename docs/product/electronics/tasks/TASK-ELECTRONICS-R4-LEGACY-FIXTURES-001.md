# TASK-ELECTRONICS-R4-LEGACY-FIXTURES-001

**Issue:** https://github.com/spikeal8-maker/asa-lab/issues/1215

**Owner request:** 2026-11-16, recheck and finish Arduino programming UX. Separate category-C test-only prerequisite; not part of PR #1163.

## Fixed evidence / scope
Source main at selection: `aef89f02a3425653109ce0d159367c8d9cc2f82b`. The candidate UX PR is `a05294e758d5d983778a1ca30082de88028c21a3`. Exact R4 run 43883312759: s1 has four workspace-menu fixture failures because it sets mode=blocks without saved workspace; s3 has two fast Save/navigation fixture failures because it expects an empty workspace key. Accepted #865 intentionally preserves absent workspaces for source-only sketches.

**Only implementation files:**
- `e2e/electronics-interactions.spec.ts`
- `e2e/electronics-simulation.spec.ts`

## Required test-only corrections
1. In the four native workspace-menu cases, use a genuinely saved, valid Blockly fixture rather than changing only `arduinoCodeMode`. Check native context menu at 1440, 1024, 390 and 320 px; verify that source and serialized Blockly workspace remain identical after repeated menus, close/reopen, and no unsafe replacement.
2. For the two source-only fast Save and genuine departure cases, preserve the actual exact document schema: no synthesized `arduinoWorkspace: ''` key when the existing project did not contain one. Continue asserting the exact local document at input and immediate action, the unchanged 260 ms bound, one PUT 200, server readback, source bytes and identity.
3. Verify source-only no-edit mount retains source and absent workspace; avoid any product change or weakening of unrelated test contracts.
4. Do not edit runtime, GPIO, solver, Worker, timeouts, thresholds, R4 math/optical assertions, CSS, API, production, databases or legacy data.

## Execution
One author for the two test files; exact-path preflight and plan verification. Two separately bounded candidate files only, with task-registration documents; no foreign worktree edits. Run focused native tests where a permitted isolated stack exists; General CI and Electronics strict gates classify unrelated failure. One independent exact-SHA reviewer must approve before any merge. No Codex. Existing PR #1163 stays OPEN/HOLD until all required gates pass. `main` and deployed instances are not modified by this candidate branch.
