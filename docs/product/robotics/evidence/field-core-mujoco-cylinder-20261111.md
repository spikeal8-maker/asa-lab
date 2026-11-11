# MuJoCo cylinder rest/tip qualification — 2026-11-11

> **Working-tree optimization candidate: NEW_ADMISSION_NOT_RUN.** The historical a1 PASS below belongs to the original source at aaf8427f. The two changed source/spec files have pure proof only; no new registration or native run has occurred.

## Current outcome

**Admission a1 PASS**: one authorized invocation, 8 model/data pairs created and freed, 40,200 native advances, and four exact split/full phase-parity pairs. The controller reviewed and accepted this bounded admission. Its journal, frozen sources, receipts and logs are **ARCHIVED_VERIFIED** in an unpublished evidence draft. MAIN rest/tip, independent replay, browser/Worker and E1/D01 closure remain NOT_RUN/open. This report accompanies the authorized seven-path checkpoint.

## Status and boundary

This is a new **TEST_ONLY** slice under
`TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001`, specification v1.1 §§16.2/19.7.
The exact specification SHA256 is
`297bcc4f48ac3af82f9cf6f85e7dc019a409beb48c7506b75c8efeacb6443a0e`.
The static checkpoint below had zero models/data/advances. After the frozen
source receipt and the controller's separate GO, the single admission invocation
completed as recorded in the current outcome and admission receipt below.
Artifact policy and pure test success alone do not constitute physics PASS.

The source base is `5d2f9585546983926de2f72fe5c427f13ae56513` on a physically
separate checkout and branch `codex/robotics-field-core-mujoco-cylinder-001`.
The base preserves the accepted PHY01 source bytes and integrates main
`8c58667208202de22b7b8d36851bbcf4a979e3f3`. The seven new files do not edit
package/lock, PHY01, Rapier, core/UI, workflows, or execution state.

The 16:59:12.104Z scoped preflight returned SAFE_TO_START: exact seven planned
new paths, zero overlap, zero dirty paths, empty index, ahead2/behind0. Before
product writes, the preservation readback verified all 149 E0 files and
13,672,812 bytes, the live HEAD and remote E0 checkpoint, the frozen Rapier
seven dirty paths and index/package hashes, and unchanged listeners4630–4632.
PR1044, live data/services, E0 archives, and the prior PHY01 checkout remain
outside this slice.

## Registered physical experiment

| Item | Registered value |
| --- | --- |
| Engine | Official pinned `@mujoco/mujoco@4.0.0`, offline single-thread WASM |
| Integration | implicitfast, native500/250µs, macro5ms =10/20 real native steps |
| Contact solver | Newton100, tolerance1e-10, line search50/.01, dense/elliptic |
| NoSlip | 20 iterations, tolerance1e-12; combined iteration accounting |
| Contact | condim3, slidingμ1, authored spin/roll0, effective native floor1e-5 |
| Softness | solref(.004,1), solimp(.99,.99,.001,.5,2), solreffriction(0,0) |
| Native flags | nativeCCD/multiCCD, islands, warmstart, refsafe, DIAGEXACT on; sleep/autoreset off |
| Cylinder | radius.033m, height.115m, mass.5kg, explicit uniform inertia/COM0 |
| Block | .1×.05×.03m, mass.5kg, explicit box inertia/COM0 |
| Rest | 2s settling +60s measurement; two dt ×two repeats |
| Rest gates | COM drift≤1mm, orientation change≤.5°, no slip; whole-window global energy minimum |
| Stand | finite5kg box on +Y hinge; native position actuator Kp25000, Kv210, force±32Nm |
| Tilt | 150 targets at.24° through36°; left-sampled quintic ramps; normal.25s+1s / slow.5s+2s |
| Loaded slip | peak≤1mm/s; cumulative sum(h×maximum loaded slip)≤.1mm, every native interval |
| Tip | 100ms consecutive intervals; β≥2°, relativeωY≥.01, uphill lift≥1mm, β growth≥.25°, all loaded contacts on downhill base rim |

REQ-PHY-04's initial2/4 native-step candidate is explicitly changed before
dynamics to10/20 under a5ms macro. The dt choice comes from the separately
qualified MuJoCo PHY01 profile; neither its PASS nor any Rapier result transfers
to this contact experiment. Energy budgets are the inherited physical
acceptance floors `64*2^-23*m*9.81*L`, not Float64 roundoff estimates:
4.3035507202148445e-6J for the cylinder and3.7422180175781254e-6J for the block.
The minimum is global over the complete60s rest window and is never reset to
hide energy growth.

