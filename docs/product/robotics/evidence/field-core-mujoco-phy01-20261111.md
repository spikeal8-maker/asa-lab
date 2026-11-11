# MuJoCo PHY-01: contact-free qualification

## Status

Package and local single-thread initialization admission: PASS.
Preregistered contact-free PHY-01 qualification: PASS.
Three author invocations executed 60 worlds and 72,000 native integration steps.
Browser, Dedicated Worker, contact/friction/tipping/CCD and school-PC performance:
NOT_RUN. E1, D01 and D02 remain open. Exact-commit independent review and required
CI are pending. This report does not grant product or deployment acceptance.

## Scope and provenance

This independent reserve candidate follows the recorded boundary of Rapier's
published API for contact-phase observability. That boundary is not a proven
Rapier physics failure. MuJoCo qualification does not inherit Rapier's accepted
freefall result.

Official @mujoco/mujoco 4.0.0 is an exact development dependency. The artifact
manifest records the npm SRI, ten installed file hashes, root single-thread WASM,
JavaScript, exports and source-derived companion licenses. The npm tarball omits
license files. The companion preserves the pinned linked-source declarations and
Emscripten 4.0.10 runtime notices with whitespace normalization recorded separately.
This is declared-build provenance; reproducible binary build and cryptographic
attestation verification remain NOT_RUN. Unmodified npm JS and WASM are loaded
locally using explicit bytes; the isolated initialization recorded zero fetches.

The first admission-only loader call failed because its locator callback rejected
Emscripten's unconditional filename resolution. A corrected local-path locator
instantiated exactly the pinned WASM bytes. Neither initialization created a model
or advanced physics.

## Frozen physical and phase protocol

The authoritative JSON fixture points to specification v1.1 sections 16.2 and
19.7. The REQ-PHY-04 initial 2/4 substep candidate is replaced, before dynamics,
with 10/20 actual native steps per 5 ms macro step: 500/250 microseconds.
For semi-implicit constant gravity, displacement error is g*t*h/2. At 0.1 s the
coarse prediction is 0.24525 mm within the unchanged 0.4905 mm displacement-based
threshold; 1250 microseconds would produce 0.613125 mm and fail. Refining the
native step predicts half the displacement error. This prediction is not measured
evidence.

Three explicit sphere masses 0.02/0.5/2 kg start at z=2 m with radius 0.02 m,
zero velocity and zero local COM. Explicit solid-sphere inertia is the only mass
source. There are no actuators, sensors, model plugins, callbacks, damping,
frictionloss, springs, armature, fluid terms or sleep. The floor top is zero.
Native options, coordinates, geometry, mass and inertia are admitted before any step.

The main eighteen worlds use mj_step1 then mj_step2; two 0.5 kg reference worlds
use full mj_step. The budget per execute invocation is 20 worlds and 24,000 actual
native steps, maximum 1,600 per world. Each native endpoint must be finite,
contact-free, warning-free and at its scheduled time within the preregistered
floating-point addition bound. mj_step1 must preserve qpos/qvel/time bitwise.
Split/full parity includes qpos/qvel/qacc/qacc_warmstart/time at every native step;
timers, solver and allocation counters are deliberately excluded. Native double
bytes preserve signed zero. No extra forward solve refreshes caches.
The physical oracle consumes qpos/qvel only after the COM/frame readback; stale
post-integration xpos/cvel caches are not physical endpoint measurements.

Main measurements are the four times 0.1/0.2/0.3/0.4 s, unchanged PHY-01 tolerances,
nine convergence checks, twenty-four mass-independence comparisons and six exact
native-state repetitions. Two phase parity comparisons cover 2,400 reference
steps. No contact, tipping, friction or continuous-collision qualification is made.

## Evidence and ownership guards

Warning observations are read and checked after every native step. The seven
initial counters must be zero. The report retains that baseline, the number of
successful zero-warning checks, and an incremental SHA256 digest of ordered
Float64LE (number, lastinfo) pairs. Split/full runs compare that digest exactly.
Any failing endpoint retains the observed warning values. There is no repeated
24,000-by-seven JSON array of zeros. Every native state still has its own SHA256
digest. At two-space report indentation, the 24,000 state-digest entries occupy
about 1.9 MB; fixed run metadata and eighty endpoint samples are additional.
The pre-run estimate was 2-3 MB per complete attempt. The first measured report
was 2,327,755 bytes before adding verification receipts. Raw observations retain
their original digest after documentation updates.

Each run enters the raw journal before model allocation. The executor returns
actual created/deleted resources and dispatched/completed integration calls even
when initialization, native execution, cleanup, or assessment fails. Native
step1/step2/full calls also have separate dispatched/returned counters. Cleanup
errors do not discard earlier results. The last completed observation is retained;
a separate best-effort failure observation stores any available state, warning
values and read errors without replacing it. No failing attempt is substituted
with a successful rerun.

