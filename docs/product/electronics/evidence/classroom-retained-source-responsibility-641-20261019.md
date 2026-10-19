# Classroom retained-source responsibility review — Issue641

## Record boundary and current status

This is the bounded responsibility and baseline proposal for
TASK-ELECTRONICS-CLASSROOM-HYGIENE-001, a maintenance dependency of the separately
selected D13 task in Issue638. It implements sections 6 and 8 of the
[Engineering Hygiene Contract](../contracts/ENGINEERING_HYGIENE_CONTRACT.md).
The maintenance selection commit and the final composed candidate commit/tree
remain **pending controller receipts** in this draft. This record is not a
maintenance acceptance or D13 product acceptance.

The source measurements below are actual formatted candidate measurements
reported in `l-applied-result.json` and checked as described below. The review
snapshot was prepared at 2026-10-19T12:05:34Z. The last supplied canonical main
observation is 4c4bbed5c575122fdaa366a033e72f63ef0e96d6; the controller must attach
the fresh selection/main observation and final source commit before acceptance.

No baseline edit is applied under this proposal until the maintenance selection
is published. The baseline must accompany its matching source when the complete
D13 result is permitted to integrate. It must not be published against the older
main source merely because this responsibility review is favourable.

## Source identity and preserved composition

The retained source is R27 base 1669d7b2f1f630b3c4da045147500a343e139ca9,
preserving R26 cdad26c361cb4cf8ed2d095fae3c087b5d2abb2d. The selected 46-path
import manifest has SHA256
`fec04404e42cc1f8c502b92b69accd5a418567ac42c9e6462f039cff11b988bb`.
Its groups contain 22 production paths, 16 unit regressions, four browser
regressions and four technical documentation/mapping/generated paths. Each
selected R27 source blob equals its retained R26 blob, and the compared main
blobs equal the merge-base blobs for those paths. The controller separately
verified all 46 restored working files using Git object hashes.

This manifest describes the retained import. The new D13 amendments and additive
test registration are separately identified; it is not the entire final diff.
In particular, the new L amendment also touches WorkbenchStage and
ProductionComponentVisual outside the original 22 changed production paths.

| Reviewed production source | Actual bytes | SHA256 | Git blob derived from the same bytes |
|---|---:|---|---|
| contexts/electronics/domain/arduino-circuit-scheduler.ts | 71,720 | `a22c550f052d7861d2a3d028c4685ac0868bfb8555fede28508357f34113239b` | `c20f29866201c5681741177623a847d57a0ec737` |
| contexts/electronics/domain/arduino-program-runtime.ts | 106,392 | `8efa49310c6b4b78a0d0011fabb50fb6c532136da7bf1b4931ce9234dceb7bbb` | `4bdc532fc7fa858249a1afcb117e9acea37079f7` |

The runtime bytes independently match the exact retained R27 source. The final
scheduler measurement independently matches the reviewed composed source after
removing one redundant final LF; no token changes are involved. Both Git blob
identities above were computed with Git's blob object framing from these exact
bytes. They remain subject to confirmation in the final committed candidate.

The original R27 repair patch is
`a9e22aa670f33d98456d711a781aa1355b678ac0fb291f0c194fbbf59e5e5e7e`.
The exact composed L patch is
`f303bf161a1dffbcc78d62546c6247a83e7bffdd835921a4efd99e9ff6ebf6e7`,
with manifest
`52f2c4be7b8c1d75575a3412e2a1463bed8de823baac95061a0cce59f9e8b736`.
Independent local `git apply --check`, application and output hashing proved
that all nine L files equal the previously reviewed three-patch composition
`83df411f34db673877d7840fce1436f2e2b5bb0d9844078854e6d67b2ff24d88`.
Subsequent formatter-only measurements are kept separate from those original
patch/file hashes. The controller must preserve the final formatted-file manifest.

Canonical Issue546 history retains the R26 runtime source review
`c22c2b329d5c4124780b92c2a95161651861b28d848271c21ad2178c5cfe632e`,
quality source review
`6f89188050ea097231137d2711d6b7e4fdfcb9840876b1464fe1e4eceec5b792`,
and combined responsibility review
`9bf76418ecb7cdff724098657c7c5df10faefbe9fae03b1a84ae6452e391c835`.
These are preserved historical source/responsibility approvals. Their labels,
associated failures and limits remain intact. This bounded review reuses that
provenance and reviews the current responsibility boundaries and D13 differences;
it does not replay the historical 27-stage audit or convert old FAIL into PASS.

## Growth and baseline decisions

