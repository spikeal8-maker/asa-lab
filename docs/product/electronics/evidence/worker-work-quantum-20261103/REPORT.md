# Supported Worker quantum experiment

TASK: TASK-ELECTRONICS-WORKER-WORK-QUANTUM-001; ISSUE: #539.
STATUS: measured candidate, pending responsiveness evidence, exact-SHA CI and independent review.

## Bounded source

Base: `5b04151e08e82b06d6723283adc44db35cc3f8ac`.
Only product change: pass existing supported `maxEvents: 1024` to the private
Worker advance session. Public default256, supported1–1024 range, total limits,
requested horizons, instructions, physical/quality barriers, fresh per-step model
validation,8ms yield checks and cancellation checks are unchanged. No test changed.
Candidate evaluator SHA256: `f264084cab90e9cb18f9c4e5d1e93676940fd16bfdf8a2d4ce4a78b2110e047f`.

## Primary untouched production measurement

One paired Chromium140.0.7339.186 run:8 frozen actual no-delay/millis requests,
20 counterbalanced passes,320 complete responses,7182.1575ms total (120s cap).
The same canonical production Vite config, aliases, minification and ES Worker
graph were used. Both graphs contain54 source modules and no Electronics or
Contracts dist imports. Transport was routed in Chromium at reserved HTTPS
`.invalid` origins; no listening server, ports, Docker or database.

| Metric,160 responses per variant | Before256 | Candidate1024 | Change |
| --- | ---: | ---: | ---: |
| Sum Worker computeMs | 2403.4ms | 1804.1ms | -24.94% |
| Sum request wall time | 2486.9ms | 1871.2ms | -24.76% |
| Worker artifact bytes | 354015 | 354030 | +15 |

All320 complete responses match the original saved golden responses byte-for-byte
after removing **only `metrics.computeMs`**. State hashes, quality, electrical
values, diagnostics, optical history, events and caller input immutability pass.
Before Worker SHA256: `689ed0889baf00d464aa5442a07a4896cf877e2fc18e7a9328c95aff2a3a0127`.
Candidate Worker SHA256: `61f60acd1fddc4bff4f9d305ecca3fe793cd9a1b4d82f3006b7a346a32c42c04`.
Primary receipt SHA256: `7162f39757bd70a0e81f49654152b1986742b95d92ee7b41e196042f40920f8e`.

Private raw inputs,320 responses, receipt, module manifests and executable recipes
are preserved in `C:/Users/spike/AppData/Local/Temp/asa-worker-quantum-20261103/`.
This is a controlled transport measurement, not native remaining20 acceptance or
exclusive CPU timing. Initial workers are cold; later passes reuse warm workers.
`write:false` avoids publication graph encryption while retaining the actual
production Worker graph. Project session identity follows the original recovered
saved project. No CPU profiler was run.

## Executed checks

- `pnpm agent:preflight --scope electronics-realtime-compute-cause ... --check`:
  SAFE_TO_START before edits; exact corrected report-path plan subsequently PASS,
  control-plane PASS, no blockers/overlaps. Existing owned dirty diff inspected.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-WORKER-WORK-QUANTUM-001`:
 114/114 validator tests and selected-task routing PASS. An accidentally repeated
  baseline-build command then correctly refused its nonempty TEMP output directory;
  the first complete baseline artifact was retained and recovery was SAFE_TO_START.
- `pnpm exec vitest run apps/web/src/electronics/testing/simulation-worker.spec.ts`:
 34/34 PASS, including forced-yield cancellation, fault, ownership and disposal.
- `pnpm exec vitest run` for `engine-timed-api`, `arduino-circuit-scheduler`,
 `arduino-execution-clock`, `mixed-servo-observation`, `led-temporal-observation`,
 `seven-segment-optical`, `arduino-servo-runtime`, `arduino-serial-runtime`,
 `arduino-electrothermal-clock` with `--fileParallelism=false`:9 files,317/317 PASS.
- Prettier source check PASS. Focused ESLint completed with no errors; Nx boundary
  rule was skipped because the local ProjectGraph cache was absent.

No Nx tasks ran and no Nx cache evidence is claimed. Full focused and General CI
are not run by this local author. `pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
could not resolve unbuilt local workspace package declarations (Electronics,
Checkers, ThreeD and others); dependent implicit-any errors follow. This is an
incomplete local build environment, not a typecheck PASS. An initial invocation
used a nonexistent tsconfig.app.json and was corrected without source changes.
Separate TEMP-only step/pause telemetry is pending at this publication checkpoint.
Native original Stop/Reset/input/supersession and large/mixed circuit budgets
remain mandatory before activation. Compute gain closes none of remaining20.

SELF_REVIEW: PASS_WITH_RISK. Scope contains only the supported private quantum and
this report. Larger indivisible steps can delay a cooperative pause; primary parity
does not settle that risk. Independent exact-source/evidence review is required.
Routing/map ownership unchanged. DEPLOYMENT: not requested; DATABASE_ACTIONS: none;
VISIBLE_RESULT/USER_FLOW: unaccepted candidate only; PORTS/DEMO_URLS/SCREENSHOTS:
none. NEXT_ALLOWED_TASK: STOP / CONTROLLER REVIEW after bounded pending evidence.
