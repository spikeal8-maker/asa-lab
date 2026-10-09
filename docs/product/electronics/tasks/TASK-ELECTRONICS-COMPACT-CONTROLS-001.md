---
task_id: TASK-ELECTRONICS-COMPACT-CONTROLS-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Accepted531 application readiness and owner programme452
  - Independent530 original981 primary Run caption and font-selector clipping
acceptance_boundary: slice
review: independent
---

# Compact desktop controls stay readable and usable

Programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452); separately selected dependency [532](https://github.com/spikeal8-maker/asa-lab/issues/532) of preserved530/526. Selection lives only in current.yaml. This is a bounded product layout repair, not broad visual restyling or Arduino/runtime work.

## Pupil result and preserved BEFORE

With Code open at981px, the full primary Start/Stop Simulation caption and Arduino text-size control must fit and work with ordinary input. Window narrowing and drawer width changes must preserve those controls. Do not replace the full caption with an icon or suppress necessary controls to pass bounds checks.

[Independent530 review](../evidence/wire-menu-530-independent-review-87099554.md) inspected original production-built981-before-purple.png and981-after-purple.png: primary Run caption and right font selector are clipped, including after menu closes/toolbar28. Original source87099554c8227f841718fc052cc24f99f2883d41/tree84d1bda673f13d30734748032e0567a2c5239722/run37876603308; original PNG SHA256ac9b1f3147b532ed0ecfcdf1e45b97589d4b3d5cc814d61ee39ef9f604023ec3/86fa54cb56f6d6ca3a7e88ee0c1d05086059fc82fda27f4d10c55c6d0ca2bf62. Cached once at C:/Users/spike/.codex/temp/electronics-e01/87099554-ci/run-37876603308/extracted/reports/playwright/electronics-wire-menu-530/. These are actual candidate BEFORE images, not a performed main browser comparison. New530 diff only raises an open-menu stacking context; closed-menu clipping and unchanged base geometry support a separate cause. Confirm exact relevant source continuity before attributing main; do not rerun old measurements without new reason.

## Route and write budget

Mapped electronics.ui.workbench in components/ui-assets-persistence.yaml; one dependent ArduinoCodePanel presentation consumer. Read this card, original530 review, docs/product/ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md, WorkbenchHeader toolbar and ArduinoCodePanel toolbar consumers, affected workbench.css rules, exact regression harness. No new inventory.

Start from newly selected canonical main in a clean owned branch. Preserve all published references and accepted work; do not merge either unaccepted530870/5260dd or resume525.

- Production budget: apps/web/src/electronics/workbench.css only, minimal causal compact desktop layout for the two proved controls and their containers. Preserve normal desktop and existing mobile presentation, native wire menu layering, drawer interaction, text and accessibility. No global restyling/breakpoint rewrite. If an additional production file is necessary, show concrete causal evidence to controller before editing.
- Meaningful regression: one new case in existing e2e/electronics-simulation.spec.ts, real existing API/login/project and production-built editor. At1440/1024/981 desktop and980/390/320 applicable mobile, capture raw bounds, full rendered caption/text range, clipping ancestors, normal hit targets and original PNG before assertions. Code-open, stopped/running captions and normal text-size selection must be checked; verify actual outcome and preservation of circuit/sketch intent. Exercise actual drawer width on desktop and applicable mobile height without synthetic/force input. Protect unchanged physical accuracy, readiness, deadline and existing scenarios. Do not import526 full56 denial journey or reimplement530 native-menu repair.
- Only canonical generated component-coverage.json browser-source digest follows changed simulation source; all other parsed fields stay equal generator/main. No hand editing other generated capabilities.

Preserve accepted531 readiness scenario and every prior browser case. No product solver/Worker/parser/Arduino semantics, persistence/auth/session/RLS/bootstrap/MAX/Portal/assets/dependencies/workflow/Compose changes. No fake SDK, added sleep, increased timeout, reduced caption, deleted assertion or broad cleanup. Existing CSS is reviewed120669bytes; growth20percent threshold must remain satisfied. One accepted production-changing529 since hygiene524 precedes this repair;531 test-only does not count.

## Acceptance and programme continuation

Author quick scoped checks and self-review, exact unpublished source SHA/tree/report/clean and STOP. Controller independently inspects actual source/diff/raw evidence and publishes ordinary final source. Required ordinary exact-SHA General and Electronics gates, frozen dependencies/literalNX_SKIP_NX_CACHE=true/fresh task counts, actual production browser original receipts and original PNG visual review, plus NEW independent reviewer of final SHA/GitHub state. No approval from implementer report or stale candidate CI; a new finding requires a separately bounded repair and NEW review. No blind full-suite rerun or local stack.

After this dependency is technically integrated/accepted, controller freshly selects preserved530 for final ordinary convergence/evidence/NEW review, then526 for full56/denial/real persistence/final combined acceptance. Do not declare either accepted here. Suspended525 and all accepted results remain unchanged. SchoolK0 version/full backups and actual-pupilT3 remain pending; no school deployment/DB/network/backup operation or class/owner/release claim. Controller continues452; author/reviewer stop after one slice.
