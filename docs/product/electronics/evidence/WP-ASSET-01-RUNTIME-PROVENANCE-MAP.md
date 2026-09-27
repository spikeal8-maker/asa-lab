# WP-ASSET-01 — Electronics runtime and provenance asset map

This is a read-only inventory of the five roots under
`apps/web/public/assets/electronics/` at Git `69725acd375ff498b6cbfe0ea0b7ed84cad31920`.
It records the current boundary; it does not approve a packaging change or an
owner-asset move. The task and acceptance state remain in
`docs/execution/current.yaml`.

## How the browser and build reach these files

- `apps/web/src/electronics/load-schematic-editor.ts:16-23` loads the editor and
  calls `loadProductionLibrary()` before mounting it.
  `production-manifest-adapter.ts:7,775-778` fetches only
  `/assets/electronics/component-database/catalog.json?rev=<build revision>`.
  Its `configureProductionLibrary()` checks the catalog policy and maps component
  `runtimePath` and `stateAssets[].runtimePath` to renderable items
  (`production-manifest-adapter.ts:618-668,714-716,749-773`).
  `component-catalog.ts:365-402` selects an SVG URL; `ProductionComponentVisual.tsx:978`
  consumes it, through SVG `<image href={asset}>` and, for selected components,
  `fetch(asset)` (`ProductionComponentVisual.tsx:97-106,143,1409`).
  Thus these URLs can cause browser requests. The catalog's provenance strings,
  including `fullInventoryEvidence.manifest`, are data, not another fetch.
- `apps/web/vite.config.ts` sets `root` to `apps/web`, `build.outDir` to `dist`, and
  does not override `publicDir` or `build.copyPublicDir`. The pinned Vite 6.4.3
  (`package.json:169`) defaults them to `public` and `true`; its installed build
  implementation copies `publicDir` to `outDir` (Vite's
  `dist/node/chunks/dep-Dm0c1Wj2.js:46054,46405-46421,48620`).
  `apps/web/project.json:9-10` invokes that build; `Dockerfile.web:24-43` copies
  `apps/web/dist` into `/srv`; `docker/web/Caddyfile` serves `/srv` files. There
  is no asset-root exclusion in these rules. All five roots are therefore
  **publicly exposed by the current build rule**, independently of whether the
  browser asks for them. An existing local `dist` from revision
  `7449ca1f0d5892a4c9ec05c443b3a64697be657d` contains byte-identical
  copies of all 1,416 inventoried files; it is a prior-build observation, not
  exact-head build evidence.
- A source search of `apps/web/src/electronics` excluding `testing/**` finds
  current asset-root URL references only to `component-database/`
  (`production-manifest-adapter.ts`, `production-asset-contracts.ts`). The
  previous `owner-catalog/manifest.json` embeds 22 `owner-audit/` and 13
  `owner-approved/` URLs, but the current adapter does not fetch that manifest;
  `tools/validate_owner_electronics_runtime.py:341-343` explicitly rejects the
  old manifest URL in the adapter. A historical URL in JSON and a copied public
  file do not establish a current runtime request.

## Inventory and classification

Counts and byte totals use recursive regular files on disk, not directory
entries. `git ls-files` reports the same 1,416 paths across these five roots;
the root-level `ASSETS_NOTICE.md` is a separate 1,417th tracked path.
`runtime-required` means
the current catalog and renderer address the bytes at their present public URL
for at least an applicable component/state; it does not mean every SVG is fetched
in every session. `provenance-required-but-not-runtime` means current audit,
source, test, or validation contracts rely on the source bytes or records, with
no browser URL requirement shown. `historical-evidence` records a superseded
runtime reference or legacy evidence, without inferring permission to delete.

