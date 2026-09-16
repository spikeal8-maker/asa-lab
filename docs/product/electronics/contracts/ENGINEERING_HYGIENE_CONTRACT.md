# Electronics Engineering Hygiene and Legacy Retirement Contract

This contract defines mandatory maintenance checkpoints for Electronics. It is a governance and maintainability contract; it does not authorize product/runtime semantic changes.

## 1. Why hygiene is mandatory

Electronics evolves through bounded roadmap slices. A locally correct slice may still leave transitional adapters, duplicated routes, oversized hotspots or stale documentation. Those leftovers become architecture only when they are allowed to accumulate without an explicit retirement decision.

Hygiene therefore has the same fail-closed character as routing: a due checkpoint must be resolved before starting another production-changing slice, except for a bounded repair required to restore a broken gate.

## 2. Checkpoint triggers

A hygiene checkpoint becomes due at the earliest of:

1. three accepted production-changing slices since the last accepted hygiene checkpoint; counted slices are `implementation`, `component/peripheral`, and any `maintenance`/`repair` slice that changed tracked production source;
2. before transition from one major `E-OPT-N` stage to another major `E-OPT-M` stage;
3. immediately after a canonical replacement makes a provisional/legacy path eligible for retirement;
4. a validator discovers a new unreviewed large source, stale baseline entry, orphaned route or missing retirement condition;
5. owner selection of a bounded cleanup/decomposition audit.

A checkpoint never automatically authorizes the next feature. After acceptance, normal `current.yaml` selection rules still apply.

## 3. Artifact lifecycle classes

Every artifact or bounded concern reviewed by hygiene uses one of these classes:
| Class | Meaning |
| --- | --- |
| `canonical-active` | Current production implementation or canonical contract. |
| `active-legacy-bridge` | Transitional behaviour still used by production; must name a retirement condition. |
| `compatibility-shim` | Deliberate compatibility layer kept for a bounded compatibility window; must name a retirement condition. |
| `generated` | Reproducible output owned by a generator; edit the generator, not the output. |
| `historical-evidence` | Accepted task/evidence/golden/provenance material retained for auditability. |
| `protected-owner-asset` | Owner-supplied/protected material governed by asset policy; never cleanup by inference. |
| `dead-orphan-candidate` | Suspected unused artifact requiring deletion proof before removal. |
| `decomposition-candidate` | Active cohesive code/document that needs a bounded responsibility review because of size/growth/coupling. |

Classification may apply to a concern inside a file rather than the whole file. A Worker controller can remain canonical while one `simulationTimeMs` compatibility path inside it is an active legacy bridge.

## 4. Deletion and retirement proof

A bot must never delete source because it “looks old”, has an old name, or is not mentioned in one local route.

Before removal, record evidence for all applicable conditions:

```text
runtime/import references: zero or explicitly migrated
public/package exports: zero or explicitly migrated
persistence/schema compatibility dependency: none or explicitly migrated
normative contract/task/evidence dependency: none requiring retention
owner/protected asset status: not protected
replacement coverage: present when behaviour moved elsewhere
focused tests after removal: PASS
required shared gates after removal: PASS
```

If any condition is unknown, classify the artifact as `dead-orphan-candidate` and STOP deletion until evidence exists.

## 5. Legacy bridge retirement

Every `active-legacy-bridge` or `compatibility-shim` entry must contain a concrete retirement condition tied to accepted capability/evidence, not a date or vague “later” statement.
Examples of valid retirement conditions:

- “E-OPT-3D canonical Worker horizons are integrated and direct/Worker parity passes without this path”;
- “E-OPT-3F reset/pause/resume/input conformance proves no caller relies on the compatibility state”;
- “all persisted document versions accepted by the product contract migrate before this shim is removed”.

Once the condition is satisfied, the next due hygiene checkpoint must either retire the bridge or record a new evidence-backed reason for retention.

## 6. Large-source and decomposition review

The Electronics routing validator uses `50_000` bytes as the large-source review threshold for tracked production `.ts`, `.tsx`, `.js`, `.mjs` and `.css` files under the Electronics source roots.

Crossing the threshold does **not** require automatic splitting. The baseline must instead record why the source remains cohesive or classify it as `decomposition-candidate`.

A reviewed large source may grow by at most 20% from its recorded `reviewed_bytes` before another hygiene review is mandatory. Growth beyond that threshold fails routing validation until the baseline is reviewed and updated by a selected hygiene/maintenance task.

Decomposition must follow responsibility boundaries. Creating arbitrary `utils`, one-function fragments or circular helper layers solely to reduce line count is forbidden.

Tests, compiled `dist` output and generated outputs are excluded from the production large-source baseline unless a separate contract explicitly includes them.

## 7. Generated, historical and protected material

Generated artifacts require a reproducible generator and stale-output validation where they are committed. They are not hand-maintained cleanup targets.

Completed task cards, accepted golden baselines and delivery/review evidence are `historical-evidence`. They may be archived/reindexed by a selected governance task but are not dead code.

Owner-supplied Electronics asset roots remain `protected-owner-asset`. Hygiene cannot replace, redraw, normalize or delete them without the existing explicit owner-asset authorization path.

## 8. Hygiene baseline

`../evidence/hygiene-baseline.yaml` is the machine-readable current review baseline. It contains reviewed large sources, active legacy concerns and selected documentation hotspots; it never stores active task/SHA/CI/deployment state.
Baseline changes require the selected governance/maintenance scope, evidence for the changed classification/size and routing validation.

## 9. Checkpoint evidence

A hygiene checkpoint reports:

```text
reviewed large sources and growth
legacy bridges and retirement conditions
new/deleted/orphaned routes
new/deleted generated artifacts and generators
historical/protected material preserved
actual removals with deletion proof
residual debt with owner-selectable follow-up
```

No cleanup task may hide a solver/runtime semantic change inside refactoring. If cleanup reveals a needed semantic decision, record it and STOP for a separately selected design/implementation task.

## 10. Stop rule

After the selected hygiene outcome, validation and bounded review pass, STOP. A clean repository does not itself authorize the next E-OPT slice.
