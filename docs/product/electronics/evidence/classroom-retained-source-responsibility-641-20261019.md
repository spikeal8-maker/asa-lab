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

## R3 repair 2: native resource and host responsibility review

This appended review implements the further bounded UI selection in
01d431d2fbdd078987546a728f24785f75bd9d6f. It preserves every earlier paragraph,
source review, failure and matching-source validation above. The controller
observed main 47524e08f14a1c7c6c11b213063103e652a32c3d again at
2026-10-19T17:02:01Z; the selected candidate HEAD was 01d431d2, with nine known
staged product/test paths and no overlapping target edits in 67 worktrees.
The exact staged product tree after formatting is
3e568227484ef0738f6447155f95243556bc7cae. It is a source identity for this review,
not an integrated commit or a browser acceptance claim.

| Reviewed source | Previous reviewed bytes | Actual formatted bytes | SHA256 | Git blob |
|---|---:|---:|---|---|
| ProductionComponentVisual.tsx | 72,432 | 89,698 | `e3313f0572fb890ee157f4204e956c1888f04d2294fbb5800c8c83537121125a` | `9f6f58825947d495da172d8d6f04d3cdd6993403` |
| use-electronics-workbench.ts | 103,385 | 126,864 | `dedc04bd6cd93581e7fa053295cb4c85c74fceab5edc9b9bdc813be3ce63c4fd` | `940b44c37934ea9931a064fa5a65f6ecb467a6f2` |
| WorkbenchStage.tsx | 54,879 | 63,252 | `581f0c57b74d932a3dca15f042f0895b2030aa1be8696f7787a80cbb7ef3cdab` | `686af0075aa3cd61e031689a50f91ce10075c3f8` |

The renderer and host exceed their unchanged 20% growth boundaries of 86,918.4
and 124,062 bytes respectively. Update only their reviewed_bytes to the exact
formatted counts in this table and their evidenced rationales. WorkbenchStage
remains below 65,854.8 bytes, so its complete baseline entry is unchanged. The
previous scheduler/runtime entries and every other baseline entry remain exact.
No allowance above the measured size is added.

### Responsibility and residual debt

The renderer owns the actual native image elements and their resource lifetime.
The ordinary LED implementation preserves loaded OFF, current active and pending
resources within three resident nodes. An exact element/href/revision lease
cannot be manufactured from a matching colour or a later load. The prior active
lease is protected until the parent accepts the new joint state or rejects it;
a rejected new state restores that same prior loaded element. A protected slot
cannot be reused for a fourth resource. Shared asset recovery and the existing
non-LED family rendering remain at their original boundaries. No owner artwork
is replaced, generated or redrawn.

The host owns the atomic publication of the simulated optical vector. It passes
immutable preparation to the renderer, admits only current ready leases, commits
a joint state, and acknowledges the actual layout. Explicit rollback state is
cleared by a cleanup commit after acknowledgement, rather than waiting for an
unrelated future update. If a rejected state also has invalid prior leases, or
the presenter clears its accepted frame, the entire optical vector is cleared;
ordinary waiting for two RAFs preserves a valid prior frame. Source/generation,
Stop and Reset cancellation remain one host lifecycle boundary. Electrical
collection and programme execution stay in the domain; the presentation clock
stays in led-temporal-presentation.ts. No independent GPIO animation is added.

Keeping these coherent native-lifetime and joint-publication responsibilities
avoids splitting an atomic protocol solely to reduce file size. Both sources
remain decomposition-candidate. Future extraction must preserve exact resource
identity, cancellation/rollback, whole-vector publication, physical provenance,
shared cursor and native browser evidence together. The pre-existing shared
loading, family dispatch, instrument/selection and controller responsibility debt
remains. This review selects no new helper layer, source removal or retirement.

### Exact independent source and formatting evidence

The independent repair-2 source verdict is
APPROVE_BOUNDED_SOURCE_COMPOSITION_ONLY in
native-phase-r3-r2-independent-source-review.json, SHA256
`49d5423f862da01a229e9dc37e6159249285b562b2b427ff525b6c52e4a6e216`.
Its separate placement receipt is
native-phase-r3-r2-ui-responsibility-independent-review.json, SHA256
`d2aeded73072f2380a172752fdd920703b3c949037da20a473b0670d14a396ce`.
Both full patches to the retained candidate and deltas to original R3 produced
the same six authored files. Old 28 native and 42 phase test-call ASTs are
preserved. The earlier R3 rejection, SHA256
`fa85ad411352ef231a76057df8ca467d026ae60c0d246c2738aea14631d7cc68`,
remains the verdict on that earlier source. The new source closes its reproduced
rollback defect and the separate stale-vector cleanup defect; it does not rewrite
the original result.

The formatter-only patch has SHA256
`89925616d14db0be251396dca9a37d45db0d1614fce685942179701b525a3b2e`.
Actual TypeScript 5.9.3 lowering and complete semantic-child AST comparison of
all nine formatted files passed; only positions, trivia and redundant
parentheses are excluded. Identifiers, literal/template values and template raw
text are included. The comparison receipt v3-r2-format-semantic.json has SHA256
`e4e19c08dd67733841d25974e4db92f6f293bebcc51d5f3529b6593ae1d27a73`;
its complete script has SHA256
`beda5c735c82aff019c8eba20b823529586dace1d1267b386cc1b51626c6876f`.
Emitted JavaScript bytes differ in five files because of formatting; no claim
of emitted-byte identity is made. An independently assembled local mirror also
matches every measured final SHA256, byte count and Git blob. Final independent
format/baseline diff approval is recorded by its separate matching receipt.

### Actual verification and remaining product boundary

The actual formatted source receipt v3-r2-product-actual.json has SHA256
`c79cbd1c37bf7e3df563ab0af6405bd014f76d86b9834732e55b952335377dbe`.
At 2026-10-19T16:52:07Z the complete four targeted Vitest suites passed 238/238:
82 engine, 96 presenter, 37 asset recovery and 23 temporal observation cases.
The official web:typecheck also passed all six freshly executed Nx tasks with
literal NX_SKIP_NX_CACHE=true. Original logs are retained as
v3-r2-product-complete-targeted-vitest.log, SHA256
`a78d1bdaefe3cdd47b53b8e3b030a1bd22277fca03aa9fd352897b5db9446e2c`,
and v3-r2-product-web-typecheck.log, SHA256
`008d5811f2f0f6b1601bbe71c5185645b5fada84ffcd759e53b74e9b5989ee91`.
These source checks do not replace the actual browser or repository gates.

This baseline/evidence amendment changes no source, test, route, generator,
protected asset, legacy bridge, retirement condition or policy. All previous
lifecycle and residual-debt obligations in this record remain. It is still a
bounded growth review with production_source_changed=false and
full_hygiene_checkpoint=false; the accepted production-slice ledger is not reset.

The exact composed baseline/source must pass the targeted hygiene validator,
full Electronics routing and Governance, with independent final diff review.
Attach those original receipts to the final candidate identity. D13 still
requires full focused, benchmark, complete classroom and General gates, the
separate actual strict qualification, and new independent native-browser review.
The raw-wall 50 ms publication bound, physical current/polarity/resistor checks,
full order, duty and lifecycle criteria remain binding. Main integration and
working-site deployment remain separate actions; no installation or live-data
action is authorized by this maintenance amendment.
