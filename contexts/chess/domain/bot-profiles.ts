import { chooseChessBotMove, evaluateChessPosition, type ChessBotChoice } from './bot.js';
import { generateLegalMoves, moveToUci, type ChessMove, type ChessPosition } from './chess.js';
import type { BotLevel } from './document.js';
import { ASA_OPENING_BOOK } from './opening-book.js';

export type AsaBotTier = 'beginner' | 'intermediate' | 'advanced' | 'adaptive';
export type AsaBotStyleSignal =
  'tactics' | 'positional' | 'aggression' | 'defence' | 'material' | 'mobility';

export interface AsaBotProfile {
  readonly id: string;
  readonly displayName: string;
  readonly tier: AsaBotTier;
  /** Design target only. No empirical calibration is claimed. */
  readonly targetEloBand: Readonly<{ min: number; max: number }>;
  readonly calibrationStatus: 'not-calibrated';
  readonly engine: Readonly<{ level: BotLevel; depth: BotLevel }>;
  readonly style: Readonly<{
    weights: Readonly<Record<AsaBotStyleSignal, number>>;
    signals: readonly [AsaBotStyleSignal, AsaBotStyleSignal];
  }>;
  readonly openingRepertoireIds: readonly string[];
  readonly mistakeModel: Readonly<{
    baseChance: number;
    maxChance: number;
    pressureSensitivity: number;
    maxScoreLossCp: number;
    minimumPly: number;
    seedSalt: string;
  }>;
  readonly moveTimeModel: Readonly<{
    minimumMs: number;
    baseMs: number;
    maximumMs: number;
    jitterMs: number;
    complexityMs: number;
    inCheckBonusMs: number;
    remainingTimeReserveRatio: number;
  }>;
  readonly policy: Readonly<{
    assistance: Readonly<{
      hintMode: 'guided' | 'limited' | 'off' | 'adaptive';
      maxHintsPerGame: number;
      takebacks: 'encouraged' | 'one' | 'none' | 'adaptive';
      explainAfterMove: boolean;
    }>;
    challenge: Readonly<{
      mode: 'supportive' | 'balanced' | 'competitive' | 'adaptive';
      pressure: number;
      adaptiveWindowGames: number;
      maxEloAdjustment: number;
    }>;
  }>;
}

export interface AsaBotSeedContext {
  readonly gameSeed: string;
  readonly positionKey: string;
  readonly ply: number;
}

export interface AsaBotMistakeDecision {
  readonly triggered: boolean;
  readonly probability: number;
  readonly roll: number;
  readonly maxScoreLossCp: number;
}

export interface AsaBotMoveTimeInput extends AsaBotSeedContext {
  readonly legalMoveCount: number;
  readonly inCheck: boolean;
  readonly remainingMs: number;
}

export interface AsaBotMappedChoice extends ChessBotChoice {
  readonly profileId: string;
  readonly fallbackUsed: boolean;
}

const STYLE_SIGNALS: readonly AsaBotStyleSignal[] = [
  'tactics',
  'positional',
  'aggression',
  'defence',
  'material',
  'mobility',
];
const TIERS: readonly AsaBotTier[] = ['beginner', 'intermediate', 'advanced', 'adaptive'];
const OPENING_IDS = new Set(ASA_OPENING_BOOK.map((opening) => opening.id));
const FORBIDDEN_IDENTITY_TERMS = [
  'chess.com',
  'chesscom',
  'magnus',
  'carlsen',
  'hikaru',
  'nakamura',
  'kasparov',
  'kramnik',
  'fischer',
  'gotham',
  'stockfish',
] as const;

const ROOT_KEYS = [
  'id',
  'displayName',
  'tier',
  'targetEloBand',
  'calibrationStatus',
  'engine',
  'style',
  'openingRepertoireIds',
  'mistakeModel',
  'moveTimeModel',
  'policy',
] as const;

function styleWeights(
  tactics: number,
  positional: number,
  aggression: number,
  defence: number,
  material: number,
  mobility: number,
): Readonly<Record<AsaBotStyleSignal, number>> {
  return { tactics, positional, aggression, defence, material, mobility };
}

