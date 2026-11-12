# E1 MuJoCo portability — completed bounded native result

**Current result: PASS_FOR_BOUNDED_PORTABILITY_ONLY. Native status: EXECUTED.**

One authorized run, portability_668_r1_20261112T024900Z, executed **source checkpoint 668e645de31946521008df9c537cf430a0cc7df5** on 2026-11-12. Independent evidence review: **PASS_INDEPENDENT_EVIDENCE_FOR_ONE_BOUNDED_PORTABILITY_RUN; 27 PASS checks; 0 blocking findings**, accepted by ROOT. This report describes that completed run. This report-only revision was never executed and does not transfer native evidence to new report bytes or a future document commit.

Task TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001, Issue #1071. **E1 is not closed; D01 NOT_ACCEPTED; D02 OPEN_ACCEPTANCE_BLOCKER; D04 BLOCKED.** Integration, release, deployment and another native run remain outside this result.

## Exact executed identity and actual command

Parent: 7abc72d2f8bf88475fd9b2467603243d7498b336. Tree: 5ddbb83725daf818bdda65b4df87c70faee9c841. Branch: codex/robotics-field-core-mujoco-portability-001. Source manifest SHA-256: 2ea44facddacfe7f1620bd18fba0b972d3b22730acefd588d0f4bb3cad892544.

Approved predata: **6020 B / 64b14bdd7810244274c60f22144868b358c2f45f3f402886db3bb2c83418c4a1**. The preserved 6015 B proposal differs only by the separately authorized token replacement. The unchanged supervisor is 6812 B / 7416012a53c2ea7439cec2dfb370a56d1803f0fc8b9aca7c3336a9d2d752ff6d.

Actual command, executed once from C:\Users\spike\Projects\asa-lab-robotics-mujoco-portability-001:

```text
"C:\Users\spike\AppData\Local\Programs\nodejs\node-v22.23.3-win-x64\node.exe" "C:\Users\spike\Projects\asa-lab-robotics-mujoco-portability-001\tools\robotics-field-core\run-mujoco-portability.mjs" "--execute-native" "C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\approved-predata.json"
```

| Process                    |   PID | Popen dispatch UTC, 2026-11-12 | Observed terminal UTC                     | Exit |
| -------------------------- | ----: | ------------------------------ | ----------------------------------------- | ---: |
| Reviewed Python supervisor | 11436 | 03:32:45.587096                | 03:33:13.160780                           |    0 |
| Native Node orchestrator   | 36920 | 03:32:45.984450                | 03:33:13.019861                           |    0 |
| Node realm child           | 48544 | Not separately claimed         | Actual child-exit receipt in runtime.json |    0 |

External capture PID: 48628. Native stdout: 359 B; stderr: 0 B. Exclusive fsynced claim precedes one dispatch; retries/replays: 0. Actual launch checked Python optimize=0, **debug**=true, absent PYTHONOPTIMIZE and cleared the four reviewed guard variables. Actual receipts below retain command, environment, PID, start/return/end times and streams; exit 0 alone is not the physical verdict.

Pinned Node: v22.23.3. Actual Chromium: 140.0.7339.186, revision 1193; Playwright Core: 1.55.1. MuJoCo in each realm: 4000000 / 4.0.0. Exact file hashes are in JSON and the runtime-prerequisites receipt.

## Native results and separate accounting stages

Node child, browser-main and DedicatedWorker executed sequentially, each owning 20 positive PHY01 worlds and one real quota world. The Worker owned its Module/Model/Data and advances; its page transported copied buffers.

| Observed quantity                          |            Each realm |            All realms |
| ------------------------------------------ | --------------------: | --------------------: |
| Worlds                                     |                    21 |                    63 |
| Model dispatched / returned                |               21 / 21 |               63 / 63 |
| Data dispatched / returned                 |               21 / 21 |               63 / 63 |
| Model deletion dispatched / returned       |               21 / 21 |               63 / 63 |
| Data deletion dispatched / returned        |               21 / 21 |               63 / 63 |
| Advance attempts                           |                 24005 |                 72015 |
| Reserved / dispatched / completed advances | 24004 / 24004 / 24004 | 72012 / 72012 / 72012 |
| mj_step1 dispatched / returned             |         21604 / 21604 |         64812 / 64812 |
| mj_step2 dispatched / returned             |         21604 / 21604 |         64812 / 64812 |
| mj_step dispatched / returned              |           2400 / 2400 |           7200 / 7200 |
| Quota refusals                             |                     1 |                     3 |

