import { useSyncExternalStore } from 'react';
import type { SchematicComponent } from '../api';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';
import type { diagnosticBadgeGeometry } from './workbench-geometry';
import { diagnosticsGroupedByComponent } from './diagnostic-presentation';
import { EMPTY_NATIVE_OPTICAL_SNAPSHOT } from './native-optical-presentation';

const idleSubscribe = () => () => {};
const idleSnapshot = () => EMPTY_NATIVE_OPTICAL_SNAPSHOT;

/** The small diagnostic consumer follows the same observation as the native LED body. */
export function NativeLedDiagnostic({
  controller: c,
  component,
  entryKey,
  baseSize,
  badgeAnchor,
  badgeAnchorKind,
  badgeGeometry,
}: {
  readonly controller: ElectronicsWorkbenchController;
  readonly component: SchematicComponent;
  readonly entryKey: string;
  readonly baseSize: { readonly width: number; readonly height: number };
  readonly badgeAnchor: { readonly x: number; readonly y: number };
  readonly badgeAnchorKind: string;
  readonly badgeGeometry: ReturnType<typeof diagnosticBadgeGeometry>;
}) {
  const port = entryKey === 'led-5mm' && c.simulationRunning ? c.nativeOpticalPresentation : null;
  const snapshot = useSyncExternalStore(
    port?.subscribe ?? idleSubscribe,
    port?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const observation = snapshot.observation;
  if (entryKey === 'led-5mm' && c.simulationRunning && !observation) return null;
  const componentDiagnostics = observation
    ? (diagnosticsGroupedByComponent(observation.result.diagnostics).get(component.id) ?? [])
    : (c.diagnosticsByComponent.get(component.id) ?? []);
  const diagnostics = componentDiagnostics.map((diagnostic) => diagnostic.code);
  const actionableDiagnostics = componentDiagnostics.filter(
    (diagnostic) => diagnostic.severity !== 'info',
  );
  const isLedIndicator = entryKey === 'led-5mm';
  const isRgbLed = entryKey === 'rgb-led';
  const presentationResult = observation
    ? c.nativeOpticalPresentation.resultMap(observation).get(component.id)
    : c.runtimePresentationResultByComponent.get(component.id);
  const ledBurned =
    (isLedIndicator || isRgbLed) &&
    (presentationResult?.presentationState === 'failed' ||
      (isLedIndicator &&
        (presentationResult?.deviceHealth === 'failed_open' ||
          presentationResult?.damageState === 'failed')) ||
      (isRgbLed && diagnostics.includes('led_burnout')));
  const ledOvercurrent = isLedIndicator && diagnostics.includes('led_overcurrent');
  const primaryDiagnostic = ledBurned
    ? actionableDiagnostics.find((diagnostic) => diagnostic.code === 'led_burnout')
    : ledOvercurrent
      ? actionableDiagnostics.find((diagnostic) => diagnostic.code === 'led_overcurrent')
      : actionableDiagnostics[0];
  const diagnosticText = primaryDiagnostic
    ? `${primaryDiagnostic.message}${
        primaryDiagnostic.suggestedAction ? ` ${primaryDiagnostic.suggestedAction}` : ''
      }`
    : '';
  // The ordinary Tinkercad LED keeps reverse and disconnected states
  // visually quiet. Its on-canvas marker exists only for actual
  // over-current, and the destructive state replaces it with the
  // starburst. Other components retain their existing diagnostics.
  const showDiagnosticIndicator = isLedIndicator
    ? ledOvercurrent || ledBurned
    : !isRgbLed || ledBurned;
  if (!c.simulationRunning || !primaryDiagnostic || !showDiagnosticIndicator) return null;
  return (
    // Слой рисуется поверх схемы, поэтому метка обязана называть свою
    // деталь: иначе по разметке не понять, о чём предупреждение, — ни
    // тесту, ни человеку, который читает страницу.
    <g
      key={component.id}
      transform={`translate(${badgeAnchor.x} ${badgeAnchor.y})`}
      data-testid="component-diagnostic"
      data-screen-upright="true"
      data-anchor={badgeAnchorKind}
      data-component-id={component.id}
      data-component-type={component.componentTypeId}
      data-kind={component.kind}
    >
      <g
        className={`workbench-component-diagnostic-indicator${
          ledBurned ? ' workbench-led-burnout-explosion' : ''
        }${(observation ? actionableDiagnostics.some((diagnostic) => diagnostic.severity === 'error') : c.errorDiagnosticComponentIds.has(component.id)) ? ' error' : ''}`}
        data-testid={
          ledBurned
            ? entryKey === 'rgb-led'
              ? 'rgb-led-burnout-explosion'
              : 'led-burnout-explosion'
            : isLedIndicator
              ? 'led-diagnostic-badge'
              : 'component-diagnostic-indicator'
        }
        data-diagnostic-count={actionableDiagnostics.length}
        pointerEvents="all"
        role="img"
        tabIndex={0}
        aria-label={diagnosticText}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          c.selectComponent(component.id, event.shiftKey);
        }}
      >
        {ledBurned ? (
          // Sized from the part, not from the screen: the burst is ~85% of
          // the component's smaller side and lives in world units, so it
          // grows and shrinks together with the LED when zooming instead of
          // covering it at every zoom level.
          <g
            transform={`scale(${(Math.min(baseSize.width, baseSize.height) * 0.85) / 68})`}
            aria-hidden="true"
          >
            <path
              className="workbench-led-explosion-outer"
              d="M0-30 7-17 20-24 18-9 33-8 22 3 34 13 18 14 19 30 6 21 0 35-7 21-20 29-18 14-34 13-22 3-33-8-18-9-20-24-7-17Z"
            />
            <path
              className="workbench-led-explosion-inner"
              d="M0-22 5-11 16-16 13-5 24 0 13 5 16 16 5 11 0 23-5 11-16 16-13 5-24 0-13-5-16-16-5-11Z"
            />
          </g>
        ) : (
          <>
            <circle r={badgeGeometry.radius} vectorEffect="non-scaling-stroke" />
            <text y={badgeGeometry.textBaseline} fontSize={badgeGeometry.fontSize}>
              !
            </text>
          </>
        )}
      </g>
    </g>
  );
}
