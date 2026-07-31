export const WORLD_UNITS_PER_MM = 5 as const;
export const PIN_ANCHOR_TOLERANCE_MM = 0.25 as const;

export type OrdinaryLedColour = 'blue' | 'green' | 'orange' | 'red' | 'white' | 'yellow';
export type OrdinaryLedFault = 'none' | 'reverse' | 'overcurrent' | 'burned';
export type RgbCommonMode = 'common-anode' | 'common-cathode';
export type SevenSegmentId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'dp';
export type SpdtThrow = 'left' | 'right';
export type MotorDirection = 'clockwise' | 'counterclockwise' | 'stopped';
export type LampState = 'off' | 'dim' | 'on' | 'max';

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
  if (state.fault !== 'none') {
    return `/assets/electronics/production/states/led/special/${state.fault}.svg`;
  }
  return `/assets/electronics/production/states/led/${state.colour}/${String(state.brightness).padStart(3, '0')}.svg`;
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
  return -135 + Math.min(1, Math.max(0, wiperPosition)) * 270;
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
