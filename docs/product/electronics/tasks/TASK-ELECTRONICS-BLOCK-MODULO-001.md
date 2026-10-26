---
task_id: TASK-ELECTRONICS-BLOCK-MODULO-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Portable numeric modulo for Blockly variables: bounded candidate first

Consolidated4/16 and prerequisite13counter, issue789, parent703/452. Real Workspace
variable math fails because generated variables are float but modulo emits percent.
BEFORE must reproduce original generated source and runtime rejection. Do not
turn all variables into int or allow invalid C++ floating percent in interpreter.

Propose/implement a narrow exact-known generated adapter: integral inputs preserve
existing percent/usual conversions/fulluint32, floating path Uno double32 fmod
remainder with truncation toward zero (not Euclidean Scratch modulo). Zero and
non-finite fail closed. Arguments evaluate once and pending/RNG/increment replay
remain correct. Preserve old valid integer/text behavior and fractional variables.

A minimal portable C++11 overload/SFINAE helper is a proposal, not compile proof.
Only modulo blocks emit it, exact helper admission only, no arbitrary template/
function execution; handle generated-name collision. Shared NEW helper constant/
entry allowed for correctness if genuinely used by generator/runtime; do NOT move
old functions/strings or import code artificially merely to shift measured cost.
No broad casts/fmod/API language expansion beyond required adapter semantics.

Scope generator, directly related runtime/capability/numeric helper, optional NEW
exact helper module/publicentry and minimal required package/TS alias, existing
numeric-block/correctness tests and loops native mode/evidence. No old code moves,
refactoring, unrelated tooltip shortening/cleanup, new dependency/workflow without
need, server/Docker/DB/ports/assets or foreign edits. Keep textual floating percent
invalid. Test actual Workspace variable add/mod, fractions/negative/zero, same/mixed
AVR integral types and uint32above2^24, collision, pendingonce, oldbyteoracles.

Current ArduinoCodePanel1999997/2000000 leaves ONLY3bytes. This is CANDIDATE-FIRST:
targeted proof then ONE actual Web build/cap measure before any broad gate. If
budget FAIL, preserve candidate/proof and STOP this slice; no cap raise, adjacent
cleanup or minification chase. Programme continues independent work. Real Arduino
AVR GNU++11 compilation proof required before final acceptance; if toolchain not
available report NOT_RUN and preserve, do not disguise host-only proof as AVR.
No full focused gate before budget-safe candidate exists. Author must coordinate
CPU with independent751tooltip writer; source paths/worktrees separate. Controller
alone owns currentyaml. One candidate then STOP; independent review before closure.