| Exact path or class below `assets/electronics/` | Files / bytes | Class | Current URL need and evidence |
| --- | ---: | --- | --- |
| `component-database/catalog.json` | 1 / 1,010,509 | `runtime-required` | Exact URL fetched by `loadProductionLibrary()` before editor mount. It contains 43 positions (42 enabled, one `disabled_missing_svg`), geometry/model data, 692 runtime-path records, and provenance fields. The whole JSON is fetched even though its provenance URLs are not followed. Source-side consumers also read it in `e2e/electronics-interactions.spec.ts:23-29`, `tools/generate-electronics-component-coverage.mjs:6-7`, and `tools/run-electronics-browser-benchmark.mjs:280-284`; `tools/run-electronics-load-benchmark.mjs:50` uses its public URL. |
| `component-database/components/**/*.svg` | 677 / 7,950,385 | `runtime-required` | All 677 unique SVG paths named by catalog `runtimePath`/`stateAssets[].runtimePath`; `tools/validate_electronics_assets.py` finds zero undeclared runtime files and verifies the recorded hashes. The adapter allows only this URL prefix; the renderer uses these URLs. The 650 state records include repeated paths, hence 692 records but 677 files. |
| `component-database/owner-imports.json` | 1 / 6,751 | `provenance-required-but-not-runtime` | 16 direct-owner import records. `tools/validate_owner_electronics_runtime.py:143-166` reads them to establish accepted byte-exact source hashes; `production-assets.spec.ts:44` reads the file. No production fetch/import at this URL was found. |
| `component-database/README.md` | 1 / 671 | `unknown` | A current source-side explanation of the catalog/runtime boundary; no browser consumer or independent retention contract was found. Public exposure comes solely from the copy rule. Its packaging and retention classification needs a later decision. |
| `owner-audit/manifest.json` and `owner-audit/components/**` | 698 / 18,755,175 | `provenance-required-but-not-runtime` | The manifest names 697 imported files with SHA-256: 673 SVG and 24 PNG. `tools/validate_electronics_assets.py:46-50,244-292` checks the referenced bytes; `tools/validate_owner_electronics_runtime.py:109-141` reads accepted source records; `owner-asset-manifest.spec.ts:55-110` tests the audit. The 24 PNGs are individually inventoried in `WP-ART-01-TRACKED-SCREENSHOT-INVENTORY.md:51-80`. No current browser URL for this root was found. The 22 old `owner-audit/` URLs in `owner-catalog/manifest.json` are not current requests. |
| `owner-audit/breadboard-footprint-map.json`, `pin-map.json`, `state-family-map.json` | 3 / 961,711 | `provenance-required-but-not-runtime` | Outputs of `tools/audit_owner_electronics_assets.py:943-960`; `owner-asset-manifest.spec.ts:68-81` reads these exact paths. The screenshot inventory also names `state-family-map.json:36,68`. No production fetch found. |
| `owner-audit/physical-dimensions.json` | 1 / 8,241 | `unknown` | The current audit generator still writes this exact file (`tools/audit_owner_electronics_assets.py:941-953`). No current reader or proof that a replacement supersedes it was found. Its exact-file retention and use by future audit/recovery flows remain unresolved; `AGENTS.md` §3 protects the path while that question is open. |
| `owner-supplied/manifest.json` and `owner-supplied/*.svg` | 20 / 691,022 | `provenance-required-but-not-runtime` | The manifest describes eight owner source components and their variants; 19 SVGs are retained owner-source bytes. `production-assets.spec.ts:35` requires the manifest and `docs/product/electronics/README.md:34` and `ASSETS_NOTICE.md:3-10` identify this source area. No current production URL or import for either class was found. Individual SVG retention is protected by `AGENTS.md` §3; it is not inferred from a live renderer request. |
| `owner-approved/*.svg` | 13 / 358,641 | `historical-evidence` | All 13 old public URLs occur in `owner-catalog/manifest.json` (for example `:17216,28166,30040`), which the current adapter does not fetch. Ten files have SHA-256 matches among the current 677 runtime SVGs; the three `battery-{1.5v,3v,6v}.svg` do not. `component-database/README.md:13-14` calls the root legacy provenance evidence. No exact-file current validator or browser consumer was found. Owner rights/retention are not settled by that absence. |
| `owner-catalog/manifest.json` | 1 / 988,637 | `provenance-required-but-not-runtime` | Legacy catalog with 37 positions and old URL paths. `tools/validate_owner_electronics_runtime.py:109-141` requires and reads it as an accepted-source record, and `tools/validate-license-policy.mjs:74` names it. The current E2E simulation suite reads this file from disk at module load (`e2e/electronics-simulation.spec.ts:23-33`) and uses its breadboard, Arduino, and potentiometer pin IDs (`:29-33,1880-1883,1910-1912`). This is a current source-side test dependency, not a browser fetch of the legacy URL; the browser adapter loads `component-database/catalog.json`. Removal from source would need separate proof. |

The `owner-audit/` root totals 702 files / 19,725,127 bytes. The
`component-database/` root totals 680 / 8,968,316. The three other root totals
are the corresponding rows above. The owner boundary differs by root:
`owner-audit/` and `owner-supplied/` are immutable owner-protected paths under
`AGENTS.md` §3. The `component-database/` SVGs are byte-exact owner artwork and
that entire root is excluded from the code license by `ASSETS-LICENSE.md:10-14`,
but §3 does not name it as an immutable source path. The same license notice
excludes `owner-catalog/manifest.json` and its referenced materials, which
include every `owner-approved/` SVG URL. The `owner-approved/` name and legacy
references do not prove a current owner retention decision or authorize changes.
`docs/execution/PRODUCTION_RECOVERY_STORAGE_INVENTORY.md:28-34` also names the
protected owner roots, component database, and owner catalog as byte-preserved
Git/release inventory; this is a recovery/evidence dependency, not a browser
request for every file.

## Reproduction and proof limits

```text
git rev-parse HEAD
git ls-files apps/web/public/assets/electronics
rg -n 'component-database|owner-audit|owner-supplied|owner-approved|owner-catalog' apps/web/src/electronics --glob '!**/testing/**'
python -c "from pathlib import Path; p=Path('apps/web/public/assets/electronics'); roots=['component-database','owner-audit','owner-supplied','owner-approved','owner-catalog']; [(lambda f: print(r,len(f),sum(x.stat().st_size for x in f)))([x for x in (p/r).rglob('*') if x.is_file()]) for r in roots]"
python tools/validate_electronics_assets.py
python tools/validate_owner_electronics_runtime.py
```

At the inventory baseline, `validate_electronics_assets.py` passes with 692
catalog URL records, 677 unique runtime paths, 697 audit imports, 1,374
verified hash contracts, and zero undeclared runtime files. The separate
`validate_owner_electronics_runtime.py` fails on the untouched baseline with
`FAIL: owner catalog ordering is not deterministic`: the current catalog places
`arduino-uno` (`catalogOrder: 12`) before `seven-segment-display`
(`catalogOrder: 10.5`). That script is not called by `package.json` gates or
`tools/gate-governance.sh`; the canonical governance gate calls
`validate_electronics_assets.py`. This failure limits any claim that the
separate validator passed. It does not create a runtime request for a provenance
root and is left for separately selected repair.

No exact-head browser network capture or fresh exact-head Web build was run for
this inventory. Source code, current manifests, the pinned build rule, and the
prior local build prove the stated URL and exposure boundary; they do not prove
that every catalogued state is requested in a particular user journey. Packaging
exclusion, owner-source location, and retention choices require a later selected
task and owner review.
