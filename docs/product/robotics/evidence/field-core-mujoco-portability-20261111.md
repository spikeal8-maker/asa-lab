# E1 MuJoCo portability — source repair v2

Status: **SOURCE_REPAIR_V2_READY_FOR_INDEPENDENT_PREDATA_REVIEW**. Native qualification: **NOT_RUN**.

This report records the bounded source repair of independent findings PDR-01 through PDR-03. The source remains in the eight owned paths on `7abc72d2f8bf88475fd9b2467603243d7498b336`. Six files are execution inputs; two are reports. No preregistration, native run, product commit, push or deployment occurred.

## Findings and resulting behavior

| Finding | Repair | Meaningful verification |
|---|---|---|
| PDR-01 | Remove the unused observer prerequisite absent from the published checkout; eleven inherited inputs remain. | Independent literal paths and SHA-256 values, actual filesystem reads, and all eleven published Git blobs. |
| PDR-02 | Record and reject unexpected cached/index drift separately, before and after execution snapshots. | Real temporary repository with HEAD=A/index=B/worktree=A; executable staged change rejects, staged allowlisted report change admits. |
| PDR-03 | Preserve bounded module, world, realm-end and terminal/disposal receipts before propagating ACK or cleanup errors. Distinguish returned/completed/emitted/ACK/accepted/durable counts and failure frames. | Partial completed-step/failure-frame journal checks; module persistence and disk rejection; terminal fallback; Worker relay waiting for disposal; identity/counter bounds; interruption classification. |

A completed native call whose observation fails is retained as completed without inventing a successful endpoint. Success still requires complete equality of native completed steps, validated/emitted/acknowledged records, host accepted records and the durable prefix. Incomplete observations are never passed to the physical assessor. The original PHY01 assessor remains the only physical acceptance assessor for a complete positive set.

Watchdog timeout, process loss and forced termination are `INCOMPLETE`. A confirmed native invariant is `FAIL`. If an interruption also occurs, the overall invocation is `INCOMPLETE` and its original native failure record remains visible as `FAIL`; the primary cause and phase are not replaced by a cleanup message.

The Worker relay retains its listener after sending a fatal ACK response and waits for the real disposal/failure receipt under the existing watchdog. Module and terminal bodies are stored as bounded, digest-linked protocol chunks. A terminal receipt can recover the last received world after the regular protocol closes. Only genuinely unreceived counters remain `UNKNOWN`.

## Actual author validation

| Gate | Result and evidence |
|---|---|
| Official Vitest 4.1.11, final v7 | **99/99 PASS**, one file, one fork, exit0. `checks-focused-repair-v3.json`, `pure-tests-official-v7.stdout`, `pure-tests-official-v7.stderr`. |
| Actual Nx project graph | **28 projects / 2136 links**, SHA-256 `ede7f960a55befdb060b24c09720476fc0db688420d233e8e134355a5c41c918`. |
| Targeted lint | **PASS** for four MJS files and the test file; stdout/stderr zero; actual graph available, no skipped-boundary warning. |
| Format | **PASS** for six execution inputs. Reports are ignored by the repository formatter; no eight-file format claim. |
| Syntax | **PASS** for four MJS execution files on pinned Node22.23.3. |
| Preservation | Five physics/admission/budget source regions are byte-exact to v1; operational fixture unchanged. Eleven inherited inputs match published blobs; product index, HEAD, package/lock and current.yaml unchanged. |

The first repair attempt v5 collected99 tests and reported98 PASS/1 FAIL because Windows rejected a long path in the newly created Git fixture. The fixture alone now sets local `core.longpaths=true`. V6 then passed99/99. The first lint gate found an unused test variable and an unsafe throw in `finally`; both were repaired, then v7 and final lint/format passed. Every attempt and its actual stdout/stderr remains preserved. Final Vitest stderr465B contains three LF-to-CRLF warnings from the temporary fixture; the fixture was removed.

Technical parser WASM is separate from MuJoCo: each of the three repair test attempts observed3 compile and3 instantiate calls, all returned; total9+9. The fourth allowed parser was not called. Each attempt used the approved Node orchestrator, one Vitest fork and one pinned esbuild service. Temporary Git calls were23/22/1 dispatch/return/error in v5, then91/91/0 in each of v6 and v7. Git child PIDs are not exposed by execFileSync and are not fabricated. The runner's optional process-report probe remained denied. Completed Vitest forks received the runner's normal SIGTERM, so their absent exit receipt is explicit; actual boundary events remain available. All nine known runner/fork/esbuild PIDs were subsequently absent.

**MuJoCo import/factory/compile/instantiate/Model/Data/advances =0; browser, DedicatedWorker construction and listen =0.** Pure message objects and native-shaped byte fixtures are unit data, not physics evidence. Package preparation was reused without another install.

