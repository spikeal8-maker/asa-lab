---
task_id: TASK-ELECTRONICS-TOOLBAR-TOOLTIPS-001
kind: repair
risk: medium
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# OWNER23 L03 — instant toolbar hover/focus help

Original remark15, P2; Issue751 under703/452. Owner authorizes the full first-file
programme, easiest free slice first. P0 read-only classification found no newly
confirmed current loss/security cause;19 remains PARTIAL and21 confidential
UNATTRIBUTED. This slice is independent of save/API/identity. Preserve all active
reverse-LED, SPDT, E11, mirror, boundary and Arduino lanes.

Component: electronics.ui.workbench (ASA, medium). Read its entry in
../components/ui-assets-persistence.yaml, OWNER_23_EXECUTION_QUEUE sections2–5,
AGENT_GUIDE sections2,5,11–13 and docs/product/ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md.

BEFORE is source-confirmed: ToolButton and direct Header wire-colour/path, Code,
Run/Stop and disabled Share controls use native title without immediate DOM help.
Capture genuine native BEFORE before product edits; do not claim it already run.
Do not confuse this task with Blockly block descriptions from4cf71f8a.

Outcome: immediate short help at actual mouse hover and keyboard focus; dismiss
on leave/blur/Escape without focus/command changes. No duplicate native tooltip,
clipping, viewport overflow, pointer interception or focus trap. Touch tap/swipe/
cancel must keep native scrolling and exact callback counts, with no sticky
bubble. Disabled controls remain inert and dynamic Run/Stop wording remains true.

Production write budget: WorkbenchHeader.tsx, narrowly scoped workbench.css and,
only if needed, one small local WorkbenchTooltip.tsx presentation helper. The
mobile toolbar deliberately clips its horizontally scrolling content: do not
put an untested pseudo-tooltip inside that clip or change scrolling to hide it.
Keep all existing touchCommand handlers/callback semantics unchanged.

Tests: at most two dedicated unit/native browser regression files plus existing
Header time/presentation regressions. Register actual new source/test paths in
the same component card. The real Header/CSS/NativeOpticalPresentation may be
bundled with the established in-memory esbuild/Chromium pattern; no local app
listener, Docker stack, account or database. Native1440/1024/390/320 evidence must
cover first rendered hover/focus, Tab/Enter/Space/Escape, mobile tap/swipe/cancel,
scroll clipping, all direct controls and exact activation counts. Test behavior,
not source substrings. Preserve existing save/runtime state rather than mocking
new authority. Fresh before/after web build and bundle:check are mandatory; do not
raise the current checked-in cap or pull unrelated PR685. The fresh baseline
is221965/222000 bytes;222000 was owner-approved in6b534da6 after the historical
queue218000 literal. This task does not change the checker or its cap.

Run focused regressions, lint/types/build and declared focused gate. Push one
bounded candidate only when controller instructs; independently review one final
SHA and genuine browser evidence. General/required CI on the selected candidate
must be classified exactly; cancelled/stale or unrelated failures are not PASS.
No simulation/model/clock/persistence/hooks, dependencies, workflows, protected
artwork, other product, server/deployment or live pupil-data change.

Executor returns candidate/evidence/self-review then STOP. Controller integrates
accepted work, updates703/current.yaml and selects the next free dependency;
executor must not start L05 or close unrelated branches. Installed and owner
acceptance remain separate from source/technical proof.

## Controlled unpublished prototype before a budget decision

Native BEFORE and fresh baseline are captured; only35bytes remain. Two genuine
Stage cleanup proxies offer158/209bytes and cannot establish adequate headroom.
The controller therefore permits ONE unpublished, minimal correct L03 prototype
in the isolated worktree to establish its actual functional result and exact byte
cost. Keep all feature constraints, callbacks and the checked-in cap unchanged.
No source publication/merge or technical/owner acceptance until the explicit
budget blocker is resolved by real passing budget proof or an accepted bounded
prerequisite. A failing bundle check remains FAIL, never waived or relabelled.

Capture native AFTER, focused Header regressions, lint/type/build and actual
bundle measurement. Do not run knowingly blocked broad CI or change another
module simply to make room. Return one local candidate/evidence and STOP. This
makes any necessary owner budget/design choice concrete; it grants no increase.

## Owner decision after the measured prototype

On2026-10-25 the owner explicitly chose to retain222000bytes and perform a
separate cleanup first. Prototype3e706b5e has independent functional/native proof
but fails the unchanged budget at224410bytes. Preserve it unpublished. Select and
review any behavior-preserving cleanup as its own bounded prerequisite; minifier
proxies or moving cost into the eager startup graph do not establish headroom.
Only actual production build measurements can unblock the feature. No increase
to this or other budgets is authorized by this decision.
