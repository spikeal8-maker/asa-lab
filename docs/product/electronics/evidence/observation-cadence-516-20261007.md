# Observation cadence repair: dated technical evidence

Programme [#452](https://github.com/spikeal8-maker/asa-lab/issues/452); bounded repair [#516](https://github.com/spikeal8-maker/asa-lab/issues/516), following independently accepted [#510 diagnosis](arduino-observation-cadence-510-20261007.md). This is historical evidence; current task/status lives only in `docs/execution/current.yaml`.

## Implemented and independently reviewed candidate

Candidate `ba05381af8e95ad26ee04f9d501625b7a3154681` limits each new complete observation horizon to committed model time plus 500000 microseconds. Later host demand remains pending; yielded continuation keeps its fixed target. Startup, ordered inputs, cancellation and fault handling remain in the same canonical controller. Only actual `ready` results publish an electrical frame; every measured ready has committed horizon equal to its requested horizon.

Exactly three final files changed: `live-simulation-worker-controller.ts`, its focused controller tests and `engine-trace-replay.spec.ts`. Engine/model source, 1 ms physical precision, default 256 work budget and browser timeouts are unchanged. Actual timed-engine tests compare complete canonical state, observation and diagnostics without discarding physical fields: RC, Arduino, motor, heat and damaged-battery fixtures, including future input retention.

The implementer stopped after self-review. A NEW independent reviewer APPROVED this exact candidate, independently checked source/diff, ran 78 relevant tests and verified GitHub conclusions and original normal/load artifact digests, trace resources and raw measurements.

| Exact candidate evidence | Result |
| --- | --- |
| [General 37657279859](https://github.com/spikeal8-maker/asa-lab/actions/runs/37657279859) | All four jobs SUCCESS; 166 fresh Nx tasks, no cache hits |
| [Electronics 37658060110](https://github.com/spikeal8-maker/asa-lab/actions/runs/37658060110) | All four jobs SUCCESS; focused 1001 tests, browser 115/115, 159 fresh Nx tasks |
| [Normal directed probe 37657708620](https://github.com/spikeal8-maker/asa-lab/actions/runs/37657708620) | Original Arduino HIGH → LOW / Reset scenario PASS |
| [Finite CPU-load probe 37657469486](https://github.com/spikeal8-maker/asa-lab/actions/runs/37657469486) | Same original scenario PASS |

The probes preserve the original sixty-second LOW poll and 180-second scenario timeout. Their production source is identical to the final candidate. Temporary passive diagnostics and focused workflow routes are absent from the final three-file diff. Initial normal probe 37657462237 stopped before browser execution because temporary test instrumentation made a generated coverage source digest stale; correcting that probe-only digest was the explicit reason for the single replacement normal run. Cancelled temporary general workflows are not acceptance evidence.

## Saved measurements, not a new measurement campaign

| Run / generation | Ready / yielded | Maximum ready gap, ms | computeMs median / maximum | LOW ready → DOM publication, ms |
| --- | --- | --- | --- | --- |
| Normal 1 | 45 / 42 | 771.1 | 277.7 / 413.7 | 9.2 |
| Normal 2 | 44 / 42 | 628.8 | 262.85 / 354.1 | 2.4 |
| CPU load 1 | 43 / 41 | 1944.3 | 550.65 / 1118.1 | 8.9 |
| CPU load 2 | 43 / 43 | 1426.2 | 508.35 / 852.1 | 2.2 |

Every new observation target is at most 500000 model microseconds beyond the previous committed result. Normal first LOW target is 20.0001 s; loaded first LOW target is 20.217 s. CPU load is three finite 90-second processes, total 196.104387 CPU seconds (about 2.17894 cores). Original raw normal attachment SHA256: `827f8d8a8ba451dfdaaf4589c9ed5e7d39313a14c1eb55808e5770c73646caa8`; loaded: `12df4449879bc21cce7a54872bec1caf83e858b6af9a2a375d62543af3fdc6dd`.

Original GitHub outer artifact digests were independently matched before reading trace/raw attachments: normal artifact 11500036836 `1215bd07ed18e12a31883a34a8a5d9f2257b7ccd7cda5cc7622f5063af7a86fd`; loaded 11500301811 `e4a51cce53e39306bb9d788a505611e9720300967240b4b42c9dbb6847b87515`.

Limits: 500 ms bounds model horizon, not wall-clock latency or real-time throughput. The second LOW occurs after the finite CPU load ends. In loaded generation 2, ready model time exactly 20.000 s still legitimately precedes the Arduino GPIO instruction; crossing model 20 s is not the actual LOW event. These are separate CI runners with passive diagnostic overhead, DOM publication rather than paint, and elapsed compute time including preemption. Frequency on school devices remains unproved.

## Integrated SHA independently challenged

Ordinary integration `4bad8a7f1eb3543097c397f05df7805e9024e342` preserves independent Settings baseline `08dd188b13dd3c6f53b9c45c80d287f0599dd249`; its three Electronics blobs are identical to the approved candidate. A NEW independent reviewer verified the actual remote SHA, parents, preserved files, raw evidence and selected-card/preflight/control plane, and issued REQUEST_CHANGES for required exact-main gates:

- [General 37661992911](https://github.com/spikeal8-maker/asa-lab/actions/runs/37661992911): governance/code/data PASS, Access A FAIL because the Settings navigation label changed but three old test selectors remained. Category C relative to Electronics. The Settings executor separately published test repair `6b93059e8a199c4c96ba47da271c6e8e14f1eb73`; its result must be checked on its own exact SHA.
- [Electronics 37662037546](https://github.com/spikeal8-maker/asa-lab/actions/runs/37662037546): focused and benchmark PASS, browser 114/115. Original Arduino Reset PASS; sole failure is the permanent ordinary-image catalog error badge. That scenario has no running simulation and unchanged asset/test source, category C relative to #516. Separate bounded [#517](https://github.com/spikeal8-maker/asa-lab/issues/517) investigates and repairs the proven cause.

No #516 integrated technical acceptance, release claim, owner acceptance or deployment follows from the earlier green candidate. Do not repair either independent blocker inside #516 or PR #506. Preserve #505 candidate `350d2442d044d8992374ca4deef2758b6c95c61f` while these dependencies are resolved.
