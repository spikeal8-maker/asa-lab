import { useSyncExternalStore } from 'react';
import type { SolveResult } from '../api';
import type { NativeOpticalPresentation } from './native-optical-presentation';
import { diagnosticsGroupedByComponent } from './diagnostic-presentation';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

const idleSubscribe = () => () => {};
const emptyObservation = () => null;
export function useCommittedObservation(presentation: NativeOpticalPresentation | null) {
  return useSyncExternalStore(
    presentation?.subscribe ?? idleSubscribe,
    presentation?.getCommittedSnapshot ?? emptyObservation,
    emptyObservation,
  );
}

function projectResult(result: SolveResult | null) {
  const diagnosticsByComponent = diagnosticsGroupedByComponent(result?.diagnostics ?? []);
  const resultByComponent = new Map(
    (result?.components ?? []).map((item) => [item.componentId, item]),
  );
  return {
    resultByComponent,
    runtimePresentationResultByComponent: resultByComponent,
    diagnosticsByComponent,
    errorDiagnosticComponentIds: new Set(
      [...diagnosticsByComponent]
        .filter(([, items]) => items.some((item) => item.severity === 'error'))
        .map(([id]) => id),
    ),
  };
}
// Weak ownership retires projections with their results; every mounted consumer
// shares the same maps rather than rebuilding the circuit once per component.
const projections = new WeakMap<SolveResult, ReturnType<typeof projectResult>>();
const emptyProjection = projectResult(null);
const controllers = new WeakMap<
  ElectronicsWorkbenchController,
  WeakMap<ReturnType<typeof projectResult>, ElectronicsWorkbenchController>
>();
export function committedResultProjection(result: SolveResult | null) {
  if (!result) return emptyProjection;
  let projection = projections.get(result);
  if (!projection) {
    projection = projectResult(result);
    projections.set(result, projection);
  }
  return projection;
}

export function useCommittedWorkbenchPresentation(controller: ElectronicsWorkbenchController) {
  const observation = useCommittedObservation(
    controller.simulationRunning ? controller.nativeOpticalPresentation : null,
  );
  if (!controller.simulationRunning || !controller.nativeOpticalPresentation) return controller;
  const projection = committedResultProjection(observation?.result ?? null);
  let views = controllers.get(controller);
  if (!views) {
    views = new WeakMap();
    controllers.set(controller, views);
  }
  let view = views.get(projection);
  if (!view) {
    view = { ...controller, ...projection };
    views.set(projection, view);
  }
  return view;
}
