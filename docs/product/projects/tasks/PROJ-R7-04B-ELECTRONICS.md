# PROJ-R7-04B — Electronics Public Viewer

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-03`; current Electronics public-safe simulation contract must be verified before activation.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

## 0. Activation gate

Start only when this exact slice is selected in control-plane and current Electronics/Public Projects baselines are delta-checked.

---

## 1. Пользовательский результат

На публичной странице электроники пользователь может открыть опубликованную immutable схему в read-only режиме и, если public artifact это разрешает, запустить ограниченную безопасную симуляцию.

Минимум:

- read-only schematic;
- start / stop / reset simulation;
- отображение только доказанных sensor/output values;
- static preview fallback;
- code/logic read-only только если автор и artifact contract разрешают.

---

## 2. Scope

Входит:

- Electronics Public Artifact adapter;
- sanitizer/capability projection;
- read-only schematic viewer;
- bounded simulation runtime;
- start/stop/reset;
- supported value projection;
- error/fallback state;
- mobile controls;
- resource cleanup;
- performance/security tests.

Не входит:

- wiring/component editing;
- changing source Project;
- unsupported sensor emulation;
- editor toolbox/palette;
- Arduino authoring workflow redesign;
- arbitrary code execution outside approved simulation sandbox.

---

## 3. Critical invariants

- legality/simulation rules come from canonical Electronics runtime contracts;
- Public Projects does not fork component semantics;
- unsupported component/value is reported as unsupported, not fabricated;
- simulation cannot write back to Project/ProjectVersion;
- runtime has explicit limits for CPU/time/event count where applicable;
- source code visibility is a capability, not assumed by UI.

---

## 4. Architecture

```text
PublicationRevision
→ Electronics Public Artifact
→ read-only schematic projection
→ optional constrained simulation runtime
```

Reuse canonical electronics engine/runtime primitives only through stable boundaries. Do not import full authoring editor if a lighter runtime path exists.

---

## 5. Required tests

- eligible public circuit renders from R7-03 artifact;
- private/revoked denied;
- start/stop/reset work for supported circuit;
- unsupported component/value fails clearly;
- no source Project write occurs;
- code hidden when capability false;
- simulation limits are enforced;
- cleanup stops timers/listeners/workers on unmount;
- static preview fallback works;
- public page remains usable when simulation runtime fails;
- unrelated routes do not eagerly load electronics public runtime;
- existing Electronics editor/simulation regression remains green.

---

## 6. Acceptance Criteria

- **R7-04B-AC01** viewer uses exact sanitized artifact.
- **R7-04B-AC02** schematic is read-only.
- **R7-04B-AC03** simulation is bounded and server/product-policy compliant.
- **R7-04B-AC04** unsupported data is not invented.
- **R7-04B-AC05** no mutation of original Project is possible.
- **R7-04B-AC06** mobile controls and accessibility pass.
- **R7-04B-AC07** lazy loading/cleanup/fallback are proven.

---

## 7. Hygiene

High-risk runtime slice: threshold 2. Record route/chunk delta, worker/runtime cleanup, duplicated component semantics, new dependencies, large files and hygiene counter.

`BLOCK` if public viewer introduces a second electronics simulation engine or copies component behavior into UI code.

---

## 8. STOP conditions

STOP if safe simulation boundary is not proven, unsupported components require fake behavior, full editor rewrite is needed, or source mutation/authz boundary would be weakened.