**Native completed / validated / emitted / ACK / host accepted / durable endpoints each equal 72012.** Packet dispatched/ACK/received/accepted/durable counts each equal 791. Raw records: 72080 = 63 initial + 72012 endpoint + 2 offline-resume + 3 quota-refusal + 0 failure. A failed observation never becomes a successful endpoint.

Three saved original PHY01-assessor results are **PASS**, failures=[]: 20 positive worlds, 72 main comparisons and 24000 positive native advances per realm. Reviewer linked 240 saved sample states, including full-step references, to raw without re-importing or rerunning the assessor. Saved maximum position error is 0.0009809999999959018 m and velocity error 4.1744385725905886e-14 m/s per realm.

Independent decoding checked all packet payload SHA, all records, integer schedules, finite state, endpoint invariants, state digests, trajectory/warning hashes, metadata and assessor-input completeness. **All 21 corresponding world triples contain byte-identical native state/warning/integer evidence across the three realms**, including initial and quota observations. The 2000 protocol rows contain 943 receive–ACK pairs and 114 parts of nine durable module/realm-end/terminal receipts; every raw packet has exactly one matching pair.

Three engine imports, factories and pinned MuJoCo instantiations were dispatched and returned. This covers three measured MuJoCo boundaries only. Internal compile count is **UNKNOWN_INTERNAL**; global host/Chromium WASM activity is outside that scope.

## Negative admission and allowed asset IO

All **18 negative cases PASS**. Fifteen N1–N5 admission cases have zero imports/factory/instantiation/Model/Data/advances before and after. Engine-asset reads are separate:

| Case in each realm  | engineAssetReads before → after | Observation                                                    |
| ------------------- | ------------------------------- | -------------------------------------------------------------- |
| N1 NaN mass         | 0 → 0                           | Rejected before asset IO                                       |
| N2 Infinity gravity | 0 → 0                           | Rejected before asset IO                                       |
| N3 invalid geometry | 0 → 0                           | Rejected before asset IO                                       |
| N4 missing WASM     | 0 → 1                           | Actual allowed missing-resource read, no fallback/native call  |
| N5 corrupt WASM     | 1 → 2                           | Actual allowed integrity read, not a native compiler rejection |

Three N6 quota worlds used the approved 0.5 kg / 500 us case. Four advances completed; request five was refused before native dispatch or another reservation. Quota-refusal state/warnings/integers equal endpoint four. The refused request remains an attempt, not a completed advance.

## Same-world warm offline continuation

In browser-main world 21 and Worker world 42, endpoint **400 at 200000 us** was durable and acknowledged before the barrier. Actual context-offline transition produced uncached sentinel failure net::ERR_INTERNET_DISCONNECTED. Runtime checked identity-bound offline ACK and navigator.onLine=false.

The offline-resume record preserves native state, warning bytes and native integer fields from endpoint 400; the next native endpoint is **401 in the same world**, which completes at 800. No Module/Model/Data was recreated. All 68 network rows are loopback GETs on registered routes; two expected missing-WASM 404/ERR_ABORTED events belong to N4.

Initial local asset loading occurred while locally online with external application traffic denied. This is cold local loading plus warm real-offline continuation of loaded MuJoCo realms. It does **not** qualify cold real-offline application reload, full-app offline, auth/save/drafts/persistent resume or cross-network deployment.

## Disposal, journal and watchdog limits

Returned Model/Data handles were deleted; live handles are 0 and max live Model/Data is 1 per realm. Warning observations total 72080; warningGet and warningDelete dispatched/returned each equal 504560. All saved warnings are zero; failure observations/frames are 0.

Receipts confirm one child exit 0, one Chromium close, two context/page closures, one Worker self-close and one HTTP-server close callback; cleanupFailures=[]. Worker records 264 transferred/detached sender buffers, one listener created/removed, maxInflight=1, disposed=true and relayFailure=null. Module lifetime is owned by its realm; no invented Module.delete operation is claimed.

