# E-OPT-1A — Current Electronics Public Boundary Inventory

Task: `TASK-ELECTRONICS-EOPT1A-001`
Kind: `analysis/inventory`
Semantic change: `no`
Source baseline: `c9fbb773bc4b2c4e19c181ef586ee6300a9cfed6`
Execution-state selection: `16dea36ea023a7f1ffff5441cf1f739c5ef68de6`

## 1. Executive finding

The current Electronics implementation already contains a reusable deterministic domain engine, but it does **not** expose one small intentional portable engine boundary.

Observed today:

- `@asa-lab/electronics` exposes 21 re-export groups with 206 named exports.
- `@asa-lab/electronics/simulation` exposes 14 groups with 129 named exports.
- the `./simulation` dependency closure stays inside `contexts/electronics` and has no external package import;
- the root package additionally reaches `@asa-lab/module-sdk` through `module.ts`;
- production Web code imports model/profile helpers directly from the package root;
- the Worker evaluator enters the engine through the Web-owned `live-simulation.ts` bridge;
- the Worker protocol and bridge use Web-owned duplicate `SchematicDocument` / `SolveResult` DTOs;
- API/server verification reaches the same `analyseCircuit` implementation through `ELECTRONICS_MODULE`.

E-OPT-1B should therefore **wrap and narrow existing behaviour**, not rewrite solver physics. The stable E-OPT-1 boundary should remain structural/non-temporal; existing clock/transient inputs remain provisional until E-OPT-3.

## 2. Method and evidence boundary

This inventory used only source-level evidence and repository-wide consumer search; no runtime source or test was modified.

Reproducible checks used:

- TypeScript AST enumeration of `export ... from` groups in `index.ts` and `simulation.ts`;
- TypeScript AST scan of production/test imports from `@asa-lab/electronics` and `@asa-lab/electronics/simulation`;
- recursive relative-import traversal from both public entry points;
- `git grep` for package consumers and source-path bypasses;
- focused inspection of `module.ts`, `domain/document.ts`, `domain/simulation.ts`, Worker protocol/evaluator, Web live bridge, API module registry and project analysis path.

The GitHub private-repository code-search endpoint returned an incomplete zero-result set for an exact package query, so repository-wide consumer discovery was verified with read-only `git grep` against the same pinned Git revision. This did not mutate production state.

## 3. Package/export configuration

`contexts/electronics/package.json` currently publishes two package entry points:

| Package entry | Source | Observed role |
| --- | --- | --- |
| `@asa-lab/electronics` | `contexts/electronics/index.ts` | broad root surface plus ASA module adapter |
| `@asa-lab/electronics/simulation` | `contexts/electronics/simulation.ts` | broad simulation/domain surface |

The package is `private: true`. Its only declared package dependency is `@asa-lab/module-sdk`. The Nx project is a `type:lib`, `scope:core`, `context:electronics` library.

Recursive import traversal found 33 source files reachable from each entry point. The root entry has one external import edge, `module.ts -> @asa-lab/module-sdk`; the `./simulation` entry has no external package import edge.

## 4. Root export groups (`contexts/electronics/index.ts`)

AST inventory: **21 groups / 206 named exports**.

| # | Source group | Boundary assessment |
| ---: | --- | --- |
| 1 | `domain/document.js` | candidate facade input/validation types; also carries editor viewport/settings |
| 2 | `domain/document.js` (`SchematicDocument` alias) | candidate input alias, but duplicate naming should not expand the facade |
| 3 | `domain/netlist.js` | compile internals currently public; candidate output may expose prepared topology, not raw helpers by default |
| 4 | `domain/simulation-input-digest.js` | deterministic metadata/support; currently used by Web host |
| 5 | `domain/led-model.js` | model-specific leakage |
| 6 | `domain/model-identity.js` | registry/model identity internals; capability descriptor may wrap selected facts later |
| 7 | `domain/model-registry.js` | model-registry internals |
| 8 | `domain/models/device-model.js` | extension/model implementation types, not minimal consumer API |
| 9 | `domain/models/brushed-motor-profiles.js` | model-specific leakage |
| 10 | `domain/models/brushed-motor-transient-model.js` | model-specific + temporal leakage |
| 11 | `domain/models/piezo-audio-model.js` | model-specific leakage |
| 12 | `domain/models/linear-dc-models.js` | solver/model implementation leakage |
| 13 | `domain/models/incandescent-lamp-model.js` | model-specific + thermal leakage |
| 14 | `domain/models/npn-dc-model.js` | model-specific solver leakage |
| 15 | `domain/photoresistor-model.js` | model-specific leakage used directly by Web presentation |
| 16 | `domain/switch-topology.js` | component-specific topology helpers used directly by Web presentation/contracts |
| 17 | `domain/arduino-capabilities.js` | useful capability data, but Arduino-specific rather than an engine capability descriptor |
| 18 | `domain/solver.js` | raw solver/result internals; `solveCircuit` has no production package consumer outside the context |
| 19 | `domain/models/capacitor-transient-model.js` | temporal state internals |
| 20 | `domain/simulation.js` | strongest current facade candidate: `compileCircuit` / `analyseCircuit` plus result types, but options include time/state |
| 21 | `module.js` | ASA Lab host adapter, intentionally not portable core |

