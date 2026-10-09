# Independent exact review — Electronics #532 / R1

VERDICT: **REQUEST_CHANGES**

Reviewer: NEW independent reviewer `electronics_532_r1_new_exact_independent_review`; not the author or programme controller. Review boundary: one final source candidate, no source/state changes, no next task. Review timestamp: 2026-10-09T06:15:00Z (fresh GitHub/CI observation at 06:14:33Z).

## Exact candidate and independent entry

- Repository: `spikeal8-maker/asa-lab`.
- Candidate: `823796169da09dd3e8683bd5a3b3af5b1007b7de`.
- Tree: `b67ae45c5c2c854cdd9d07cf085f1fda8e392241`.
- Published ref: `codex/electronics-compact-controls-532-r1`.
- Independently fetched/queried canonical main: `169790363b0f55c01688307a8f6a245236f5feb3`.
- Selected canonical task: `TASK-ELECTRONICS-COMPACT-CONTROLS-001`, Issue #532 OPEN, status `in_progress`, checkpoint `r1_bounded_workspace_selector_and_breakpoint_evidence`.
- Actual checkout: `C:/Users/spike/.codex/worktrees/electronics-autosave-459/ASA-lab`; clean tracked/untracked/index state observed, HEAD exact candidate. Divergence relative to main: 0 main-only / 3 candidate-only commits.
- Independently executed `pnpm agent:preflight --scope electronics --check`: exit 0, `SAFE_TO_START`, remote refresh PASS, actual CONTROL_PLANE PASS, dirty paths 0, blockers 0, execution blockers 0, worktree overlaps 0.
- Independently read root policy and entry route, GitHub-first protocol/delivery workflow, Electronics router, selected complete card including R1, mapped UI/persistence component card, AGENT_GUIDE bounded/evidence/review provisions, review protocol and full UI layout acceptance contract. No implementer report used as acceptance evidence.

## P1 — running primary caption is clipped immediately above the chosen compact breakpoint

**Product finding; scope #532 is incomplete.** At 1181×900, with real production editor, breadboard, Code open, normal Start input and simulation actually `running`, the toolbar remains one 48 px row. The full running clock joins the row, pushing Stop and Share beyond the viewport. Stop is not fully readable and two of its normal hit points are outside the viewport. This blocks functional/layout acceptance under UI contract §§3–4, 10A–11. It is not a selector failure, unready SVG or justification for a longer timeout.

Exact affected product source: `apps/web/src/electronics/workbench.css:4796` (`width: max-content; flex-shrink: 0` for the full primary caption) together with `apps/web/src/electronics/workbench.css:4820` (two-row layout only through `max-width: 1180px`). At 1181 the base flex row at line195 applies; the production running clock is rendered by `WorkbenchHeader.tsx:381`. The measured controls do not fit that one row. These CSS bytes are identical to the first unaccepted #532 source0340, so R1 exposed an incomplete product repair; R1 did not introduce a new product-code change. No actual main BEFORE browser run was performed here; do not claim a newly introduced regression relative to main solely from this evidence.

Independently parsed actual raw `geometry.json`:

| Actual phase | Toolbar | Stop/Start rectangle | Rendered caption | Result |
| --- | --- | --- | --- | --- |
| 1440-running | 48 px, y48–96 | x1102.234375–1345, width242.765625 | x1136.234375–1334 | fits; all five normal hit points owned |
| 1181-stopped | 48 px, y48–96 | x864–1086, width222 | x904.65625–1068.34375 | fits; all five normal hit points owned |
| 1181-running | 48 px, y48–96 | x1035.9375–1278.703125, width242.765625 | x1069.9375–1267.703125 | clipped; right edge 97.703125 px outside viewport |

At 1181-running:

- Full clock text: `Время моделирования: 00:00:00`; clock x568–812.546875, width244.546875. Left controls end at568. Clock fits and remains fully rendered.
- Code x820.546875–898.359375, Save x905.359375–1028.9375, Stop x1035.9375–1278.703125, Share x1285.703125–1365.703125.
- Stop right top/bottom probes x1275.703125 report `owned:false, hit:null`; three remaining probes are owned. Share has all five probes `owned:false, hit:null`.
- `DIV.workbench-shell code-open` clips x0–1181 with `overflowX:hidden` / `overflowY:hidden`. Page scrollWidth/clientWidth are both1181. Consequently page-overflow equality alone passes while necessary controls are visibly clipped.
- Source editor font is normal14px and the actual Stop caption font is14px; this is not an altered-font or synthetic geometry result.

I independently opened original PNGs `1181-running.png`, `1181-stopped.png` and `1440-running.png`. The failing original visibly cuts the Russian Stop caption at the right edge; stopped1181 and running1440 originals provide same-run comparison. Original screenshots were not modified or recomposed.