| Source | Previous review reference | Actual bytes | Growth from that review | Decision |
|---|---:|---:|---:|---|
| Scheduler | 56,913 bytes in retained R26 baseline; entry absent from observed main baseline | 71,720 | 26.0169% | Add/update the reviewed entry at 71,720; retain decomposition-candidate |
| Runtime | 84,928 bytes in observed main and retained baselines | 106,392 | 25.2732% | Update reviewed_bytes to 106,392; retain decomposition-candidate |
| Workbench controller | 103,385 | 115,584 | 11.80% approximately | Existing review limit remains; no baseline edit |
| ProductionComponentVisual | 72,432 | 72,889 | 0.63% approximately | Existing review limit remains; no baseline edit |
| WorkbenchStage | 54,879 | 62,984 | 14.77% approximately | Existing review limit remains; no baseline edit |
| Retained solver | 179,752 | 211,087 in unchanged retained source | 17.43% approximately | Existing review limit remains; no baseline edit |

The new D13 scheduler source is 360 bytes larger than the retained R26 scheduler
source of 71,360 bytes. The runtime is unchanged from the retained 106,392-byte
source. The mandatory review is principally about the accumulated retained
growth and its present responsibility boundary, not a new runtime rewrite.

The proposed baseline has SHA256
`d2a0f434c2733f20a43a05b555ca6b1f84731eb4eeb4aa14831bf60e3300601d`.
It changes only the scheduler/runtime entries and links their rationale to this
record. Both the parsed comparison and an inverse textual reconstruction proved
that every other main baseline entry, policy field, lifecycle class, retirement
condition, documentation hotspot and protected/historical classification is
unchanged. No margin above actual source bytes is added.

## Scheduler responsibility assessment

`createArduinoCircuitClockRequest` and `advanceArduinoCircuitClock` coordinate one
canonical coupled-clock transition. That transition validates imported state,
selects real event and electrical boundaries, advances boards, solves the actual
circuit and publishes a complete observation or fault. Moving individual steps
across an arbitrary new helper boundary would risk changing their order or
allowing a partially accepted state to escape.

The retained request-owned preparation belongs at this orchestration boundary:

- `ordinaryOwnedGraph`, `originalOwnedProducers`, `strictOwnedDocument` and the
  source/continuation guards constrain when retained preparation may be reused.
  The canonical loaded-program and continuation checks still validate the
  imported runtime before an owned runtime performs work.
- `ordinaryOwnedContinuation` now admits a nonempty, already executed event
  history. It does not erase, reinterpret or replay that history. The independent
  runtime schema, counters, sequence order, timestamps, event kinds and finite
  voltage checks remain; malformed continuations take the generic fault path.
- Electrical barriers, pre-event physical integration, simultaneous board state
  changes, quality evaluation and fault/rollback publication retain their order.
  Reusing owned preparation does not grant permission to skip physical work or
  change numerical tolerances.
- The D13 amendment adds eligible Arduino component IDs to the existing temporal
  observer construction. Collection itself stays in led-temporal-observation.ts;
  browser playback stays in led-temporal-presentation.ts. No presentation timer,
  sketch parser or renderer is moved into scheduler semantics.

The source remains a decomposition candidate because orchestration, validation
and request lifetime management are substantial coupled responsibilities. A
future extraction should follow a complete boundary, with exact full-return and
event-order parity, multi-board/input/fault behaviour, physical quality and owned
producer/fallback invariants proved together. A size-only split would not resolve
this debt and is outside the current selection.

## Runtime responsibility assessment

The retained runtime contains lexical preparation, typed expression/statement
execution, compilation caching, typed scopes, resumable programme counters,
peripheral dispatch, diagnostics and the serialized runtime state. These pieces
share one programme/state contract. Its generic and request-owned execution
facades must preserve that contract across pauses, imports and new requests.

`runtimeStateIsValid` and `arduinoRuntimeStateMatchesProgram` bind imported state
to valid clocks, counters, ordered bounded history, typed scopes and the loaded
programme. `createOwnedClockedArduinoRuntime` supplies a constrained internal
workspace for eligible compiled instructions; `advanceRuntime` remains the
execution boundary. The classroom patch changes neither this file nor the
instruction cost, event cap, compilation limits or diagnostic policy.

The cache is explicitly bounded by its existing entry and byte policies. Owned
workspace reuse is scoped to a request's proven programme and producers; it is
not persistent electrical or presentation state. The retained public
`advanceArduinoRuntime` still explicitly selects legacy-ms-v1, while
`advanceClockedArduinoRuntime` selects instruction-us-v1. This review grants no
new Arduino capability or retirement of either public path.

