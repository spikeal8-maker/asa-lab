---
task_id: TASK-ELECTRONICS-CLASSROOM-HYGIENE-001
kind: maintenance
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Owner 2026-10-19 authorization to complete and integrate the classroom D13 repair and its necessary repository gates
  - TASK-ELECTRONICS-CLASSROOM-D13-001 remains selected under Issue638 and requires the preserved R26/R27 source composition
  - ENGINEERING_HYGIENE_CONTRACT sections 6 and 8 require selected maintenance scope before updating the large-source baseline
  - Fresh canonical main, path ownership and exact candidate source observations
acceptance_boundary: slice
review: independent
---

# Classroom retained-source responsibility review

## Selection and limited purpose

Issue641 is a maintenance dependency of classroom Issue638 and retained Issue546.
The owner has already authorized the classroom implementation and the necessary
checked integration. This selection supplies the explicit maintenance scope
required by ENGINEERING_HYGIENE_CONTRACT sections 6 and 8; it does not change that
contract or the classroom acceptance criteria.

The D13 candidate reuses the coherent R26/R27 production dependencies. Its
arduino-circuit-scheduler.ts and arduino-program-runtime.ts require a fresh
large-source responsibility review: the scheduler entry is absent from the
current main baseline, and the retained scheduler/runtime sizes exceed their
previous recorded review sizes. Importing an old baseline or changing only a
number is not this review.

This task is a bounded large-source maintenance review. It is not a full hygiene
checkpoint, does not reset the accepted-slice counter, and does not clear any
other due checkpoint, historical failure, acceptance blocker or decomposition
debt. D13 remains separately selected throughout this maintenance work.

## Owned changes

Only these repository files may be written under this task:

- docs/product/electronics/tasks/TASK-ELECTRONICS-CLASSROOM-HYGIENE-001.md
- docs/product/electronics/evidence/hygiene-baseline.yaml
- docs/product/electronics/evidence/classroom-retained-source-responsibility-641-20261019.md

The controller alone publishes the selection and acceptance state in
docs/execution/current.yaml. Source, tests, component routing and generated
coverage remain under the separately coordinated D13 composition. The hygiene
author does not modify production code, solver behaviour, electrical tolerances,
runtime instruction costs, event budgets, tests or product gate requirements.

## Required bounded review and evidence

1. Freeze the actual formatted D13 candidate source. Record its exact source/tree
   identity, per-file Git blobs and bytes, observed main, the R26/R27 import
   manifest and the independently reviewed R27/L amendments. Review the retained
   source by its original provenance; do not repeat the historical 27-stage audit.
2. Review scheduler and runtime responsibility boundaries and growth. Explain
   their retained orchestration/runtime responsibilities, why the new D13 work
   belongs at the existing boundaries, and what timing/state/physics parity a
   future extraction must preserve. Historical source reviews support provenance
   but do not substitute for this exact candidate review or D13 product acceptance.
3. Add or update only the scheduler/runtime baseline entries after that review,
   with reviewed_bytes equal to actual final source bytes and a rationale linking
   the new evidence. Keep both entries decomposition-candidate. Preserve every
   other baseline entry, lifecycle class, retirement condition, the 50_000-byte
   threshold, 20% growth limit and three-slice checkpoint rule.
4. Record the other touched large UI sources and confirm whether their existing
   review limits remain sufficient. If an additional baseline entry actually
   requires change, stop that edit and obtain a further bounded selection; do
   not raise unrelated ceilings opportunistically.
5. Cover the contract's checkpoint evidence fields within this composition:
   retained legacy bridges and retirement conditions; added/deleted/orphaned
   routes; generated artifacts and their actual generators; historical/protected
   material; actual removals; and residual responsibility debt. Use the exact
   import manifest and existing routing validator. This scope selects no removal,
   legacy retirement, protected-asset edit or unrelated cleanup.
6. Preserve the active legacy runtime bridge and its existing retirement proof
   requirement. A source being large or old is not evidence that a caller,
   persisted format, public API or historical reference can be removed.

The baseline stores classification, reviewed sizes and rationale only. Active
task state, SHA/CI/deployment status and acceptance results belong in the evidence
and canonical current.yaml, never in hygiene-baseline.yaml.

## Validation and acceptance

Require independent review of the exact baseline diff and responsibility evidence,
then actual routing and governance validation on the composed candidate:

- node tools/validate-electronics-agent-docs.mjs --task TASK-ELECTRONICS-CLASSROOM-HYGIENE-001
- pnpm gate:governance

Fresh execution uses literal NX_SKIP_NX_CACHE=true. Record exact commands, source
identity, exits and CI run identities where executed. A maintenance PASS resolves
only the reviewed growth entries. D13's focused, benchmark, real browser and
repository gates remain mandatory and its acceptance blocker remains active.

Do not publish a candidate-sized baseline against a different main source tree.
The reviewed baseline and evidence accompany the matching D13 source composition
when that complete product result is permitted to integrate. Selection metadata
can be published first; neither metadata nor this review is product acceptance.

## Stop and continuation

After the selected maintenance outcome, validation and independent review pass,
the maintenance author stops. The controller continues the already authorized
and separately selected D13 browser/review/CI integration work, then the owner's
remaining visible classroom programme. This maintenance outcome grants no new
E-OPT stage, deployment, school database, Docker, network or protected-data action.