function mistakeModel(
  baseChance: number,
  maxChance: number,
  pressureSensitivity: number,
  maxScoreLossCp: number,
  minimumPly: number,
  seedSalt: string,
): AsaBotProfile['mistakeModel'] {
  return {
    baseChance,
    maxChance,
    pressureSensitivity,
    maxScoreLossCp,
    minimumPly,
    seedSalt,
  };
}

function moveTimeModel(
  minimumMs: number,
  baseMs: number,
  maximumMs: number,
  jitterMs: number,
  complexityMs: number,
  inCheckBonusMs: number,
  remainingTimeReserveRatio: number,
): AsaBotProfile['moveTimeModel'] {
  return {
    minimumMs,
    baseMs,
    maximumMs,
    jitterMs,
    complexityMs,
    inCheckBonusMs,
    remainingTimeReserveRatio,
  };
}

function policy(
  hintMode: AsaBotProfile['policy']['assistance']['hintMode'],
  maxHintsPerGame: number,
  takebacks: AsaBotProfile['policy']['assistance']['takebacks'],
  explainAfterMove: boolean,
  mode: AsaBotProfile['policy']['challenge']['mode'],
  pressure: number,
  adaptiveWindowGames = 0,
  maxEloAdjustment = 0,
): AsaBotProfile['policy'] {
  return {
    assistance: { hintMode, maxHintsPerGame, takebacks, explainAfterMove },
    challenge: { mode, pressure, adaptiveWindowGames, maxEloAdjustment },
  };
}

