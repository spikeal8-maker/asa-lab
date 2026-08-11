export type OrdinaryLedColour = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'white';
export type RgbLedChannel = 'red' | 'green' | 'blue';

export interface LedJunctionProfile {
  /** Zero-current intercept of the deterministic piecewise-linear junction model. */
  readonly kneeVoltage: number;
  /** Package/die slope resistance used after the junction begins conducting. */
  readonly dynamicResistanceOhm: number;
  readonly nominalCurrentAmp: number;
  readonly maxContinuousCurrentAmp: number;
  /** Maps electrical current to the perceived 0-100 light level. */
  readonly brightnessExponent: number;
}

const ORDINARY_DYNAMIC_RESISTANCE_OHM = 44.5;
const RGB_DYNAMIC_RESISTANCE_OHM = 1.03;
const NOMINAL_CURRENT_AMP = 0.02;
const MAX_CONTINUOUS_CURRENT_AMP = 0.03;
const BRIGHTNESS_EXPONENT = 0.65;

/**
 * The generic 5 mm parts deliberately keep separate colour profiles. A colour
 * selection is therefore electrical, not just a CSS tint: the same source and
 * arbitrary resistor value produces a different current for each die colour.
 *
 * The intercepts and package resistance preserve the owner-observed Tinkercad
 * 2xAA sweep (normal -> warning -> over-current -> burnout) while remaining a
 * continuous Ohmic branch for every finite resistance entered in the editor.
 */
export const ORDINARY_LED_PROFILES: Readonly<Record<OrdinaryLedColour, LedJunctionProfile>> = {
  red: {
    kneeVoltage: 1.65,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  orange: {
    kneeVoltage: 1.72,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  yellow: {
    kneeVoltage: 1.78,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  green: {
    kneeVoltage: 1.85,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  blue: {
    kneeVoltage: 2.55,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  white: {
    kneeVoltage: 2.65,
    dynamicResistanceOhm: ORDINARY_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
};

/** RGB dies use the observed low package resistance and independent junctions. */
export const RGB_LED_PROFILES: Readonly<Record<RgbLedChannel, LedJunctionProfile>> = {
  red: {
    kneeVoltage: 1.9,
    dynamicResistanceOhm: RGB_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  green: {
    kneeVoltage: 2.2,
    dynamicResistanceOhm: RGB_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  blue: {
    // A finite margin at 3 V is required by the reproduced owner circuit.
    kneeVoltage: 2.98,
    dynamicResistanceOhm: RGB_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    maxContinuousCurrentAmp: MAX_CONTINUOUS_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
};

export function ordinaryLedProfile(colour: string): LedJunctionProfile {
  return ORDINARY_LED_PROFILES[colour as OrdinaryLedColour] ?? ORDINARY_LED_PROFILES.red;
}

export function rgbLedProfile(channel: string): LedJunctionProfile {
  return RGB_LED_PROFILES[channel as RgbLedChannel] ?? RGB_LED_PROFILES.red;
}

/**
 * Continuous at zero and monotonic for every finite positive current. The
 * renderer may quantise this percentage to one of the owner's 101 SVG states,
 * but the electrical result itself is never quantised to a preset resistor.
 */
export function ledBrightnessPercent(
  currentAmp: number,
  profile: Pick<LedJunctionProfile, 'nominalCurrentAmp' | 'brightnessExponent'>,
): number {
  if (!Number.isFinite(currentAmp) || currentAmp <= 0) return 0;
  return Math.min(
    100,
    Math.pow(currentAmp / profile.nominalCurrentAmp, profile.brightnessExponent) * 100,
  );
}
