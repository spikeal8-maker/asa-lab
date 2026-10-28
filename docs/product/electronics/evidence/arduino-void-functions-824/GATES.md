# Frozen candidate gate receipts

Product SHA: `4c50c4e20dc177efa40f6fe2c2fff6fae99ac0de`.

First canonical run: core 1338 PASS; web 1102 PASS, one timeout in unchanged
owner-asset-manifest.spec.ts, imported review asset hash loop (697 files):
12101ms against Vitest 5000ms limit. No runtime imports or changed assets.
Classification D: parallel filesystem/hash contention. Isolated exact test PASS
in 131ms. Controller authorized ONE unchanged canonical retry.

Retry `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: exit 0,
core 1338/1338, web 1103/1103. Fresh Nx: SDK 1, typecheck43, build27 =71;
all cache skipped. No code/config/worker/timeout changes between runs.

`pnpm bundle:check`: exit0, all8 caps PASS.


> @asa-lab/source@0.0.0 bundle:check C:\Users\spike\.codex\worktrees\electronics-reverse-led-simple\ASA-lab
> node tools/check-web-bundle-budget.mjs

PASS initial application: 382841/570000 bytes (index-DMlTmR5j.js)
PASS electronics editor: 169815/222000 bytes (SchematicEditor-C37tIbGV.js)
PASS chess editor: 244236/255000 bytes (ChessModuleExperience-CJGadc1k.js)
PASS checkers editor: 158901/160000 bytes (CheckersModuleExperience-DUAvgjKi.js)
PASS 3D editor: 2870467/2900000 bytes (ThreeDEditor-BucpXBPw.js)
PASS Three.js vendor: 602992/620000 bytes (three-vendor-CzfQjxfA.js)
PASS Arduino editor: 1999997/2000000 bytes (ArduinoCodePanel-CxaTkLSq.js)
PASS initial JS/CSS graph: 554728/600000 bytes (3 assets)
