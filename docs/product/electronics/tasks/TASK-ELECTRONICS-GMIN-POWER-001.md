---
task_id: TASK-ELECTRONICS-GMIN-POWER-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Account for numerical shunts in the circuit power balance

Correct the false power-quality rejection of a 23.5 V source feeding a
31,622.776601683792 ohm / 1 megohm divider. The solver stamps 1e-12 siemens
numerical shunts; the quality check must account for their actual power
without hiding a physical imbalance. The audit measured -1.065152161 nW
physical terminal power and +1.071162167 nW numerical shunt power.

Use actual stamped nonreference nodes and solved voltages, including isolated
islands and alternate reference selection. Do not derive compensation from
measured imbalance. Keep static and owned quality paths consistent. Preserve
all numerical, KCL and source-voltage checks, their thresholds, physical and
thermal steps, event ordering, continuation format and persistence behavior.
Do not introduce generic caches or a solver rewrite.

Scope: the minimum Electronics domain change and focused regression tests,
plus a real browser regression for this circuit through the editor and Worker.
No lamp, FET, timing, server, deployment, database or foreign-worktree edits
in this slice. Before edits, preflight the exact chosen paths.

Acceptance:

- Divider solves and agrees with independent circuit formulas. Test source
  voltage and resistance ranges, reference choices and multiple islands.
- Deliberately corrupted currents/voltages and genuine power imbalance still
  fail; non-finite and unsupported results remain rejected.
- Static and owned quality checks agree; existing physical and thermal
  regressions remain green. No weakened tests or tolerance changes.
- Real browser reproduction fails before and passes after the fix; verify
  visible simulation outcome and persistence/reopen as applicable.
- Focused gate, applicable repository gate and independent final-SHA review.
  Classify unrelated historical strict timing failures honestly; they remain
  open and do not authorize changes to their tests in this slice.

After integration the programme controller restores main/CI state and selects
the lamp endpoint repair separately. The executor and reviewer stop at their
bounded result; this card does not authorize them to start the next repair.