Later PID absence is a scoped observation, not an exit receipt. Former Chromium PID 9120 was reused by the author's Python inspection capture, confirmed by capture PID/image; it does not indicate a surviving Chromium process.

Journal directory: C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z

| Quantity                        | Actual or fixed limit |
| ------------------------------- | --------------------: |
| Complete journal files          |                   261 |
| Complete journal bytes          |              29318654 |
| Raw packet bytes                |              25422784 |
| State-digest bytes              |               2304384 |
| Approved journal maximum bytes  |              43357920 |
| Envelope bytes                  |              67108864 |
| Manifest other-file descriptors |                   260 |
| Manifest bytes                  |                 41515 |

Every file size/SHA matches the closed completion and inventories. Runtime's earlier accounting snapshot is 29212954 B; later runtime/negative/failure/manifest finalization adds 105700 B. This is the documented finalization order, not hidden resource use.

Watchdogs remain overall/module/world/packet/offline/cleanup **300/30/60/10/10/5 s**. ROOT selected no external deadline or automatic tree termination. Overall 300 s is not a hard total-wall claim: preparation, synchronous callbacks, cleanup and finalization retain their reviewed semantics. Elapsed time and 17629184 B module-memory snapshots do not qualify school-reference performance, long-duration heap/leak behavior or E10.

## Accepted independent review and exact evidence

Independent review has 27 PASS checks, blocking findings 0. Reviewer native/replay/test-suite/assessor-import/browser/Worker/server counts are 0. Failed helper v1 selected wrong quota mass; v2 conflated asset IO with native admission. Both actual exit-1 attempts remain preserved; v3 derives its predicates from the existing contract and passes. No product source or native result was repaired.

The JSON companion carries all checks, counters, saved assessor receipts and chain descriptors. These are existing local evidence paths with exact byte identities. This report creates no archive and invents no upload URL.

