export const RESISTANCE_UNITS = [
  { id: 'pΩ', multiplier: 1e-12 },
  { id: 'nΩ', multiplier: 1e-9 },
  { id: 'μΩ', multiplier: 1e-6 },
  { id: 'mΩ', multiplier: 1e-3 },
  { id: 'Ω', multiplier: 1 },
  { id: 'kΩ', multiplier: 1e3 },
  { id: 'MΩ', multiplier: 1e6 },
  { id: 'GΩ', multiplier: 1e9 },
] as const;

export type ResistanceUnit = (typeof RESISTANCE_UNITS)[number]['id'];

export function defaultResistanceUnit(value: number): ResistanceUnit {
  if (value >= 1e9) return 'GΩ';
  if (value >= 1e6) return 'MΩ';
  if (value >= 1e3) return 'kΩ';
  if (value > 0 && value < 1e-6) return 'nΩ';
  if (value > 0 && value < 1e-3) return 'μΩ';
  if (value > 0 && value < 1) return 'mΩ';
  return 'Ω';
}

export function resistanceMultiplier(unit: ResistanceUnit): number {
  return RESISTANCE_UNITS.find((candidate) => candidate.id === unit)?.multiplier ?? 1;
}

export function resistanceDisplayValue(value: number, unit: ResistanceUnit): number {
  return Number((value / resistanceMultiplier(unit)).toPrecision(9));
}

export function resistanceValueInOhms(displayValue: number, unit: ResistanceUnit): number {
  return displayValue * resistanceMultiplier(unit);
}
