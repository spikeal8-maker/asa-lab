---
task_id: TASK-ELECTRONICS-E2-STARTUP-DIAGNOSIS-001
kind: analysis/inventory
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Independent REQUEST_CHANGES for TASK-ELECTRONICS-E2-STARTING-STYLE-001
acceptance_boundary: slice
review: independent
---

# Diagnose the delayed first Worker result in E2

Program [#452](https://github.com/spikeal8-maker/asa-lab/issues/452); diagnostic [#512](https://github.com/spikeal8-maker/asa-lab/issues/512). This is a separate dependency of [#509](https://github.com/spikeal8-maker/asa-lab/issues/509) and [#505 / PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506). Arduino cadence [#510](https://github.com/spikeal8-maker/asa-lab/issues/510) remains separate.

## Observed boundary

On exact #509 candidate `a02e3292193ffbb0d3fec5f510c9a3e7f229df64`, a directed isolated E2 browser run `37524546045` passed 1/1. Exact-head general run `37525538670` passed. Full Electronics run `37525582255` passed 114/115, but E2 remained `starting` for the standard five-second status assertion. Its trace shows the Stop label, `aria-pressed=true`, no `running` class and displayed simulation time `00:00:00`. Arduino Reset passed in that same full run. The independent reviewer returned REQUEST_CHANGES. Neither Worker failure nor a shared Arduino cause has been proved.

## One result

Explain the delayed first result with measured, reproducible evidence and identify a bounded repair or test synchronization rule that preserves the real `running` state and strict active-style checks. First inspect saved run logs and trace at `C:/Users/spike/.codex/temp/electronics-509-full-browser/reports/playwright/electronics-interactions-o-34484-talog-pickup-exits-the-mode/trace.zip`. Confirm actual GitHub state and run `pnpm agent:preflight --scope electronics --check` and the selected card validator before edits.

Use only directed isolated built-browser CI probes. Compare the identical E2 fixture alone and with controlled runner contention; capture timestamps for Start, Worker request/loading, advance response, generation, `onResult`, UI status and displayed time. Check an explicit hypothesis before each probe. Preserve the test's five-second default until evidence justifies a product or test change. Do not rerun the full 115 scenarios in hope of a pass, lower physics accuracy, weaken the status/CSS checks, or change Arduino, PR #506, live installation, working DB or deployment.

The implementer publishes one diagnostic report with exact candidate SHA and stops. A new independent reviewer checks actual trace, measurements, source and GitHub state. The controller then selects a separate bounded repair if proven, resumes #509 only after that repair, and keeps #510 distinct.