## Phase, contact geometry, and actuator interpretation

The split observer copies q/v/time before mj_step1, proves those values are
unchanged by mj_step1, then copies pre-forward COM frames, body velocities,
contact geometry, and elliptic constraint-row velocities. One mj_step2 advances
the world. Fresh contact forces, constraint forces, accelerations, warnings,
and endpoint physical state are captured before any refresh. Forces belong to
the saved pre-state. They are solved RHS forces, not interval impulses.

Endpoint refresh is strictly mj_kinematics →mj_comPos →mj_comVel after that
capture. The physical state, time, and warmstart must remain bitwise identical.
Admission compares this path against full mj_step reference worlds whose
pre-forward caches are copied immediately after mj_step and **never refreshed**.
No extra forward solve is inserted. H/mu solver caches are excluded from shared
pre-state identity and retained in the solved force phase only.

Both point velocities use the same native con.pos. All three reconstructed
contact-frame components must match efc_vel within1e-9m/s; orthonormality uses
1e-12. Those are arithmetic consistency checks. Neither claims native normal
direction accuracy. Fn>0 means loaded exactly; zero is diagnostic; negative
normal force under zero adhesion is UNKNOWN. Missing loaded/outward support
cannot masquerade as zero slip. Contact material/softness, row identity,
dimensions, and native force aggregation are checked independently.

Pinned native CCD source constructs each contact midpoint from matched witness
pairs. With margin0, witnesses are con.pos±dist*n/2 with the geom-order sign.
The cylinder and box face candidates must satisfy the registered0.1mm base and
floor planes, footprint, and floor interior. The block interpretation is
restricted to bottom/top face support; generic edge-edge support is outside the
admission. No independent native-normal angular threshold is introduced.
Source locations and ownership proof are preserved in the companion JSON.

For the finite stand, n=Ry(θ)ez, downhill=Ry(θ)ex, and n×downhill=+Y.
Stable orientation uses the full3D axis angle, not just signed β. Uphill rim
means the base-circle point along the normalized projection of -downhill into
the cylinder base plane. Maximum rim height is a separate diagnostic, because
sideways tilt makes it a different quantity. A degenerate uphill direction
before the event is UNKNOWN.

Each100ms window has exactly N=100000/dtUs native interval records. Contact
predicates use their pre-states and associated forces; the last endpoint also
satisfies the relevant state-only predicates. β growth is last endpoint minus
first pre-state. The event time is that last endpoint. The actual-angle span
includes all pre/post values and the previous accepted stable window. The first
event is immutable; the current complete hold finishes without another target.
The remainder is POST_EVENT_DIAGNOSTIC for slip/support/stability/tracking/speed,
while finite state, warnings, resources, and both force caps remain mandatory.

Native actuator saturation uses the pinned inclusive derivative branch.
Unsaturated effective torque is nativeForce−Kv*(ωpost−ωpre); at either force
bound the derivative is zero and effective torque equals native force. Both
caps retain only128*EPSILON*32 arithmetic allowance. The alternate endpoint
formula is checked with an operand-magnitude arithmetic budget, separately from
the unchanged physical cap. Actuator work is diagnostic only.

## Explicit work budgets and evidence retention

| Invocation | Worlds | Native advances | Maximum simultaneous worlds |
| --- | ---: | ---: | ---: |
| Admission A | 4 | 1,200 | 2 |
| Admission B | 4 | 39,000 | 2 |
| Admission combined | 8 | 40,200 | 2 |
| Main rest | 4 | 744,000 | 1 |
| Main normal+slow tilt | 8 | ≤6,798,000 | 1 |
| Main combined | 12 | ≤7,542,000 | 1 |
| Both authorized invocations | 20 | ≤7,582,200 | 2 |

A intentionally supplies tangential velocity and applies no PHY no-slip gate;
it proves loaded/tangential witnesses, force/velocity reconstruction, exact
phase parity, and refresh preservation. B settles the finite stand and executes
one normal.24° target. Admission is not a rest/tip qualification. MAIN requires
the same-source admission PASS and a separate controller GO. A failure retains
counts and observations and ends the invocation. Every replay is an explicit,
separately recorded budget; no native run is hidden inside Vitest or hooks.

