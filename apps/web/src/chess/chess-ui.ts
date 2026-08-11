import {
  ASA_BOT_PROFILES,
  type AsaBotProfile,
  type AsaBotStyleSignal,
  type BotLevel,
  type ChessDocument,
  type Color,
  type Piece,
  type PieceType,
  type Square,
} from '@asa-lab/chess';

export const PIECE_SYMBOL: Readonly<Record<Color, Readonly<Record<PieceType, string>>>> = {
  white: {
    king: '♔',
    queen: '♕',
    rook: '♖',
    bishop: '♗',
    knight: '♘',
    pawn: '♙',
  },
  black: {
    king: '♚',
    queen: '♛',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    pawn: '♟',
  },
};

const COLOR_LABEL: Readonly<Record<Color, string>> = {
  white: 'белые',
  black: 'чёрные',
};

const PIECE_LABEL: Readonly<Record<PieceType, string>> = {
  king: 'король',
  queen: 'ферзь',
  rook: 'ладья',
  bishop: 'слон',
  knight: 'конь',
  pawn: 'пешка',
};

const BOT_STYLE_LABEL: Readonly<Record<AsaBotStyleSignal, string>> = {
  tactics: 'тактика',
  positional: 'позиционная игра',
  aggression: 'атака',
  defence: 'защита',
  material: 'материал',
  mobility: 'активность фигур',
};

const HINT_MODE_LABEL: Readonly<Record<AsaBotProfile['policy']['assistance']['hintMode'], string>> =
  {
    guided: 'обучающие подсказки',
    limited: 'ограниченные подсказки',
    off: 'без подсказок',
    adaptive: 'адаптивные подсказки',
  };

const TAKEBACK_LABEL: Readonly<Record<AsaBotProfile['policy']['assistance']['takebacks'], string>> =
  {
    encouraged: 'отмена ходов приветствуется',
    one: 'одна отмена',
    none: 'без отмены ходов',
    adaptive: 'отмена зависит от учебного режима',
  };

const CHALLENGE_LABEL: Readonly<Record<AsaBotProfile['policy']['challenge']['mode'], string>> = {
  supportive: 'поддерживающий вызов',
  balanced: 'сбалансированный вызов',
  competitive: 'соревновательный вызов',
  adaptive: 'адаптивный вызов',
};

export interface BotProfileUiSummary {
  readonly levelLabel: string;
  readonly styleLabel: string;
  readonly assistanceLabel: string;
  readonly challengeLabel: string;
  readonly calibrationNote: string;
}

export function botProfileUiSummary(profile: AsaBotProfile): BotProfileUiSummary {
  const styleSignals = profile.style.signals.map((signal) => BOT_STYLE_LABEL[signal]).join(' · ');
  return {
    levelLabel: `Уровень локального движка ${profile.engine.level} из 3`,
    styleLabel: `Проектные сигналы, пока не влияющие на выбор хода: ${styleSignals}`,
    assistanceLabel: `Проектная политика, пока не управляющая контролами: ${HINT_MODE_LABEL[profile.policy.assistance.hintMode]}; ${TAKEBACK_LABEL[profile.policy.assistance.takebacks]}`,
    challengeLabel: `Проектная политика, пока не управляющая сложностью: ${CHALLENGE_LABEL[profile.policy.challenge.mode]}`,
    calibrationNote: `Проектный Elo-ориентир ${profile.targetEloBand.min}–${profile.targetEloBand.max}. Профиль не откалиброван по серии партий.`,
  };
}

export function resolveAsaBotProfile(
  profileId: string | undefined,
  level: BotLevel,
): AsaBotProfile {
  return (
    ASA_BOT_PROFILES.find(
      (profile) => profile.id === profileId && profile.engine.level === level,
    ) ??
    ASA_BOT_PROFILES.find((profile) => profile.engine.level === level) ??
    ASA_BOT_PROFILES[0]!
  );
}

export function applyAsaBotProfile(document: ChessDocument, profile: AsaBotProfile): ChessDocument {
  if (document.mode !== 'computer' || !document.bot) {
    throw new Error('ASA bot profiles can only be applied to a computer game.');
  }
  const botColor = document.bot.color;
  return {
    ...document,
    bot: {
      color: botColor,
      level: profile.engine.level,
      profileId: profile.id,
    },
    headers: {
      ...document.headers,
      [botColor === 'white' ? 'White' : 'Black']: profile.displayName,
    },
  };
}

export function squareAccessibleLabel(square: Square, piece: Piece | null): string {
  if (!piece) return `${square}, пустое поле`;
  return `${square}, ${COLOR_LABEL[piece.color]} ${PIECE_LABEL[piece.type]}`;
}

export function formatChessClock(milliseconds: number): string {
  const safe = Math.max(0, Math.floor(milliseconds));
  const totalSeconds = Math.ceil(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function resultLabel(result: string, termination: string): string {
  if (result === '*') return 'Партия продолжается';
  const resultText =
    result === '1-0' ? 'Белые победили' : result === '0-1' ? 'Чёрные победили' : 'Ничья';
  const reason: Readonly<Record<string, string>> = {
    checkmate: 'мат',
    stalemate: 'пат',
    fifty_move: 'правило 50 ходов',
    threefold: 'троекратное повторение',
    insufficient_material: 'недостаточно материала',
    resignation: 'сдача',
    timeout: 'время истекло',
    draw_agreement: 'соглашение на ничью',
  };
  return `${resultText}${reason[termination] ? ` · ${reason[termination]}` : ''}`;
}

export function evaluationLabel(scoreCp: number): string {
  if (Math.abs(scoreCp) >= 90000) return scoreCp > 0 ? 'Мат за белых' : 'Мат за чёрных';
  const pawns = scoreCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}
