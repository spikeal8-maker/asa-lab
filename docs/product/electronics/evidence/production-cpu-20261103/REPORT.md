# Native production Worker CPU attribution — 3 November 2026

Selected task: `TASK-ELECTRONICS-PRODUCTION-CPU-001`, source
`f1a15cd42269349181919c832dec58ec0f59da8b`. Read-only diagnosis; no product,
clock, physics, test, workflow or limit edits. **Zero timing failures closed.**

## Exact native execution

One Chromium140.0.7339.186 native Worker CPU profile collected through browser
CDP `Target.attachToTarget` (nonflattened), `Target.sendMessageToTarget` and
`Profiler.enable/setSamplingInterval/start/stop`. Attachment succeeded on the
first attempt. Sampling interval configured100µs; no second profile, Node/IIFE
fallback, source instrumentation, monkeypatch, timer replacement or fake data.

Reused the successful unmodified BEFORE Vite production ES Worker from the
preceding experiment, original build source94deef205, at the same checkout path.
All54 loaded repository module hashes, config/lock/Worker/runtime source hashes
and every emitted artifact hash match current sourcef1a15cd4. Worker354015 bytes,
SHA256 `689ed0889baf00d464aa5442a07a4896cf877e2fc18e7a9328c95aff2a3a0127`.
The earlier production config used configLoader:runner, default esbuild minify,
ES Worker, TEMP app transport and write:false (publication encryption/write only).
No rebuild, app server/listening port, Docker, live DB or external service.

20 passes ×8 unchanged full original no-delay/millis requests = **160 responses**.
Measurement3.768s; native profile weighted span3789.909ms,6826 samples/1418 nodes.
All160 complete responses match original goldens, excluding only top-level
`metrics.computeMs`; all160 complete saved-state hashes and caller input
immutability checks pass. Original projectSessionId remains reconstructed from
saved project id. The native app observer, startup, visible frame timing and
all20 original failures are not qualified by this TEMP transport.

## Sampled cost

Weights use native profile timeDeltas, not an assumed100µs per sample. Observed
sample delta min9µs, median544µs, max19766µs: platform/profiler scheduling differs
from the requested interval. First pass is cold; later passes share the Worker
and compiler caches. Profiler/JIT/host overhead is present; elapsed or compute
measurements under this profiler are not performance acceptance.

| Function group, exact source range | Exclusive ms | Inclusive ms |
|---|---:|---:|
| arduino-program-runtime.ts:3342–3995 `advanceRuntime` | 290.253 | 716.449 |
| models/device-model.ts:119–141 captured-definition validator | 228.049 | 228.049 |
| arduino-circuit-scheduler.ts:749–1961 `advanceArduinoCircuitClock` | 178.091 | 1886.969 |
| arduino-program-runtime.ts:1517–1555 `evaluateSyntax` | 89.271 | 182.359 |
| solver.ts:2703–5084 `solveCircuitStep` | 60.052 | 255.407 |

Function groups include exact source ranges, so unrelated anonymous callbacks
are not merged by name. Exclusive weights sum only sampled self time. Inclusive
weights union the function's sampled ancestry, counting recursive frames once
per sample; rows overlap and **must not be added**.

- Repository-mapped self:2333.984ms (61.58% of sampled span).
- Idle:1343.153ms (35.44%). This includes gaps while the controller verifies/writes
  full goldens and requests, protocol round trips and cooperative waits; it is
  not evidence that a host timer is the native application's bottleneck.
- GC:75.835ms (2.00%); native/VM without script URL:36.734ms (0.97%).
- Unmapped script self:0.203ms (0.0054%).

Hidden production maps resolve function-entry callFrame columns to embedded
original source. Production minification means positionTicks contain generated
line numbers, not an exact original inner statement. Inlined work can be charged
to caller locations. These weights do **not** prove that any particular line,
map allocation or descriptor read within a function caused that entire cost.

## One separately selectable follow-up

The most concrete non-interpreter cost is the captured-definition validator:
228.049ms,9.77% of repository-mapped self time. Retained stacks reach it through
`originalOwnedProducers` → owner `check` → clock-request `step`; the union cost of
`originalOwnedProducers` including descendants is251.420ms. Source confirms the
check already runs once per clock-request step, not at every reused solve.
Therefore a proposed "validate once per step" repair would duplicate existing code.

Select a **guarded synchronous-batch design** only if the controller wants to
address this measured cost: preserve fresh validation at every public step and
actual yield/resume; consider a private owned batch capability solely across
several steps inside one synchronous Worker window. It requires proof of no
reachable caller callback/getter/model mutation between those internal steps,
full fallback on tampering, and exact partition/retained-state/descriptor tests.
Never cache across public steps or yields, freeze/change exported models,
disable checks, coalesce events or change physical/instruction budgets.
This is a design candidate, not implementation authority or a measured speedup;
even removing this cost alone would not prove all20 timing failures fixed.

## Preserved private evidence

Raw profile, production hidden maps, all160 full response files, exact inputs,
module/artifact identities and scripts remain under
`C:/Users/spike/AppData/Local/Temp/asa-production-cpu-20261103/` and the retained
BEFORE build `asa-event-copy-20261103/before/`. No raw source maps/profile are
published to the repository.

- `profile.mjs`: 8132 bytes, SHA256 `f865e43d1885d925f284817fead9303c34da5a29dfd3ca2f7e5b0af958c4919e`.
- `analyse.mjs`: 5967 bytes, SHA256 `8477142a05868eac087ea90b43bb96c07f5d3147fd93639ebfff8c155cfc6fe6`.
- `reused-build.json`: 25419 bytes, SHA256 `3e219d32f0d73c4351913eca07f173d65b150e3e22394cdcdba1edd55e47a11d`.
- `inputs.json`: 72999 bytes, SHA256 `9566f01fcae9849a6e3ecddbef850baac80819e8158ffc4402475018265e4476`.
- `receipt.json`: 74001 bytes, SHA256 `23d3f4767ec62796fd5ae98904ffeeb66e69d35ee7fc3c9dda8915bd81cd52e2`.
- `production.cpuprofile`: 418102 bytes, SHA256 `9c987a220b12395495698dc19253621dda7cc95a7f522f2e353eced441315a37`.
- `mapped-nodes.json`: 990211 bytes, SHA256 `3a93206cec6e629ec47393c944fca0a7adc9ca6248510ff01b54b29487539b2e`.
- `summary.json`: 121524 bytes, SHA256 `047d083a60d165b933b84c4948f7bebf4e405b8392476f945929d8b3aa37d6f1`.

Initial exact-path preflight SAFE_TO_START; selected routing validation PASS.
Analysis used installed source-map0.6.1 and TypeScript; an initial resolver miss
was corrected to the existing package path, with no install or new measurement.
No production gate, full CI, native timing rerun, deployment or owner acceptance.
Author STOP; independent source/evidence review precedes any product selection.
