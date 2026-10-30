---
task_id: TASK-ELECTRONICS-MIXED-SERVO-OBSERVATION-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Preserve decoded Servo pose in transient circuit observations

Issue [862](https://github.com/spikeal8-maker/asa-lab/issues/862), owner remaining
plan point 4 and the Servo regression requirement. Execution selection and status
belong only in `docs/execution/current.yaml`; this card does not start a repair.

The pacing verification found an electrically valid mixed Arduino, ordinary LED,
raw seven-segment and Servo circuit. Dedicated Servo signal is D3, separate from
display D4/D6/D7/D8/D9/D10/D11/D12, with valid 5V/common ground. Frozen baseline
`9821f0f8` reproduces complete Worker advances at H0/1000/26000 microseconds
byte for byte. At 100000 microseconds the powered decoder has a valid 1008us
pulse and 45-degree angle, but the complete result lacks `servoAngleDegrees`;
the native horn consequently displays its default 90 degrees. Full fixtures,
requests, results, continuations and old replay are retained under
`evidence/simulation-speed-861/combined-*.json.gz` with artifact hashes.

## Cause and bounded source change

The scheduler supplies decoded Servo states correctly.
`solveRcCircuitWithHeldArduino()` passes `servoRuntimeStateById` to
`solveCircuitBase()`. That function reconstructs `solveCircuitStep()` options
without forwarding the Servo map in five branches: initial zero-duration
observation, common normal/full/first-half options, adaptive second half,
post-thermal-failure resampling and the unfinished/error fallback.

The direct DC adapter already preserves the map, explaining the passing separate
Servo fixture. The mixed fixture uses `electrothermal-v1`; do not add Servo to
`electrothermal-events-v2` or redesign profiles to mask this omission.

Forward `options.servoRuntimeStateById` at all five existing option boundaries.
The map is read only for angle projection. Preserve scheduler/decoder behavior,
electrical equations, currents, voltages, integration steps, time, quality and
failure handling. Never substitute the requested `Servo.write()` angle in UI
for the actually decoded signal. No UI workaround, unrelated extraction or
refactoring, cap increase, server, live database or deployment is authorized.

If the forwarding literals must share the three peripheral state-map fields
locally, preserve the exact HC-SR04/Ping references alongside Servo and forward
only those fields. Do not spread all solver options into recursive steps or
extract unrelated old functions to meet the bundle limit.

## Required evidence

Before source edits, publish the full captured failing mixed case and unchanged
legacy oracle. Compare H0/1000/26000/100000 observations to the decoded pose;
exercise at least 45 and 135 degrees. Intentional output differences are limited
to the previously missing pose metadata. Preserve all electrical measurements,
LED/display outputs, quality, state, actions and ordered events.

Cover zero-duration initialization, normal/full/first-half, adaptive second-half,
post-failure resampling and fallback behavior with real supported fixtures or
existing branch tests. Include Servo plus RC and a thermal-failure case. Preserve
JSON continuation, yielding/repartitioning and deterministic repeated results.
Verify old non-Servo profiles and direct DC Servo full bytes unchanged.

Real native desktop/mobile journeys must show the mixed circuit's actual horn
matching the decoded result, with the entire Servo visible, and continued LED
and seven-segment operation. Do not inject an angle or replace solver output.

Check candidate source/bundle caps before the broad gate: the Arduino entry has
only 19 bytes of headroom on the observed baseline. Then freeze, run one uncached
canonical electronics gate, all unchanged caps and a new independent exact-SHA
review. Preserve every previous diagnostic and unique candidate.
