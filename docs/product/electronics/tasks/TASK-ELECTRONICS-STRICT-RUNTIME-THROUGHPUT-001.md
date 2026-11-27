---
task_id: TASK-ELECTRONICS-STRICT-RUNTIME-THROUGHPUT-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Restore Arduino model-time throughput for stable loops

The strict browser run recorded about 1.85 s of wall/model drift in the
no-delay and Reset scenarios and timed out waiting for model time in the
1 ms and independent millis scenarios. Repair the calculation path behind
electronics.arduino.runtime. Keep visual phase delivery and Blockly native
controls as separate concerns.

Inspect the two private Worker stable-loop changes in PR #1072. Admit only
already-latched literal writes and proven unchanged iterations within the
same absolute millisecond. Preserve all existing physical and input
boundaries, partial instruction execution, explicit budgets, runtime
continuation, GPIO and Serial order, and validation thresholds. Review
the exact source-size evidence for any required hygiene baseline update.

Require full-result and continuation parity across the touched scheduler and
engine paths, adversarial input and explicit-budget tests, and independent
final-SHA review. In Chromium compare the no-delay, 1 ms, independent millis
and Reset journeys against their original wall/model thresholds. Check the
50 and 100 ms scenarios for regression. Run the focused and required
repository checks before integration and report the actual full strict
result separately.

## Reference hardware and ×1 qualification

The first reference configuration is Linux on Intel Xeon 6975P-C with four available virtual CPUs. The Playwright test runner registers this class at the `begin` journal event before running scenarios. Its affinity, effective cpuset, CPU identities and visible cgroup v2 quota hierarchy must agree. Missing evidence, unreadable visible quotas or host-only telemetry leaves reference-class eligibility unverified. The class is independent of the measured speed and test outcome.

Strict CI assigns five hosted runners before any outcome is known. The generic shards run the exact 252 universal scenarios. Each assigned runner is classified inside its test container before browser execution. Every qualifying runner independently runs all 25 unchanged wall-time and native-frame scenarios. Every reference verdict remains binding. Generic runs record the separate slow-CPU and overload proofs, including physical ordering and the achieved pace displayed by the UI.

The final cohort check requires 252 distinct universal IDs, at least one complete passing reference set of 25, all qualified reference verdicts, both generic pace receipts and successful browser jobs on the same SHA, run and attempt. No reference, missing evidence, duplicate IDs or any failure blocks qualification and review images. The hosted label assigns five slots and does not select a CPU model. No retry or later attempt can supply evidence for the original cohort. Strict suite browser jobs have a 75-minute job budget for the generic and reference passes together. Named classroom and error-profile job budgets stay at 50 minutes, and existing assertion thresholds and test timeouts are preserved.

At commit `b193cb023` shard `s2` passed 29/29 and the dedicated Arduino real-time group passed 7/10. The pre-run Playwright process in **both** jobs reported GenuineIntel, Intel(R) Xeon(R) 6975P-C, affinity and cpuset 0–3, and an unlimited leaf CPU quota. The ordinary Docker cgroup namespace qualifies on its visible limits; the class does not guarantee exclusive CPU scheduling. Those journals predate this in-runner classifier. Neither the Intel identity nor a green shard establishes full reference acceptance. The repository-level runner inventory on 25 November 2026 returned zero registered runners. The `ubuntu-24.04` job label does not pin this CPU. Keep the strict gate and its existing thresholds active until a separately verified reference run and overload check exist. [Archived run](https://github.com/spikeal8-maker/asa-lab/actions/runs/45656693505)
