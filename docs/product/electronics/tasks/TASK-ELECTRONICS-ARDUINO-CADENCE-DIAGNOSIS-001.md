---
task_id: TASK-ELECTRONICS-ARDUINO-CADENCE-DIAGNOSIS-001
kind: analysis/inventory
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Technical acceptance of TASK-ELECTRONICS-ZERO-HORIZON-STARTUP-001
acceptance_boundary: slice
review: independent
---

# Measure Arduino continuation and visible observation cadence

Program [#452](https://github.com/spikeal8-maker/asa-lab/issues/452); bounded diagnosis [#510](https://github.com/spikeal8-maker/asa-lab/issues/510). It resolves the remaining baseline dependency for [#505 / PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506). Accepted startup repair [#513](https://github.com/spikeal8-maker/asa-lab/issues/513) fixes the first complete observation; this card investigates later Arduino progress.

## Existing evidence and one result

Read the [#507 evidence](../evidence/browser-baseline-507-20261006.md), saved attempt-1 trace `C:/Users/spike/.codex/temp/electronics-507/attempt1/trace.zip`, its error context, and original run `37506449432`. The failure occurred before Reset: committed work crossed the programmed LOW transition while UI retained an earlier complete HIGH result. Worker was yielded, not proved stuck. Full run `37533998221` later passed Arduino Reset after #513; that pass does not establish why the earlier run failed or close the cadence question.

Explain, with measured production-browser evidence, whether the same canonical fixture can leave a stale LED while committed calculation advances under normal or controlled load. Distinguish calculation cost, transport/scheduling delay, target coalescing and `ready` publication. Identify a bounded repair if a product defect is proved; otherwise state the measured limits and residual risk without claiming school-device acceptance.

## Bounded entry and probes

Restore fresh GitHub/main/current.yaml/CI and preserve other agents' work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ARDUINO-CADENCE-DIAGNOSIS-001`. Inspect saved evidence first, then run only the existing Arduino Reset scenario in an isolated built CI editor using the current accepted startup code. Capture each Worker preflight/advance response, `computeMs`, generation, requested/committed horizons, `ready`/`yielded`, and UI displayed clock/LED publication timestamps. Compare identical fixture/code with finite explicitly measured contention; record CPU/quota and avoid equating synthetic stress with normal classrooms.

Keep HIGH-to-LOW and Reset assertions, original sixty-second LOW poll, scheduler precision and physical model unchanged. Do not rerun the full suite in hope of passing, extend waits, publish incomplete horizons, edit #506, or repair the product in this diagnostic. No live school load, local second stack, installation, DB or network operation. Restore temporary probe/workflow files before the report-only final candidate.

The implementer publishes a concise report with exact candidate SHA and measured cause/limits, then STOP. A new independent reviewer verifies logs, trace, source and actual GitHub state. The controller selects a separate repair if needed, or resumes #505 after accepted evidence resolves the dependency. Owner acceptance and deployment remain separate.