Evidence is a **registered retained raw journal plus per-step digests**.
Every actual interval computes guards, energy minima, slip sums, and a canonical
digest. Rolling digest checkpoints and compact metrics are retained every100ms;
full records are retained at stage boundaries and around the first event or
failure. This does not save all dense native states, and a digest cannot
reconstruct missing states. Independent replay recomputes the whole trajectory.

The canonical schema uses tagged binary records, U32LE framing/counts, UTF8
strings and byte-sorted keys, IEEE754 binary64LE numbers, preserved signed zero,
and a fixed quiet-NaN representation for failed records. Finite guards still
reject nonfinite physics. Host paths, wall timestamps, and platform metadata
are outside the raw digest. Platform metadata and full diagnostic errors remain
in the separate attempt receipt.

Each pre-window is200ms, at most800 exact-length buffers of24KiB. Admission's
two rings total at most39,321,600 payload bytes; MAIN has one ring. Post-event
retention lasts at most200ms within the already scheduled hold, with no extra
advance. Failed observations use the pre-window plus failing tick. Journal
normal writes stop before a41,551,872-byte emergency reserve covering both
active rings, bounded failing observations, framing, and final trailer. The
entire invocation remains capped at256MiB; the committed summary at8MiB.
Caps and cadence are fixed before data, and the first event/failure is preserved.

The final raw journal, including any failed attempt, must be archived as an
unpublished draft-release asset and downloaded for byte-exact hash verification
before publication. This slice creates no public release, tag, or Latest
change. The completed a1 archive verification is recorded below; the original registration and attempt retain their historical source identity.

## Commands and gates

The default test suite is pure/static and creates no MuJoCo module/model/data:

```powershell
pnpm.cmd exec vitest run tests/robotics/field-core-qualification/mujoco-cylinder.spec.ts --maxWorkers=1
node tools/robotics-field-core/run-mujoco-cylinder.mjs --preregister
```

Only after the respective frozen-source controller GO:

```powershell
node tools/robotics-field-core/run-mujoco-cylinder.mjs --admission --write-evidence
node tools/robotics-field-core/run-mujoco-cylinder.mjs --main --write-evidence
```

An authorized independent replay uses the identical mode and
`--verify-recorded`; each invocation writes its own external raw journal and
receipt and records its actual counts. Native CLI is the physics gate. Later
isolated GitHub qualification CI must run the same commands; pure CI alone is
not a repeat of PHY03/PHY06. Workflow changes belong to a later controller slice.

Source hashes, fixture hash, logs, registration and actual outcomes are recorded
in the companion JSON. Admission a1 passed for the original aaf8427f source.
MAIN rest/tip, independent replay, browser/Worker, school performance,
all-six-test closure and E1/D01 remain NOT_RUN/open. The optimized working-tree
candidate below has status NEW_ADMISSION_NOT_RUN.

## Replay immutability and hash timing

`--verify-recorded` leaves both committed reports unchanged. Its RUNNING/final
receipt and raw journal live outside Git, with exact before/after source and
report hashes and `evidenceWritten:false`. Existing same-source RUNNING or
non-PASS external receipts block automatic retry. Qualification records still
use `--write-evidence`.

For qualification, `afterHashes.reports` is sampled after native execution but
before the final qualification JSON save. The receipt explicitly labels that
timing; it is not the hash of the final self-containing JSON. For replay, the
before/after report hashes refer to the unchanged committed reports. A later
independent artifact manifest can hash the final qualification report without
introducing a self-reference.

## Frozen static receipt (historical, before admission)

At registration **2026-11-11T17:51:19.108Z**, there was exactly one registration and zero attempts, models, data objects or native advances. All eight admission and twelve main worlds were then NOT_RUN. The later a1 outcome is recorded separately below.

Final pure suite: **102/102 PASS**,599ms. Syntax, Prettier, targeted ESLint and final CLI lint: PASS. Governance: one invocation,exit0,372.44s; unique journal created2026-11-11T17:39:32.029Z at C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-cylinder-20261111\governance-static.log. The full external static exit receipt is static-exits-frozen.json.

Synthetic eight-contact A/rest retained record: worst24,042 bytes out of24,576,spare534. Native state/contact/force fields remain; only redundant derived endpointBodies is runtime-only. General native count caps and record-byte cap are independent.

