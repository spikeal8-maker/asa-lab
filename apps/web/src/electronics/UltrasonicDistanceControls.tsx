import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SchematicComponent } from '../api';
import { catalogEntry, renderedSize } from './component-catalog';
import { useCommittedWorkbenchPresentation } from './committed-result-presentation';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';
import { componentTransform } from './workbench-model';
import {
  ULTRASONIC_TARGET_GEOMETRY,
  formatUltrasonicTargetDistance,
  ultrasonicTargetAtPoint,
  ultrasonicTargetPoint,
  type Point,
  type UltrasonicTargetPosition,
} from './workbench-geometry';

export type UltrasonicDistanceComponentTypeId = 'ultrasonic-sensor' | 'ultrasonic-hc-sr04';

export function UltrasonicDistanceControls({
  componentTypeId,
  distanceMeters,
  onChange,
}: {
  readonly componentTypeId: UltrasonicDistanceComponentTypeId;
  readonly distanceMeters: number;
  readonly onChange: (distanceMeters: number) => void;
}): JSX.Element {
  const maximumMeters = componentTypeId === 'ultrasonic-hc-sr04' ? 4 : 3;
  return (
    <label>
      <span>Расстояние, м</span>
      <input
        aria-label="Расстояние ультразвукового датчика, м"
        type="number"
        min="0.02"
        max={String(maximumMeters)}
        step="0.01"
        value={distanceMeters}
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= 0.02 && value <= maximumMeters) onChange(value);
        }}
      />
    </label>
  );
}

// Original owner SVG transducer centers, normalized by each artwork viewBox.
const TRANSDUCER_CENTERS = {
  'ultrasonic-hc-sr04': { left: 152 / 738, right: 585 / 738, y: 163 / 415 },
  'ultrasonic-sensor': { left: 63 / 285, right: 221.5 / 285, y: 70 / 168 },
} as const;

type TargetController = Pick<
  ElectronicsWorkbenchController,
  | 'nativeOpticalPresentation'
  | 'simulationRunning'
  | 'resultByComponent'
  | 'runtimePresentationResultByComponent'
  | 'diagnosticsByComponent'
  | 'errorDiagnosticComponentIds'
  | 'setRuntimeSensorDistance'
  | 'setSelectedProperties'
  | 'viewport'
>;

interface TargetDrag {
  readonly pointerId: number;
  readonly initial: UltrasonicTargetPosition;
  readonly offset: Point;
  latest: UltrasonicTargetPosition;
}

function supplyStatus(
  voltages: Readonly<Partial<Record<string, number>>> | undefined,
): 'waiting' | 'no-power' | 'powered' {
  const vcc = voltages?.vcc;
  const gnd = voltages?.gnd;
  if (vcc === undefined || gnd === undefined) return 'waiting';
  // Both model profiles require 4.5–5.5 V. Supply status never implies a returned pulse.
  return vcc - gnd >= 4.5 && vcc - gnd <= 5.5 ? 'powered' : 'no-power';
}

