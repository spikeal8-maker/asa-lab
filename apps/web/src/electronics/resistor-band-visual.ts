export type ResistorVisualColor =
  | 'black'
  | 'brown'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'violet'
  | 'gray'
  | 'white'
  | 'gold'
  | 'silver';

export interface ResistorVisualBand {
  readonly color: ResistorVisualColor;
  readonly cssColor: string;
  readonly meaning: 'digit-1' | 'digit-2' | 'multiplier' | 'tolerance';
}

export interface ResistorVisualCode {
  readonly requestedOhms: number;
  readonly representedOhms: number;
  readonly relativeError: number;
  readonly tolerancePercent: 1 | 2 | 5 | 10;
  readonly bands: readonly [ResistorVisualBand, ResistorVisualBand, ResistorVisualBand, ResistorVisualBand];
}

const DIGIT_COLORS: readonly ResistorVisualColor[] = [
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
  'gray',
  'white',
];
const MULTIPLIER_COLORS: Readonly<Record<number, ResistorVisualColor>> = {
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
  8: 'gray',
  9: 'white',
};
const TOLERANCE_COLORS: Readonly<Record<1 | 2 | 5 | 10, ResistorVisualColor>> = {
  1: 'brown',
  2: 'red',
  5: 'gold',
  10: 'silver',
};
const CSS_COLORS: Readonly<Record<ResistorVisualColor, string>> = {
  black: '#17191b',
  brown: '#7a3f22',
  red: '#cc2735',
  orange: '#ed7d20',
  yellow: '#e9c927',
  green: '#2b8b57',
  blue: '#2874b8',
  violet: '#7351a3',
  gray: '#777d82',
  white: '#f4f4ed',
  gold: '#c99a2e',
  silver: '#aeb4b8',
};

function band(
  color: ResistorVisualColor,
  meaning: ResistorVisualBand['meaning'],
): ResistorVisualBand {
  return { color, cssColor: CSS_COLORS[color], meaning };
}

/**
 * Browser-side visual adapter for the shared four-band domain contract.
 * A parity test compares this adapter with the domain implementation so the
 * renderer cannot silently drift from the saved electrical value.
 */
export function resistorVisualCode(
  requestedOhms: number,
  tolerancePercent: 1 | 2 | 5 | 10 = 5,
): ResistorVisualCode {
  if (!Number.isFinite(requestedOhms) || requestedOhms <= 0) {
    throw new Error('resistance must be a positive finite number');
  }
  let exponent = Math.floor(Math.log10(requestedOhms)) - 1;
  let significant = Math.round(requestedOhms / 10 ** exponent);
  if (significant >= 100) {
    significant = Math.round(significant / 10);
    exponent += 1;
  }
  exponent = Math.max(-2, Math.min(9, exponent));
  significant = Math.max(10, Math.min(99, Math.round(requestedOhms / 10 ** exponent)));
  const first = Math.floor(significant / 10);
  const second = significant % 10;
  const representedOhms = significant * 10 ** exponent;
  const multiplier = MULTIPLIER_COLORS[exponent];
  if (!multiplier) throw new Error(`unsupported resistor multiplier exponent: ${exponent}`);
  return {
    requestedOhms,
    representedOhms,
    relativeError: Math.abs(representedOhms - requestedOhms) / requestedOhms,
    tolerancePercent,
    bands: [
      band(DIGIT_COLORS[first]!, 'digit-1'),
      band(DIGIT_COLORS[second]!, 'digit-2'),
      band(multiplier, 'multiplier'),
      band(TOLERANCE_COLORS[tolerancePercent], 'tolerance'),
    ],
  };
}