The model.opt and data.warning getters are borrowed embedded references and are
not deleted. Each warning.get(i) is an owned snapshot and is deleted after its
scalar values are read. The owned MjData is deleted before the owned MjModel.
These ownership rules follow the pinned MuJoCo generated bindings and
Emscripten 4.0.10 reference/vector conversion sources:

- https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/wasm/codegen/generated/bindings.cc
- https://github.com/google-deepmind/mujoco/blob/ac60eae30fa7e0d31315c38d9476752fb81be67e/wasm/codegen/generated/bindings.h
- https://github.com/emscripten-core/emscripten/blob/4.0.10/system/include/emscripten/bind.h
- https://github.com/emscripten-core/emscripten/blob/4.0.10/system/include/emscripten/wire.h
- https://github.com/emscripten-core/emscripten/blob/4.0.10/src/lib/libembind.js

## Checks before dynamics

The exact dependency was installed with the frozen lockfile. The repository
license gate and its four CLA self-tests passed. Thirteen pure admission tests
passed; the eight native dynamics tests were not selected by the explicit
admission-only test-name filter. Focused ESLint, strict TypeScript and source
syntax checks passed. A fixture-hash refresh initially missed a wrapped source
declaration; the resulting pure admission failures were corrected before
preregistration, with zero model creations and zero physics steps. The native
warning enum contains seven entries; this was checked from the pinned declaration
before writing the final fixture. These checks preceded the first measured
physics invocation recorded below.

## Measured result

The frozen registration was recorded at 2026-11-11T16:06:21.904Z against base
dc3731c67e4c1cdf74cafc324dc3521486d5910e. All nine source hashes remained unchanged
through qualification and verification. The raw fixture SHA256 is
a8c88eac291c4ef48a0db7261f67949e162b1e13e713705333365c804d41f67c.

The first attempt, mujoco-phy01-a1, ran at
2026-11-11T16:09:52.455Z--2026-11-11T16:09:53.692Z on D2-R2, Windows x64,
Node v22.23.3, Intel Core i5-13400. Its raw SHA256 is
5bd2b3d7ca0c34d6a23b6a1c3f7a79f145319bbde8438d03fe7f52e0c2a6d281.
The host fingerprint and timestamps identify this execution; they are not a
school-PC performance qualification.

All twenty native model/data pairs were created and deleted. The eighteen main
worlds completed 21,600 mj_step1 and 21,600 mj_step2 calls; the two reference
worlds completed 2,400 full mj_step calls. This is 24,000 integration advances,
not 45,600 physical time steps. Native options, actual Float64Array states,
mass/COM/inertia and free-joint frames passed admission before their first step.
There were zero contacts, constraints, sleeping trees, nonzero inputs or native
warning increments in the checked window.

All 72 main samples, 9 convergence checks, 24 mass comparisons and 6 exact
repeatability groups passed. Both split/full phase comparisons passed at every
one of 800 and 1,600 reference endpoints, including exact qpos, qvel, qacc,
qacc_warmstart, time and warning-trace equality. No mismatch was repaired.

Representative 0.5 kg repeat-0 displacement errors are below; the raw JSON holds
every mass, repeat and native trace. Values are rounded here only for display.

| Time, s | 500 us error, mm | 250 us error, mm | Unchanged position limit, mm |
|---:|---:|---:|---:|
| 0.1 | 0.245250 | 0.122625 | 0.490500 |
| 0.2 | 0.490500 | 0.245250 | 1.962000 |
| 0.3 | 0.735750 | 0.367875 | 4.414500 |
| 0.4 | 0.981000 | 0.490500 | 7.848000 |

The maximum position error across main samples was
0.0009809999999959018 m. Maximum velocity error was
4.1744385725905886e-14 m/s. Position and velocity spread among the three masses
was exactly zero in all 24 comparisons. Maximum sampled native-clock drift from
the integer schedule was 1.637578961322106e-14 s, inside the preregistered bound.
Minimum sampled floor clearance was 1.194219000000004 m.

## Invocation accounting and regression history

| Author invocation | Command | Worlds | Native integration steps | Result |
|---|---|---:|---:|---|
| 1: recorded qualification a1 | pnpm.cmd qualify:robotics-field-core:mujoco-phy01 --write-evidence | 20 | 24,000 | PASS; full raw journal retained |
| 2: fresh focused suite | pnpm.cmd test:robotics-field-core:mujoco | 20 | 24,000 | 21/21 tests PASS |
| 3: fresh exact-source replay | pnpm.cmd qualify:robotics-field-core:mujoco-phy01 --verify-recorded | 20 | 24,000 | PASS; raw/manifest/fixture/budget all equal |
| Total author executions | Three separate registered invocations | 60 | 72,000 | All resources released |

