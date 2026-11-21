---
task_id: TASK-ELECTRONICS-SEEDED-RANDOM-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Deterministic Arduino random/randomSeed

Consolidated18. Planning until canonical selection. Implement actual missing
runtime support and activate existing random Blockly reporter. No Math.random,
wall time or global shared RNG; explicit per-board serialized continuation state.

Pin the supported semantics to
[ArduinoCore-avr1.8.6 WMath.cpp](https://github.com/arduino/ArduinoCore-avr/blob/1.8.6/cores/arduino/WMath.cpp)
and [avr-libc2.0.0 random.c](https://github.com/avrdudes/avr-libc/blob/avr-libc-2_0_0-release/libc/stdlib/random.c).
This is named deterministic compatibility, not a complete AVR/toolchain claim.
Default state1, exact signed32bit recurrence including high-bit unsigned seeds.
randomSeed(unsignedlong) ignores0. Bound0 and min>=max return without drawing;
ordinary modulo range mapping. Support Arduino one/two argument overloads plus
raw libc zero-argument random() exposed by the pinned standard include API.
randomSeed is a one-argument void statement, not a numeric expression.
Use current long/unsignedlong conversions and existing overflow fail-closed
policy; no silent new overflow semantics.

Optional state must leave untouched old nonrandom JSON/state/fingerprints and
compiled streams byte-identical. Preserve zero RNG state (do not default it via
truthiness), every legacy/clocked/owned evaluation path and Worker/direct clone.
Validation and short-circuit paths must not draw. Reset/incompatible program
starts default; continuation and same program retain sequence; boards isolated.
Unknown/malformed state rejected under existing state-validation policy.

Expected scope existing runtime/value interfaces/capabilities and directly
related command help, plus a small new Arduino-specific PRNG helper module if
needed to keep existing runtime file growth bound. Move no old functions; this
is new feature code only. No generic PRNG framework/dependencies or scheduler/
thermal/protocol changes. Update old unsupported random tests and real executable
help example. Existing Blockly range is inclusive; generated max+1 must remain
compatible with upper-exclusive text overload and retain expression evaluation
count. Do not accidentally draw twice or evaluate disconnected reporters.
Reuse the accepted optional expression replay journal for random effects plus
blocking calls, including new random-only instructions without increments:
draw/reseed/Serial/time operands execute once across waits and JSON. Old valid
nonrandom programs still omit both new optional fields byte-for-byte.

Prove pinned vectors, seed/reseed0/highbit, bounds, negative arguments, typed
conversion errors, draw counts, expression side effects, short circuit and
per-board isolation; JSON budget1/2/7, reset/source edits and old-state resume.
Actual Blockly-generated source and textual seeded sketches through real
Worker/client/controller Serial/GPIO with Stop/Run/Reset and source edits at
desktop/mobile. New independent finalSHA review; primary source vectors separate
from actual AVR hardware qualification.

Fresh gate literalNX_SKIP_NX_CACHE=true types/build fixed222000/2000000caps;
no capraise refactor deferredcleanup/682, foreign changes, server Docker DB or
assets/dependency/workflow edits. One bounded candidate then STOP.
