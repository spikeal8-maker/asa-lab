import { useMemo, useSyncExternalStore } from 'react';
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
export function committedResultProjection(result: SolveResult | null) {
  if (!result) return emptyProjection;
  let projection = projections.get(result);
  if (!projection) {
    projection = projectResult(result);
    projections.set(result, projection);
  }
  return projection;
}

export type CommittedPresentationController = Pick<
  ElectronicsWorkbenchController,
  | 'nativeOpticalPresentation'
  | 'simulationRunning'
  | 'resultByComponent'
  | 'runtimePresentationResultByComponent'
  | 'diagnosticsByComponent'
  | 'errorDiagnosticComponentIds'
>;

export function useCommittedWorkbenchPresentation<T extends CommittedPresentationController>(
  controller: T,
): T {
  const observation = useCommittedObservation(
    controller.simulationRunning ? controller.nativeOpticalPresentation : null,
  );
  const projection = committedResultProjection(observation?.result ?? null);
  return useMemo(
    () =>
      !controller.simulationRunning || !controller.nativeOpticalPresentation
        ? controller
        : { ...controller, ...projection },
    [controller, projection],
  );
}

export type WorkbenchDiagnosticIndicatorsController = CommittedPresentationController &
  Pick<
    ElectronicsWorkbenchController,
    | 'diagnosticsByComponent'
    | 'errorDiagnosticComponentIds'
    | 'runtimePresentationResultByComponent'
    | 'selectComponent'
    | 'simulationRunning'
    | 'viewport'
  >;

export type WorkbenchComponentBodyController = CommittedPresentationController &
  Pick<
    ElectronicsWorkbenchController,
    | 'committedComponentLedAsset'
    | 'componentArduinoLActive'
    | 'componentLedBrightness'
    | 'componentVisualState'
    | 'diagnosticsByComponent'
    | 'document'
    | 'errorDiagnosticComponentIds'
    | 'onLedAssetReadiness'
    | 'preparedComponentLedAsset'
    | 'resetArduinoRuntime'
    | 'rollbackComponentLedAsset'
    | 'runtimePresentationResultByComponent'
    | 'selectComponent'
    | 'selection'
    | 'setMultimeterMeasurementMode'
    | 'setRegulatedPowerSupplyControls'
    | 'setSelectedProperties'
    | 'setSignalGeneratorControls'
    | 'simulationRunning'
    | 'simulationTimeMs'
    | 'startComponentDrag'
    | 'startPotentiometerControl'
    | 'toggleComponentState'
    | 'viewport'
  >;

export type WorkbenchInspectorController = CommittedPresentationController &
  Pick<
    ElectronicsWorkbenchController,
    | 'beginReconnect'
    | 'diagnosticsByComponent'
    | 'libraryOpen'
    | 'removeSelection'
    | 'removeWireBends'
    | 'resetArduinoRuntime'
    | 'resultByComponent'
    | 'selectedComponent'
    | 'selectedEntry'
    | 'selectedFamily'
    | 'selectedWire'
    | 'selection'
    | 'setRegulatedPowerSupplyControls'
    | 'setSelectedMotorShaftLocked'
    | 'setSelectedProperties'
    | 'setSelectedState'
    | 'setSelectedVariant'
    | 'setSelectedWiper'
    | 'setSignalGeneratorControls'
    | 'setWireColor'
    | 'simulationRunning'
    | 'terminalConnectionCount'
    | 'terminalConnectionLabel'
    | 'updateSelectedName'
    | 'updateSelectedResistanceValue'
    | 'updateSelectedValue'
  >;
