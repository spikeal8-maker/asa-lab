import type { RoboticsBall, RoboticsBody } from '@asa-lab/robotics/world-document';

/** Example educational object sizes; not certified product or competition standards. */
export const BALL_PRESETS = [
  { id: 'pool', label: 'Для сухого бассейна · Ø 7 см', radiusMeters: 0.035, massKg: 0.012 },
  { id: 'tennis', label: 'Теннисный · Ø 6,7 см', radiusMeters: 0.0335, massKg: 0.057 },
  { id: 'practice', label: 'Мягкий игровой · Ø 12 см', radiusMeters: 0.06, massKg: 0.05 },
  { id: 'football', label: 'Большой игровой · Ø 22 см', radiusMeters: 0.11, massKg: 0.43 },
] as const;
export type BallPresetId = (typeof BALL_PRESETS)[number]['id'];

export function applyBallPreset(ball: RoboticsBall, presetId: BallPresetId): RoboticsBall {
  const preset = BALL_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error('Неизвестный размер мяча.');
  return { ...ball, radiusMeters: preset.radiusMeters, massKg: preset.massKg };
}

export const CAN_PRESETS = [
  {
    id: '250',
    label: 'Узкая банка · 250 мл',
    volumeLiters: 0.25,
    radiusMeters: 0.027,
    heightMeters: 0.113,
    shellKg: 0.018,
  },
  {
    id: '330',
    label: 'Обычная банка · 330 мл',
    volumeLiters: 0.33,
    radiusMeters: 0.033,
    heightMeters: 0.115,
    shellKg: 0.021,
  },
  {
    id: '500',
    label: 'Высокая банка · 500 мл',
    volumeLiters: 0.5,
    radiusMeters: 0.033,
    heightMeters: 0.168,
    shellKg: 0.026,
  },
] as const;
export type CanPresetId = (typeof CAN_PRESETS)[number]['id'];
export const CAN_FILL_PRESETS = [
  { id: 'empty', label: 'Пустая', fraction: 0 },
  { id: 'half', label: 'Наполовину', fraction: 0.5 },
  { id: 'full', label: 'Полная', fraction: 1 },
] as const;
export type CanFillId = (typeof CAN_FILL_PRESETS)[number]['id'];

export function applyCanPreset(
  body: RoboticsBody,
  presetId: CanPresetId,
  fillId: CanFillId,
): RoboticsBody {
  if (body.kind !== 'can') throw new Error('Настройки банки недоступны для этого предмета.');
  const preset = CAN_PRESETS.find((candidate) => candidate.id === presetId);
  const fill = CAN_FILL_PRESETS.find((candidate) => candidate.id === fillId);
  if (!preset || !fill) throw new Error('Неизвестный размер или заполнение банки.');
  // Density of water-like contents ~1kg/l, illustrative only. Physical solver uses massKg.
  const massKg = Math.round((preset.shellKg + preset.volumeLiters * fill.fraction) * 1000) / 1000;
  return { ...body, radiusMeters: preset.radiusMeters, heightMeters: preset.heightMeters, massKg };
}

export const CUBE_PRESETS = [
  { id: 'small', label: 'Малый кубик · 3 × 3 × 3 см', sideMeters: 0.03, massKg: 0.02 },
  { id: 'medium', label: 'Средний кубик · 5 × 5 × 5 см', sideMeters: 0.05, massKg: 0.075 },
  { id: 'large', label: 'Большой кубик · 10 × 10 × 10 см', sideMeters: 0.1, massKg: 0.25 },
] as const;
export type CubePresetId = (typeof CUBE_PRESETS)[number]['id'];

export function applyCubePreset(body: RoboticsBody, presetId: CubePresetId): RoboticsBody {
  if (body.kind !== 'box') throw new Error('Настройки кубика недоступны для этого предмета.');
  const preset = CUBE_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error('Неизвестный размер кубика.');
  return {
    ...body,
    widthMeters: preset.sideMeters,
    depthMeters: preset.sideMeters,
    heightMeters: preset.sideMeters,
    massKg: preset.massKg,
  };
}
