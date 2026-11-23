# Arduino runtime responsibility review, 11 November 2026

This bounded maintenance review applies sections 6 and 8 of the
[engineering hygiene contract](../contracts/ENGINEERING_HYGIENE_CONTRACT.md) to
the runtime in `1277bc1966624307de08b920f48b478396ea4cf3`. The Code gate in
[General CI](https://github.com/spikeal8-maker/asa-lab/actions/runs/42974569942)
reported this file as the sole large-source growth violation. The previous
[responsibility review](runtime-responsibility-20261026.md) supplies the starting
boundary.

## Reviewed growth

Sizes come from the Git blobs and use the tracked LF representation.

| Revision | Runtime bytes | Git blob | Increment |
| --- | ---: | --- | ---: |
| Prior review `5f57d071` | 127658 | `c25786f81d8580caffe6deab0445d339870f06ee` | baseline |
| Conditional expressions `c2fc3f8f` | 129531 | `d873f72cefc6ca035828683c8eaf5f29f1b7187b` | +1873 |
| Helper calls `242d401f` | 141778 | `f4f3a7a7a32800217f8886d3aee482440ac5658a` | +12247 |
| Switch control flow `0c78a2d6` | 149171 | `24a2e0238dc205a0926349a4e57252c9b3ce9ec4` | +7393 |
| Stable loops `39656d38`, retained in main `4f7b5873` | 153077 | `ca3f09e042df617ba2687d0cac080b9033217bd6` | +3906 |
| Latched-write accounting `1c1d2fba` | 153814 | `4643e501318de721b13d867c737b125cb2185400` | +737 |
| Same-millisecond accounting `41b1d772`, retained in `1277bc19` | 154401 | `fd2f9857a9b76ebb1b7545ec617544d25c61a20d` | +587 |

The reviewed window adds 26743 bytes, or 20.95% over 127658. Main was 112.6 bytes
below the existing 153189.6-byte limit. The two candidate runtime changes add
1324 bytes and cross that limit. The review records 154401 bytes for the exact
blob and preserves the existing 20% rule and `decomposition-candidate` class.

## Responsibilities and coupling

- **Conditional expressions** extend the prepared expression tree and its parser
  counterpart. Both must retain branch evaluation, type checks and wait replay
  semantics. This work adds a language construct to the existing evaluator.
- **Helper calls** account for the largest increase. Compiled call and return
  instructions preserve the caller's return program counter and lexical scopes.
  Resume validation checks call-frame order, scope depth, parameter types and
  pending evaluation context against the same compiled program. That coupling
  is necessary for a wait inside a helper to resume at the correct instruction
  without repeating a completed effect.
- **Switch** adds integral selector and case validation, dispatch, fallthrough
  and scope unwinding through the existing instruction representation. The
  private `arduino-switch-syntax.ts` helper owns section parsing and case value
  normalization. The compiler still resolves instruction targets and break
  scopes, and the evaluator still executes the selected branch in order.
- **Stable loops** use the private `arduino-stable-loop.ts` helper to classify
  compiled instructions and compare known runtime entries. Only the runtime has
  the live program counter, scope stack, latched GPIO and ordered effect state
  needed to prove a skip. The Worker opts in through its owned session. The
  scheduler supplies a window up to the next existing physics or input boundary
  and retains the ordinary budget for explicit limits or input-bearing requests.
  Within that window, the runtime checks that literal writes already match the
  latched output and that a repeated `millis()` iteration leaves scopes and GPIO
  unchanged within the same absolute millisecond. It accounts for complete
  iterations and leaves a partial `millis()` iteration within the original
  instruction budget. This keeps program counter and continuation accounting
  with the checks that justify skipping work. Physical steps and effect ordering
  remain the scheduler's responsibility.

## Follow-up seams

The runtime remains a `decomposition-candidate`. Source scanning, diagnostics and
instruction preparation form a compiler boundary with a defined output. A
selected extraction can use that boundary after proving source-offset and
diagnostic parity, stable instruction identities and unchanged compile cache
behavior. The persisted evaluation journal and helper call frames form a second
boundary around continuation validation. It requires one explicit interface for
the compiled instruction identity, program counter and lexical scopes, plus
exact typed-state, effect-order and JSON-resume parity. Moving just the replay
loop would separate it from checks it currently depends on. Existing peripheral
and syntax helpers give concrete examples of smaller boundaries that retain
their runtime call sites.

`advanceArduinoRuntime` still selects `legacy-ms-v1`, with current calls in
`arduino-model.ts` and `solver.ts`. The baseline's existing retirement condition
requires canonical-profile convergence and proof that production, public and
evidence dependencies have been migrated or removed. This review preserves that
condition, runtime version 7 and the instruction-clock counterpart.

The two documentation changes record the reviewed size and retained debt. They
do not change runtime source, generated artifacts, routes, assets or other
checkpoints. Existing full-result, continuation, event-order and physical-quality
checks remain necessary for the candidate's executable changes. The scope of
this review is source responsibility and the routing baseline.
