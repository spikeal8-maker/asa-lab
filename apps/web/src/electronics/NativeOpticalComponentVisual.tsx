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
  const componentId = props.component.id;
  // LED/Uno participate in the prepared-asset ACK barrier. The lamp subscribes
  // to the same store but only reads committed results and never registers layout.
  const lamp = props.entry.key === 'incandescent-lamp';
  const opticalPort =
    props.simulationRunning &&
    (lamp || props.entry.key === 'led-5mm' || props.entry.key === 'arduino-uno')
      ? port
      : null;
  const snapshot = useSyncExternalStore(
    opticalPort?.subscribe ?? idleSubscribe,
    opticalPort?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  useLayoutEffect(() => {
    if (opticalPort && !lamp) return opticalPort.rendered(componentId, snapshot);
    return undefined;
  }, [lamp, opticalPort, componentId, snapshot]);
  if (!opticalPort) {
    return <OwnerVisual {...props} result={lamp ? undefined : props.result} />;
  }
  const observation = lamp ? snapshot.committed : snapshot.observation;
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
      preparedLedAsset={
        asset && snapshot.preparation ? { token: snapshot.preparation.token, asset } : undefined
      }
      committedLedAsset={observation?.ledAssets.get(componentId)}
      rollbackLedAsset={snapshot.rollback?.get(componentId)}
    />
  );
}
