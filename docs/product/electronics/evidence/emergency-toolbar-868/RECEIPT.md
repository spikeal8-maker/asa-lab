# Emergency toolbar 868 — bounded layout evidence

The production toolbar keeps recovery actions reachable at 320 CSS pixels. The
only product change is `apps/web/src/electronics/workbench.css`: the emergency
button uses a visible JSON abbreviation with its existing full accessible name
and tooltip, mobile action spacing is reduced, and the elapsed clock remains
visible. At 390 pixels and below, the existing speed button places the rate below
the clock inside one touch target, leaving a complete scrollable tool target.
No toolbar action is removed. The toolbar remains one row.

## Reproduction and evidence

The immutable source is e1be12d19f8669c1145020c756551dd2188ed10f, canonical
browser run 41026543811. `before/` preserves the original E01 denied-storage
error-stop JSON verbatim inside gzip and the original 320 PNG. Decompressed JSON
SHA256 is 790e9936ba688c197466125cf844c0181e8f82e797206b45462b9734e9b45540;
PNG SHA256 is 1105c63c191637af9a05a10b9282e359c71134010806900fe58eda09aabeca9e.
They were pushed in 88c4020c6 before the first CSS edit. The original E01 oracle
and the full external source artifact are unchanged.

The executable native fixture imports the actual production WorkbenchHeader,
SimulationSpeedControl and complete workbench CSS. It supplies controller ports
in memory; Chromium request interception provides HTML with no listening server.
Run `node apps/web/src/electronics/testing/emergency-toolbar.browser.mjs`.
`--before` loads the immutable source Header and CSS. Both native matrices have
80 states: 320/390/1024/1152/1440 CSS widths, DPR 1/1.25, Code open/closed,
running/stopped, emergency present/absent. 1152 CSS pixels also represents a
1440-wide desktop at 125% browser zoom; this is an equivalent viewport check,
not an assertion that Windows display settings were changed.

BEFORE reproduces exactly the canonical failure: Save x320.203125 to362.203125,
unobstructed false, tool-strip width0 at320/running/Code open/emergency present.
AFTER Save occupies x276 to318, unobstructed true; the tool strip retains
47.953125 pixels. All required actions and the clock fit inside the same toolbar
row with no pairwise overlaps or horizontal page scroll. Mobile action boxes
remain42x44; the narrow speed button remains44px high. The suite checks every
required action center against document.elementFromPoint, verifies the complete
left tool width, and executes744 native keyboard/touch actions, including Save,
Run/Stop, JSON copy, Code, catalog, left Copy, and the speed dialog.

This fixture proves responsive production component layout and callback reachability.
It does not prove installed Save durability or an installed owner journey.

## Checks and bounded self-review

- Selected-task routing validation:114 tests PASS.
- Native matrix:80 states/744 actions PASS; immutable native BEFORE80 states saved.
- Existing production toolbar native matrix:432 states PASS.
- Focused workbench presentation, clock and speed-control Vitest:22 tests PASS.
- Targeted ESLint, Prettier and git diff checks PASS.
- Final web build with NX_SKIP_NX_CACHE=true:7 tasks freshly executed, cache skipped.
- All8 fixed bundle budgets PASS; Electronics187873/222000 and Arduino1999925/2000000.

SELF_REVIEW: PASS. Component electronics.ui.workbench. One CSS presentation repair;
controller, persistence, engine, clocks, protected assets and source fonts unchanged.
Supporting executable fixture and raw/PNG receipts prove this bounded result.
No unrequested changes; routing ownership unchanged. Foreign report directories
were preserved and never staged. Main632ddaf0e was merged without product overlap
before the final native/build checks. Canonical gate and independent exact-SHA
review are handed to the programme controller. No repository, release, installed
acceptance or deployment PASS is claimed here. NEXT_ALLOWED_TASK: STOP / OWNER REVIEW.