Future decomposition can separate an immutable prepared-program interface from
validated mutable execution/import state only with compiler/diagnostic,
typed-scope, instruction-timing, peripheral, reset and serialized-state parity.
The current coherent source remains classified decomposition-candidate. The
previous parsing/scope/peripheral responsibility record in
`evidence/release-baseline-hygiene.md` remains referenced by the new rationale.

## Lifecycle, routing and remaining debt

| Required evidence field | Bounded finding and preserved obligation |
|---|---|
| Legacy runtime bridge | Preserve the active-legacy-bridge entry and its exact retirement condition. The retained public legacy entry point still exists and explicitly selects legacy-ms-v1. Existing baseline production callers in arduino-model.ts and solver.ts remain part of the retained composition; no caller migration or zero-reference finding is claimed. |
| live-simulation compatibility shim | Preserve its classification and exact condition requiring migration/retirement of active reference-test and benchmark callers before deletion. This file is outside the retained changed-source list and no deletion is selected. |
| Routes | Retained engine-worker-clock.yaml maps the existing runtime, solver, Worker and temporal boundaries. Additive D13 browser/source mapping is coordinated by the D13 controller. Final orphan/stale/missing-symbol validation remains an acceptance requirement; this record does not claim an unexecuted validator PASS. |
| Generated artifacts | Retain component-coverage.json and its generator tools/generate-electronics-component-coverage.mjs. Regenerate through the owning D13 mapping change and require actual stale-output validation. This maintenance task does not hand-edit coverage counters. |
| Historical and protected material | The import manifest excludes wholesale task/evidence/report and owner-supplied/owner-audit replacement. All corresponding baseline classes remain byte-identical. Historical failures, source approvals and protected art are preserved. |
| Removals | This task selects no source, export, route, asset or historical deletion. Its proposed baseline diff removes no other entry. Final composed-diff verification must retain this condition. |
| Residual source debt | Scheduler/runtime remain decomposition-candidate. Existing solver E-OPT-4, controller E-OPT-7/maintenance, stage/visual boundary and legacy convergence obligations remain; none is discharged by a larger reviewed_bytes value. |
| Checkpoint accounting | This is a bounded growth review with production_source_changed=false and full_hygiene_checkpoint=false. It does not reset the accepted production-slice ledger or clear another due checkpoint. |

## Available verification and remaining acceptance work

The independent R27 source review approved the passive-history change and the
meaningful subsequent-request/cap/malformed regressions. The controller reported
the intended red-before outcome (three admission failures and one malformed-state
pass) followed by 82/82 tests in engine-timed-api.spec.ts after the repair. Attach
the original execution receipts to the final candidate evidence.

The independent L UI review covered synchronous maps at a shared cursor, receipt
provenance, held-time recovery, standalone/open/reversed external circuits and
generation/Reset cleanup. Local execution of the actual presenter exercised more
than 360 checkpoints; the actual production selector passed eight canonical and
legacy identity/state checks. These are source checks, not browser acceptance.

The first actual formatted temporal run was 95 PASS / 4 FAIL, retained in
`l-applied-result.json`. The four new tests incorrectly compared ideal GPIO 5 V
with the solved 4.99999999995 V. Test-only patch
`a0ad8d9d00b50be0498f2c30b48bd40f7e7b58865639d36a919f2b9b3394040d`
now solves the actual circuit independently from zero at every exact GPIO event
horizon, with temporal collection disabled, and requires exact solved-voltage
equality plus HIGH/LOW consistency. It introduces no epsilon or production
change. Independent test-source review approved this correction; the controller
subsequently reported 99/99 actual temporal tests PASS. Preserve the predecessor
FAIL receipt and attach the successful rerun's original receipt separately.

Before maintenance acceptance, record the final selection and source commit/tree,
the final baseline/evidence diff review by someone other than its author, and
actual results of:

- `node tools/validate-electronics-agent-docs.mjs --task TASK-ELECTRONICS-CLASSROOM-HYGIENE-001`
- `pnpm validate:electronics-agent-docs`
- `pnpm gate:governance`

Fresh execution uses literal NX_SKIP_NX_CACHE=true. Preserve command exits and CI
identities. Until those receipts are attached, these final checks are pending.
Any formatting or composition change must retain the exact reviewed production
bytes or provide the updated source identity and bounded review.

Maintenance acceptance resolves only the two reviewed growth entries. D13 still
requires its complete real-browser delay/order/physical/Reset/Save/reopen evidence,
independent product review and all required focused, benchmark, browser and
repository gates. Its acceptance blocker, Issue546's full-realtime restrictions,
and the separate main/deployment distinction remain active. No working-site,
database, Docker, network or protected-data action is authorized by this record.