| Evidence                          |  Bytes | SHA-256                                                          | Absolute local path                                                                                                                                  |
| --------------------------------- | -----: | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| sourceFreezeV2                    |   9915 | c6bd0811fa29f8c7ce17bbd3d83f8c8e698153d88d3716b839919814d32d32de | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\browser-worker-offline-repair-20261112-01\source-freeze-v2\freeze-receipt.json          |
| semanticSourceReview              |  24878 | 5f33f13690cee63c2c904f577eb4a17e6683f3b088e900835e53c72f184c4124 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-v2-predata-review-20261112T015100Z\source-review.json                       |
| sourcePublication                 |  14359 | 71e1b529638788c26c31b90aef612b45d04d8c06d03b29104ee7608589c0512e | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-v2-publication-20261112T020400Z\publication-final.json                      |
| publishedCheckpointReview         |  73856 | 96d88544447ac89d777a306bf7265c440a4f2dcfed65073c5869ed5985176e8b | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-published-668-review-20261112T023500Z\published-checkpoint-review.json      |
| concretePredataReview             |  53010 | 3b04c1dafd6a248770dc461fa9ee030e6f86f7c31ee682f4fa4aad1495cf4179 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-independent-review-20261112T032000Z\predata-review.json             |
| originalProposal                  |   6015 | 90c0d0cfe8c25d8f974fdabb81470338e4096de5465e0fad2566cc39849d7e8b | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\proposed-predata.json                     |
| approvedPredata                   |   6020 | 64b14bdd7810244274c60f22144868b358c2f45f3f402886db3bb2c83418c4a1 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\approved-predata.json                     |
| runtimePrerequisites              | 125198 | efe53006054d4159eb7ea19390028d1ce03c9b4ae3998a563a97c05caa86341b | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\runtime-prerequisites.json                |
| reviewedSupervisor                |   6812 | 7416012a53c2ea7439cec2dfb370a56d1803f0fc8b9aca7c3336a9d2d752ff6d | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\proposed-native-supervisor.py             |
| nativeAuthorization               |   4525 | 0705610e74e8432c6dbfe743fe3fdd3dfb99358142d4f0e24bd358e31eafe630 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-execution-668-20261112T032900Z\root-authorization.json               |
| dispatchClaim                     |   3667 | 1abf598a2f44123004ed3543fe12716949341819f6e69683e29896bf3d819502 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\native-dispatch-claim.json                |
| actualDispatch                    |   3793 | bfbdb75cbad8137ace2f7c1cbfb36b684081096e02d6d6b5e72ba7f45fb36886 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\native-dispatch-actual.json               |
| actualCompletion                  |  75884 | 56d2afeccbb818eefc52a8c7a32f0ff734e9cf3adce3901f2f7cdfe27751539e | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-predata-proposal-20261112T024900Z\native-completion.json                    |
| actualSupervisorCompletion        |   2787 | d1c54f643dfe75184078b491762babde91bb0f1d7e3420c1a7b1abbec5934159 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-execution-668-20261112T032900Z\native-supervisor-capture.exit.json   |
| nativeInvocation                  |  23473 | bb048a853cf30088128550e187ebd0d471d5b20966b9ee36f1d7c7a2f1e82056 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\invocation.json                              |
| nativeRuntime                     |  39702 | 0684e71d6a5c3df8f898dbc4a0981ec448c9bcf134c53f43f29a9c8c3b1cd217 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\runtime.json                                 |
| nativeManifest                    |  41515 | 59f39de1e2506a7aa67b1be9475773ef66b8679e3f6d7fb3a4df5d40244603a5 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\manifest.json                                |
| nativeNegative                    |  24460 | 86773de3d7f5769ae5616bd9c9266b499ef04e484f2fcd856854bcb5d92a71d8 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\negative.json                                |
| nativeNetwork                     |  11435 | fcd5944a08c09489deb2a30a6f58d7e87180cce9dbde43f35c6646c956e757f2 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\network.ndjson                               |
| nativeProtocol                    | 356204 | fc449f503d8d5ce6581fe6796f85f9b947f6a67a1e4382d81685288418278ba7 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\protocol.ndjson                              |
| nativeFailure                     |     23 | 79dec3c98c9dfadf1c0125abd719aa1d1043dcf1a3c02d38af481abfac498e5c | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-668-r1-20261112T024900Z\failure.json                                 |
| authorExecutionFinal              |  25676 | a33db0a3686612cfa08172fe8476108f7eeeee91961cc1789499c75e9ed716db | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-execution-668-20261112T032900Z\native-execution-final.json           |
| authorExecutionManifest           |  38477 | 02872fcba103a7243e34cc2d1d234142a82f7979c48af701a2bf035f46f8e140 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-execution-668-20261112T032900Z\artifact-manifest.json                |
| authorExecutionCompletion         |   4708 | a2f4f6ea5fb24a6519541f207e98f14db7078846095dd7d85ff6e318f67684c8 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-execution-668-20261112T032900Z\package-completion.json               |
| independentNativeReview           |  51845 | 575f82d2bfcec53222937a82f7253930acad0af3cd2e0b33685538fc869e567f | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-independent-review-20261112T040000Z\native-evidence-review.json      |
| independentNativeReviewNarrative  |  14022 | 0907b05740d7a191b48b85cf51d6e287b3aa0506d6447e0ebc95e66ca87d489e | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-independent-review-20261112T040000Z\NATIVE_EVIDENCE_REVIEW.md        |
| independentNativeReviewManifest   |  24921 | ae61a3040555c3033440d3efe725a67f285bca1c05d64cf3da4879e59f1c2bc8 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-independent-review-20261112T040000Z\review-manifest.json             |
| independentNativeReviewSeal       |   1753 | b742a6a472689972f7d1dc829a084533101c4349bdd67aae00f7a44e16b0c1e0 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-independent-review-20261112T040000Z\seal-capture.exit.json           |
| independentNativeReviewCompletion |   3894 | 960133cdd69ff0cfc3b809ebe6a2f4a6f81628bc7339bf6f589450dcbe5e1441 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-independent-review-20261112T040000Z\review-completion.json           |
| freshReportPreflight              |   1252 | 5c053b87788abd52a6e444af54378703bf946e59ae1f1f54824eb46b5beb4fef | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-report-preparation-20261112T041300Z\fresh-report-preflight.exit.json |
| freshExact668CI                   |   1109 | b3aff4db213470dfd6df2c988fe822622daa13f58c57779581cb1e2d8431ae8e | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-report-preparation-20261112T041300Z\report-exact668-ci.exit.json     |
| beforeReportPreservation          | 805141 | dfd0578d43b1f7593306435e3132b47351f4b262d863095f70d8264fcbac2645 | C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-report-preparation-20261112T041300Z\before-report-preservation.json  |

