# Seeded random logical compatibility evidence

Bounded source candidate based on `9c81bc643cafc34f8cc52f11572f49f43bc4f159`.
No deployment, database access or owner acceptance is claimed.

The behavior is pinned to [ArduinoCore-avr 1.8.6 WMath.cpp](https://github.com/arduino/ArduinoCore-avr/blob/1.8.6/cores/arduino/WMath.cpp)
and [avr-libc 2.0.0 random.c](https://github.com/avrdudes/avr-libc/blob/avr-libc-2_0_0-release/libc/stdlib/random.c).
This is deterministic logical compatibility, not AVR hardware, timing or full
C++ toolchain qualification. The adapted recurrence retains the Berkeley license
in source and the built simulation-core/Worker assets.

Default raw vector: `16807,282475249,1622650073,984943658,1144108930`.
Default `random(100)` vector: `7,49,73,58,30`. Seed 2147483647 yields zero;
the next draw uses the libc zero-state substitution and yields 520932930.
Unsigned high-bit seeds first convert to signed 32-bit recurrence input.
Zero reseeding is ignored. Zero bound and min >= max do not draw. Bounds use
the existing long conversions, modulo and signed-overflow failure policy.
`randomSeed` is a void statement; raw zero-argument and bounded one/two-argument
`random` return long values.

The optional per-board `randomState` remains absent until used. The unchanged
pre-feature complete nonrandom result/state/event stream and JSON-resume hash is
`67f230cb0174dc9b275f44b27b850cc113572b3dc69c7582329ed45688b9ebd5`.
It was captured before runtime edits. Existing increment and scheduler byte
goldens also pass. Random instructions reuse the existing expression replay
journal around blocking calls, including cached Serial RX, time and PRNG values.

Validation on the final executable content:

- `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: PASS. Domain 52 files /
  1213 tests; editor 61 files / 1079 tests. Nx executed 71 fresh tasks across
  module-sdk build (1), typecheck (43) and full build (27); all three summaries
  report `Cache: Skipped (--skip-nx-cache)`.
- `pnpm bundle:check` against that new build: PASS. Electronics editor
  221950/222000 bytes; Arduino editor 1999967/2000000 bytes. Caps unchanged.
- `node tools/validate-electronics-agent-docs.mjs --task TASK-ELECTRONICS-SEEDED-RANDOM-001`:
  PASS. Runtime file 127658 bytes remains below the existing growth threshold.
- `node apps/web/src/electronics/testing/arduino-loops.browser.mjs`: PASS at
  1440 and 390 pixels. Actual Chromium Worker/client/controller paths execute
  text seeded code and source produced by registered ScratchBlocks. The random
  reporter has supported status and normal green `#40bf4a`; detached reporters
  add no draws. Inclusive block bounds emit exclusive text max + 1. Worker and
  direct complete state match through JSON horizons; budget-one runtime state
  also matches. Native controller ports prove Stop/Run/Reset and source edit
  invalidation. Two boards retain independent seeds and states.

Local generated receipts and screenshots: `test-results/arduino-loops/`;
fresh gate log: `test-results/seeded-random-gate.log`. The native fixture fulfills
its browser routes without a listening server, Docker, DB or SaveCAS calls.
This scoped fixture does not claim the deployed full portal journey.

Self-review: requested random support only; no generic framework, moved old
functions, dependency/cap changes or unrelated feature implementation. Existing
unsupported random assertions were replaced with executable random tests;
unsupported switch/goto/string behavior remains in the full passing suite.
Independent final-SHA review remains required before integration.