const PROFILE_FOUNDATION: AsaBotProfile[] = [
  {
    id: 'asa-bot-sprout',
    displayName: 'Росток ASA',
    tier: 'beginner',
    targetEloBand: { min: 450, max: 650 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 1, depth: 1 },
    style: {
      weights: styleWeights(0.08, 0.14, 0.1, 0.24, 0.28, 0.16),
      signals: ['defence', 'material'],
    },
    openingRepertoireIds: ['open-game', 'caro-kann'],
    mistakeModel: mistakeModel(0.3, 0.42, 0.12, 420, 2, 'sprout-v1'),
    moveTimeModel: moveTimeModel(250, 650, 1_400, 180, 260, 100, 0.08),
    policy: policy('guided', 6, 'encouraged', true, 'supportive', 0.15),
  },
  {
    id: 'asa-bot-lantern',
    displayName: 'Фонарь ASA',
    tier: 'beginner',
    targetEloBand: { min: 600, max: 800 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 1, depth: 1 },
    style: {
      weights: styleWeights(0.14, 0.1, 0.25, 0.12, 0.14, 0.25),
      signals: ['aggression', 'mobility'],
    },
    openingRepertoireIds: ['open-game', 'italian-game'],
    mistakeModel: mistakeModel(0.25, 0.36, 0.11, 360, 3, 'lantern-v1'),
    moveTimeModel: moveTimeModel(280, 720, 1_550, 210, 300, 120, 0.08),
    policy: policy('guided', 5, 'encouraged', true, 'supportive', 0.22),
  },
  {
    id: 'asa-bot-brook',
    displayName: 'Ручей ASA',
    tier: 'beginner',
    targetEloBand: { min: 750, max: 950 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 1, depth: 1 },
    style: {
      weights: styleWeights(0.1, 0.26, 0.1, 0.14, 0.15, 0.25),
      signals: ['positional', 'mobility'],
    },
    openingRepertoireIds: ['english-opening', 'queens-gambit'],
    mistakeModel: mistakeModel(0.2, 0.31, 0.11, 300, 4, 'brook-v1'),
    moveTimeModel: moveTimeModel(320, 820, 1_750, 240, 340, 150, 0.09),
    policy: policy('guided', 4, 'one', true, 'supportive', 0.3),
  },
  {
    id: 'asa-bot-compass',
    displayName: 'Компас ASA',
    tier: 'beginner',
    targetEloBand: { min: 900, max: 1_100 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.12, 0.24, 0.12, 0.14, 0.24, 0.14),
      signals: ['material', 'positional'],
    },
    openingRepertoireIds: ['french-defence', 'queens-gambit'],
    mistakeModel: mistakeModel(0.16, 0.26, 0.1, 260, 4, 'compass-v1'),
    moveTimeModel: moveTimeModel(380, 950, 2_000, 260, 390, 180, 0.09),
    policy: policy('limited', 3, 'one', true, 'balanced', 0.38),
  },
  {
    id: 'asa-bot-forge',
    displayName: 'Кузница ASA',
    tier: 'intermediate',
    targetEloBand: { min: 1_050, max: 1_250 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.27, 0.13, 0.24, 0.1, 0.16, 0.1),
      signals: ['tactics', 'aggression'],
    },
    openingRepertoireIds: ['sicilian-defence', 'italian-game'],
    mistakeModel: mistakeModel(0.12, 0.2, 0.08, 220, 5, 'forge-v1'),
    moveTimeModel: moveTimeModel(450, 1_100, 2_300, 300, 430, 220, 0.1),
    policy: policy('limited', 2, 'one', true, 'balanced', 0.46),
  },
  {
    id: 'asa-bot-kestrel',
    displayName: 'Пустельга ASA',
    tier: 'intermediate',
    targetEloBand: { min: 1_200, max: 1_400 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.25, 0.12, 0.16, 0.1, 0.14, 0.23),
      signals: ['tactics', 'mobility'],
    },
    openingRepertoireIds: ['sicilian-defence', 'english-opening', 'ruy-lopez'],
    mistakeModel: mistakeModel(0.1, 0.17, 0.07, 190, 6, 'kestrel-v1'),
    moveTimeModel: moveTimeModel(500, 1_250, 2_600, 330, 470, 240, 0.1),
    policy: policy('limited', 2, 'one', true, 'balanced', 0.54),
  },
  {
    id: 'asa-bot-cedar',
    displayName: 'Кедр ASA',
    tier: 'intermediate',
    targetEloBand: { min: 1_350, max: 1_550 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.12, 0.25, 0.1, 0.25, 0.16, 0.12),
      signals: ['defence', 'positional'],
    },
    openingRepertoireIds: ['caro-kann', 'french-defence', 'queens-gambit'],
    mistakeModel: mistakeModel(0.08, 0.14, 0.06, 160, 6, 'cedar-v1'),
    moveTimeModel: moveTimeModel(560, 1_400, 2_900, 360, 510, 270, 0.11),
    policy: policy('limited', 1, 'one', true, 'balanced', 0.62),
  },
  {
    id: 'asa-bot-prism',
    displayName: 'Призма ASA',
    tier: 'intermediate',
    targetEloBand: { min: 1_500, max: 1_700 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.25, 0.12, 0.12, 0.14, 0.25, 0.12),
      signals: ['material', 'tactics'],
    },
    openingRepertoireIds: ['ruy-lopez', 'kings-indian', 'caro-kann'],
    mistakeModel: mistakeModel(0.065, 0.12, 0.055, 140, 7, 'prism-v1'),
    moveTimeModel: moveTimeModel(620, 1_550, 3_200, 400, 550, 300, 0.11),
    policy: policy('limited', 1, 'none', true, 'balanced', 0.68),
  },
  {
    id: 'asa-bot-comet',
    displayName: 'Комета ASA',
    tier: 'advanced',
    targetEloBand: { min: 1_700, max: 1_900 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 3, depth: 3 },
    style: {
      weights: styleWeights(0.14, 0.24, 0.24, 0.11, 0.14, 0.13),
      signals: ['aggression', 'positional'],
    },
    openingRepertoireIds: ['sicilian-defence', 'kings-indian', 'italian-game'],
    mistakeModel: mistakeModel(0.045, 0.085, 0.04, 110, 8, 'comet-v1'),
    moveTimeModel: moveTimeModel(700, 1_800, 3_700, 450, 620, 340, 0.12),
    policy: policy('off', 0, 'none', false, 'competitive', 0.76),
  },
  {
    id: 'asa-bot-bastion',
    displayName: 'Бастион ASA',
    tier: 'advanced',
    targetEloBand: { min: 1_850, max: 2_050 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 3, depth: 3 },
    style: {
      weights: styleWeights(0.14, 0.18, 0.1, 0.25, 0.1, 0.23),
      signals: ['defence', 'mobility'],
    },
    openingRepertoireIds: ['caro-kann', 'french-defence', 'queens-gambit'],
    mistakeModel: mistakeModel(0.03, 0.065, 0.035, 90, 9, 'bastion-v1'),
    moveTimeModel: moveTimeModel(780, 2_050, 4_200, 500, 680, 380, 0.12),
    policy: policy('off', 0, 'none', false, 'competitive', 0.84),
  },
  {
    id: 'asa-bot-orbit',
    displayName: 'Орбита ASA',
    tier: 'advanced',
    targetEloBand: { min: 2_000, max: 2_200 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 3, depth: 3 },
    style: {
      weights: styleWeights(0.25, 0.24, 0.12, 0.12, 0.15, 0.12),
      signals: ['tactics', 'positional'],
    },
    openingRepertoireIds: ['ruy-lopez', 'sicilian-defence', 'kings-indian', 'queens-gambit'],
    mistakeModel: mistakeModel(0.018, 0.045, 0.027, 70, 10, 'orbit-v1'),
    moveTimeModel: moveTimeModel(850, 2_300, 4_800, 560, 740, 420, 0.13),
    policy: policy('off', 0, 'none', false, 'competitive', 0.92),
  },
  {
    id: 'asa-bot-horizon',
    displayName: 'Горизонт ASA',
    tier: 'adaptive',
    targetEloBand: { min: 800, max: 2_150 },
    calibrationStatus: 'not-calibrated',
    engine: { level: 2, depth: 2 },
    style: {
      weights: styleWeights(0.14, 0.16, 0.24, 0.23, 0.11, 0.12),
      signals: ['aggression', 'defence'],
    },
    openingRepertoireIds: ['open-game', 'sicilian-defence', 'queens-gambit', 'english-opening'],
    mistakeModel: mistakeModel(0.075, 0.2, 0.125, 210, 5, 'horizon-v1'),
    moveTimeModel: moveTimeModel(420, 1_350, 3_600, 420, 580, 300, 0.1),
    policy: policy('adaptive', 2, 'adaptive', true, 'adaptive', 0.5, 5, 300),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  errors: string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    errors.push(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function finiteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateAsaBotProfileCatalog(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) return ['catalog must be an array'];
  if (value.length !== 12) errors.push('catalog must contain exactly 12 profiles');

  const ids = new Set<string>();
  const names = new Set<string>();
  const styleSignatures = new Set<string>();
  const tierCounts: Record<AsaBotTier, number> = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
    adaptive: 0,
  };

  value.forEach((entry, index) => {
    const label = `profiles[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    hasExactKeys(entry, ROOT_KEYS, label, errors);

    const id = entry.id;
    if (typeof id !== 'string' || !/^asa-bot-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      errors.push(`${label}.id must be a stable ASA bot id`);
    } else if (ids.has(id)) errors.push(`${label}.id must be unique`);
    else ids.add(id);

    const displayName = entry.displayName;
    if (typeof displayName !== 'string' || displayName.trim().length < 5) {
      errors.push(`${label}.displayName must be a non-empty original name`);
    } else {
      const normalized = displayName.trim().toLocaleLowerCase('ru-RU');
      if (names.has(normalized)) errors.push(`${label}.displayName must be unique`);
      names.add(normalized);
      if (FORBIDDEN_IDENTITY_TERMS.some((term) => normalized.includes(term))) {
        errors.push(`${label}.displayName must not use a real-person or third-party identity`);
      }
    }

    const tier = entry.tier;
    if (!TIERS.includes(tier as AsaBotTier)) errors.push(`${label}.tier is invalid`);
    else tierCounts[tier as AsaBotTier] += 1;
    if (entry.calibrationStatus !== 'not-calibrated') {
      errors.push(`${label}.calibrationStatus must be not-calibrated`);
    }

    const elo = entry.targetEloBand;
    if (!isRecord(elo)) errors.push(`${label}.targetEloBand must be an object`);
    else {
      hasExactKeys(elo, ['min', 'max'], `${label}.targetEloBand`, errors);
      if (
        !Number.isInteger(elo.min) ||
        !Number.isInteger(elo.max) ||
        !finiteInRange(elo.min, 100, 3_000) ||
        !finiteInRange(elo.max, 100, 3_000) ||
        Number(elo.min) >= Number(elo.max)
      ) {
        errors.push(`${label}.targetEloBand must be an increasing integer band`);
      }
    }

    const engine = entry.engine;
    if (!isRecord(engine)) errors.push(`${label}.engine must be an object`);
    else {
      hasExactKeys(engine, ['level', 'depth'], `${label}.engine`, errors);
      for (const field of ['level', 'depth'] as const) {
        if (!Number.isInteger(engine[field]) || !finiteInRange(engine[field], 1, 3)) {
          errors.push(`${label}.engine.${field} must be an integer from 1 to 3`);
        }
      }
    }

    const style = entry.style;
    if (!isRecord(style)) errors.push(`${label}.style must be an object`);
    else {
      hasExactKeys(style, ['weights', 'signals'], `${label}.style`, errors);
      const weights = style.weights;
      if (!isRecord(weights)) errors.push(`${label}.style.weights must be an object`);
      else {
        hasExactKeys(weights, STYLE_SIGNALS, `${label}.style.weights`, errors);
        const total = STYLE_SIGNALS.reduce((sum, signal) => sum + Number(weights[signal]), 0);
        if (
          STYLE_SIGNALS.some((signal) => !finiteInRange(weights[signal], 0, 1)) ||
          Math.abs(total - 1) > 1e-9
        ) {
          errors.push(`${label}.style.weights must be finite normalized weights`);
        }
      }
      const signals = style.signals;
      if (
        !Array.isArray(signals) ||
        signals.length !== 2 ||
        new Set(signals).size !== 2 ||
        signals.some((signal) => !STYLE_SIGNALS.includes(signal as AsaBotStyleSignal))
      ) {
        errors.push(`${label}.style.signals must contain two distinct known signals`);
      } else {
        const signature = [...signals].sort().join('|');
        if (styleSignatures.has(signature)) {
          errors.push(`${label}.style.signals must be distinct across profiles`);
        }
        styleSignatures.add(signature);
        if (
          isRecord(weights) &&
          signals.some((signal) => !finiteInRange(weights[String(signal)], 0.2, 1))
        ) {
          errors.push(`${label}.style.signals must map to measurable weights of at least 0.2`);
        }
      }
    }

    const repertoire = entry.openingRepertoireIds;
    if (
      !Array.isArray(repertoire) ||
      repertoire.length < 2 ||
      repertoire.length > 4 ||
      new Set(repertoire).size !== repertoire.length ||
      repertoire.some((openingId) => typeof openingId !== 'string' || !OPENING_IDS.has(openingId))
    ) {
      errors.push(`${label}.openingRepertoireIds must contain 2-4 unique opening-book ids`);
    }

    const mistake = entry.mistakeModel;
    if (!isRecord(mistake)) errors.push(`${label}.mistakeModel must be an object`);
    else {
      hasExactKeys(
        mistake,
        [
          'baseChance',
          'maxChance',
          'pressureSensitivity',
          'maxScoreLossCp',
          'minimumPly',
          'seedSalt',
        ],
        `${label}.mistakeModel`,
        errors,
      );
      if (
        !finiteInRange(mistake.baseChance, 0, 0.5) ||
        !finiteInRange(mistake.maxChance, 0, 0.5) ||
        Number(mistake.maxChance) < Number(mistake.baseChance) ||
        !finiteInRange(mistake.pressureSensitivity, 0, 0.25) ||
        !Number.isInteger(mistake.maxScoreLossCp) ||
        !finiteInRange(mistake.maxScoreLossCp, 20, 600) ||
        !Number.isInteger(mistake.minimumPly) ||
        !finiteInRange(mistake.minimumPly, 0, 80) ||
        typeof mistake.seedSalt !== 'string' ||
        mistake.seedSalt.length < 4
      ) {
        errors.push(`${label}.mistakeModel is invalid`);
      }
    }

    const timing = entry.moveTimeModel;
    if (!isRecord(timing)) errors.push(`${label}.moveTimeModel must be an object`);
    else {
      hasExactKeys(
        timing,
        [
          'minimumMs',
          'baseMs',
          'maximumMs',
          'jitterMs',
          'complexityMs',
          'inCheckBonusMs',
          'remainingTimeReserveRatio',
        ],
        `${label}.moveTimeModel`,
        errors,
      );
      if (
        !Number.isInteger(timing.minimumMs) ||
        !Number.isInteger(timing.baseMs) ||
        !Number.isInteger(timing.maximumMs) ||
        !finiteInRange(timing.minimumMs, 50, 5_000) ||
        !finiteInRange(timing.baseMs, Number(timing.minimumMs), 10_000) ||
        !finiteInRange(timing.maximumMs, Number(timing.baseMs), 15_000) ||
        !Number.isInteger(timing.jitterMs) ||
        !finiteInRange(timing.jitterMs, 0, Number(timing.maximumMs)) ||
        !Number.isInteger(timing.complexityMs) ||
        !finiteInRange(timing.complexityMs, 0, 5_000) ||
        !Number.isInteger(timing.inCheckBonusMs) ||
        !finiteInRange(timing.inCheckBonusMs, 0, 5_000) ||
        !finiteInRange(timing.remainingTimeReserveRatio, 0.02, 0.25)
      ) {
        errors.push(`${label}.moveTimeModel is invalid`);
      }
    }

    const profilePolicy = entry.policy;
    if (!isRecord(profilePolicy)) errors.push(`${label}.policy must be an object`);
    else {
      hasExactKeys(profilePolicy, ['assistance', 'challenge'], `${label}.policy`, errors);
      const assistance = profilePolicy.assistance;
      if (!isRecord(assistance)) errors.push(`${label}.policy.assistance must be an object`);
      else {
        hasExactKeys(
          assistance,
          ['hintMode', 'maxHintsPerGame', 'takebacks', 'explainAfterMove'],
          `${label}.policy.assistance`,
          errors,
        );
        if (
          !['guided', 'limited', 'off', 'adaptive'].includes(String(assistance.hintMode)) ||
          !Number.isInteger(assistance.maxHintsPerGame) ||
          !finiteInRange(assistance.maxHintsPerGame, 0, 8) ||
          !['encouraged', 'one', 'none', 'adaptive'].includes(String(assistance.takebacks)) ||
          typeof assistance.explainAfterMove !== 'boolean'
        ) {
          errors.push(`${label}.policy.assistance is invalid`);
        }
      }
      const challenge = profilePolicy.challenge;
      if (!isRecord(challenge)) errors.push(`${label}.policy.challenge must be an object`);
      else {
        hasExactKeys(
          challenge,
          ['mode', 'pressure', 'adaptiveWindowGames', 'maxEloAdjustment'],
          `${label}.policy.challenge`,
          errors,
        );
        const isAdaptive = challenge.mode === 'adaptive';
        if (
          !['supportive', 'balanced', 'competitive', 'adaptive'].includes(String(challenge.mode)) ||
          !finiteInRange(challenge.pressure, 0, 1) ||
          !Number.isInteger(challenge.adaptiveWindowGames) ||
          !finiteInRange(challenge.adaptiveWindowGames, 0, 20) ||
          !Number.isInteger(challenge.maxEloAdjustment) ||
          !finiteInRange(challenge.maxEloAdjustment, 0, 500) ||
          (isAdaptive &&
            (Number(challenge.adaptiveWindowGames) === 0 ||
              Number(challenge.maxEloAdjustment) === 0)) ||
          (!isAdaptive &&
            (Number(challenge.adaptiveWindowGames) !== 0 ||
              Number(challenge.maxEloAdjustment) !== 0))
        ) {
          errors.push(`${label}.policy.challenge is invalid`);
        }
      }
    }
  });

  const expectedCounts: Record<AsaBotTier, number> = {
    beginner: 4,
    intermediate: 4,
    advanced: 3,
    adaptive: 1,
  };
  for (const tier of TIERS) {
    if (tierCounts[tier] !== expectedCounts[tier]) {
      errors.push(`${tier} tier must contain exactly ${expectedCounts[tier]} profiles`);
    }
  }
  return errors;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

const foundationErrors = validateAsaBotProfileCatalog(PROFILE_FOUNDATION);
if (foundationErrors.length > 0) {
  throw new Error(`Invalid ASA bot profile foundation:\n${foundationErrors.join('\n')}`);
}

export const ASA_BOT_PROFILES: readonly AsaBotProfile[] = deepFreeze(PROFILE_FOUNDATION);

function assertSeedContext(context: AsaBotSeedContext): void {
  if (!context.gameSeed.trim() || !context.positionKey.trim()) {
    throw new TypeError('gameSeed and positionKey must be non-empty');
  }
  if (!Number.isInteger(context.ply) || context.ply < 0) {
    throw new RangeError('ply must be a non-negative integer');
  }
}

function seededUnit(profile: AsaBotProfile, context: AsaBotSeedContext, purpose: string): number {
  assertSeedContext(context);
  const input = [
    profile.id,
    profile.mistakeModel.seedSalt,
    purpose,
    context.gameSeed,
    context.positionKey,
    context.ply,
  ].join('|');
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_296;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function chooseAsaBotCandidateIndex(
  profile: AsaBotProfile,
  candidateCount: number,
  context: AsaBotSeedContext,
): number {
  if (!Number.isInteger(candidateCount) || candidateCount <= 0 || candidateCount > 256) {
    throw new RangeError('candidateCount must be an integer from 1 to 256');
  }
  return Math.min(
    candidateCount - 1,
    Math.floor(seededUnit(profile, context, 'candidate-choice') * candidateCount),
  );
}

export function decideAsaBotMistake(
  profile: AsaBotProfile,
  context: AsaBotSeedContext,
  pressure = 0,
): AsaBotMistakeDecision {
  const boundedPressure = Number.isFinite(pressure) ? clamp(pressure, 0, 1) : 0;
  const probability =
    context.ply < profile.mistakeModel.minimumPly
      ? 0
      : clamp(
          profile.mistakeModel.baseChance +
            boundedPressure * profile.mistakeModel.pressureSensitivity,
          0,
          profile.mistakeModel.maxChance,
        );
  const roll = seededUnit(profile, context, 'mistake-roll');
  return {
    triggered: roll < probability,
    probability,
    roll,
    maxScoreLossCp: profile.mistakeModel.maxScoreLossCp,
  };
}

export function computeAsaBotMoveTimeMs(
  profile: AsaBotProfile,
  input: AsaBotMoveTimeInput,
): number {
  assertSeedContext(input);
  if (!Number.isInteger(input.legalMoveCount) || input.legalMoveCount < 0) {
    throw new RangeError('legalMoveCount must be a non-negative integer');
  }
  if (!Number.isFinite(input.remainingMs) || input.remainingMs < 50) {
    throw new RangeError('remainingMs must be at least 50');
  }
  const model = profile.moveTimeModel;
  const complexity = clamp(input.legalMoveCount / 40, 0, 1) * model.complexityMs;
  const jitter = (seededUnit(profile, input, 'move-time') * 2 - 1) * model.jitterMs;
  const requested = model.baseMs + complexity + (input.inCheck ? model.inCheckBonusMs : 0) + jitter;
  const reserveCap = Math.max(50, Math.floor(input.remainingMs * model.remainingTimeReserveRatio));
  const upper = Math.max(50, Math.min(model.maximumMs, reserveCap, input.remainingMs));
  const lower = Math.min(model.minimumMs, upper);
  return Math.round(clamp(requested, lower, upper));
}

function fallbackChoice(
  position: ChessPosition,
  profile: AsaBotProfile,
  legalMoves: readonly ChessMove[],
): AsaBotMappedChoice | null {
  const move = [...legalMoves].sort((left, right) =>
    moveToUci(left) < moveToUci(right) ? -1 : moveToUci(left) > moveToUci(right) ? 1 : 0,
  )[0];
  if (!move) return null;
  return {
    profileId: profile.id,
    fallbackUsed: true,
    move,
    uci: moveToUci(move),
    scoreCp: evaluateChessPosition(position),
    depth: profile.engine.depth,
    nodes: 0,
  };
}

/**
 * Maps a profile to the current deterministic 1..3 bot. Style, mistake and
 * timing models remain policy signals until a later calibrated move-ranker
 * explicitly consumes them.
 */
export function chooseMappedAsaBotMove(
  position: ChessPosition,
  profile: AsaBotProfile,
): AsaBotMappedChoice | null {
  const legalMoves = generateLegalMoves(position);
  if (legalMoves.length === 0) return null;
  const legalUci = new Set(legalMoves.map(moveToUci));
  const mapped = chooseChessBotMove(position, profile.engine.level);
  if (!mapped || !legalUci.has(mapped.uci)) return fallbackChoice(position, profile, legalMoves);
  return { ...mapped, profileId: profile.id, fallbackUsed: false };
}
