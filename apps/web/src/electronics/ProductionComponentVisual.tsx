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
  WORLD_UNITS_PER_MM,
  type RgbCommonMode,
  type ResistorTolerancePercent,
  type SevenSegmentId,
} from './production-asset-contracts';

const TINKERCAD_MODEL_UNIT_MM = 0.254;
const TINKERCAD_MODEL_TO_WORLD = TINKERCAD_MODEL_UNIT_MM * WORLD_UNITS_PER_MM;
const TINKERCAD_RESISTOR_BODY =
  'M3.69-3.66c0-2.16,1.11-2.67,1.11-5.53s-3.35-3.81-3.58-4.55c-0.17-0.53-0.19-0.95-0.19-0.95s0.05-0.25-0.56-0.28-1.49,0.28-1.49,0.28-0.02,0.41-0.19,0.95C-1.45-13.01-4.8-12.06-4.8-9.2s1.11,3.37,1.11,5.53c0,0.99,0,6.05,0,7.04,0,2.16-1.11,2.67-1.11,5.53s3.35,3.81,3.58,4.55c0.17,0.53,0.19,0.95,0.19,0.95s-0.01,0.42,0.5,0.42,1.55-0.42,1.55-0.42,0.02-0.41,0.19-0.95c0.23-0.74,3.58-1.69,3.58-4.55S3.69,5.53,3.69,3.38C3.69,2.39,3.69-2.68,3.69-3.66z';
const TINKERCAD_RESISTOR_BAND_PATHS = [
  'M-4.8,8.91c0-0.7,0.07-1.25,0.17-1.73h9.26c0.1,0.48,0.17,1.03,0.17,1.73,0,0.3-0.04,0.57-0.11,0.82h-9.38c-0.06-0.25-0.11-0.53-0.11-0.82z',
  'M3.69,3.38c0-0.24,0-0.71,0-1.31h-7.38c0,0.6,0,1.07,0,1.31,0,0.49-0.06,0.89-0.15,1.25h7.68c-0.09-0.37-0.15-0.77-0.15-1.25z',
  'M3.69-3.06h-7.38c0,0.63,0,1.58,0,2.56h7.38C3.69-1.48,3.69-2.43,3.69-3.06z',
  'M-4.8-9.2c0,0.22,0.02,0.41,0.03,0.6h9.53c0.01-0.2,0.03-0.38,0.03-0.6,0-0.13-0.01-0.25-0.03-0.37h-9.53C-4.78-9.45-4.8-9.33-4.8-9.2z',
] as const;
const TINKERCAD_BUTTON_FRAME =
  'M11-11.5c0.28,0,0.5,0.22,0.5,0.5v22c0,0.28-0.22,0.5-0.5,0.5h-22c-0.28,0-0.5-0.22-0.5-0.5v-22c0-0.28,0.22-0.5,0.5-0.5H11 M11-12h-22c-0.55,0-1,0.45-1,1v22c0,0.55,0.45,1,1,1h22c0.55,0,1-0.45,1-1v-22C12-11.55,11.55-12,11-12L11-12z';
