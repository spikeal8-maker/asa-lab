# Scratch activity build fixture dependency resolution

Programme909 bounded build-fixture repair, baseline
a69d7f8ce23e3550ed1fa6b49a8a8cb62f675b1b. No product, database, native Scratch,
runtime origin, image/source pin, timer or browser assertion is changed.

Scratch Focused41368027890 job125032279721 passed all three public Scratch
PostgreSQL tests and the real public native-player browser journey. Its next
activity/minute-save step failed before opening the browser: Rollup could not
find `parseThreeDDocument` exported by `contexts/three-d/dist/domain/document.js`.
Those earlier passes do not imply the later activity or cumulative browser gate
passed.

There is no isolated3D stub in this fixture. The package is built with NodeNext
without package type=module, yielding CommonJS workspace dist. The accepted Web
build aliases the pure3D document/operations subpaths to their real TypeScript
sources. The Scratch product fixture uses Vite with configFile:false and had no
equivalent resolution. A new shipping ProjectPreview→ThreeDHoverPreview import
therefore reached CommonJS dist outside Vite's default node_modules conversion.
The lazy SceneRuntime also imports createThreeDNode from the same document API.

The fixture now uses exact aliases to the complete real document.ts and
operations.ts source modules. These are not per-symbol substitutes and do not
stub geometry, the editor, Scratch VM/vendor, saved source or telemetry. Exact
matching leaves the3D package root, Scratch and all other imports untouched.
The cumulative Scratch gate includes a small regression suite exercising source
resolution and real parser/defaults/operation exports, including invalid input.
Its checks use the owned sources and Node22 type stripping without installing
dependencies or running a browser/database locally.

Node unit/syntax/format checks are source evidence only. Full Vite composition,
real public PostgreSQL/native-player, activity, minute-save and all cumulative
Scratch browser checks remain the responsibility of the exact-SHA GitHub
workflow. No browser acceptance,100-user capacity or whole-system stability is
claimed by this fixture repair. Existing deployment blockers remain in force.
