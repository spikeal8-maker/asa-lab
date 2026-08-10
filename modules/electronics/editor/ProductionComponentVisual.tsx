import type { CSSProperties } from 'react';
import type { ComponentResult, SchematicComponent } from '../index.js';
import type { CatalogEntry, ComponentVisualState } from './component-catalog';
import { visualAsset } from './component-catalog';
import {
  potentiometerKnobAngle,
  RESISTOR_BAND_CSS,
  resistorBandState,
  rgbLedColour,
  rgbLedState,
  WORLD_UNITS_PER_MM,
  type RgbCommonMode,
  type ResistorTolerancePercent,
  type SevenSegmentId,
} from './production-asset-contracts';

const LED_GLOW_RGB: Readonly<Record<string, string>> = {
  blue: '47, 132, 255',
  green: '46, 214, 82',
  orange: '255, 145, 28',
  red: '255, 48, 56',
  white: '238, 248, 255',
  yellow: '255, 221, 48',
};

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
const TINKERCAD_POTENTIOMETER_KNOB =
  'M18.02,0.13c0-0.04,0.01-0.08,0.01-0.12c0-0.38-0.03-0.76-0.06-1.14L15.7-1.19c-0.01-0.11-0.01-0.23-0.02-0.34L17.9-2c-0.05-0.42-0.11-0.83-0.19-1.24l-2.25,0.2c-0.02-0.11-0.05-0.22-0.07-0.34l2.15-0.73c-0.1-0.41-0.19-0.82-0.31-1.22l-2.23,0.47c-0.03-0.11-0.08-0.21-0.12-0.32l2.05-0.98c-0.14-0.39-0.29-0.79-0.46-1.17L14.3-6.59c-0.05-0.1-0.1-0.21-0.15-0.31l1.92-1.21c-0.19-0.38-0.39-0.74-0.61-1.1l-2.05,0.98c-0.06-0.1-0.12-0.2-0.18-0.29l1.77-1.44c-0.23-0.35-0.49-0.68-0.74-1.01l-1.92,1.21c-0.07-0.09-0.14-0.19-0.21-0.27l1.58-1.62c-0.27-0.32-0.55-0.63-0.84-0.93l-1.76,1.43c-0.08-0.08-0.17-0.15-0.26-0.23l1.38-1.8c-0.31-0.28-0.62-0.57-0.94-0.83L9.7-12.39c-0.09-0.07-0.18-0.14-0.27-0.21l1.16-1.96c-0.34-0.25-0.69-0.48-1.04-0.7l-1.38,1.81c-0.1-0.06-0.2-0.12-0.29-0.18l0.92-2.09c-0.36-0.2-0.74-0.39-1.12-0.57l-1.15,1.95c-0.11-0.05-0.21-0.1-0.31-0.15l0.66-2.17c-0.39-0.16-0.78-0.3-1.18-0.43l-0.91,2.07c-0.11-0.03-0.22-0.06-0.33-0.1l0.4-2.23c-0.4-0.11-0.8-0.23-1.22-0.31l-0.67,2.18c-0.11-0.02-0.23-0.03-0.34-0.05l0.13-2.26c-0.41-0.06-0.83-0.12-1.25-0.16l-0.4,2.24C1-15.7,0.88-15.7,0.76-15.71l-0.13-2.27C0.42-17.98,0.21-18.01,0-18.01s-0.42,0.02-0.63,0.03l-0.13,2.27c-0.12,0.01-0.23,0.01-0.34,0.02l-0.4-2.24c-0.42,0.03-0.83,0.09-1.25,0.16l0.13,2.26c-0.11,0.02-0.23,0.03-0.34,0.05l-0.67-2.18c-0.41,0.08-0.81,0.2-1.22,0.31l0.4,2.23c-0.11,0.03-0.22,0.06-0.33,0.1l-0.91-2.07c-0.4,0.13-0.79,0.27-1.18,0.43l0.66,2.17c-0.11,0.05-0.21,0.1-0.31,0.15l-1.15-1.95c-0.38,0.18-0.76,0.36-1.12,0.56l0.92,2.09c-0.1,0.06-0.2,0.12-0.29,0.18l-1.38-1.81c-0.36,0.22-0.7,0.46-1.04,0.7l1.16,1.96c-0.09,0.07-0.19,0.14-0.27,0.21l-1.59-1.63c-0.33,0.26-0.64,0.54-0.94,0.83l1.38,1.8c-0.08,0.08-0.17,0.15-0.26,0.23l-1.76-1.43c-0.29,0.3-0.57,0.61-0.84,0.93l1.58,1.62c-0.07,0.09-0.14,0.18-0.21,0.27l-1.92-1.21c-0.26,0.33-0.51,0.66-0.74,1.01l1.77,1.44c-0.06,0.1-0.12,0.2-0.18,0.29l-2.05-0.98c-0.22,0.36-0.42,0.73-0.61,1.1l1.92,1.21c-0.05,0.1-0.1,0.2-0.15,0.31l-2.16-0.73c-0.17,0.38-0.32,0.77-0.46,1.17l2.05,0.98c-0.04,0.11-0.08,0.21-0.12,0.32l-2.23-0.47c-0.12,0.4-0.22,0.81-0.31,1.22l2.15,0.72c-0.02,0.11-0.05,0.22-0.07,0.34l-2.25-0.2C-17.78-2.83-17.85-2.42-17.9-2l2.22,0.47c-0.01,0.11-0.01,0.23-0.02,0.34l-2.27,0.07c-0.02,0.38-0.06,0.75-0.06,1.14c0,0.04,0.01,0.08,0.01,0.12l2.27,0.2c0,0.11,0.01,0.23,0.02,0.34l-2.24,0.33c0.02,0.42,0.05,0.84,0.1,1.25l2.27-0.07c0.02,0.11,0.03,0.22,0.05,0.33l-2.19,0.6c0.07,0.42,0.16,0.83,0.26,1.23l2.25-0.34c0.03,0.11,0.05,0.22,0.08,0.33l-2.11,0.86c0.12,0.4,0.27,0.8,0.42,1.19l2.19-0.6c0.04,0.11,0.07,0.22,0.12,0.32l-1.98,1.09c0.17,0.39,0.35,0.76,0.55,1.13l2.1-0.85c0.05,0.1,0.12,0.19,0.17,0.29l-1.84,1.32c0.21,0.36,0.43,0.73,0.66,1.07l2-1.1c0.06,0.09,0.14,0.18,0.2,0.27l-1.68,1.53c0.25,0.34,0.52,0.66,0.79,0.98l1.85-1.33c0.07,0.08,0.15,0.17,0.23,0.25l-1.49,1.72c0.29,0.3,0.6,0.59,0.91,0.87l1.67-1.53c0.08,0.07,0.16,0.15,0.25,0.23l-1.27,1.89c0.32,0.27,0.67,0.51,1.01,0.75l1.48-1.72c0.09,0.06,0.19,0.12,0.28,0.19l-1.03,2.02c0.35,0.23,0.71,0.45,1.08,0.65l1.27-1.89c0.1,0.05,0.2,0.1,0.3,0.15l-0.79,2.13c0.38,0.18,0.76,0.36,1.15,0.51l1.04-2.02c0.1,0.04,0.21,0.08,0.31,0.11l-0.53,2.21c0.4,0.14,0.8,0.25,1.21,0.36l0.79-2.13c0.11,0.03,0.21,0.06,0.32,0.08l-0.27,2.26c0.41,0.09,0.83,0.15,1.24,0.21l0.53-2.2c0.11,0.01,0.22,0.04,0.33,0.05v2.27c0.41,0.04,0.84,0.05,1.26,0.06l0.27-2.25c0.06,0,0.11,0.01,0.17,0.01s0.11-0.01,0.17-0.01l0.27,2.25C0.86,18,1.28,17.99,1.7,17.95v-2.27c0.11-0.01,0.22-0.04,0.33-0.05l0.53,2.2c0.42-0.06,0.84-0.12,1.24-0.21l-0.27-2.26c0.11-0.02,0.22-0.06,0.32-0.08l0.79,2.13c0.41-0.11,0.81-0.23,1.21-0.36l-0.53-2.21c0.1-0.04,0.21-0.07,0.31-0.11l1.04,2.03c0.39-0.16,0.77-0.33,1.15-0.51L7.03,14.1c0.1-0.05,0.2-0.09,0.3-0.15l1.27,1.89c0.37-0.2,0.72-0.43,1.08-0.65l-1.03-2.02c0.09-0.06,0.19-0.12,0.28-0.19l1.48,1.72c0.34-0.24,0.68-0.49,1.01-0.75l-1.27-1.89c0.09-0.07,0.16-0.15,0.25-0.23l1.67,1.53c0.31-0.28,0.62-0.57,0.91-0.87l-1.49-1.72c0.08-0.08,0.15-0.16,0.23-0.25l1.85,1.33c0.28-0.32,0.54-0.64,0.79-0.98l-1.68-1.53c0.07-0.09,0.14-0.18,0.2-0.27l2,1.1c0.24-0.35,0.45-0.71,0.66-1.07L13.7,7.78c0.06-0.1,0.12-0.19,0.17-0.29l2.1,0.85c0.19-0.37,0.38-0.75,0.55-1.13l-1.98-1.09c0.04-0.1,0.08-0.21,0.12-0.32l2.19,0.6c0.15-0.39,0.3-0.78,0.42-1.19l-2.11-0.86c0.03-0.11,0.06-0.22,0.08-0.33l2.25,0.34c0.1-0.4,0.19-0.82,0.26-1.23l-2.19-0.6c0.02-0.11,0.04-0.22,0.05-0.33l2.27,0.07c0.05-0.41,0.08-0.83,0.1-1.25l-2.24-0.33c0.01-0.11,0.02-0.22,0.02-0.34L18.02,0.13z';
