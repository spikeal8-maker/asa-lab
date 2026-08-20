export const WORLD_UNITS_PER_MM = 5 as const;
export const BREADBOARD_PITCH_MM = 2.54 as const;
export const PIN_ANCHOR_TOLERANCE_MM = 0.25 as const;

export type OrdinaryLedColour = 'blue' | 'green' | 'orange' | 'red' | 'white' | 'yellow';
export type OrdinaryLedFault = 'none' | 'reverse' | 'overcurrent' | 'burned';
export type RgbCommonMode = 'common-anode' | 'common-cathode';
export type SevenSegmentId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'dp';
export type SevenSegmentColour = 'blue' | 'green' | 'red' | 'white' | 'yellow';
export const SEVEN_SEGMENT_COLOUR_CSS: Readonly<Record<SevenSegmentColour, string>> = {
  red: '#ff2424',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#fbbf24',
  white: '#f8fafc',
};
export const SEVEN_SEGMENT_COLOUR_OPTIONS: readonly {
  value: SevenSegmentColour;
  label: string;
}[] = [
  { value: 'red', label: 'Красный' },
  { value: 'green', label: 'Зелёный' },
  { value: 'blue', label: 'Синий' },
  { value: 'yellow', label: 'Жёлтый' },
  { value: 'white', label: 'Белый' },
];
export type SpdtThrow = 'left' | 'right';
export type MotorDirection = 'clockwise' | 'counterclockwise' | 'stopped';
export type LampState = 'off' | 'dim' | 'on' | 'max';
export type ResistorBandColour =
  | 'black'
  | 'brown'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'violet'
  | 'grey'
  | 'white'
  | 'gold'
  | 'silver';
export type ResistorTolerancePercent = 1 | 2 | 5 | 10;

export interface PhysicalSizeMm {
  readonly width: number;
  readonly height: number;
}

export interface OrdinaryLedState {
  readonly colour: OrdinaryLedColour;
  readonly brightness: number;
  readonly fault: OrdinaryLedFault;
}

export interface RgbLedState {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly commonMode: RgbCommonMode;
}

export interface SevenSegmentState {
  readonly active: ReadonlySet<SevenSegmentId>;
  readonly brightness: number;
}

export interface ResistorBandState {
  readonly resistanceOhms: number;
  readonly tolerancePercent: ResistorTolerancePercent;
  readonly bands: readonly [
    ResistorBandColour,
    ResistorBandColour,
    ResistorBandColour,
    ResistorBandColour,
  ];
}

export interface ProductionReviewStatus {
  readonly vector_reconstruction_ready: boolean;
  readonly transparency_pass: boolean;
  readonly physical_scale_pass: boolean;
  readonly pins_pass: boolean;
  readonly state_animation_pass: boolean;
  readonly breadboard_fit_pass: boolean | null;
  readonly owner_accepted: boolean;
  readonly production_ready: boolean;
}

const clampPercent = (value: number): number => Math.round(Math.min(100, Math.max(0, value)));

const RESISTOR_DIGIT_COLOURS = [
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
  'grey',
  'white',
] as const;

const RESISTOR_MULTIPLIER_COLOURS: Readonly<Record<number, ResistorBandColour>> = {
  [-2]: 'silver',
  [-1]: 'gold',
  0: 'black',
  1: 'brown',
  2: 'red',
  3: 'orange',
  4: 'yellow',
  5: 'green',
  6: 'blue',
  7: 'violet',
  8: 'grey',
  9: 'white',
};

const RESISTOR_TOLERANCE_COLOURS: Readonly<Record<ResistorTolerancePercent, ResistorBandColour>> = {
  1: 'brown',
  2: 'red',
  5: 'gold',
  10: 'silver',
};

export const RESISTOR_BAND_CSS: Readonly<Record<ResistorBandColour, string>> = {
  black: '#111111',
  brown: '#8b4513',
  red: '#e41f26',
  orange: '#f28c18',
  yellow: '#f3d328',
  green: '#228b45',
  blue: '#1769aa',
  violet: '#7c3f98',
  grey: '#8b8b8b',
  white: '#f5f5f5',
  gold: '#c8a43b',
  silver: '#b8bec4',
};

export function physicalToWorld(size: PhysicalSizeMm): PhysicalSizeMm {
  return { width: size.width * WORLD_UNITS_PER_MM, height: size.height * WORLD_UNITS_PER_MM };
}

export function ordinaryLedState(
  colour: OrdinaryLedColour,
  brightness: number,
  fault: OrdinaryLedFault = 'none',
): OrdinaryLedState {
  return { colour, brightness: clampPercent(brightness), fault };
}

export function ordinaryLedAsset(state: OrdinaryLedState): string {
  if (state.fault === 'reverse')
    return '/assets/electronics/owner-audit/components/led/special/led_red_reverse_polarity.svg';
  if (state.fault === 'overcurrent')
    return '/assets/electronics/owner-audit/components/led/special/led_orange_overcurrent.svg';
  if (state.fault === 'burned')
    return '/assets/electronics/owner-audit/components/led/special/led_red_burned.svg';
  return `/assets/electronics/owner-audit/components/led/${state.colour}/led_${state.colour}_i${String(
    state.brightness,
  ).padStart(3, '0')}.svg`;
}

