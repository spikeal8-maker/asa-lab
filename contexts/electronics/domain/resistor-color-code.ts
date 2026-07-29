export type ResistorBandColor =
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

export interface ResistorBandDefinition {
  readonly color: ResistorBandColor;
  readonly hex: string;
  readonly digit?: number;
  readonly multiplierExponent?: number;
  readonly tolerancePercent?: number;
}

export interface FourBandResistorCode {
  readonly requestedOhms: number;
  readonly representedOhms: number;
  readonly tolerancePercent: 1 | 2 | 5 | 10;
  readonly significantDigits: readonly [number, number];
  readonly multiplierExponent: number;
  readonly bands: readonly [
    ResistorBandDefinition,
    ResistorBandDefinition,
    ResistorBandDefinition,
    ResistorBandDefinition,
  ];
  readonly relativeRepresentationError: number;
}

const DIGIT_BANDS: readonly ResistorBandDefinition[] = [
  { color: 'black', hex: '#17191c', digit: 0, multiplierExponent: 0 },
  { color: 'brown', hex: '#6f3d1f', digit: 1, multiplierExponent: 1, tolerancePercent: 1 },
  { color: 'red', hex: '#c82f27', digit: 2, multiplierExponent: 2, tolerancePercent: 2 },
  { color: 'orange', hex: '#ed7d16', digit: 3, multiplierExponent: 3 },
  { color: 'yellow', hex: '#e6c62b', digit: 4, multiplierExponent: 4 },
  { color: 'green', hex: '#2d8b57', digit: 5, multiplierExponent: 5 },
  { color: 'blue', hex: '#2d5fa8', digit: 6, multiplierExponent: 6 },
  { color: 'violet', hex: '#7046a1', digit: 7, multiplierExponent: 7 },
  { color: 'grey', hex: '#7b858d', digit: 8, multiplierExponent: 8 },
  { color: 'white', hex: '#f1f3f4', digit: 9, multiplierExponent: 9 },
];
const GOLD: ResistorBandDefinition = {
  color: 'gold',
  hex: '#c7a23a',
  multiplierExponent: -1,
  tolerancePercent: 5,
};
const SILVER: ResistorBandDefinition = {
  color: 'silver',
  hex: '#b9bec3',
  multiplierExponent: -2,
  tolerancePercent: 10,
};

function digitBand(digit: number): ResistorBandDefinition {
  const band = DIGIT_BANDS[digit];
  if (!band) throw new Error(`unsupported resistor digit: ${digit}`);
  return band;
}

function multiplierBand(exponent: number): ResistorBandDefinition {
  if (exponent === -2) return SILVER;
  if (exponent === -1) return GOLD;
  const band = DIGIT_BANDS.find((candidate) => candidate.multiplierExponent === exponent);
  if (!band) throw new Error(`unsupported resistor multiplier exponent: ${exponent}`);
  return band;
}

function toleranceBand(tolerancePercent: 1 | 2 | 5 | 10): ResistorBandDefinition {
  if (tolerancePercent === 5) return GOLD;
  if (tolerancePercent === 10) return SILVER;
  const band = DIGIT_BANDS.find(
    (candidate) => candidate.tolerancePercent === tolerancePercent,
  );
  if (!band) throw new Error(`unsupported resistor tolerance: ${tolerancePercent}%`);
  return band;
}

/**
 * Convert a positive resistance to the nearest representable four-band code.
 * The model is deterministic and intentionally keeps rendering logic separate
 * from the electrical resistance value stored in the project document.
 */
export function resistorFourBandCode(
  requestedOhms: number,
  tolerancePercent: 1 | 2 | 5 | 10 = 5,
): FourBandResistorCode {
  if (!Number.isFinite(requestedOhms) || requestedOhms <= 0) {
    throw new Error('resistance must be a positive finite number');
  }

  let multiplierExponent = Math.floor(Math.log10(requestedOhms)) - 1;
  multiplierExponent = Math.max(-2, Math.min(9, multiplierExponent));
  let significant = Math.round(requestedOhms / 10 ** multiplierExponent);
  if (significant >= 100 && multiplierExponent < 9) {
    significant = Math.round(significant / 10);
    multiplierExponent += 1;
  }
  significant = Math.max(10, Math.min(99, significant));

  const first = Math.floor(significant / 10);
  const second = significant % 10;
  const representedOhms = significant * 10 ** multiplierExponent;
  const relativeRepresentationError = Math.abs(representedOhms - requestedOhms) / requestedOhms;

  return {
    requestedOhms,
    representedOhms,
    tolerancePercent,
    significantDigits: [first, second],
    multiplierExponent,
    bands: [
      digitBand(first),
      digitBand(second),
      multiplierBand(multiplierExponent),
      toleranceBand(tolerancePercent),
    ],
    relativeRepresentationError,
  };
}

export function resistorBandCssColors(
  requestedOhms: number,
  tolerancePercent: 1 | 2 | 5 | 10 = 5,
): readonly [string, string, string, string] {
  const code = resistorFourBandCode(requestedOhms, tolerancePercent);
  return code.bands.map((band) => band.hex) as [string, string, string, string];
}
