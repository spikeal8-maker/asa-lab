import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { ProductionComponentVisual as OwnerVisual } from './ProductionComponentVisual';
import {
  committedResultProjection,
  useCommittedObservation,
} from './committed-result-presentation';
import {
  EMPTY_NATIVE_OPTICAL_SNAPSHOT,
  NativeOpticalPresentation,
} from './native-optical-presentation';
const Context = createContext<NativeOpticalPresentation | null>(null);
const idleSubscribe = () => () => {};
const idleSnapshot = () => EMPTY_NATIVE_OPTICAL_SNAPSHOT;
export function NativeOpticalProvider({
  port,
  children,
}: {
  readonly port: NativeOpticalPresentation;
  readonly children?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  useLayoutEffect(() => {
    port.afterLayout(snapshot);
  }, [port, snapshot]);
  return <Context.Provider value={port}>{children}</Context.Provider>;
}
/** Visual leaves subscribe: the Stage and its editor do not reconcile for a frame. */
export function ProductionComponentVisual(props: ComponentProps<typeof OwnerVisual>) {
  const port = useContext(Context);
  const componentId = props.component.id;
  const nativeKind = [
    'led-5mm',
    'arduino-uno',
    'servo-motor',
    'seven-segment-display',
    'multimeter',
    'regulated-power-supply',
    'signal-generator',
    'oscilloscope',
  ].indexOf(props.entry.key);
  const committedOnly = nativeKind >= 4 || nativeKind === 2;
  const opticalPort = props.simulationRunning && nativeKind >= 0 ? port : null;
  const snapshot = useSyncExternalStore(
    opticalPort?.subscribe ?? idleSubscribe,
    opticalPort?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  useLayoutEffect(() => {
    if (opticalPort) return opticalPort.rendered(componentId, snapshot);
    return undefined;
  }, [opticalPort, componentId, snapshot]);
  // Native resource leases belong to the mounted OwnerVisual. Keep its parent
  // path identical across Run/Stop rather than remounting it through a wrapper.
  if (!opticalPort)
    return nativeKind >= 0 ? <OwnerVisual {...props} /> : <CommittedComponentVisual {...props} />;
  // Servo and raw display follow committed physics without waiting for an editor render.
  // Proposed optical frames still belong to the LED/native-asset commit barrier.
  const observation =
    committedOnly ||
    (nativeKind === 3 && !snapshot.observation?.frame.sevenSegmentBrightness?.has(componentId))
      ? snapshot.committed
      : snapshot.observation;
  const result = opticalPort.resultMap(observation).get(componentId);
  const optical = observation?.frame.brightness.get(componentId);
  let visualState = props.visualState;
  if (props.component.kind === 'led') {
    visualState =
      result?.presentationState === 'failed' ||
      result?.deviceHealth === 'failed_open' ||
      result?.damageState === 'failed'
        ? 'burned'
        : result?.junctionState === 'reverse_blocking'
          ? 'reverse'
          : result?.presentationState === 'destructive'
            ? 'overcurrent'
            : (optical ?? result?.brightness ?? 0) > 0
              ? 'lit'
              : 'off';
  }
  const asset = snapshot.preparation?.assets.get(componentId);
  return (
    <OwnerVisual
      {...props}
      result={result}
      visualState={visualState}
      simulationTimeMs={(observation?.frame.atMicroseconds ?? 0) / 1000}
      effectiveBrightness={optical ?? result?.brightness ?? 0}
      effectiveArduinoLActive={observation?.frame.arduinoLStates.get(componentId)}
      effectiveSevenSegmentBrightness={observation?.frame.sevenSegmentBrightness?.get(componentId)}
      preparedLedAsset={
        asset && snapshot.preparation ? { token: snapshot.preparation.token, asset } : undefined
      }
      committedLedAsset={observation?.ledAssets.get(componentId)}
      rollbackLedAsset={snapshot.rollback?.get(componentId)}
    />
  );
}

/** Ordinary electrical visuals share the committed result, never a proposed optical frame. */
function CommittedComponentVisual(props: ComponentProps<typeof OwnerVisual>) {
  const port = useContext(Context);
  // This existing asset has no runtime-result branch in OwnerVisual. Unknown
  // assets keep the live subscription, including future dynamic components.
  const passiveAsset = props.entry.key === 'resistor-axial';
  const observation = useCommittedObservation(
    props.simulationRunning && !passiveAsset ? port : null,
  );
  if (!port || !props.simulationRunning || passiveAsset) return <OwnerVisual {...props} />;
  const result = committedResultProjection(observation?.result ?? null).resultByComponent.get(
    props.component.id,
  );
  let visualState = props.visualState;
  if (props.component.kind === 'lamp') visualState = result?.lit ? 'lit' : 'off';
  if (props.component.kind === 'rgb-led') {
    visualState =
      result?.presentationState === 'failed'
        ? 'burned'
        : result?.presentationState === 'destructive'
          ? result?.stressState === 'burned'
            ? 'burned'
            : 'overcurrent'
          : result?.lit
            ? 'lit'
            : 'off';
  }
  return (
    <OwnerVisual
      {...props}
      result={result}
      visualState={visualState}
      simulationTimeMs={(observation?.frame.atMicroseconds ?? 0) / 1000}
    />
  );
}