## 5. `./simulation` export groups

AST inventory: **14 groups / 129 named exports**.

| # | Source group | Boundary assessment |
| ---: | --- | --- |
| 1 | `domain/document.js` | document types only; no parser exported from this subpath |
| 2 | `domain/netlist.js` | raw topology helpers |
| 3 | `domain/arduino-circuit-scheduler.js` | explicitly temporal API; must remain provisional for E-OPT-3 |
| 4 | `domain/model-identity.js` | model identity/registry surface |
| 5 | `domain/simulation-input-digest.js` | deterministic metadata/support |
| 6 | `domain/simulation.js` | compile/analyse and simulation result types |
| 7 | `domain/models/capacitor-transient-model.js` | temporal internals |
| 8 | `domain/models/piezo-audio-model.js` | model-specific leakage |
| 9 | `domain/photoresistor-model.js` | model-specific leakage |
| 10 | `domain/models/incandescent-lamp-model.js` | model-specific/thermal leakage |
| 11 | `domain/switch-topology.js` | component-specific helper leakage |
| 12 | `domain/models/brushed-motor-profiles.js` | model-specific leakage |
| 13 | `domain/models/brushed-motor-transient-model.js` | model-specific + temporal leakage |
| 14 | `domain/solver.js` | solver result/controller types |

The `./simulation` entry is therefore **dependency-pure but surface-broad**. Its current name does not imply a stable non-temporal contract: it exports Arduino clock state, transient state and concrete device-model helpers alongside `analyseCircuit`.

`SimulationOptions` confirms the temporal mixing: it currently contains `simulationTimeMs`, `transientState` and `controllerState`. E-OPT-1B must not freeze those fields as the permanent public time contract.

## 6. Production consumer inventory

AST scan found **14 production import declarations** from the two package entry points: one API import and thirteen Web imports.

| Consumer | Entry | Imported surface |
| --- | --- | --- |
| `apps/api/src/module-registry.ts` | root | `ELECTRONICS_MODULE` |
| `apps/web/src/api.ts` | `./simulation` | `ArduinoControllerState` |
| `ArduinoCodePanel.tsx` | root | Arduino source-support analyser/diagnostic type |
| `WorkbenchSidebars.tsx` | root | LED/lamp/photoresistor/motor/seven-segment/SPDT helpers + `ComponentResult` |
| `WorkbenchStage.tsx` | root | photoresistor illumination/resistance helpers |
| `arduino-blocks.ts` | root | `arduinoBlockSupport` |
| `arduino-command-reference.ts` | root | Arduino language/text support tables and types |
| `arduino-source-language.ts` | root | Arduino text-command support and types |
| `component-help-content.ts` | root | lamp/LED profile helpers |
| `component-information.ts` | `./simulation` | `sha256Hex` |
| `electronics-document-merge.ts` | root | `parseElectronicsDocument` |
| `live-simulation.ts` | `./simulation` | `analyseCircuit`, `simulationInputDigest` |
| `production-asset-contracts.ts` | root | button/SPDT topology helpers and `SpdtThrow` |
| `workbench-document.ts` | `./simulation` | `resolveElectricalModelIdentity` |

Five additional Web test import declarations use package exports. Test/tool-only source-path bypasses also exist for the benchmark harness and module preview tests; no production app source was found importing `contexts/electronics/domain/*` directly.