The replay ran at 2026-11-11T16:15:10.042Z--2026-11-11T16:15:12.101Z and reproduced
the exact raw digest above. The CLI used transient label mujoco-phy01-a2, with
evidenceWritten=false; the qualification journal still contains exactly one
measured attempt. The focused-suite and replay receipts are stored separately in
the JSON verification section. The 72,000 total includes both verification
invocations; they are not silently excluded.

The first pnpm.cmd test:robotics invocation failed before full collection because
the new checkout lacked built @asa-lab/module-sdk outputs: 9 files failed import,
8 files and 191 discovered tests passed. Its original log SHA256 is
4f4f292d4b28f05a602196e019942459a60a61a73221ad9f9470fc032b4de03b.
Ordinary pnpm.cmd build then passed for all 28 projects. With those generated
outputs, one regression retry passed all 17 files and 372 tests, log SHA256
ffda0f2c00791f6dd7c5b9f4bef0598531942de110e037d191109b1a8ed3223c.
No product source changed to obtain that result. The regression command does
not include this MuJoCo spec, so both regression invocations added zero MuJoCo
models or steps.

## Local gates and logs

All listed gates passed before source publication. Dependency inventory found
808 installed packages, zero critical/high advisories, 15 moderate and 6 low,
and satisfied the repository's existing advisory and license policy. The initial
JS/CSS bundle graph was 598,096 bytes within its existing 600,000-byte budget.
No thresholds, skipped tests, package integrity values or CI rules were changed.

| Command | Result | Full-log SHA256 |
|---|---|---|
| pnpm.cmd build | PASS | b477d1db1daed1f44daa98639922d899a4bdf344b411cdc41eef5aa870f6fea9 |
| pnpm.cmd license:check | PASS | 4e14908537482e8fa58d4c604b3d1f0b6c89f5e841b560dc597d4a1dfd1898df |
| pnpm.cmd security:dependencies | PASS | 24ecc13577f00208986cb223bc6b67b2a774599ca60313f36f930c71a6275771 |
| pnpm.cmd gate:governance | PASS | fa2507cfb4b0e2694501888b983ee9cb33eaae41e059c5110fd720e1fc1a67ce |
| pnpm.cmd lint | PASS | 2be2dfc685d40ebe10a6eaf187b4e79490c94c9ce846c7f79f3d051172435087 |
| pnpm.cmd typecheck | PASS | b908c3129b873db6e369da785d2eae0f6589c1da14646374ea2325c1782cc43f |
| pnpm.cmd boundaries:check | PASS | c3b252e4c95d12b5a1017e97ee5aa256f0893f795b7f19982fceec55aab2db96 |
| pnpm.cmd format:check | PASS | 4b0892c2f94c3bbfe38577c5ab59fff1a0ad4f91de02849ef1a9c25894e1e878 |
| pnpm.cmd bundle:check | PASS | 3b3bf62b7aeaa4a29ee5c89803e1b4ddfc2f63e59bd1e88fcd7eeaa302de98b9 |

Full command logs and machine-readable receipts remain at
C:/Users/spike/Projects/asa-lab-robotics-field-core-evidence/mujoco-phy01-verification-20261111.
The committed JSON embeds command names, timestamps, exit codes, exact log
hashes and the native invocation budgets. Focused-suite log SHA256 is
3cd196c685f5572870b9191ea7e0c4a06b90ce5f215145a102a86813946e8b62;
exact replay log SHA256 is
666c0fbc865b165d5367152c2aef38fa3dacaa5d844296a0b971de5d2099a526.

The nine preregistered source files are frozen. Only these two evidence reports
were updated after dynamics. New files use LF, and their working-tree and Git
clean-filter bytes agree. The old Rapier checkout, E0 preservation, live services,
database and ports were not modified.

## Commands

- Preregister without creating any model: pnpm.cmd qualify:robotics-field-core:mujoco-phy01 --preregister
- Authorized measured run: pnpm.cmd qualify:robotics-field-core:mujoco-phy01 --write-evidence
- Exact-source replay: pnpm.cmd qualify:robotics-field-core:mujoco-phy01 --verify-recorded
- Pure admission only: pnpm.cmd test:robotics-field-core:mujoco -t "admission without dynamics"
- Complete qualification tests: pnpm.cmd test:robotics-field-core:mujoco

A complete test invocation executes its own fresh twenty-world fixture. It does
not use committed measurements as evidence. The journal retains preregistrations
and every measured attempt; an uncommitted snapshot is identified by base SHA plus
source hashes, never by base SHA alone. Review and required exact-SHA CI remain
pending. Production, live database, ports and previous E0/Rapier evidence are unchanged.