const TINKERCAD_POTENTIOMETER_POINTER =
  'M2.56,15.52c0.03,0.53-0.85,2.87-2.57,2.87s-2.59-2.35-2.56-2.87l1.02-10.71c0.03-0.53,0.48-0.96,1.01-0.96h1.07c0.53,0,0.98,0.43,1.01,0.96L2.56,15.52z';

interface Props {
  readonly entry: CatalogEntry;
  readonly component: SchematicComponent;
  readonly width: number;
  readonly height: number;
  readonly visualState: ComponentVisualState;
  readonly effectiveBrightness?: number;
  readonly result?: ComponentResult | undefined;
  readonly selected?: boolean;
  readonly selectionOffset?: number;
  readonly simulationRunning?: boolean;
  readonly onSwitchActuate?: (() => void) | undefined;
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
  result,
  selected = false,
  selectionOffset = 2,
  simulationRunning = false,
  onSwitchActuate,
}: Props): JSX.Element {
  const properties = component.stateProperties ?? {};
  const ledColour = String(properties['ledColour'] ?? 'red');
  const ledBrightness =
    entry.key === 'led-5mm' && simulationRunning
      ? Math.round(Math.min(100, Math.max(0, effectiveBrightness ?? 0)))
      : 0;
  const ledIsLit = entry.key === 'led-5mm' && visualState === 'lit' && ledBrightness > 0;
  const ledRuntimeState =
    entry.key !== 'led-5mm'
      ? undefined
      : !simulationRunning
        ? 'stopped'
        : visualState === 'lit'
          ? 'lit'
          : visualState === 'off'
            ? 'off'
            : 'fault';
  const visualComponent: SchematicComponent =
    entry.key === 'led-5mm' && effectiveBrightness !== undefined
      ? {
          ...component,
          stateProperties: { ...properties, ledBrightness: effectiveBrightness },
        }
      : entry.key === 'incandescent-lamp' && result
        ? {
            ...component,
            stateProperties: {
              ...properties,
              lampLevel:
                (result.brightness ?? 0) >= 90
                  ? 'max'
                  : (result.brightness ?? 0) >= 45
                    ? 'on'
                    : (result.brightness ?? 0) > 0
                      ? 'dim'
                      : 'off',
            },
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
    'potentiometer',
    'switch-spdt',
  ].includes(entry.key);
  return (
    <svg
      className={`workbench-production-visual${
        entry.key === 'led-5mm' ? ` workbench-led-visual${ledIsLit ? ' is-lit' : ''}` : ''
      }`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      data-led-colour={entry.key === 'led-5mm' ? ledColour : undefined}
      data-led-brightness={entry.key === 'led-5mm' ? ledBrightness : undefined}
      data-led-runtime-state={ledRuntimeState}
      style={
        ledIsLit
          ? ({
              '--workbench-led-glow': `rgba(${LED_GLOW_RGB[ledColour] ?? LED_GLOW_RGB['red']}, ${(
                0.28 +
                (ledBrightness / 100) * 0.62
              ).toFixed(3)})`,
            } as CSSProperties)
          : undefined
      }
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
      ) : entry.key === 'potentiometer' ? (
        <g
          className="workbench-tinkercad-potentiometer"
          data-visual-contract="tinkercad-three-pin-rotary"
          transform={`translate(${width / 2} ${24 * TINKERCAD_MODEL_TO_WORLD}) scale(${TINKERCAD_MODEL_TO_WORLD})`}
        >
          {[-10, 0, 10].map((x) => (
            <line
              key={`pin-${x}`}
              x1={x}
              y1="21.57"
              x2={x}
              y2="30"
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
                  y1="21.57"
                  x2={x}
                  y2="30"
                  stroke="#3b8ed7"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
              <circle cx="0" cy="0" r="24" fill="#3b8ed7" stroke="#3b8ed7" strokeWidth="3.5" />
            </g>
          ) : null}
          <circle cx="0" cy="0" r="24" fill="#2c4656" />
          <circle cx="0" cy="3" r="18.13" opacity="0.3" />
          <circle cx="0" cy="0" r="18.13" fill="#6a9cce" />
          {(
            [
              [14.91, 14.91, '#6a9cce'],
              [21.08, 0, '#669bbf'],
              [14.91, -14.91, '#6095b2'],
              [0, -21.08, '#5886a5'],
              [-14.91, -14.91, '#527c99'],
              [-21.08, 0, '#4b728c'],
              [-14.91, 14.91, '#44677f'],
            ] as const
          ).map(([cx, cy, fill]) => (
            <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="1.03" fill={fill} />
          ))}
          <g
            data-testid="potentiometer-angle"
            transform={`rotate(${potentiometerKnobAngle(component.wiperPosition ?? 0.5)})`}
            pointerEvents="none"
          >
            <path d={TINKERCAD_POTENTIOMETER_KNOB} fill="none" stroke="#132b3a" />
            <path d={TINKERCAD_POTENTIOMETER_POINTER} fill="#132b3a" />
          </g>
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
          <g
            data-testid="spdt-actuator"
            transform="translate(0 -10)"
            onPointerDown={
              onSwitchActuate
                ? (event) => {
                    event.stopPropagation();
                    event.preventDefault();
                  }
                : undefined
            }
            onClick={
              onSwitchActuate
                ? (event) => {
                    event.stopPropagation();
                    onSwitchActuate();
                  }
                : undefined
            }
          >
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
        <image
          className={entry.key === 'led-5mm' ? 'workbench-led-asset' : undefined}
          href={asset}
          width={width}
          height={height}
          preserveAspectRatio={imageFit}
        />
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
              simulationRunning ? Number(result?.branchBrightness?.['red'] ?? 0) : 0,
              simulationRunning ? Number(result?.branchBrightness?.['green'] ?? 0) : 0,
              simulationRunning ? Number(result?.branchBrightness?.['blue'] ?? 0) : 0,
              String(properties['commonMode'] ?? 'common-cathode') as RgbCommonMode,
            ),
          )}
          opacity={
            (Math.max(
              simulationRunning ? Number(result?.branchBrightness?.['red'] ?? 0) : 0,
              simulationRunning ? Number(result?.branchBrightness?.['green'] ?? 0) : 0,
              simulationRunning ? Number(result?.branchBrightness?.['blue'] ?? 0) : 0,
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
            return (Object.keys(SEGMENT_BOXES) as SevenSegmentId[]).map((segment) => {
              const brightness = simulationRunning
                ? Number(result?.branchBrightness?.[segment] ?? 0)
                : 0;
              const [x, y, segmentWidth, segmentHeight] = SEGMENT_BOXES[segment];
              return segment === 'dp' ? (
                <circle
                  key={segment}
                  data-segment={segment}
                  cx={((x + segmentWidth / 2) / 12.7) * width}
                  cy={((y + segmentHeight / 2) / 19.05) * height}
                  r={(segmentWidth / 2 / 12.7) * width}
                  fill="#ff2424"
                  opacity={brightness / 100}
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
                  opacity={brightness / 100}
                />
              );
            });
          })()}
        </g>
      ) : null}
    </svg>
  );
}