The key observation is that most production imports are **not engine lifecycle calls**. They are model-specific presentation/help/capability helpers. A minimal portable facade should not preserve all of those helpers merely because the current root index exports them.

## 7. Server verification boundary

Observed server path:

```text
apps/api/src/module-registry.ts
  -> @asa-lab/electronics:ELECTRONICS_MODULE
  -> module.ts provider.validate(...)
  -> parseElectronicsDocument(...)
  -> module.ts provider.analyse(...)
  -> analyseCircuit(...)
```

`ProjectsController` is module-generic. On project open and draft save it resolves the registered provider, validates the document and calls `provider.analyse(validated.payload)`. Electronics therefore reuses the same deterministic `analyseCircuit` implementation on the server without the API importing solver internals directly.

Portability implication: `ELECTRONICS_MODULE` is a valid **ASA Lab adapter**, but it is not the portable engine facade because it depends on `@asa-lab/module-sdk` and includes project manifest/preview concerns.

## 8. Worker / browser boundary

Observed running path:

```text
Worker message
  -> simulation-worker-evaluator.ts
  -> live-simulation.ts
  -> @asa-lab/electronics/simulation
  -> analyseCircuit(...)
  -> domain simulation / solver / models
```

`simulation-worker-evaluator.ts` does not call an Electronics facade directly. It imports `calculateSimulationPreflight` and `advanceLiveSimulation` from the Web-owned `live-simulation.ts` module.

The Worker protocol itself also imports `SchematicDocument` and `SolveResult` from `apps/web/src/api.ts`. Those Web DTOs duplicate the domain document/result shapes instead of using one engine-owned boundary type. `apps/web/src/api.ts` only imports `ArduinoControllerState` from Electronics and then locally redeclares the larger `SchematicDocument` and `SolveResult` shapes.

This creates two current host couplings:

1. Worker protocol types are owned by Web/API client code rather than the engine boundary.
2. Worker execution enters through a Web helper that carries transient/controller state and same-sample `+1 ms` behaviour.

`globalThis.performance.now()` in the evaluator is used for compute metrics, not as the physical simulation clock. The physical-time contract still enters requests as `simulationTimeMs` and remains out of scope until E-OPT-3.

## 9. Current dependency shape

```text
API ProjectsController
  -> ModuleRegistry
  -> ELECTRONICS_MODULE -------------------------+
                                                  |
Web presentation/helpers                         |
  -> broad root/model exports                    |
                                                  v
Web Worker protocol -> Web live-simulation -> analyseCircuit
                                             -> compileCircuit
                                             -> solveCircuit
                                             -> registry/models/Arduino runtime
```

The pure-engine direction is already mostly one-way. The architectural defect is primarily **surface ownership and host coupling**, not a React import inside the solver.

Recursive entry-point inspection found no React, NestJS, PostgreSQL or portal package import below `@asa-lab/electronics/simulation`. The root entry differs only because it also exports the ASA-specific module adapter.

## 10. Observed non-temporal core candidates

These are observations, **not** an accepted E-OPT-1B API design.

| Existing symbol/type | Why it is a candidate | Current caveat |
| --- | --- | --- |
| `parseElectronicsDocument` / `DocumentParseResult` | schema validation + migration entry | document includes viewport and `simulation.running` editor state |
| `ElectronicsDocument` | canonical persisted engine input shape | currently also carries presentation/session settings |
| `compileCircuit` / `CompiledCircuit` | deterministic topology preparation | raw netlist details may be too implementation-specific for a stable facade |
| `analyseCircuit` / `SimulationResult` | canonical deterministic analysis entry/result | `SimulationOptions` also accepts time/transient/controller state |
| simulation/model revision metadata | required for capability/version reporting | currently distributed across result constants/module manifest, no dedicated engine descriptor |
| Arduino support/capability data | useful for capability discovery | current exports are Arduino-specific tables, not one engine capability contract |

A safe E-OPT-1B facade can therefore be built around existing parse/prepare/analyse behaviour while deliberately withholding the current temporal option fields from the stable contract.

## 11. Temporal surface that must remain provisional

The following observed items are explicitly **not** candidates for freezing during E-OPT-1B:

- `advanceArduinoCircuitClock` and scheduler state/event types;
- `SimulationOptions.simulationTimeMs`;
- `SimulationOptions.transientState`;
- `SimulationOptions.controllerState`;
- Worker `SimulationAdvanceRequest.simulationTimeMs` / `previousResult` semantics;
- the Web bridge's same-sample `previousTimeMs + 1` event step;
- reset/pause/resume/event-horizon semantics.

They are inputs to E-OPT-3, not defects to repair in E-OPT-1A.

## 12. Portability blockers / boundary debt

| ID | Observed blocker | Consequence | Future owner |
| --- | --- | --- | --- |
| PB-1 | root entry exports 206 names across engine, models and host adapter | accidental public surface; consumers can couple to internals | E-OPT-1B |
| PB-2 | `./simulation` exports 129 names including scheduler/transient/model helpers | no clear stable non-temporal package surface | E-OPT-1B |
| PB-3 | Worker evaluator calls Web `live-simulation.ts` instead of an engine facade | Worker depends on host orchestration | E-OPT-1E, then E-OPT-3 for timed path |
| PB-4 | Worker protocol uses Web-owned duplicate document/result DTOs | engine boundary types are not the single source of truth | E-OPT-1B / E-OPT-1E |
| PB-5 | Web presentation imports concrete LED/lamp/photoresistor/motor/switch helpers | UI changes can depend on model implementation details | later bounded UI/model routing work; not E-OPT-1A |
| PB-6 | version/capability facts are distributed across module manifest, solver result and support tables | no one portable capability/version descriptor | E-OPT-1B |
| PB-7 | `analyseCircuit` combines structural solve and temporal continuation options | freezing current signature would pre-empt E-OPT-3 | E-OPT-1B must expose only structural use; E-OPT-3 owns time |

`domain/simulation.ts` itself also imports many concrete model registries/profiles and the Arduino runtime-state version. That is an existing orchestration hotspot, but decomposing it or `solver.ts` belongs to E-OPT-4, not this task.

## 13. Inputs for E-OPT-1B

E-OPT-1B can now be bounded to these decisions:

1. create one intentional **non-temporal engine facade** around existing parse/validate, compile/prepare and snapshot analyse behaviour;
2. expose only boundary-owned input/output types required by a minimal consumer;
3. add one capability/version descriptor without re-exporting concrete model registries;
4. keep ASA Lab `ELECTRONICS_MODULE` as an adapter above that facade;
5. keep model-specific helpers available only where compatibility requires them; do not treat them as facade members;
6. do not expose/freeze timed advance, event horizon, transient continuation or Arduino clock semantics;
7. leave Worker convergence to E-OPT-1E after the facade and dependency tests exist.

## 14. Consumer-search record

Repository-wide search confirmed these boundary facts:

- production package imports are limited to `apps/api` and `apps/web`;
- API production imports only `ELECTRONICS_MODULE` directly;
- Web production imports both package entries and a significant number of model-specific helpers;
- no production app file was found bypassing the package with a direct `contexts/electronics/domain/*` import;
- direct source imports found outside the context are test/benchmark/config/tooling concerns;
- `compileCircuit` has internal scheduler/test consumers but no production package consumer outside Electronics;
- `solveCircuit` is exported at the root but the only package-level outside-context call found is a Web test, not production code.

This means E-OPT-1B can introduce a smaller supported facade without first rewriting the production solver call graph. Compatibility work will mainly concern Web model-helper imports and the Worker bridge.

## 15. Explicit non-actions

E-OPT-1A made no change to:

- `contexts/electronics/**` production source;
- solver equations or result semantics;
- Arduino parser/runtime/scheduler behaviour;
- Worker protocol, evaluator, controller or stale-generation semantics;
- physical/simulation time;
- components, profiles, SVG/assets or UI behaviour;
- API, database, Docker or deployment state;
- golden fixtures.

No new public facade is declared by this document. Names and exact type ownership remain an E-OPT-1B design/implementation decision.

## 16. Acceptance conclusion

The current boundary is sufficiently inventoried to start E-OPT-1B as a separate owner-selected task. The evidence identifies package exports, real production consumers, server verification, Worker bypass/host coupling, pure dependency direction, temporal surfaces to defer, and a bounded set of non-temporal facade candidates.

**STOP:** E-OPT-1B is not started by this evidence task.
