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
/** Only the native visual subscribes: the Stage and its editor do not reconcile for a frame. */
export function ProductionComponentVisual(props: ComponentProps<typeof OwnerVisual>) {
  const port = useContext(Context);
  const opticalPort =
    props.simulationRunning && (props.entry.key === 'led-5mm' || props.entry.key === 'arduino-uno')
      ? port
      : null;
  const snapshot = useSyncExternalStore(
    opticalPort?.subscribe ?? idleSubscribe,
    opticalPort?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  useLayoutEffect(() => {
    if (opticalPort) return opticalPort.rendered(props.component.id, snapshot);
    return undefined;
  }, [opticalPort, props.component.id, snapshot]);
  if (!opticalPort) return <OwnerVisual {...props} />;
  const observation = snapshot.observation;
  const result = opticalPort.resultMap(observation).get(props.component.id);
  const optical = observation?.frame.brightness.get(props.component.id);
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
  const asset = snapshot.preparation?.assets.get(props.component.id);
  return (
    <OwnerVisual
      {...props}
      result={result}
      visualState={visualState}
      simulationTimeMs={(observation?.frame.atMicroseconds ?? 0) / 1000}
      effectiveBrightness={optical ?? result?.brightness ?? 0}
      effectiveArduinoLActive={observation?.frame.arduinoLStates.get(props.component.id)}
      preparedLedAsset={
        asset && snapshot.preparation ? { token: snapshot.preparation.token, asset } : undefined
      }
      committedLedAsset={observation?.ledAssets.get(props.component.id)}
      rollbackLedAsset={snapshot.rollback?.get(props.component.id)}
    />
  );
}