export function UltrasonicTargetOverlay({
  controller,
  component,
  componentTypeId,
}: {
  readonly controller: TargetController;
  readonly component: SchematicComponent;
  readonly componentTypeId: UltrasonicDistanceComponentTypeId;
}): JSX.Element | null {
  const sensorSupply = (voltages: Readonly<Partial<Record<string, number>>> | undefined) => {
    const result = controller.nativeOpticalPresentation?.getCommittedSnapshot()?.result;
    return result?.diagnostics.some((entry) => entry.code === 'no_source')
      ? 'no-power'
      : supplyStatus(voltages);
  };
  const c = useCommittedWorkbenchPresentation(controller, (projection) =>
    sensorSupply(
      projection.runtimePresentationResultByComponent.get(component.id)?.terminalVoltages,
    ),
  );
  const localRef = useRef<SVGGElement>(null);
  const drag = useRef<TargetDrag | null>(null);
  const [angle, setAngle] = useState(0);
  const [preview, setPreview] = useState<UltrasonicTargetPosition | null>(null);
  const [screenScale, setScreenScale] = useState(1);
  const [focused, setFocused] = useState(false);

  const entry = catalogEntry(component);
  const { minimumDistanceMeters, minimumRadius, maximumRadius, halfAngle } =
    ULTRASONIC_TARGET_GEOMETRY;
  const maximumDistanceMeters = componentTypeId === 'ultrasonic-hc-sr04' ? 4 : 3;
  const rawDistance = component.stateProperties?.['distanceMeters'] ?? 1;
  const distanceValid =
    typeof rawDistance === 'number' &&
    Number.isFinite(rawDistance) &&
    rawDistance >= minimumDistanceMeters &&
    rawDistance <= maximumDistanceMeters;

  useLayoutEffect(() => {
    const node = localRef.current;
    const svg = node?.ownerSVGElement;
    if (!node || !svg) return;
    const update = () => {
      const matrix = node.getScreenCTM();
      if (!matrix) return;
      const scale = Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
      if (Number.isFinite(scale) && scale > 0) setScreenScale(scale);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [c.viewport.zoom, component.rotation, distanceValid, entry]);

  if (!entry?.enabled || !distanceValid) return null;
  const { left, right, y } = TRANSDUCER_CENTERS[componentTypeId];
  const { width, height } = renderedSize(entry, 0);
  const origin = { x: ((left + right) / 2) * width, y: y * height };
  const current = preview ?? { angle, distanceMeters: rawDistance };
  const target = ultrasonicTargetPoint(origin, current, maximumDistanceMeters);
  const point = (distanceMeters: number, polarAngle: number) =>
    ultrasonicTargetPoint(origin, { distanceMeters, angle: polarAngle }, maximumDistanceMeters);
  const innerLeft = point(minimumDistanceMeters, -halfAngle);
  const innerRight = point(minimumDistanceMeters, halfAngle);
  const outerLeft = point(maximumDistanceMeters, -halfAngle);
  const outerRight = point(maximumDistanceMeters, halfAngle);
  const sector = [
    'M',
    innerLeft.x,
    innerLeft.y,
    'L',
    outerLeft.x,
    outerLeft.y,
    'A',
    maximumRadius,
    maximumRadius,
    0,
    0,
    1,
    outerRight.x,
    outerRight.y,
    'L',
    innerRight.x,
    innerRight.y,
    'A',
    minimumRadius,
    minimumRadius,
    0,
    0,
    0,
    innerLeft.x,
    innerLeft.y,
    'Z',
  ].join(' ');
  const noReflection =
    componentTypeId === 'ultrasonic-hc-sr04' && component.stateProperties?.echoAvailable === false;
  const power = c.simulationRunning
    ? sensorSupply(c.runtimePresentationResultByComponent.get(component.id)?.terminalVoltages)
    : 'stopped';
  const muted = noReflection || (power !== 'powered' && power !== 'stopped');
  const status =
    power === 'no-power'
      ? 'нет питания'
      : power === 'waiting'
        ? 'питание не подтверждено'
        : noReflection
          ? 'отражение выключено'
          : '';
  const mirrorX = component.stateProperties?.mirrorX === true ? -1 : 1;
  const mirrorY = component.stateProperties?.mirrorY === true ? -1 : 1;
  const inverseTextTransform = [
    'translate(' + origin.x + ' -8)',
    'scale(' + mirrorX + ' ' + mirrorY + ')',
    'rotate(' + -(component.rotation ?? 0) + ')',
    'scale(' + 1 / screenScale + ')',
  ].join(' ');
  const stroke = muted ? '#576777' : '#175b92';

  const publish = (distanceMeters: number): boolean => {
    // The current HC Run setter enables reflection. Keep a stored false intact.
    if (c.simulationRunning)
      return !noReflection && c.setRuntimeSensorDistance(component.id, distanceMeters);
    c.setSelectedProperties({ distanceMeters });
    return true;
  };
  const localPoint = (event: ReactPointerEvent<SVGCircleElement>): Point | null => {
    const matrix = localRef.current?.getScreenCTM();
    return matrix
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      : null;
  };
  const move = (event: ReactPointerEvent<SVGCircleElement>) => {
    event.stopPropagation();
    const interaction = drag.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const local = localPoint(event);
    if (!local) return;
    const sample = ultrasonicTargetAtPoint(
      origin,
      { x: local.x + interaction.offset.x, y: local.y + interaction.offset.y },
      maximumDistanceMeters,
    );
    if (!sample) return;
    if (
      c.simulationRunning &&
      sample.distanceMeters !== interaction.latest.distanceMeters &&
      !publish(sample.distanceMeters)
    )
      return;
    interaction.latest = sample;
    setPreview(sample);
  };
  const finish = (pointerId: number, cancel: boolean) => {
    const interaction = drag.current;
    if (!interaction || interaction.pointerId !== pointerId) return;
    drag.current = null;
    if (!cancel) setAngle(interaction.latest.angle);
    if (
      cancel === c.simulationRunning &&
      interaction.latest.distanceMeters !== interaction.initial.distanceMeters
    )
      publish(cancel ? interaction.initial.distanceMeters : interaction.latest.distanceMeters);
    setPreview(null);
  };

  return (
    <g
      ref={localRef}
      transform={componentTransform(component)}
      data-testid="ultrasonic-target-overlay"
      data-component-id={component.id}
      data-power={power}
      data-distance-m={current.distanceMeters}
    >
      <path
        d={sector}
        fill={stroke}
        fillOpacity={muted ? 0.05 : 0.14}
        stroke={stroke}
        strokeOpacity={0.65}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
        aria-hidden="true"
      />
      {[left, right].map((transducer) => (
        <line
          key={transducer}
          x1={transducer * width}
          y1={origin.y}
          x2={target.x}
          y2={target.y}
          stroke={stroke}
          strokeWidth={1}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          aria-hidden="true"
        />
      ))}
      <text
        transform={inverseTextTransform}
        textAnchor="middle"
        fill={stroke}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
        fontSize={13}
        fontWeight={600}
        pointerEvents="none"
      >
        {'Цель: ' + formatUltrasonicTargetDistance(current.distanceMeters)}
        {status ? (
          <tspan x={0} dy={16}>
            {status}
          </tspan>
        ) : null}
      </text>
      <circle
        cx={target.x}
        cy={target.y}
        r={12 / screenScale}
        fill="transparent"
        role="slider"
        tabIndex={0}
        aria-label="Расстояние до цели, см"
        aria-valuemin={minimumDistanceMeters * 100}
        aria-valuemax={maximumDistanceMeters * 100}
        aria-valuenow={current.distanceMeters * 100}
        aria-valuetext={formatUltrasonicTargetDistance(current.distanceMeters)}
        aria-disabled={c.simulationRunning && noReflection}
        data-testid="ultrasonic-target"
        style={{ touchAction: 'none', cursor: 'grab' }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (
            event.button !== 0 ||
            !event.isPrimary ||
            drag.current ||
            (c.simulationRunning && noReflection)
          )
            return;
          const local = localPoint(event);
          if (!local) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = {
            pointerId: event.pointerId,
            initial: current,
            latest: current,
            offset: { x: target.x - local.x, y: target.y - local.y },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          move(event);
          finish(event.pointerId, false);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          finish(event.pointerId, true);
        }}
        onLostPointerCapture={(event) => finish(event.pointerId, true)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const pointerId = drag.current?.pointerId;
          if (event.key === 'Escape' && pointerId !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            finish(pointerId, true);
            if (event.currentTarget.hasPointerCapture(pointerId))
              event.currentTarget.releasePointerCapture(pointerId);
            return;
          }
          if (pointerId !== undefined) return;
          const { key } = event;
          const distanceCm = Math.round(current.distanceMeters * 100);
          let nextDistanceCm: number;
          switch (key) {
            case 'Home':
              nextDistanceCm = minimumDistanceMeters * 100;
              break;
            case 'End':
              nextDistanceCm = maximumDistanceMeters * 100;
              break;
            case 'ArrowUp':
            case 'ArrowRight':
              nextDistanceCm = distanceCm + 1;
              break;
            case 'ArrowDown':
            case 'ArrowLeft':
              nextDistanceCm = distanceCm - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
          const next = Math.min(
            maximumDistanceMeters,
            Math.max(minimumDistanceMeters, nextDistanceCm / 100),
          );
          if (next !== current.distanceMeters) publish(next);
        }}
      />
      <circle
        cx={target.x}
        cy={target.y}
        r={(focused ? 9 : 7) / screenScale}
        fill={muted ? '#f4f6f8' : '#fff'}
        stroke={stroke}
        strokeWidth={focused ? 3 : 2}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
        aria-hidden="true"
      />
    </g>
  );
}