The static-freeze main readback was 58735ee04981bc6ba7a22d1b5deb1ef20587e324. Its two changes since the base main are current.yaml and an Electronics e2e spec; overlap with these seven paths is zero. The preflight and explicit recovery report RECOVERY_REQUIRED because these exact seven authored paths are dirty; PLAN/control-plane PASS,zero execution blockers/overlaps. The diff has been classified and preserved without altering canonical state.

Initial lint/recovery-wrapper/report-writer failures are retained in the JSON receipt. The report-writer failure was an absent quiet ESLint log, not a test failure. The pinned Python3.13 recovery classified the same seven files. No repeated physics or preregistration occurred.

Frozen new input SHA256:

| Input | SHA256 |
| --- | --- |
| tools/robotics-field-core/mujoco-contact-observer.mjs | dd22ed00fc47a68cce8c27f4c1e82145b0f6d26b2924908a9f42317115726a8c |
| tools/robotics-field-core/mujoco-cylinder.mjs | d9748052ca54987aa5ed42f909d0c1f8e21587c0e6ca60c6b5f0b4c3c86ea24b |
| tools/robotics-field-core/run-mujoco-cylinder.mjs | 9729d2f48a51db51a09962e412c41c76912d8719ce864ff93f89a10cc59418e9 |
| tests/robotics/field-core-qualification/mujoco-cylinder.fixture.json | 28c24e4692f65c41fec11a5ade73cf0ce25d0e6e6b80a3b2bb5fca36408222eb |
| tests/robotics/field-core-qualification/mujoco-cylinder.spec.ts | 4bc8a30abc7c309ecb2bb43ede162c44fc3019d0016371dae56a1cebe2a6f2f8 |

All nine immutable parent SHA256 values match the registration and the accepted PHY01 publication. No prior PHY01 physics was rerun. This freeze preceded the controller's separate ADMISSION GO. The later admission passed; MAIN remains unauthorized.

## Admission a1 - completed and controller reviewed

Started2026-11-11T17:56:17.773Z; finished2026-11-11T17:57:16.748Z; outer process exit0 at2026-11-11T17:57:16.7714602Z. Elapsed60.71s is an execution receipt, not a school performance qualification.

**Budget:**8/8 models created/freed,8/8 data objects,40,200 dispatched/returned/schedule-confirmed advances,20,100 step1 calls,4 registered keyframe resets,maximum2 simultaneous worlds. Admission A consumed1,200 advances; B39,000. All planned admission worlds ran; all12 main worlds remain NOT_RUN. Temporary owned wrappers created/deleted:691768/691768; this is balanced ownership accounting, not a leak-test claim.

**Parity:** all four pairs PASS exactly at every native interval: A 500 us: 200; A 250 us: 400; B 500 us: 6,500; B 250 us: 13,000. Split worlds refreshed endpoint kinematics after force capture; full-step references did not refresh. All20,100 split refreshes preserved physical state/time/warmstart exactly. All40,200 warning observations remained at the zero baseline.

**Observer maxima:** contacts8/32; constraint rows24/128; islands2/2; combined solver iterations10/120. Velocity reconstruction error6.938893903907228e-18m/s; frame orthonormality error4.440892098500626e-16; force aggregation error3.552713678800501e-15N. Every force component met its own registered arithmetic bound. Native/effective torque maxima0.2026901905669991/0.1624939310860175Nm, under the unchanged32Nm caps.

A intentionally slipped and qualified the observer. Its no-slip accumulators were not evaluated and must not be interpreted as zero physical slip. Both bodies had positive-load/tangential-velocity witnesses in each A world. B completed only the first 0.24 degree target after settling:

| Split world | Peak slip m/s | Cumulative slip m | Max tracking (deg) | Max speed rad/s | Stage span (deg) |
| --- | ---: | ---: | ---: | ---: | ---: |
| admission-B-500-split | 1.619051095099134e-9 | 1.271592879473593e-9 | 0.015070833764681914 | 0.03128383126520083 | 0.23999110782837182 |
| admission-B-250-split | 1.5490760263002255e-9 | 1.3212465114119654e-9 | 0.015066059715106911 | 0.03127679744859536 | 0.23999106044938015 |

The matching full-step worlds have the same physical values. Both final100ms windows were STABLE. This establishes admission for the registered observer/first stand stage; it is not60s rest or critical-tip qualification.