## Fixed future resource envelope

The operational contract is unchanged:63 worlds,72012 advances,791 normal packets,72080 normal records; each record352B includes208B native state. The journal remains **43357920B <67108864B**, with261 files maximum. Normal raw bytes25422784B, state digests2304384B, one emergency frame416B, and the existing fixed category caps remain unchanged.

Receipt bodies reuse `protocol.ndjson`: at most9 receipts, caps8192/16384/32768B per module/realm-end/terminal body,384B chunks and1024B rows. At most453 additional rows plus1886 normal rows yields2339, below the existing4096 rows /4194304B protocol cap. No per-step warning file and no additional journal file is introduced.

The same-world warm offline barrier remains at400 ×500µs =200000µs. Cold local asset loading with external application requests denied and warm real-offline continuation remain separate claims. Browser/Worker/native cleanup are still unexecuted. No full-app offline, D01 physics qualification, D04 school-reference performance, E10 long-duration heap or CCD acceptance is claimed.

## Review and preservation handoff

Evidence root: `C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\browser-worker-offline-repair-20261112-01`.

Independent v1 review: `C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-review-20261112T003115Z\source-review.json`; SHA-256 `bed7766d8ddbf6365b473e72d0ced89c8594f8f119b3a3286ab6d552fee89962`. Final repair snapshot: `C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\browser-worker-offline-repair-20261112-01\source-freeze-v2`. It contains the eight exact files, full new-file diff, v1-to-v2 repair diff, source archive, validation evidence archive, manifests and freeze receipt.

Fresh preflight actually returned exit2 / `RECOVERY_REQUIRED` for the known eight owned untracked paths. Its original result is retained; ROOT-authorized classification is `CONTINUE_CLASSIFIED_SOURCE_ONLY_REPAIR`, not a rewritten PASS. Frozen v1, its79 PASS, startup incidents, and the timestamped historical reference19 receipt remain unchanged. Later legitimate cylinder publication is not classified as portability drift.

Current own inventory is explicitly11 inherited published inputs +8 owned paths; the latter split into6 execution inputs +2 reports. The historical reference19 schema is retained separately. Reports are excluded from executable approval hashes, so report-only preregistration cannot create a self-hash cycle. Unexpected staged source changes fail closed.

**STOP: independent v2 source/predata review is next. Native MAIN, preregistration, product commit and push remain unauthorized in this phase.**

## Historical author v1 report

The following section is preserved as historical v1 context. Its79-test results and source hashes do not describe the current repaired candidate; the v2 results above are current.

# MuJoCo portability — source implementation

**SOURCE_READY_FOR_INDEPENDENT_PREDATA_REVIEW. Native evidence: NOT_RUN.** Official Vitest 4.1.11 passed all 79 pure tests. A real Nx project graph and final targeted ESLint, Prettier and syntax checks also passed. This freezes a test-only implementation; it provides no browser, physics, offline or engine acceptance result.

## Source and authorization

Task TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001, Issue 1071. The isolated branch is `codex/robotics-field-core-mujoco-portability-001` on exact base `7abc72d2f8bf88475fd9b2467603243d7498b336`. Ordinary eight-path preflight returned SAFE_TO_START against locally observed main `92377daf6db834a8fb4670598c55bf41b4fe8d2b`, with no overlaps or blockers. Source implementation and bounded validation were authorized. Preregistration, native execution, commit and push were not performed.

Approved design SHA-256: `8bb56492a54e3028c9f3c1928da711757df11fa4cffcb17c71506841e1c829c6`. Original 19-input preservation receipt SHA-256: `152116eac9125799bf89b9ac3eed2ffb04f1e436e1a0d7312674d61a343a77e6`.

Existing package/lock, PHY01, observer, specifications, CI and UI/API/DB source are unchanged. The reference checkout retains HEAD `306c80f03a55f70fd7d71d7311ac8396ed8325cc` and its one pre-existing modified cylinder report. All 19 reference input hashes match. Proposed specification 1.2 is not used as a baseline.

## Six execution inputs and two reports

The fixture lists exactly these eight new paths. The first six form the future execution-input hash set; the last two are reports.

| File | Responsibility |
|---|---|
| `tools/robotics-field-core/mujoco-portability-sampler.mjs` | Neutral original XML/readback/oracles, actual native sampling, source-time reservation and 352-byte records |
| `tools/robotics-field-core/mujoco-portability-runtime.mjs` | Exact fixture/assets admission, actual instantiate observation, finite negatives and acknowledged protocol |
| `tools/robotics-field-core/mujoco-portability-worker.mjs` | Worker-owned Module/Model/Data, copied-buffer transfer and cleanup |
| `tools/robotics-field-core/run-mujoco-portability.mjs` | Node controller/child, local assets, Chromium/offline control, original assessor and bounded journal |
| `tests/robotics/field-core-qualification/mujoco-portability.fixture.json` | Approved matrix and budgets referring to unchanged PHY01 |
| `tests/robotics/field-core-qualification/mujoco-portability.spec.ts` | Pure source, byte, oracle, admission, protocol and failure-cleanup tests |
| `docs/product/robotics/evidence/field-core-mujoco-portability-20261111.json` | Author evidence and validation receipt references |
| `docs/product/robotics/evidence/field-core-mujoco-portability-20261111.md` | Behavior, validation and limitations |