Independent trace challenge:

- `call@151` sets actual viewport1181×900 at8548.339 browser ms.
- `call@173` normal `.workbench-pill.simulate` click starts9226.114 and completes9295.794 at x975/y71.5; no force input.
- `call@175` confirms `aria-pressed:true`; `call@177` confirms actual `data-simulation-status:running`, completes9537.691.
- `after@call@177` native production DOM snapshot9554.536 contains the actual Code-open shell width761px and running primary button, at real `/projects/<id>/electronics/edit` route.
- `call@179` records failing phase9555.914–9614.112; screenshot `call@181`9667.471–9802.516.
- Immediate numeric assertion `expect@1620` ends9853.398 with received1278.703125 / expected≤1182, at `e2e/electronics-simulation.spec.ts:3039`, `record:3060`, newcase call3136. It observes already-running layout; no waiting failure.

**Required bounded repair:** controller separately selects a product R2 with a NEW author. Repair the causal Header transition/layout so full running clock, full primary caption and whole visible left/right control set fit through the actual structural boundary, preserving all consumers. Keep1180/1181 and add both sides of any newly changed boundary for text/blocks-text/blocks, ordinary resize/font input, clipping/text/hit assertions and original PNGs. Do not shift a magic breakpoint without checking the resulting transition. No timeout increase, caption reduction, hidden controls, weakened geometry/assertions, forced clicks, physical/persistence/Arduino semantics changes or unrelated cleanup. A NEW independent exact review and required final ordinary exact gates must follow repair.

## Independently verified source scope and invariants

Actual main→candidate diff is exactly3 paths, 567 insertions /1 deletion:

1. `apps/web/src/electronics/workbench.css`:51 added presentation lines; actual production bytes equal preserved0340.
2. `e2e/electronics-simulation.spec.ts`:ONLY the new compact-controls case,515 lines added relative to canonical main. Independent executable removal of that entire NEW case reproduces the canonical main simulation file byte-for-byte. Every previous simulation assertion, scenario, deadline and default is unchanged.
3. `docs/product/electronics/generated/component-coverage.json`:ONLY canonical browser-source digest. Independently parsed objects after removing that digest are equal. Candidate Git blob SHA256 `990e3022228928b74ed942821a2254289065ac0c2f0bbe5ae6652237a1b9bf80` matches the recorded digest.

Accepted531 readiness scenario in `e2e/electronics-interactions.spec.ts` is outside the diff, as are every other old browser source, workflow, dependency/lockfile, assets, product TypeScript/JavaScript, solver/runtime/Arduino implementation, persistence, schema, auth/RLS, execution/control state and Docker/network files. `git diff --check origin/main HEAD` passed. CSS Git blob134639 bytes versus reviewed120669, growth11.5771242%, below20% re-review threshold. No ownership or source-of-truth changes.

Actual consumer review includes WorkbenchHeader breadboard/schematic/BOM groups and running clock, plus ArduinoCodePanel text/blocks-text/blocks toolbar. Header selectors include all visible direct buttons, strong label and native summary; expected15/8/6 control counts correspond to production DOM. Code toolbar expected7/6/3 controls corresponds to actual modes. Old mobile icon styling is unchanged; this is preservation of an existing presentation, not a new approval of icon-only CTA policy.

R1 actual selector now scopes host > `.injectionDiv` > `svg.blocklySvg`, and explicit real `setup-532`/`loop-532` visibility remains. Source inspection confirms corrected selector and preserved checks, but **new runtime block-mode evidence was NOT_RUN** because the earlier1181 product failure stopped the case.

The new resize gesture uses actual canonical desktop min/max interval and genuine mouse movement, retains exact1024/981 clamps604/561 and aria-valuenow agreement, and retains actual1440 width change and mobile height-change checks. Source preserves full server document/revision equality assertions, actual C++/generated source, real fixture IDs/components and local draft presence/absence checks. `localBefore:null/localAfter:null` is explicitly not full mounted-document evidence. This rejected run never reached those intent receipts; no full local/server-document PASS is claimed.

## Exact CI and original evidence

### Ordinary final source General