**Raw retained journal:**578,671 bytes; SHA256933203436f9ac360ca3d61f3ff790f2f887cfe72a24b0a4d648196ccc87516a1. Independent disk readback matches the CLI digest. Complete trajectory digest:cf3390d1252bb709bde85d185af8e98dadedee946796c4eba780c3d8ea76ade9. Source manifest5+9+spec matches before/after and still matches the sole preregistration. The raw journal is retained records plus per-step digests, not every dense state.

Journal: C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-cylinder-20261111\mujoco-cylinder-admission-a1-2026-11-11T175617772Z.asacylraw
External final receipt: C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-cylinder-20261111\mujoco-cylinder-admission-a1-2026-11-11T175617772Z.receipt.json
Independent readback: C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-cylinder-20261111\mujoco-cylinder-admission-a1-2026-11-11T175617772Z.asacylraw.readback.json

At the end of the admission invocation, archival and checkpoint publication had not yet been authorized. The controller then independently reviewed a1, accepted the bounded admission, and authorized the archive and checkpoint described below. MAIN and verify-recorded remain uninvoked. The original registration, every actual attempt and all static failure diagnostics are preserved.

## Verified draft archive and checkpoint boundary

**ARCHIVED_VERIFIED** at 2026-11-11T18:19:57.884158+00:00.
[Unpublished evidence draft](https://github.com/spikeal8-maker/asa-lab/releases/tag/untagged-70f29156a619fa757ba5), release ID **442053227**.
The release remains draft with no publication timestamp. The actual Git tag ref is absent; the Latest endpoint stayed at its pre-archive 404 state.

| Asset | ID | Bytes | SHA256 |
| --- | ---: | ---: | --- |
| [mujoco-cylinder-admission-a1-2026-11-11T175617772Z.asacylraw](https://github.com/spikeal8-maker/asa-lab/releases/download/untagged-70f29156a619fa757ba5/mujoco-cylinder-admission-a1-2026-11-11T175617772Z.asacylraw) | 736479180 | 578,671 | 933203436f9ac360ca3d61f3ff790f2f887cfe72a24b0a4d648196ccc87516a1 |
| [mujoco-cylinder-admission-a1-frozen-source.zip](https://github.com/spikeal8-maker/asa-lab/releases/download/untagged-70f29156a619fa757ba5/mujoco-cylinder-admission-a1-frozen-source.zip) | 736480385 | 230,967 | 2ec898e305b7fcc22814fb35a464dea5a5943f1e7a6c8109d40c379fb950db73 |
| [mujoco-cylinder-admission-a1-receipts-logs.zip](https://github.com/spikeal8-maker/asa-lab/releases/download/untagged-70f29156a619fa757ba5/mujoco-cylinder-admission-a1-receipts-logs.zip) | 736481382 | 99,211 | b92c5e3173a6b32104403f2187b16cfbacfe3568546442cf97f7cf7e4f65afc5 |
| [mujoco-cylinder-admission-a1-archive-manifest.json](https://github.com/spikeal8-maker/asa-lab/releases/download/untagged-70f29156a619fa757ba5/mujoco-cylinder-admission-a1-archive-manifest.json) | 736481848 | 16,975 | 9699f14d4ef7d2eb21d791db200ad420c9e7fe6697a17211d3f755fa080a7187 |
| [mujoco-cylinder-admission-a1-download-verification.json](https://github.com/spikeal8-maker/asa-lab/releases/download/untagged-70f29156a619fa757ba5/mujoco-cylinder-admission-a1-download-verification.json) | 736486020 | 4,758 | 198fa0a4c8891dcc4e5e3b30739fccb28a246981280e0152bc6e024a5c9d8d9b |

All five assets were downloaded through the authenticated GitHub asset API, written to a separate download-check directory, reread from disk, and compared byte-for-byte with the sealed originals. Their downloaded SHA256 values and byte counts also match GitHub's asset digests. The source ZIP has 16 entries: five new registered inputs, nine immutable parents, the exact specification, and a portable frozen-source manifest. All 33 entries in the receipts/logs ZIP were verified individually. The fifth asset preserves the download-verification receipt; its own exact download/hash check is recorded in the companion JSON.

Release target 5d2f9585546983926de2f72fe5c427f13ae56513 is the historical base only. The source ZIP, registration timestamp and per-file hashes identify the actual dirty-source admission. Neither the original registration nor the original attempt gitHead was rewritten to a later checkpoint. The receipts/logs ZIP includes the exact prearchive report snapshots, which retain their historical NOT_ARCHIVED status; current Git reports add these verified links afterward.

**Probe A interpretation:** its zero peakSlipMps and cumulativeSlipM fields are inactive no-slip gate accumulators. Probe A intentionally has nonzero tangential motion, and both bodies supplied positive-load/tangent witnesses in every A world. Those zero fields do not mean measured zero slip.

Archive preflight refreshed main to f767e1271e7128daf64f31c79d21fccf80e85ab4. Compared with the base main, only current.yaml and two Electronics e2e files changed; overlap with the seven planned files and nine immutable parent inputs is zero. PLAN and control-plane checks passed, with no execution blocker or worktree overlap. RECOVERY_REQUIRED identified precisely the seven author-owned new files; their diff was classified and preserved, with an empty index before staging. No convergence with main was performed.

This archive/checkpoint step created zero models and executed zero native advances. Actual totals remain one admission invocation, 8 worlds and 40,200 native advances; all 12 main worlds remain NOT_RUN. No independent replay, PR, deployment, public release, source optimization or full physics acceptance is claimed. The 60.71-second admission runtime measures this instrumented invocation, not an engine or school performance benchmark.

The next allowed action after this checkpoint is controller review. Any MAIN run, independent replay or source/profile change requires a separate recorded decision.

Checkpoint preparation retained one external reader failure before git add: the verify-plan log had a UTF-8 BEGIN line followed by UTF-16LE PowerShell Tee-Object output. The original gate was PLAN_VALID, exit 0, at 2026-11-11T18:22:47.6006369Z. Decoding the existing bytes resolved the reader failure; the raw log and its SHA256 were preserved. No source input, gate, model or native trajectory was changed or rerun.

## Pure observer optimization candidate - not natively admitted

Base: aaf8427f29f213c2320a72d8f8bed592e784c550. Only the observer and pure spec changed; executor, CLI, fixture, nine parents, specification, all physical tolerances and existing resource thresholds remain byte-identical. There is no parity reuse or general structural equality.

The numeric helper is used at exactly five assessContacts call sites. It admits only non-proxy plain dense arrays of length 2/3/5, with own numeric data properties, no extra keys, and ordinary unchanged array-iterator/next methods. Both complete domains are checked before returning false. All other inputs retain canonicalEqual and its byte/error behavior.

The private object-key cache keeps at most 256 keys and 16 KiB of exact, unpooled owned byte payload, with a 256-byte per-key maximum. Full/oversized misses bypass the cache. Stable Buffer.compare ordering and UTF8 collision ties remain intact. A frozen usage snapshot exposes only numbers/booleans. Map/string/Buffer metadata is bounded by entry count, but is not presented as an exact measured heap total.

### Proof and checks

**136/136 pure tests PASS** (102 existing + 34 added); syntax, scoped formatting and ESLint PASS. The external proof imported the entire unchanged aaf observer, SHA256 dd22ed00fc47a68cce8c27f4c1e82145b0f6d26b2924908a9f42317115726a8c, alongside the candidate; both modules import Node builtins only.

All **171 saved frames / 55,231 decoded nodes** were re-encoded by both implementations without exclusions. The reconstructed original journal SHA256 is 933203436f9ac360ca3d61f3ff790f2f887cfe72a24b0a4d648196ccc87516a1. The proof also compared all eight saved final physical observations, 240 contact-vector comparisons, 16 additional edge/error/trap traces and 320 cold-cache fill records. Direct compareBytes counts were 520 per encoder; vector/error comparisons are counted separately.

Independent cold modules reached both bounds: 256 entries / 914 owned bytes, and 64 entries / 16,384 owned bytes. Saturated/oversized misses did not grow the cache. Every retained key buffer had exact backing ownership. Malformed-surrogate stable ties, signed zero, canonical NaNs, sparse/accessor/proxy/custom-iterator fallbacks and late unsupported errors were preserved.

The 171-frame retained-data chain matched exactly (53cdf0146a390ed804ec6431008136aad9c88c3af694fcc7eeb6bf6ae0c25033). It is not a reconstruction of every native state in the 40,200-step admission. Native initialization, Model/Data creation and native advances for this candidate are all **0**.

### Single paired component benchmark

One explicit ABBA invocation ran from 2026-11-11T19:04:10.361Z through 2026-11-11T19:04:11.503Z: wall 1141.5472 ms, process CPU 1406 ms, exit 0. The 30-second watchdog did not fire; soft wall/CPU limits were 27 seconds. Actual counts exactly matched the plan: 2,828 full-record encodings, 8,596 non-small encodings and 48,000 small comparisons. The candidate numeric helper was called 20,000 times; the other 28,000 small comparisons used generic canonicalEqual.

| Pure case | Baseline us/call | Candidate us/call | Baseline / candidate |
| --- | ---: | ---: | ---: |
| A8.full.decoded | 226.809 | 169.892 | 1.335 |
| A8.full.permuted | 395.227 | 217.533 | 1.817 |
| A8.parity.permuted | 276.924 | 160.773 | 1.722 |
| A8.endpoint.permuted | 6.002 | 5.023 | 1.195 |
| A8.contactIdentity | 172.117 | 87.677 | 1.963 |
| A8.preEqual | 9.382 | 8.045 | 1.166 |
| A8.endpointEqual | 29.575 | 16.118 | 1.835 |
| B4.full.decoded | 158.567 | 109.129 | 1.453 |
| B4.full.permuted | 235.741 | 122.857 | 1.919 |
| B4.parity.permuted | 143.205 | 70.288 | 2.037 |
| B4.endpoint.permuted | 4.295 | 2.819 | 1.524 |
| B4.contactIdentity | 89.666 | 37.579 | 2.386 |
| B4.preEqual | 4.159 | 8.182 | 0.508 |
| B4.endpointEqual | 6.014 | 4.502 | 1.336 |
| small.friction | 5.017 | 4.510 | 1.112 |
| small.solref | 3.463 | 1.516 | 2.284 |
| small.solreffriction | 2.990 | 2.013 | 1.485 |
| small.solimp | 2.852 | 1.678 | 1.700 |
| small.efcForce | 2.915 | 1.925 | 1.514 |
| small.observedFriction | 2.556 | 4.410 | 0.580 |

All five targeted numeric comparisons were faster in this invocation. Both slower controls are retained: B4.preEqual and unchanged observedFriction. This single invocation does not establish confidence intervals or explain those timing differences. The benchmark measures pure component cost; it does not show native engine speed, runtime dominance, whole-run speedup or school performance. No benchmark rerun or tuning followed the measurements.

The timed cache held 115 keys / 964 exact owned bytes. Before/after source and original raw hashes matched. All 43 completed candidate proof/benchmark/oracle/check/authoring artifacts are listed, with absolute paths, sizes and SHA256, in the companion JSON and external manifest C:\Users\spike\Projects\asa-lab-robotics-field-core-evidence\mujoco-cylinder-20261111\pure-observer-candidate-20261111-01\candidate-artifacts-manifest.json (SHA256 2e30efa93f5fd2b679d1dfc3104cf8c9f18323ae480c87550fa54f1ffbc95e4b).

### Final source snapshot and proposed registration

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| tools/robotics-field-core/mujoco-contact-observer.mjs | 32750 | 63f57d38502dfb7f1d0a4fd4899c4112888a0040855932f6f6fdd922b8d914b0 |
| tests/robotics/field-core-qualification/mujoco-cylinder.spec.ts | 63906 | a591d2189d8ea24d27706245965a3fbf2b9b9b8bf2533f0d5e10681bb8346a01 |

The exact two-source-file diff is source-only.diff: 19582 bytes, SHA256 87f4983d769982d3611aedc827ea4600b9908bc00a67ba62eae90d5de5d96c24. It contains 487 insertions and seven deletions. The original registration, a1 attempt, admission totals and verified draft archive are unchanged.

The proposed registration is **PROPOSED_NOT_REGISTERED**, based on aaf8427f plus this dirty source snapshot. Fixture SHA256 remains 28c24e4692f65c41fec11a5ade73cf0ce25d0e6e6b80a3b2bb5fca36408222eb. A future admission would retain the same eight worlds / 40,200 native advances and requires separate controller authorization.

Future native equivalence must compare exact completeTrajectoryDigest, all per-world full/parity/endpoint chains and retained physical record bytes. The only allowed journal-content difference is the explicitly identified invocation.sourceManifest. A different-source invocation naturally has a different whole-journal SHA; the present PURE proof nevertheless re-encoded every old frame byte-exact without exclusions.

**STOP for independent delta review.** Candidate native admission, MAIN, replay, preregistration, commit, push, PR and convergence with main have not occurred.