## Seventeen immutable inputs and two report deltas

Six execution inputs plus eleven inherited inputs remain unchanged against executed checkpoint 668:

| Repository path                                                               |  Bytes | SHA-256                                                          | Git blob at executed checkpoint          |
| ----------------------------------------------------------------------------- | -----: | ---------------------------------------------------------------- | ---------------------------------------- |
| tools/robotics-field-core/mujoco-portability-sampler.mjs                      |  33568 | 7182b63e86b57e2c7c6f46fb12ae8ca46df5a9360e598fb2862472187ed79fec | 7f4ceb663202f946aa099f6c976d4a92704acf83 |
| tools/robotics-field-core/mujoco-portability-runtime.mjs                      |  39836 | cc792c204407f812080d4ce59a00ad6712e5c5cfe4db97acaa5a0a541ad46e81 | 6c9c332b298e01787850a0614f491864874fb66f |
| tools/robotics-field-core/mujoco-portability-worker.mjs                       |   4448 | e901423ad61eddd9df010686bc26a1aa11395054e0feeb91aab76d545f39c507 | 0e02388faa59257c39207f5de4450657ae5c00b3 |
| tools/robotics-field-core/run-mujoco-portability.mjs                          |  77339 | 4dc5b49ce58fb25c5c68dddc96d83511c6c8b1e907d9c09169c5b638ebb34c2a | 99bb8813c8332fb0ae08080c28050d0d0e96de00 |
| tests/robotics/field-core-qualification/mujoco-portability.fixture.json       |   5730 | 315265228876de2444ab7c9426da25e34b6a8cc42a28209a8ba8e10bbfe68cd6 | 8aee4bbb6c1f3ce08a5529ae335238f8215a4240 |
| tests/robotics/field-core-qualification/mujoco-portability.spec.ts            |  57575 | a7fca17fb426ec07cbf8400dc9d3078c7c5dc966d8d819a65fe99751a89aa4bb | 8b6f4932dc2a95d1293ec9cc92c98dacfc985e2c |
| docs/product/robotics/FIELD_CORE_SPEC.md                                      | 141843 | 297bcc4f48ac3af82f9cf6f85e7dc019a409beb48c7506b75c8efeacb6443a0e | 8bf3a05394b43cfefa416ca707dd49d05747917e |
| docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001.md |   9071 | 0ca37747706d04d38d405bdd99186a19616a8cf7187ae91dad5d8162b4061623 | c2b68e67afa3b012b7b3c158bd3f87a345249d57 |
| tools/robotics-field-core/mujoco-phy01.mjs                                    |  34587 | 05998a3f88968552cb80c75172d724719fb7f7ecfe6c66762e7e44857e0b5f99 | d1df709fb24a727323115fdd1061d783f4249386 |
| tools/robotics-field-core/run-mujoco-phy01.mjs                                |   6441 | 5b2179f0ff1b6c759b63757dd881242aee6c9fb4b258243a08a7b50dfefb12ad | 51468035707a186089c960ea747adc7a891697c0 |
| tests/robotics/field-core-qualification/mujoco-phy01.fixture.json             |   3924 | a8c88eac291c4ef48a0db7261f67949e162b1e13e713705333365c804d41f67c | fdf2f8eeb6a89693e1f250f052ab85c21a05e3c9 |
| tests/robotics/field-core-qualification/mujoco-phy01.spec.ts                  |   8577 | 1266b4c420baea08fd4448beb9d96a908d039bc3ddcbfc89a67b911aef893cb4 | e988103b4c5cb77fb4d65b3e1a20aa42ebbe9d1b |
| tools/robotics-field-core/mujoco-artifact.json                                |  14753 | 1c353e3593f1fcd730c6e97f9549d3b6fdff7ce1fff7b9c45755edd7cd1ca1c3 | 673c48e1a5c8466cf43a974902efa1a90556e996 |
| tools/robotics-field-core/MUJOCO-LICENSE.txt                                  |  11358 | cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 | d645695673349e3947e8e5ae42332d0ac3164cd7 |
| tools/robotics-field-core/MUJOCO-THIRD-PARTY-NOTICES.txt                      |  77376 | 6f681117208684ef2ab3ad03a9f928ae8c6dffb4f765eeab59fb2d8b189e1540 | cb882d4227352d8d486929573c3ba510eb99a150 |
| package.json                                                                  |  27449 | c2f5a1421e86b7dd37022eda8a37cf25cded373d986c31dc8f8e1beb435c7492 | adf54d0f15f4fbc52bf8a8a4f157e494ef5aeffa |
| pnpm-lock.yaml                                                                | 309859 | 448b5a8faa0f8497c3efe1bdc63959b381fad5577bfb5734261e9578ee5a93e1 | b1212c02e7fee2d1f532d2b0bc197bd3dfbb3770 |

