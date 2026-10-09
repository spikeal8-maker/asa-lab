---
task_id: TASK-ELECTRONICS-ARDUINO-BITWISE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme452 E13 and explicit parallel repair instruction6084548550
  - Independent acceptance of selected parallel card guard536 before executable dispatch
acceptance_boundary: slice
review: independent
---

# E13 — execute the published Arduino bit-mask sketches

Existing programme [452](https://github.com/spikeal8-maker/asa-lab/issues/452), bounded repair [537](https://github.com/spikeal8-maker/asa-lab/issues/537). Selection and executable status live only in current.yaml. Primary component `electronics.arduino.runtime`; direct capability consumer `electronics.arduino.capabilities`, mapped in `../components/arduino-peripherals.yaml`. Read those entries, AGENT_GUIDE risk/clock/state/evidence/review sections, registry E13 and sections6–7 (both full owner reference sketches), and their exact Arduino language/type contracts. No full Electronics audit or unrelated runtime rewrite.

## Confirmed BEFORE and intended pupil result

Actual production analyseArduinoProgramSyntax/advanceArduinoRuntime on604ac63d rejects &, |, ^, ~, <<, >>, compound forms and bitRead; both published mask sketches fail. Control && works. Original15-case receipt is preserved outside the repository at C:/Users/spike/.codex/temp/electronics-e01/e13-production-before-604ac63d.json, SHA256b801be1b7b8a47e80e9bfc05be139bb9e4f6981d5d527fbf4465c5caf3a849a7. Do not repeat this BEFORE without a new reason. The exact original pupil sketch is unavailable; the published complete reference sketches are the bounded acceptance input, not evidence for every E14 failure.

Implement the missing operations in the existing parser/value/runtime path using the established UNO16/32 type model, C/Arduino precedence and promotion rules. Preserve short-circuit logic and fail-closed unsupported syntax. Support the bit functions actually required by the published scenarios, with honest capability/reference/completion metadata; mutating functions require a valid lvalue. Compare the supported operations with official Arduino/AVR references, not JavaScript coercion. Invalid shift counts, type/width/sign boundaries and unsupported cases must produce explicit diagnostics, never invented output. No new interpreter, scheduler or arbitrary C++ claim.

## Exact coherent scope

Five justified production paths: `contexts/electronics/domain/arduino-program-runtime.ts`, `arduino-values.ts`, `arduino-capabilities.ts`; `apps/web/src/electronics/arduino-source-language.ts` and `arduino-command-reference.ts` are exhaustive typed consumers of the same capability registry and must agree with actual execution.

Meaningful tests: one domain file `contexts/electronics/testing/arduino-bitwise.spec.ts`, one real-API production browser file `e2e/electronics-arduino-bitwise.spec.ts`. Add that exact browser path to both existing package.json Electronics commands and the existing focused workflow path filter; no new workflow, parallel fixture or skipped gate. Only necessary subsystem source/test ownership updates in arduino-peripherals.yaml and canonical generated capability/coverage output are allowed. Do not edit the shared simulation/interactions files; the other authors own them. Preserve every existing command/test/dependency and report any additional required source boundary before editing it.

## Acceptance

Domain checks: 1,2,4,8,16,32,64,128 masks; all six operators and compound forms; mixed arithmetic/comparison/logical precedence, UNO16/32 signed/unsigned conversion and bit read/write; correct GPIO/Serial values; negative unsupported/invalid forms. Verify yielded/resumed execution against uninterrupted canonical execution without losing variables, clock or pins; deliberate reset remains a reset. No lowered solver accuracy or published incomplete electrical frame.

Real built browser and API: use the existing seed/organization-login harness. Enter each full published sketch, run actual GPIO/LED/Serial progression, observe genuinely committed electrical state and source fingerprint; save full schema/Arduino source, reopen in another same-user context and run again. Capture original raw results and screenshots before assertions; do not replace runtime truth with DOM labels, synthetic delivery, force-click, or an easier rewritten sketch. Keep existing deadlines; split independent scenarios if their existing bounded protocol demands it, retaining all assertions. Physical LED behaviour is unchanged and broad E10/E12/E14 acceptance is not implied.

Author returns one bounded candidate, focused literal NX_SKIP_NX_CACHE=true checks, self-review and exact SHA then STOP. Root verifies actual diff/evidence; ordinary exact General and Electronics gates plus a NEW independent reviewer are required for technical integration. No accepted-result replay or hopeful rerun. Controller continues452 after acceptance. School device/class, original pupil sketch and deployment remain explicitly separate.

## Independent acceptance repair R1

Preserved candidate `89946bb1dd86883ee1374e0edce6e7d25000d205` received [NEW independent REQUEST_CHANGES](../evidence/arduino-bitwise-537-independent-review-89946bb1.md). Only dedicated browser fixture canonical LED defaults. Keep full document equality and all real Worker/GPIO/LED/Serial/save/reopen assertions; production unchanged. Both failed probes stopped before Run and do not prove browser bitwise behavior.

A NEW bounded author implements only this demonstrated test defect, then returns one unpublished exact SHA/self-review and STOP. The controller checks actual source, obtains directed production-browser evidence, required exact-source gates and a NEW independent reviewer. Neither passing partial actions nor author reports accept the complete complaint; owner-original inputs and school evidence remain separately pending. No product reimplementation, timeout increase, subset document comparison, forced interaction, physical weakening or unrelated Portal repair.

## R1 confirmed ready-cadence dependency

Preserve exact1747f8650a45d27d8cdde0a5fbc03fa82a867cd9 and its branch/tree. [NEW independent R1 review](../evidence/arduino-bitwise-537-r1-independent-review-1747f865.md) REQUEST_CHANGES: strict full saved documents2->3 and General37968550047 all4SUCCESS pass, but completed electrical observations lag or skip250ms GPIO states. Serial output already appears; incomplete results stay null. Original raw traces prove a common cadence/catchup dependency, not an observer loss. Controller separately selects [539 bounded ready-observation repair](TASK-ELECTRONICS-ARDUINO-READY-CADENCE-001.md) on canonical main. Do not change either full original programme, readiness assertions, physics or timeout. After accepted dependency, safely converge this preserved candidate and obtain real full execution/save/reopen, ordinary exact gates and NEW independent review. School frequency remains NOT_PROVEN; no E13/E14 acceptance or installation action.
