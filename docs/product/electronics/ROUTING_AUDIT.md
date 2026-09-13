# Electronics routing cost audit

Bounded examples, not execution selection or implementation evidence. Source/test entries
below are starting points for diagnosis, not files changed or tests run by this audit.
Every executable example first requires its own matching canonical task and concrete card;
if either is absent, STOP before source reads. A template is not a selected card.

Common route: [START_HERE](START_HERE.md) → [COMPONENT_MAP](COMPONENT_MAP.yaml) →
one subsystem card/entry → selected concrete task card → exact contract sections →
named source declaration → focused test. Read only applicable [AGENT_GUIDE](AGENT_GUIDE.md)
sections. This is **five Electronics routing/policy documents**, including the selected card.
The architecture specification and product README are section reads on demand, never preload.

Counts below include five route documents (R), technical contract documents/sections (C),
source files (S) and test files (T); several sections of one document count once. The four
shared root documents (`AGENTS.md`, `START_HERE_FOR_AI.md`, GitHub-first protocol and change
workflow) add four on a cold session, giving nine routing/policy documents for an ordinary
repair. They are not reloaded per component. Roadmap contracts for new capabilities add one
when needed; prerequisite/selection failure stops that route. Canonical state is read by
`agent:context`, not duplicated here. This optional audit is not part of the default route.

All paths in the table are repository-relative. `W` = `apps/web/src/electronics/`;
`D` = `contexts/electronics/domain/`; `T` = `contexts/electronics/testing/`.
Card links are below `docs/product/electronics/`. Counts are initial reads, not a guarantee
that an unclassified defect will need no further context; expand one evidenced dependency at a time.

| Request / kind | Component ID → subsystem card | Exact contract | Initial source / focused test | Approximate reads after root context |
| --- | --- | --- | --- | --- |
| Resistor inspector broken / repair | `electronics.ui.inspector-help` → [ui-assets-persistence](components/ui-assets-persistence.yaml) | [README §9](README.md#9-единый-инспектор) | `W/WorkbenchSidebars.tsx` (`WorkbenchSidebars`); `W/testing/workbench-presentation.spec.ts` | R5 + C1 + S1 + T1 = **8** |
| Arduino delay incorrect / maintenance | `electronics.arduino.runtime` → [arduino-peripherals](components/arduino-peripherals.yaml) | [README §15](README.md#15-arduino-и-программирование), delay/timing subsection only; [E-OPT-5](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#8-e-opt-5--arduino-runtime-hardening) only if capability/semantics expansion is proposed | `D/arduino-program-runtime.ts` (`advanceClockedArduinoRuntime`); `T/arduino-correctness.spec.ts` | R5 + C1 + S1 + T1 = **8**; new timing semantics require separately selected design/review |
| Add Servo / component-peripheral | `electronics.peripheral.servo` → [arduino-peripherals](components/arduino-peripherals.yaml) | [E-OPT-6](ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md#9-e-opt-6--sensors-and-peripherals), canonical-time and timed-output prerequisite acceptance | `sources: []`, `tests: []`; no invented implementation route | At most R5 + roadmap1 = **6**, then STOP if prerequisite/card missing; no recursive source preload |
| Worker hangs / repair | `electronics.worker.protocol` → [engine-worker-clock](components/engine-worker-clock.yaml) | [Specification §1.3](DEVELOPMENT_SPEC.md#13-determinism-and-execution-failures) and [§7.1](DEVELOPMENT_SPEC.md#71-architecture-acceptance-evidence) | `W/simulation-worker-client.ts` (`ElectronicsSimulationWorkerClient`); `W/testing/simulation-worker.spec.ts` | R5 + C1 + S1 + T1 = **8** |
| Electronics project not saved / repair | `electronics.persistence.project` → [ui-assets-persistence](components/ui-assets-persistence.yaml) | [README §5](README.md#5-circuitdocument); root AGENTS simulation invariants already in preflight | `W/workbench-autosave.ts`; `W/testing/workbench-autosave.spec.ts` | R5 + C1 + S1 + T1 = **8** |
| Change owner SVG / prohibited asset mutation | `electronics.assets.owner-svg` → [ui-assets-persistence](components/ui-assets-persistence.yaml) | [Root protected-data policy](../../../AGENTS.md#3-неприкосновенные-данные), [README §6](README.md#6-component-library) | No source read; `asset_roots` is ownership only. Existing validation routes: `tools/test_validate_electronics_assets.py`, `W/testing/owner-runtime-assets.spec.ts` | Router + map + card + applicable guide + root policy already read = **4 incremental**, then STOP; no asset/test preload |

If the inspector defect concerns help text, the same entry maps `component-help-content.ts`
and its focused spec. If saving concerns revision/merge, follow the same card's exact state/merge
file and matching spec. A timing barrier or live-controller defect justifies one dependency lookup;
it does not justify reading the complete Electronics source/test tree.

Root audit: `START_HERE_FOR_AI.md` routes recovery/context to the Electronics router;
`AGENTS.md` owns repository policy; the change workflow owns publication and deployment steps.
None requires a specific Windows checkout. GitHub content + canonical state + exact-SHA PR/CI
evidence is sufficient; local recovery is an environment observation. No extra root routing copy
or new required audit document is needed. Architecture contract reads are counted separately
above, so the total file cost remains visible rather than hidden in a routing-only count.
