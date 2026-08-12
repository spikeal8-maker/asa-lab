export type OrdinaryLedColour = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'white';
export type RgbLedChannel = 'red' | 'green' | 'blue';

export interface LedLinearSegment {
  /** The segment becomes active at this forward-current operating point. */
  readonly minimumCurrentAmp: number;
  readonly kneeVoltage: number;
  readonly dynamicResistanceOhm: number;
}

export interface LedJunctionProfile {
  /** Zero-current intercept of the deterministic piecewise-linear junction model. */
  readonly kneeVoltage: number;
  /** Package/die slope resistance used after the junction begins conducting. */
  readonly dynamicResistanceOhm: number;
  readonly nominalCurrentAmp: number;
  /** Current at which the simulator shows the destructive package effect. */
  readonly burnoutCurrentAmp: number;
  /** Maps electrical current to the perceived 0-100 light level. */
  readonly brightnessExponent: number;
  /** Optional continuous piecewise-linear curve for a measured junction. */
  readonly linearSegments?: readonly LedLinearSegment[];
  /** Whether a pre-limit warning is part of the reference component behaviour. */
  readonly nearLimitWarning?: boolean;
}

const RGB_DYNAMIC_RESISTANCE_OHM = 1.03;
const RGB_BLUE_DYNAMIC_RESISTANCE_OHM = 23;
const NOMINAL_CURRENT_AMP = 0.02;
const RGB_BURNOUT_CURRENT_AMP = 0.03;
const ORDINARY_REFERENCE_BURNOUT_CURRENT_AMP = 0.13;
const BRIGHTNESS_EXPONENT = 0.65;

/**
 * The red 5 mm reference sweep at 3 V exposes four operating points:
 * 31.9 mA at 25 ohm, 58.4 mA at 10 ohm, 120 mA at 1 ohm and 136 mA at
 * 0 ohm. The three lines below join those points continuously. This avoids a
 * made-up preset table: arbitrary resistance still produces a continuous
 * electrical result while the captured reference points remain reproducible.
 */
const RED_REFERENCE_LINEAR_SEGMENTS: readonly LedLinearSegment[] = [
  {
    minimumCurrentAmp: 0,
    kneeVoltage: 1.945494339622642,
    dynamicResistanceOhm: 8.056603773584897,
  },
  {
    minimumCurrentAmp: 0.0584,
    kneeVoltage: 1.9761038961038961,
    dynamicResistanceOhm: 7.532467532467533,
  },
  { minimumCurrentAmp: 0.12, kneeVoltage: 1.98, dynamicResistanceOhm: 7.5 },
];

function ordinaryProfile(kneeOffset: number): LedJunctionProfile {
  const linearSegments = RED_REFERENCE_LINEAR_SEGMENTS.map((segment) => ({
    ...segment,
    kneeVoltage: segment.kneeVoltage + kneeOffset,
  }));
  const first = linearSegments[0]!;
  return {
    kneeVoltage: first.kneeVoltage,
    dynamicResistanceOhm: first.dynamicResistanceOhm,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    burnoutCurrentAmp: ORDINARY_REFERENCE_BURNOUT_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
    linearSegments,
    // The captured ordinary LED has no badge below 20 mA. Its single warning
    // appears only after the recommended maximum has actually been exceeded.
    nearLimitWarning: false,
  };
}

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
  red: ordinaryProfile(0),
  orange: ordinaryProfile(0.07),
  yellow: ordinaryProfile(0.13),
  green: ordinaryProfile(0.2),
  blue: ordinaryProfile(0.9),
  white: ordinaryProfile(1),
};

/** RGB dies use the observed low package resistance and independent junctions. */
export const RGB_LED_PROFILES: Readonly<Record<RgbLedChannel, LedJunctionProfile>> = {
  red: {
    kneeVoltage: 1.9,
    dynamicResistanceOhm: RGB_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    burnoutCurrentAmp: RGB_BURNOUT_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  green: {
    kneeVoltage: 2.2,
    dynamicResistanceOhm: RGB_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    burnoutCurrentAmp: RGB_BURNOUT_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
  blue: {
    // Keep the higher blue junction voltage, but leave enough conduction
    // margin for the owner's 2xAA reference: equal 220 ohm green and blue
    // branches must produce a visibly mixed cyan output instead of a green
    // LED with a mathematically non-zero but imperceptible blue channel.
    kneeVoltage: 2.55,
    // The separate slope also preserves the observed 3 V direct-blue warning
    // point: lowering only the knee would incorrectly turn that reference
    // circuit into an immediate burnout.
    dynamicResistanceOhm: RGB_BLUE_DYNAMIC_RESISTANCE_OHM,
    nominalCurrentAmp: NOMINAL_CURRENT_AMP,
    burnoutCurrentAmp: RGB_BURNOUT_CURRENT_AMP,
    brightnessExponent: BRIGHTNESS_EXPONENT,
  },
};

export function ordinaryLedProfile(colour: string): LedJunctionProfile {
  return ORDINARY_LED_PROFILES[colour as OrdinaryLedColour] ?? ORDINARY_LED_PROFILES.red;
}

export function rgbLedProfile(channel: string): LedJunctionProfile {
  return RGB_LED_PROFILES[channel as RgbLedChannel] ?? RGB_LED_PROFILES.red;
}

export function ledLinearSegment(
  profile: LedJunctionProfile,
  currentAmp: number,
): LedLinearSegment {
  const fallback: LedLinearSegment = {
    minimumCurrentAmp: 0,
    kneeVoltage: profile.kneeVoltage,
    dynamicResistanceOhm: profile.dynamicResistanceOhm,
  };
  const segments = profile.linearSegments ?? [fallback];
  let selected = segments[0] ?? fallback;
  for (const segment of segments) {
    if (currentAmp + 1e-10 < segment.minimumCurrentAmp) break;
    selected = segment;
  }
  return selected;
}

/** Exact series helper used by focused calibration tests and reference tools. */
export function ledCurrentForSeriesResistance(
  sourceVoltage: number,
  seriesResistanceOhm: number,
  profile: LedJunctionProfile,
): number {
  const fallback: LedLinearSegment = {
    minimumCurrentAmp: 0,
    kneeVoltage: profile.kneeVoltage,
    dynamicResistanceOhm: profile.dynamicResistanceOhm,
  };
  const segments = profile.linearSegments ?? [fallback];
  const resistance = Math.max(0, seriesResistanceOhm);
  for (const [index, segment] of segments.entries()) {
    const current = Math.max(
      0,
      (sourceVoltage - segment.kneeVoltage) / (resistance + segment.dynamicResistanceOhm),
    );
    const next = segments[index + 1];
    if (!next || current + 1e-10 < next.minimumCurrentAmp) return current;
  }
  return 0;
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
