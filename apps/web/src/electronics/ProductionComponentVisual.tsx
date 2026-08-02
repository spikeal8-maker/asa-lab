import type { SchematicComponent } from '../api';
import type { CatalogEntry, ComponentVisualState } from './component-catalog';
import { visualAsset } from './component-catalog';
import {
  potentiometerKnobAngle,
  RESISTOR_BAND_CSS,
  resistorBandState,
  rgbLedColour,
  rgbLedState,
  sevenSegmentState,
  type RgbCommonMode,
  type ResistorTolerancePercent,
  type SevenSegmentId,
} from './production-asset-contracts';

interface Props {
  readonly entry: CatalogEntry;
  readonly component: SchematicComponent;
  readonly width: number;
  readonly height: number;
  readonly visualState: ComponentVisualState;
  readonly effectiveBrightness?: number;
  readonly selected?: boolean;
  readonly selectionOffset?: number;
  readonly simulationRunning?: boolean;
}

const SEGMENT_BOXES: Readonly<Record<SevenSegmentId, readonly [number, number, number, number]>> = {
  a: [4.306, 3.166, 6.309, 1.218],
  b: [8.963, 3.788, 2.058, 5.493],
  c: [7.961, 9.769, 1.95, 5.466],
  d: [2.302, 14.639, 6.147, 1.218],
  e: [1.652, 9.714, 2.004, 5.521],
  f: [2.735, 3.788, 1.95, 5.466],
  g: [3.439, 8.876, 5.849, 1.217],
  dp: [9.763, 14.6, 1.408, 1.408],
};

export function ProductionComponentVisual({
  entry,
  component,
  width,
  height,
  visualState,
  effectiveBrightness,
  selected = false,
  selectionOffset = 2,
  simulationRunning = false,
}: Props): JSX.Element {
  const properties = component.stateProperties ?? {};
  const visualComponent =
    entry.key === 'led-5mm' && effectiveBrightness !== undefined
      ? {
          ...component,
          stateProperties: { ...properties, ledBrightness: effectiveBrightness },
        }
      : component;
  const asset = visualAsset(entry, visualComponent, visualState);
  const toleranceValue = Number(properties['tolerancePercent'] ?? 5);
  const tolerance: ResistorTolerancePercent = [1, 2, 5, 10].includes(toleranceValue)
    ? (toleranceValue as ResistorTolerancePercent)
    : 5;
  const resistorBands =
    entry.key === 'resistor-axial'
      ? resistorBandState(Math.max(0.1, Number(component.value ?? 220)), tolerance).bands
      : null;
  const selectionFilterId = `component-selection-${component.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const imageFit = entry.assetFit === 'stretch' ? 'none' : 'xMidYMid meet';
  return (
    <svg
      className="workbench-production-visual"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      aria-hidden="true"
    >
      {selected ? (
        <g className="workbench-selection-silhouette" pointerEvents="none" aria-hidden="true">
          <defs>
            <filter
              id={selectionFilterId}
              x={-selectionOffset * 2}
              y={-selectionOffset * 2}
              width={width + selectionOffset * 4}
              height={height + selectionOffset * 4}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feMorphology
                in="SourceAlpha"
                operator="dilate"
                radius={selectionOffset}
                result="expanded"
              />
              <feComposite in="expanded" in2="SourceAlpha" operator="out" result="outline" />
              <feFlood floodColor="#3b8ed7" result="outlineColour" />
              <feComposite in="outlineColour" in2="outline" operator="in" />
            </filter>
          </defs>
          <image
            href={asset}
            width={width}
            height={height}
            preserveAspectRatio={imageFit}
            filter={`url(#${selectionFilterId})`}
          />
        </g>
      ) : null}
      {entry.key === 'resistor-axial' ? (
        <g className="workbench-owner-resistor">
          <image href={asset} width={width} height={height} preserveAspectRatio="none" />
          {resistorBands ? (
            <g data-testid="resistor-colour-bands">
              {resistorBands.map((band, index) => {
                // Zones are mapped to the four colour bands in the exact owner SVG.
                // The owner body and leads stay untouched; only the electrical
                // colour-code zones change with resistance and tolerance.
                const positions = [0.326, 0.443, 0.553, 0.667] as const;
                return (
                  <rect
                    key={`${band}-${index}`}
                    data-band={index + 1}
                    x={width * 0.264}
                    y={height * positions[index]}
                    width={width * 0.528}
                    height={height * 0.056}
                    rx={width * 0.018}
                    fill={RESISTOR_BAND_CSS[band]}
                  />
                );
              })}
            </g>
          ) : null}
        </g>
      ) : (
        <image href={asset} width={width} height={height} preserveAspectRatio={imageFit} />
      )}

      {entry.key === 'rgb-led' ? (
        <ellipse
          data-testid="rgb-led-mixture"
          cx={width * 0.5}
          cy={height * 0.36}
          rx={width * 0.24}
          ry={height * 0.27}
          fill={rgbLedColour(
            rgbLedState(
              Number(properties['red'] ?? 0),
              Number(properties['green'] ?? 0),
              Number(properties['blue'] ?? 0),
              String(properties['commonMode'] ?? 'common-cathode') as RgbCommonMode,
            ),
          )}
          opacity={
            (Math.max(
              Number(properties['red'] ?? 0),
              Number(properties['green'] ?? 0),
              Number(properties['blue'] ?? 0),
            ) /
              100) *
            0.72
          }
          style={{ mixBlendMode: 'screen' }}
        />
      ) : null}

      {entry.key === 'seven-segment-display' ? (
        <g data-testid="seven-segment-state" pointerEvents="none">
          {(() => {
            const custom = String(properties['segmentMask'] ?? '')
              .split(/[,\s]+/)
              .filter((segment): segment is SevenSegmentId => segment in SEGMENT_BOXES);
            const state =
              custom.length > 0
                ? {
                    active: new Set<SevenSegmentId>(custom),
                    brightness: simulationRunning
                      ? Number(properties['segmentBrightness'] ?? 100)
                      : 0,
                  }
                : sevenSegmentState(
                    String(properties['glyph'] ?? '0'),
                    simulationRunning ? Number(properties['segmentBrightness'] ?? 100) : 0,
                  );
            return [...state.active].map((segment) => {
              const [x, y, segmentWidth, segmentHeight] = SEGMENT_BOXES[segment];
              return segment === 'dp' ? (
                <circle
                  key={segment}
                  data-segment={segment}
                  cx={((x + segmentWidth / 2) / 12.7) * width}
                  cy={((y + segmentHeight / 2) / 19.05) * height}
                  r={(segmentWidth / 2 / 12.7) * width}
                  fill="#ff2424"
                  opacity={state.brightness / 100}
                />
              ) : (
                <rect
                  key={segment}
                  data-segment={segment}
                  x={(x / 12.7) * width}
                  y={(y / 19.05) * height}
                  width={(segmentWidth / 12.7) * width}
                  height={(segmentHeight / 19.05) * height}
                  rx="1"
                  fill="#ff2424"
                  opacity={state.brightness / 100}
                />
              );
            });
          })()}
        </g>
      ) : null}

      {entry.key === 'potentiometer' ? (
        <g
          data-testid="potentiometer-angle"
          transform={`rotate(${potentiometerKnobAngle(component.wiperPosition ?? 0.5)} ${width / 2} ${height * 0.45})`}
          pointerEvents="none"
        >
          <line
            x1={width / 2}
            y1={height * 0.45}
            x2={width / 2}
            y2={height * 0.31}
            stroke="#edf5f7"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </svg>
  );
}