[General run37891874071](https://github.com/spikeal8-maker/asa-lab/actions/runs/37891874071), head exactly823796169da09dd3e8683bd5a3b3af5b1007b7de, independently queried at06:14:33Z:

- Governance113694384970 SUCCESS, completed06:08:14Z.
- Code113694690244 SUCCESS, completed06:10:46Z.
- Data/RLS113695369722 IN_PROGRESS.
- Access113695369795 IN_PROGRESS.
- Workflow IN_PROGRESS, no terminal conclusion at review. No claim of all4 PASS, full General gate PASS or General fresh task count from unreviewed logs.

Ordinary final source Electronics all4 **NOT_RUN**, following confirmed directed failure. First0340 General/Electronics and old28 phases are historical evidence, not acceptance of823. Rejected final source does not require a hopeful full-suite run to prove this finding.

### One changed-cause directed diagnostic, explicitly not a gate

[Directed run37891915974](https://github.com/spikeal8-maker/asa-lab/actions/runs/37891915974), job113694518728 FAILURE, completed source189c424495e8b50ce5d165cf6303fad94b1e516d. New case8.3s,1 failed. I independently proved temporary child189 differs from final823 ONLY in `.github/workflows/electronics-r4-m1-focused.yml`, and189 is **not** an ancestor of823. Product/tests/runtime are identical to the reviewed candidate; final source retains canonical workflow. Workflow uses the same isolated production images, frozen dependency installation, literal `NX_SKIP_NX_CACHE:true`, existing budgets/ports and normal source. Raw log has49 fresh tasks: Web0/6 cache hits, API0/16, test-runner0/27; zero hits. This is directed evidence of the actual defect, not an ordinary focused/browser/repository gate.

Cached once by controller, independently read/hash/CRC-checked by reviewer; no repeated download or browser rerun:

Base: `C:/Users/spike/.codex/temp/electronics-e01/189c4244-ci/run-37891915974/`.

| Original | Bytes | SHA256 / CRC |
| --- | ---: | --- |
| browser-job-113694518728.log |235203|1a5408fbb3e2bbb2a72031738519b3a60d3b363a607aee527a896f326b8aa04b |
| browser-artifact-11599155126.zip |17121623|3e99fe3c05dc8f34bfdf2782bdb2f2a933b70577af8f75dfb57914d8aea157dc;37 entries CRC PASS |
| trace.zip |12678125|41b62e9b99cb1a90f8b22c47abde9acd8a2b9778503d44ad17ed6e1d1fdb9acc;208 entries CRC PASS |
| geometry.json |350772|0fc7027baa42dbf544caf6f4318c7f41f0ef3634f2bd3e4b696c00ab2f5e330c |
| error-context.md |21080|9dcdc75881171e71d152b607e467896cd050da513c9758a235e147f770f0453a |
| 1181-running.png |93086|902be01363b8208b378c11fd76da854d937639b7bb2be979b129ba9988851826 |
| 1181-stopped.png |91404|6496eb235f4887a9abde4c05fac4f50d59aae903173d4cf2f9518d94e3f3d129 |
| 1440-running.png |105485|129d9dd1f9f968ac205c2609d8701e4f84d7fbdce3e1db66f926ad526881d5a8 |

Extracted test root: `extracted/reports/playwright/electronics-simulation-com-6b829-rols-at-actual-drawer-sizes/`; geometry/PNGs in child `electronics-compact-controls-532/`.

Independent raw revalidation covers **8 recorded phases only**:1440-stopped/running/resized/Схемы/Компоненты/Цепи,1181-stopped/running. First7 geometry receipts pass original bounds/text/clipping/hit checks and all7 Code controls; eighth fails primary/last Header controls. Captured text source is equal across all8; breadboard4 components, alternate views0 as expected. Full new source plans69 phases (text40, blocks-text16, blocks13); **61 later phases,1180, remaining widths/modes and all final intent receipts NOT_RUN**. Do not report69 PASS, corrected runtime SVG readiness, full scheme preservation or old120 browser regression PASS for this directed run.

## Residual risk / programme boundary / STOP

- Confirmed primary-action clipping requires a new separately selected product repair and exact acceptance. Remaining shared-mode/breakpoint/layout coverage is unperformed, not assumed green.
- Prior source0340 and rejected823 remain preserved; accepted531/529 and preserved530/526/525 unchanged. This reviewer does not select, integrate, close or implement any task.
- General exact823 terminal result remains pending at the recorded observation; no general release/gate claim.
- School installed SHA/full backups remain NOT_VERIFIED; real pupil-device T3 is pending owner device evidence. No frequency claim for school devices and no dev/runner substitution.
- DEPLOYMENT: NOT_RUN / NOT_AUTHORIZED. DATABASE_ACTIONS: none. School Docker/server/network/owner ZIP untouched. No owner/class/release acceptance.
- No production browser execution, CI dispatch/rerun, source edit, commit/push, merge/closeout or next-task work by reviewer. Only read-only source/GitHub/preflight/trace/hash/CRC/geometry/visual checks and this external UTF8/LF report.

**REQUEST_CHANGES — P1 product Header transition defect on exact823. STOP.**
