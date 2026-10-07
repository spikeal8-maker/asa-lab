# #510 — Arduino calculation and visible observation cadence

Diagnostic scope for [#510](https://github.com/spikeal8-maker/asa-lab/issues/510), a dependency of [#505 / PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506). Accepted startup repair #513 and closure #509 are preserved. No product, physical scheduler, test assertion, wait, owner image, installation or user document was changed by this diagnosis.

## Evidence identity and procedure

Saved run `37506449432` attempt-1 trace was read before new experiments. It failed **before Reset**: fixed requested horizon 36.4004 s, five yielded responses committed 25.749 → 26.773 s over 2.137 wall seconds, LED brightness 70 and last published clock 15.0001 s. Worker progress was visible; broken Reset and a stuck worker were not proved.

Directed probe SHA **`00c9d9b1cb35ff21da2c071612215cf48260b53d`**, based on main `50693c743169c2472faee6a2b8f21e015c03b651`, contains only temporary browser instrumentation, workflow selection and a finite CPU probe. Production code is identical to that baseline, including accepted #513. Exactly the existing `E-OPT-3D acceptance: Arduino Reset restarts an already progressed canonical run` executed, one test/one worker in each built isolated CI editor:

- [Ordinary run 37579056488](https://github.com/spikeal8-maker/asa-lab/actions/runs/37579056488): Playwright 1/1 PASS, both HIGH → LOW sequences and Reset generation assertions unchanged.
- [Contention run 37579060724](https://github.com/spikeal8-maker/asa-lab/actions/runs/37579060724): Playwright 1/1 FAIL at the original 60-second LOW assertion, **before Reset**. Its red conclusion is measured evidence, not a repaired-product gate PASS. The probe console printed `testInfo.status="passed"` inside `finally` before Playwright finalized the thrown assertion error; that preliminary value is not a PASS. The final Playwright failure and GitHub conclusion determine the result.

Both containers reported `nproc=4`, `cpu.max=max 100000` (no container CPU quota). The contention condition started three CPU competitors, each ending naturally after 90.000 wall seconds. Their measured user+system CPU was 67.745325, 69.659244 and 68.114868 seconds, totaling 205.519437 CPU seconds (average 2.28355 CPU cores over that interval). The test exit code was preserved while the diagnostic shell waited for finite load statistics. No test timeout or LOW poll was extended. The two GitHub runners were separate machines in the same runner class; these are controlled conditions, not paired measurements on one physical host or a classroom-load estimate.

A passive browser Worker wrapper recorded send/receive `performance.now`, request/generation IDs, requested/committed model horizons, ready/yielded state and existing `metrics.computeMs`. A MutationObserver recorded changed LED attributes and toolbar text. Those times establish **DOM publication**, not paint/compositor or human-perceived frame time. No profiling or uninstrumented overhead control was run.

Artifacts `electronics-r4-m1-browser-37579056488` and `electronics-r4-m1-browser-37579060724` retain the trace archives. In each trace, the JSON attachment has respectively resource `1dcbf0058582a9b97bcd2dcc3632232931bf0bbc` (460 events) and `fef064c94a122129a67d9da5cdbdcff4f1af21f9` (223 events). Byte-preserving extracted JSON, traces and step logs are also saved under `C:/Users/spike/.codex/temp/electronics-510/{solo-final,loaded-final}/`; trace path is `reports/playwright/electronics-simulation-E-O-1ac53-dy-progressed-canonical-run/trace.zip`.

Initial probe runs `37578670401` / `37578674533` at `13c8ead02f2bd76dfab30e2e8a4cc4be18c4bc1c` executed zero tests: anchored grep did not match Playwright's filename-prefixed full title. This was a diagnostic selection error (D), corrected without changing product/tests. Intermediate `4f7ca73b` runs `37578999378` / `37579003797` were superseded during image build to collect complete finite CPU statistics. They are neither PASS nor product FAIL. Final directed runs were not blindly rerun. Broader focused/benchmark/review-image jobs were explicitly skipped; a successful diagnostic run is not the full Electronics gate.

## Measured result

All browser timestamps below are milliseconds from the final project's document time origin. Model times are seconds. Advance medians include ready(0); roundtrip excess means `(receive − send) − computeMs`.

| Condition / generation             | Advances ready / yielded | Compute median / max (ms) | Roundtrip excess median / max (ms) | First committed ≥20 s  | First corresponding LOW DOM       | Maximum completed ready-to-ready gap |
| ---------------------------------- | ------------------------ | ------------------------- | ---------------------------------- | ---------------------- | --------------------------------- | ------------------------------------ |
| Ordinary, generation 1             | 15 / 90                  | 284.1 / 399.8             | 0.3 / 9.0                          | 20.011 s at 27513.5 ms | 24.6017 s at 31748.2 ms           | 5066.3 ms                            |
| Ordinary, generation 2 after Reset | 18 / 84                  | 277.55 / 362.9            | 0.3 / 6.5                          | 20.130 s at 55573.7 ms | 23.0763 s at 58367.8 ms           | 3227.7 ms                            |
| Contention, generation 1           | 6 / 99                   | 536.2 / 1091.8            | 2.4 / 10.8                         | 20.109 s at 53184.2 ms | No LOW before failure/capture end | 29065.4 ms                           |

The accepted zero-horizon startup works in both conditions: ordinary generation 1 ready(0) at 2425.9 ms, generation 2 at 32310.5 ms; contention generation 1 at 3707.8 ms. Initial ready(0) is separate from later long-horizon publication.

**Ordinary:** the LED stayed HIGH for **4234.7 ms after committed calculation crossed 20 s** before Reset, and **2794.1 ms after crossing** after Reset. At each crossing the UI showed the prior full HIGH result (19.5025 / 19.8778 s). It changed to LOW only when the pending target completed (24.6017 / 23.0763 s). Ready-to-DOM LOW delays were 6.6 / 3.2 ms. Reset discarded the old generation and repeated the sequence; this run passed its original assertions despite measurable staleness.

**Contention:** ready publication advanced through targets 0 → 0.1099 → 0.6023 → 2.3009 → 6.2002 → 19.6001 s. Completing the 19.6001-s target took **53 responses, 52 yielded**, with 28.9227 s summed compute elapsed time; the preceding ready result was separated by 29.0654 wall seconds. The next fixed target was 48.6001 s. It was not moved on each yielded response. Calculation crossed 20.109 s at 53184.2 ms while DOM remained lit, brightness 70, clock 19.6001 s. The failure diagnostic's last sample was 25.741 s; one further response during failure attachment collection reached 25.997 s at 63921.5 ms, still yielded against the same 48.6001-s target. No LOW DOM publication occurred through the last captured request at 63921.6 ms: **at least 10.7374 seconds after crossing 20 s**. Those failure-message and attachment samples are different instants, not conflicting state.

## Proven mechanism and limits

`simulation-worker-evaluator.ts` measures `computeMs` around evaluator execution with `performance.now`. This is elapsed time and includes CPU preemption; it is not exclusive solver CPU time. Small measured roundtrip excess (median 0.3 / 2.4 ms) compared with compute (approximately 278–536 ms per advance) supports calculation/scheduling cost inside the evaluator as the dominant measured response delay here. It does not isolate solver hot spots, structured-clone cost, host queuing or preemption individually.

`arduino-circuit-scheduler.ts` uses the fixture's electrothermal profile, 1000-µs physical barrier and default 256-event advance budget. The Worker continues making finite forward progress. `live-simulation-worker-controller.ts` prioritizes continuation over newer coalesced host horizons, and publishes `onResult` / `onCommittedHorizon` only for complete ready results. **A fixed target can therefore preserve correct incomplete-work semantics yet require many costly continuations before a new complete observation becomes visible.** When it finishes, the coalesced host horizon has moved far ahead, creating a larger next batch. Both actual sequences establish that growth; the contention case magnifies it until the unmodified visual assertion fails.

This diagnosis proves a later **observation cadence defect under the measured conditions**, including multi-second ordinary CI staleness and a reproduced loaded failure. It does not prove a broken Reset, continuous retargeting starvation, another startup failure, browser transport outage, school-device frequency or the sole cause of all classroom incidents. It also does not prove that bounded observations alone can make this physical fixture run in real time: calculation throughput remains a separate limit.

## Separately bounded next result

A justified separate repair can bound the size of **complete observation targets** while retaining later host demand, ordered inputs, existing yielded continuations, generation cancellation and ready-only publication. It must keep every canonical physical barrier/event and the exact electrical/thermal model; publishing a yielded partial horizon, enlarging waits or reducing accuracy is not an acceptable shortcut. Characterization should prove complete visible observations while calculation trails host time, then run this same HIGH → LOW / Reset journey under the recorded finite contention. Any cost optimization/hot-spot diagnosis is a separate concern unless directly proved necessary by that selected repair.

The controller must formally select and independently review that repair before implementation. #505 / #506 should remain preserved pending resolution; this diagnosis is not its final acceptance. No installation, database, protected artwork or classroom operation occurred.

## Delivery boundary

After measurement, repository writes were paused when standard preflight detected foreign unfinished mandatory shared files. No foreign change was hidden, reverted or committed by this executor. On resumption, a fresh standard preflight at main `ec34383105fd7094f08c9331b307cc4866ee7f75` returned `SAFE_TO_START`, local dirty 0, overlaps 0 and control-plane PASS; selected #510 remained canonical. This is historical entry evidence, not a second source of active task state.

This report is the only final candidate change. Temporary workflow, browser instrumentation and CPU probe remain in preserved diagnostic branches and are absent from the final diff. No new browser measurement was run on resumption. Final exact-head governance/general results and independent review are delivered separately by the controller; this report does not announce #505 acceptance, owner acceptance, deployment or release readiness.