const TINKERCAD_BUTTON_RIM =
  'M0-6.99c-3.86,0-6.99,3.13-6.99,6.99S-3.86,6.99,0,6.99c3.86,0,6.99-3.13,6.99-6.99C6.99-3.86,3.86-6.99,0-6.99z M0,6.44c-3.56,0-6.43-2.88-6.43-6.44S-3.55-6.44,0-6.44c3.56,0,6.44,2.88,6.44,6.44S3.56,6.44,0,6.44z';

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
  const usesMeasuredTinkercadGeometry = [
    'resistor-axial',
    'diode-do35',
    'button-tactile-6mm',
    'switch-spdt',
  ].includes(entry.key);
  return (
    <svg
      className="workbench-production-visual"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      aria-hidden="true"
    >
      {selected && !usesMeasuredTinkercadGeometry ? (
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
        <g
          className="workbench-owner-resistor"
          data-visual-contract="tinkercad-four-pitch"
          transform={`translate(${width / 2} ${height / 2}) scale(${TINKERCAD_MODEL_TO_WORLD})`}
        >
          <line
            x1="0"
            y1="-20"
            x2="0"
            y2="20"
            stroke="#8c8c8c"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {selected ? (
            <g className="workbench-tinkercad-selection" pointerEvents="none">
              <line
                x1="0"
                y1="-20"
                x2="0"
                y2="20"
                fill="none"
                stroke="#3b8ed7"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={TINKERCAD_RESISTOR_BODY}
                fill="#3b8ed7"
                stroke="#3b8ed7"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ) : null}
          <path d={TINKERCAD_RESISTOR_BODY} fill="#d9b477" />
          {resistorBands ? (
            <g data-testid="resistor-colour-bands">
              {TINKERCAD_RESISTOR_BAND_PATHS.map((path, index) => {
                const sourceIndex = [0, 1, 2, 3][index] as number;
                const band = resistorBands[sourceIndex];
                return band ? (
                  <path
                    key={`${band}-${index}`}
                    data-band={index + 1}
                    d={path}
                    fill={RESISTOR_BAND_CSS[band]}
                  />
                ) : null;
              })}
              <rect x="-0.16" y="-9.57" width="4.63" height="0.97" opacity="0.4" />
              <rect x="-4.65" y="-9.57" width="2.38" height="0.97" fill="#ffff33" opacity="0.5" />
            </g>
          ) : null}
        </g>
      ) : entry.key === 'diode-do35' ? (
        <g
          className="workbench-tinkercad-diode"
          data-visual-contract="tinkercad-four-pitch"
          transform={`translate(${width / 2} ${height / 2}) rotate(-90) scale(${TINKERCAD_MODEL_TO_WORLD})`}
        >
          <line
            x1="0"
            y1="-20"
            x2="0"
            y2="20"
            stroke="#8c8c8c"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {selected ? (
            <g className="workbench-tinkercad-selection" pointerEvents="none">
              <line
                x1="0"
                y1="-20"
                x2="0"
                y2="20"
                fill="none"
                stroke="#3b8ed7"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="-4.75"
                y="-12.5"
                width="9.5"
                height="25"
                rx="1"
                fill="#3b8ed7"
                stroke="#3b8ed7"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ) : null}
          <rect x="-4.75" y="-12.5" width="9.5" height="25" rx="1" fill="#333333" />
          <rect x="-4.75" y="5.5" width="9.5" height="2.3" fill="#67757f" />
        </g>
      ) : entry.key === 'button-tactile-6mm' ? (
        <g
          className="workbench-tinkercad-button"
          data-visual-contract="tinkercad-four-pin-6x6"
          transform={`translate(${width / 2} ${height / 2}) scale(${TINKERCAD_MODEL_TO_WORLD})`}
        >
          <line
            x1="-10"
            y1="-15"
            x2="-10"
            y2="15"
            stroke="#8c8c8c"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1="10"
            y1="-15"
            x2="10"
            y2="15"
            stroke="#8c8c8c"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {selected ? (
            <g className="workbench-tinkercad-selection" pointerEvents="none">
              <line
                x1="-10"
                y1="-15"
                x2="-10"
                y2="15"
                stroke="#3b8ed7"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="10"
                y1="-15"
                x2="10"
                y2="15"
                stroke="#3b8ed7"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <rect
                x="-12"
                y="-12"
                width="24"
                height="24"
                rx="1"
                fill="none"
                stroke="#3b8ed7"
                strokeWidth="3"
              />
            </g>
          ) : null}
          <rect x="-12" y="-12" width="24" height="24" rx="1" fill="#bfbfbf" />
          <path d={TINKERCAD_BUTTON_FRAME} fill="#a3a3a3" />
          {[
            [-8.58, -8.58],
            [8.58, -8.58],
            [-8.58, 8.57],
            [8.58, 8.57],
          ].map(([cx, cy]) => (
            <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="2.5" fill="#4c4c4c" />
          ))}
          {visualState !== 'pressed' ? <circle cx="0" cy="1.5" r="6.99" opacity="0.3" /> : null}
          <circle cx="0" cy="0" r="6.99" fill="#333333" />
          <path d={TINKERCAD_BUTTON_RIM} fill="#f4f4f4" opacity="0.2" />
        </g>
      ) : entry.key === 'switch-spdt' ? (
        <g
          className="workbench-tinkercad-switch"
          data-visual-contract="tinkercad-spdt-three-pin"
          transform={`translate(${width / 2} ${height}) scale(${TINKERCAD_MODEL_TO_WORLD})`}
        >
          {[-10, 0, 10].map((x) => (
            <line
              key={`pin-${x}`}
              x1={x}
              y1="0"
              x2={x}
              y2="-5"
              stroke="#8c8c8c"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
          {selected ? (
            <g className="workbench-tinkercad-selection" pointerEvents="none">
              {[-10, 0, 10].map((x) => (
                <line
                  key={`selected-${x}`}
                  x1={x}
                  y1="0"
                  x2={x}
                  y2="-5"
                  stroke="#3b8ed7"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
              <rect
                x="-14"
                y="-15"
                width="28"
                height="10"
                rx="1"
                fill="#3b8ed7"
                stroke="#3b8ed7"
                strokeWidth="3.5"
              />
            </g>
          ) : null}
          <g transform="translate(0 -10)">
            <rect x="-14" y="-5" width="28" height="10" rx="1" fill="#565656" />
            <rect x="-9.5" y="-3.75" width="19" height="7.5" fill="#222222" />
            <g transform={visualState === 'on' ? undefined : 'translate(-10 0)'} stroke="#afafaf">
              {[2, 3.5, 5, 6.5, 8].map((x) => (
                <line key={x} x1={x} y1="-2.75" x2={x} y2="2.75" />
              ))}
            </g>
          </g>
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
