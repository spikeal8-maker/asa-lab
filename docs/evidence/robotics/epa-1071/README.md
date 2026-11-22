# EPA-1071 synthetic position-only evidence

This archival branch payload preserves a consumed TEST_ONLY diagnostic: two synthetic wheel/course states and four cylinder/mesh queries. There are no physical-device measurements, owner assets, private engine binaries, credentials or local host paths. It does not select a task or update the application.

Acquisition source: `e9106acc78a9610fbf374495e3dc233a34c782db`, tree `23235f13b8e4c0cbd3ae364ce42b03530390adb0`. Links: [source PR #1314](https://github.com/spikeal8-maker/asa-lab/pull/1314), [preceding V1 PR #1309](https://github.com/spikeal8-maker/asa-lab/pull/1309), [V2 registration #1310](https://github.com/spikeal8-maker/asa-lab/pull/1310). At preparation, #1314 is OPEN, protected governance CI pending on `189f1a4a275a52c8f6ccbd9ccfbb82e5c40cc3b5`. This is a dated observation, not acceptance; acquisition and composed publication SHAs are distinct.

## Integrity and public export

- `mujoco-cylinder-epa-polytope-trace.jsonl`: exact original 1,567,508 bytes, SHA256 `f86a1361069b3f83279826b9cac354143efc6a0722d0ad8fdaf9a26beb058520`. All 235 JSONL records, LE-F64 packets, contact snapshots, four framed V1 witnesses and V2 chunks are retained without normalization.
- `independent-epa-polytope-raw-audit.public.json`: numerical evidence and all 20,783 checks retained. Private original: 96,157 bytes, SHA256 `8f09ea2bdedde2cd8c56b4fc0224fd7c26e730291d7db9a14ca4dbebafd6ca0c`.
- `independent-private-artifact-high.public.json`: preceding independent artifact review. Private original: 26,077 bytes, SHA256 `1698d5c06f23efc06a5cfada590b29b8fa4ab68fa9395ffc3bb1da9a9205d399`.
- `index.json`: public file hashes, original identities, explicit transformations and indexed-only older inputs.

Sanitation changes absolute path keys/values to unique basenames and three local tool-tree labels to semantic roles. Numerical arrays, checks, artifact digests and measured outcomes remain unchanged. Exported report hashes intentionally differ from originals. Build exit summaries are retained; no executable build command lines or OS/user identity are included. The raw was recursively inspected, including keys, and required no sanitation. Large earlier trajectory inputs, private build outputs and WASM/glue are indexed or omitted rather than bundled.

## Observations and limits

COMPLETE/CONSUMED: one module, two sequential model/data instances, four position and four zero-cutoff distance calls; zero STEP1/STEP2/forward/time advances. All 24 regular parity records match the original static observation; all four V1 witness records are byte-exact. Owned resources were cleaned. The ledger retains module lifetime accurately, without inventing a module deletion.

Union pairs `[5,1]` and `[6,1]` have selected affine weights `-0.262411108280772` and `-0.38607338303038935`. Their primary cylinder endpoints exceed finite caps by 5.248222165615435 mm and 7.721467660607771 mm. Older five-mesh descriptive controls have nonnegative weights and finite endpoints; the original course physical FAIL is unchanged.

Ordered replay confirms the native ordered-map minimum. At k=3, geometrically visible union neighbor faces 8/9 are retained because residuals `2.2986309283413386e-16` and `3.48673832464752e-16 m²` are below the original absolute `mjMINVAL=1e-15` floor (about 2.865/4.645 nm crossings). Later closed surfaces are nonconvex. This is an evidenced contributing mechanism, not proof of a complete unique engine repair. The zero-based EPA counter is 4, with five selection visits; final counts are 9 vertices, 18/18/17/17 faces and map sizes 5/5/4/4.

Pure captured-pool convex-hull candidates have nonnegative paired weights and original 10 nm support-gap checks (about 1.802/1.797 nm). These descriptive candidates were not returned by a repaired native engine, and are not global exact-shape or dynamics certificates. The audit explicitly labels its supplied analytic 82.678/78.535 nm lower bounds as external comparisons without a persisted certificate. Old positive controls show only rounding-scale exact convexity defects, distinguished from the union cases in the report.

Historical physical FAIL and causal GAP remain. No D01/D02 closure, hardware calibration, editor/toolbox integration, owner acceptance, release or deployment is claimed. No numerical repair, tolerance change, new acquisition, build or native initialization occurred during archival.

## Offline inspection

Verify all four payload byte counts and SHA256 values against `index.json`, then parse JSON/JSONL. Signed-zero evidence is in raw LE-F64 packets; JSON numeric reserialization does not replace bitwise comparison. Recomputing the complete numerical audit also requires indexed historical inputs and exact source, which this archive does not silently reconstruct. Do not invoke historical native opt-ins to inspect these files.