The two reports are excluded from executable approval hashes. Original report bytes are preserved in Git and external original668 copies:

| Original report | Bytes | SHA-256                                                          |
| --------------- | ----: | ---------------------------------------------------------------- |
| JSON            | 89733 | f58a3a02649afc1daf111c254a7566dc0a1eecd5e0889c8100e8f7c3ca94ae39 |
| Markdown        | 20582 | 756d57ff0b45c2136babddc9fc6c2c21f8c2e732ce42f0933f25effc368e5723 |

External copies and before/after proofs: C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\portability-native-report-preparation-20261112T041300Z. Native evidence belongs only to executed 668 and its original inputs, never this new report hash.

Fresh preflight returned SAFE_TO_START for exactly two paths, zero overlaps and zero execution blockers. Main c633121afb0992c21799f3c3415f8e8660fad800 differs from parent 3e14b615961770849144668b961df822c0f4527a only by e2e/learning-course-01.spec.ts +6/-0; canonical blob 4797f5f7cb22589213925ead73d0b9dd68709400 is unchanged. No sync, rebase or convergence occurred.

Exact 668e645de31946521008df9c537cf430a0cc7df5 GitHub Actions query returned **0 workflow runs: NOT_RUN**. Unrelated main CI is not transferred to 668. This preparation creates no commit/push and makes no CI claim for a future report commit. Actual documentation gates are recorded in the separate preparation package; the 99 PURE suite and native run are not repeated.

## Historical source-only phases

The entire former JSON object remains unchanged under history.sourceCheckpointReport, including nested author-v1, original receipts, startup incidents, parser accounting, source hashes and then-current NOT_RUN/STOP fields. Those describe earlier phases. Current native status is EXECUTED. Exact original JSON/MD bytes are separately retained.

| Historical phase                               | Actual result                         | Preserved meaning                                                   |
| ---------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Author v1, official v4                         | 79/79 PURE PASS                       | Native NOT_RUN then; v1/v2/v3 startup attempts remain NOT_COLLECTED |
| Repair v5                                      | 98 PASS / 1 FAIL of 99                | Actual Windows path-length failure in temporary Git fixture         |
| Repair v6                                      | 99/99 PURE PASS                       | Before first lint failures                                          |
| First repair lint                              | Two findings                          | Unused variable and unsafe finally throw; failed receipt retained   |
| Repair v7 and final lint                       | 99/99 PURE PASS, lint PASS            | Final repaired execution bytes; fixture LF/CRLF warnings preserved  |
| Published exact 668 focused gate               | 99/99 PURE PASS                       | Separate source-only validation at 668; not rerun for this report   |
| Semantic → published → concrete predata review | Accepted closed source/predata chain  | Earlier native-not-yet-run scope remains historical                 |
| Native and independent evidence review         | One bounded PASS; 27 independent PASS | Current result, with unchanged acceptance limits                    |

Historical 28-node/2136-edge graph, four syntax checks, six-file format, targeted lint, guards, technical parser WASM and temporary Git accounting retain their original scopes. Old formatter receipts ignored the reports; no retroactive eight-file format claim is made.

## Report-only handoff

This revision promotes the completed bounded native result, identifies executed source/predata, records accepted independent evidence, separates admission IO and nests old NOT_RUN fields in explicit history. Only these two report paths may differ; source/test/fixture, package/lock, engine, canonical state and index remain protected.

As of this preparation, independent document review and separate commit/push GO are pending. No E1/D01/D02/D04 acceptance, integration, release, performance/heap qualification, deployment or further native run is granted. The author stops after the closed preparation package.