export function rgbLedState(
  red: number,
  green: number,
  blue: number,
  commonMode: RgbCommonMode,
): RgbLedState {
  return {
    red: clampPercent(red),
    green: clampPercent(green),
    blue: clampPercent(blue),
    commonMode,
  };
}

export function rgbLedColour(state: RgbLedState): string {
  const channel = (value: number) => Math.round((clampPercent(value) / 100) * 255);
  return `rgb(${channel(state.red)}, ${channel(state.green)}, ${channel(state.blue)})`;
}

export function rgbLedDisplayColour(state: RgbLedState): string {
  const maximum = Math.max(state.red, state.green, state.blue);
  if (maximum <= 0) return 'rgb(0, 0, 0)';
  const channel = (value: number) => Math.round((clampPercent(value) / maximum) * 255);
  return `rgb(${channel(state.red)}, ${channel(state.green)}, ${channel(state.blue)})`;
}

export function rgbLedVisualOpacity(state: RgbLedState): number {
  const brightness = Math.max(state.red, state.green, state.blue);
  if (brightness <= 0) return 0;
  return Number((0.08 + Math.sqrt(brightness / 100) * 0.85).toFixed(3));
}

const SEVEN_SEGMENT_GLYPHS: Readonly<Record<string, readonly SevenSegmentId[]>> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['b', 'c', 'f', 'g'],
  '5': ['a', 'c', 'd', 'f', 'g'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  A: ['a', 'b', 'c', 'e', 'f', 'g'],
  b: ['c', 'd', 'e', 'f', 'g'],
  C: ['a', 'd', 'e', 'f'],
  d: ['b', 'c', 'd', 'e', 'g'],
  E: ['a', 'd', 'e', 'f', 'g'],
  F: ['a', 'e', 'f', 'g'],
};

export function sevenSegmentState(
  glyph: string,
  brightness: number,
  decimalPoint = false,
): SevenSegmentState {
  const active = new Set<SevenSegmentId>(SEVEN_SEGMENT_GLYPHS[glyph] ?? []);
  if (decimalPoint) active.add('dp');
  return { active, brightness: clampPercent(brightness) };
}

export function resistorBandState(
  requestedOhms: number,
  tolerancePercent: ResistorTolerancePercent = 5,
): ResistorBandState {
  const resistanceOhms = Math.min(99_000_000_000, Math.max(0.1, requestedOhms));
  let exponent = Math.floor(Math.log10(resistanceOhms)) - 1;
  let significant = Math.round(resistanceOhms / 10 ** exponent);
  if (significant >= 100) {
    significant = 10;
    exponent += 1;
  }
  exponent = Math.min(9, Math.max(-2, exponent));
  significant = Math.min(99, Math.max(10, significant));
  return {
    resistanceOhms,
    tolerancePercent,
    bands: [
      RESISTOR_DIGIT_COLOURS[Math.floor(significant / 10)],
      RESISTOR_DIGIT_COLOURS[significant % 10],
      RESISTOR_MULTIPLIER_COLOURS[exponent],
      RESISTOR_TOLERANCE_COLOURS[tolerancePercent],
    ],
  };
}

export function buttonContactPairs(pressed: boolean): readonly (readonly [string, string])[] {
  return pressed
    ? [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
        ['SW-A1', 'SW-B1'],
      ]
    : [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ];
}

export function spdtConnections(selected: SpdtThrow): readonly (readonly [string, string])[] {
  return [['common', selected === 'left' ? 'throw-left' : 'throw-right']];
}

export function potentiometerKnobAngle(wiperPosition: number): number {
  // The pointer shape in the SVG points down (toward the pins) at rotate(0).
  // Adding 180° makes the tip follow the pointer during drag and puts the
  // extremes where they belong electrically: 0 aims at terminal-1 (down-left),
  // 1 at terminal-2 (down-right). Without the offset the knob moved opposite
  // to the mouse and min/max looked mirrored.
  return 45 + Math.min(1, Math.max(0, wiperPosition)) * 270;
}

export function lampState(powerRatio: number): LampState {
  const value = Math.min(1, Math.max(0, powerRatio));
  if (value === 0) return 'off';
  if (value < 0.45) return 'dim';
  if (value < 0.9) return 'on';
  return 'max';
}

export function motorMotion(
  speed: number,
  direction: Exclude<MotorDirection, 'stopped'>,
): {
  readonly speed: number;
  readonly direction: MotorDirection;
  readonly durationSeconds: number | null;
} {
  const normalized = Math.min(1, Math.max(0, speed));
  return {
    speed: normalized,
    direction: normalized === 0 ? 'stopped' : direction,
    durationSeconds: normalized === 0 ? null : Math.round((1.2 - normalized) * 1000) / 1000,
  };
}

export function servoAngle(angle: number): number {
  return Math.min(180, Math.max(0, angle));
}

export function productionLibraryEligible(
  status: ProductionReviewStatus,
  breadboardApplicable: boolean,
): boolean {
  return (
    status.vector_reconstruction_ready &&
    status.transparency_pass &&
    status.physical_scale_pass &&
    status.pins_pass &&
    status.state_animation_pass &&
    (!breadboardApplicable || status.breadboard_fit_pass === true) &&
    status.owner_accepted &&
    status.production_ready
  );
}