The browser import graph contains no Node imports or Buffer/fs/Node crypto. The Node-only original assessor is host-only and byte-pinned; `executePhy01` is never invoked. Six mass/timestep XML combinations, the 208-byte Float64LE state, model admission and physical oracles are equivalent to the original module. Signed zero is preserved.

## Actual author validation

| Gate | Observed result |
|---|---|
| Official Vitest 4.1.11, one file, one fork | 79 passed; exit 0; stderr empty; wall time 1.273 s |
| XML, fixture/plan/oracles and native-state serialization | Pure equivalence tests passed without an engine or trajectory |
| Resource arithmetic, admission, sequence/ACK/transfer and failure cleanup | Included in the 79 passing tests |
| Actual Nx graph | 28 nodes, 2,136 dependency edges; exit 0 |
| Targeted ESLint, four `.mjs` modules and the spec | Exit 0; stdout/stderr empty; no skipped Nx-boundary warning |
| Prettier, six applicable code/test/fixture files | PASS; existing repository configuration ignores the two reports |
| `node --check`, four authored modules | Four exit-zero checks |
| Preservation | 19/19 reference hashes unchanged; tracked/staged diffs empty; exactly eight new paths |

Graph SHA-256: `ede7f960a55befdb060b24c09720476fc0db688420d233e8e134355a5c41c918`. Successful gates changed none of the eight files. Only the two reports were updated afterward; the six execution inputs retain the tested hashes.

Own cached pnpm 9.15.9 installation used `--offline --frozen-lockfile --ignore-scripts --ignore-pnpmfile`: 855 packages reused, zero downloaded, exit 0, package/lock and source unchanged. Four installed MuJoCo files and 11 toolchain comparisons matched expected hashes. One pnpm filesystem Worker was dispatched, returned and exited; it is separate from the future DedicatedWorker budget.

### Technical parser accounting

The official runner used pinned Vite/Vitest parsers and inherited deny guards. Its successful run observed three technical compile calls and three matching instantiations, all returned without error. Hashes `703eb31a…`, `7fefbddc…` and `04270c74…` ran once in the orchestrator. Approved lazy parser `b40099ca…` was not invoked. The fork recorded guard entry and no parser or forbidden-boundary events; Vitest then terminated it with SIGTERM, so no final fork JSON was emitted.

One Vitest fork and one pinned esbuild service were created. An optional `process.report` subprocess probe was denied and caught. Main, fork and esbuild PIDs were subsequently absent in read-only Windows process checks. MuJoCo imports/factories/compile/instantiate, Model/Data, advances, browser launches, DedicatedWorkers and listening servers remain zero.

Earlier official startup attempts remain NOT_COLLECTED:

- v1 dispatched one approved compile before an unlisted 9,509-byte parser was blocked. Its return was not observed at exit.
- v2 dispatched two approved compiles before an unlisted 11,419-byte parser was blocked. Their returns were not observed at exit.
- v3 completed three compiles/instantiations but blocked Vite's Windows `net use` before process creation. No tests were collected.
- v4 used standard external `resolve.preserveSymlinks=true` and exact physical aliases, then passed 79 tests. Product source behavior was not substituted.

Across four official attempts: nine observed technical compile dispatches, six observed returns, three returns unobserved at process exit; six instantiate calls and returns. These are not MuJoCo calls. Strict-guard lazy Undici incidents and 18 deliberate guard checks are preserved. No replacement assertion bridge or alternative runner was used.

The external summary records exact commands, timings, stdout/stderr hashes, guards and process events. Old child event details could overwrite event kind/PID; their preserved final process arrays and later PID checks remain authoritative. Final v9 event records separate writer PID/event from child details.

## Future native matrix — not measured

Node child, browser-main and Dedicated Worker execute sequentially. Each realm has 20 original PHY01 positive worlds plus one quota world. The Worker owns its module and performs its own 24,004 advances; the page transports copied records.

