# Small workbench keyboard repair — owner item14

Baseline7d0d24e1, task TASK-ELECTRONICS-KEYBOARD-UI-001, Issue754.
R rotates, M mirrors horizontally, Ctrl/Meta+Enter uses the same public
toggleSimulationWithAudio callback as the toolbar, with the same busy exclusion.
Existing transform/model/clock/save functions and protected assets are unchanged.
Optional title hints expose M and Ctrl/Meta+Enter without changing accessible names.

The existing listener/command responsibility now lives in workbench-shortcuts.ts.
Typed command maps/direct dispatch replace repeated branches and keep this small
feature within the unchanged222000byte cap. There is no chunk/dependency change.
Unknown/prototype codes return null; the action ref stays fresh. New toggles ignore
repeat and Alt; composing input is ignored. Text/code editors retain native input,
and normal button Space is no longer swallowed by the canvas pan shortcut.

Native fixture reads the actual production hook action assignment. BEFORE also
extracts the original production listeners from baseline Git source; AFTER calls
the production binding directly. Its callback/state ports are supporting fixtures,
not full-app, Worker or server-persistence proof. Real Chromium1440/390 keyboard
input and trusted CDP English/Russian key/code pairs pass; composition uses an
explicit synthetic negative event. Busy, repeat, editable ancestors, native button
Space, pan down/up, legacy commands/nudges, fresh callbacks and cleanup pass.
Receipts/screenshots: test-results/workbench-keyboard-ui/{before,after}.

26 scoped shortcut/presentation tests PASS;17 document tests also PASS.
The initial focused gate exposed two existing tests tied to the old keyboard
source spelling. Their keyboard-only assertions now check actual exported5/20
steps and resolver behavior; listener-location assertions follow the same consumer.
All other assertions remain intact. The repaired gate passes938domain+975UI tests,
42typecheck targets and27build targets, all Nx Cache:Skipped with literal
NX_SKIP_NX_CACHE=true. Scoped ESLint, Prettier, routing and diff-check PASS.

Fresh production editor:221965 BEFORE →221984 AFTER (+19), cap222000 PASS.
All other budgets PASS; initial JS/CSS547180 unchanged. No deferred752/753 or
tooltip prototype source is included. General CI, installation and user acceptance
are separate; no server, Docker, live DB, deployment or foreign-module repair.