| Resource | Complete-success expectation |
|---|---:|
| Default factories / observed pinned MuJoCo instantiations | 3 / 3 |
| Model/Data created and deleted | 63 / 63 |
| Maximum live worlds | 1 |
| Advances | 72,012 |
| `mj_step1` / `mj_step2` / `mj_step` | 64,812 / 64,812 / 7,200 |
| Raw observations | 72,080 |
| Owned warning copies, normal / one-emergency ceiling | 504,560 / 504,567 |
| Raw packets / maximum journal files | 791 / 261 |
| Planned journal / hard envelope | 43,357,920 / 67,108,864 bytes (64 MiB) |

A record is 32 header + 208 native-state + 112 warning bytes = 352 bytes. Normal raw data is 72,080 × 352 + 791 × 64 = 25,422,784 bytes. One emergency record/packet adds at most 416 bytes. The full envelope includes state digests and fixed metadata/protocol/log caps, leaving 23,750,944 bytes. Warning trajectory hashes are bounded world metadata; no extra per-step warning file exists.

Factory calls do not stand in for observed instantiations. The observer delegates to real `WebAssembly.instantiate`, compares supplied bytes with a separate copy of already SHA-verified WASM, binds realm identity, records dispatch/return/error and restores the property in `finally`. Module inputs, changed bytes or a bypassed/unobserved boundary fail closed. Expected instantiations cover only measured MuJoCo realms, not all host/Chromium WASM. Internal compile calls remain unknown. The default factory uses verified `wasmBinary`; no custom async `instantiateWasm` hook is installed.

Five admission negatives per realm are real NaN mass, Infinity gravity, invalid radius, missing WASM and corrupted actual pinned bytes. Finite/geometry validation precedes JSON/hash/engine IO. These 15 cases expect zero factory/Model/Data/advances. Missing/corrupt assets have no fallback; corruption is integrity admission, not native compiler rejection.

The sixth negative owns a real world with four advances. The fifth request is refused before `mj_step1` and another quota reservation. One state/warning reread must equal the fourth endpoint. Runtime evidence contains no synthetic trajectory or fake native exports. Pure tests use explicit serialization/boundary doubles and never execute `sampleWorld` or `runRealm`.

## Local loading, warm offline continuation and ownership

One future test-only `127.0.0.1:port0` server serves immutable allowlisted bytes. External application requests are denied before navigation. No CDN, `route.fulfill`, production port, required COOP/COEP or multithreaded WASM is used.

Both fresh browser contexts load local bundled assets while locally online. This is cold local loading with external application traffic denied, not cold real-offline reload. In each browser realm's first world, step 400 at source time 200,000 μs pauses native advancement after all packet ACKs. The host sets actual context offline, observes `navigator.onLine=false` and a failing sentinel fetch. Exact identity/sequence ACK permits the same Module/Model/Data to resume at step 401. No recreated world, pose assignment, extra advance or restored trajectory is used. Remaining worlds use the loaded module while offline.

Only one packet is in flight. The Worker transfers a copied ArrayBuffer and checks sender detachment; native WASM memory stays in its owner. Playwright transport is a bounded serialized copy. Initial, endpoint, resume and refusal records retain actual state/warnings.

Data is deleted before Model once per returned handle. Owned warning copies use `finally`; borrowed vectors/options are not deleted. Invalid Worker start removes the listener and closes its scope. Server ownership transfers before listen, allowing bind-failure cleanup. Journal metadata distinguishes accepted records from the actually written and synced prefix.

Unexpected failure stops the suite. Dispatch/return/completion and deletion attempts/success stay distinct. Lost processes or missing ACKs leave an INCOMPLETE prefix with unknown unobserved counts. A constructor throwing before a returned handle does not prove zero internal allocation.

## Admission lifecycle and review boundary

Imports initialize no engine; `--describe` is source-only. `--execute-native` requires reviewed absolute predata and fixed Node/Chromium identities.

A future committed source checkpoint pins six execution inputs and twelve inherited inputs. Current HEAD must equal or descend from it; subsequent committed/working/untracked changes must be inside the bounded explicit report allowlist. Current source/inherited hashes must match checkpoint blobs and predata. Unexpected source drift fails closed. Report-only preregistration changes are allowed, avoiding a clean-report-worktree requirement or circular hash of the receipt. Invocation hashes and rechecks predata bytes.

No predata was created. `MUJOCO_PORTABILITY_SOURCE_PRESERVATION_V1` records 19 reference inputs, unchanged reference HEAD/status, own HEAD/branch/status with empty tracked/staged diffs, six execution-input hashes, four engine-file hashes and tooling-process cleanup. The full eight-file manifest, read-only snapshot, archive and complete new-file diff are external to these reports, avoiding self-hash cycles.

The author stops here for independent source/predata review. Actual Chromium main/Worker compatibility, native failure cleanup and real offline continuation remain NOT_RUN. D01 acceptance, D04 school performance, E10 reset/ten-minute leak qualification, CCD, full-app offline, auth/save/drafts and persistent runtime resume are outside this result.
