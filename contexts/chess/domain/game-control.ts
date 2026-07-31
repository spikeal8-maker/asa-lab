import {
  createEmptyChessDocument,
  type BotLevel,
  type ChessDocument,
  type ChessMode,
} from './document.js';
import type { Color } from './chess.js';

export interface NewChessGameOptions {
  readonly mode: ChessMode;
  readonly playerColor?: Color;
  readonly botLevel?: BotLevel;
  readonly initialMs?: number;
  readonly incrementMs?: number;
}

export function createChessGameDocument(options: NewChessGameOptions): ChessDocument {
  const base = createEmptyChessDocument(options.mode);
  if (options.mode === 'analysis') return base;

  const initialMs = options.initialMs ?? base.clock?.initialMs ?? 10 * 60 * 1000;
  const incrementMs = options.incrementMs ?? base.clock?.incrementMs ?? 5 * 1000;
  if (!Number.isSafeInteger(initialMs) || initialMs < 1000 || initialMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('initialMs must be an integer from 1000 to 604800000');
  }
  if (!Number.isSafeInteger(incrementMs) || incrementMs < 0 || incrementMs > 60 * 60 * 1000) {
    throw new Error('incrementMs must be an integer from 0 to 3600000');
  }
  if (options.mode === 'computer') {
    const playerColor = options.playerColor ?? 'white';
    return {
      ...base,
      orientation: playerColor,
      clock: { initialMs, incrementMs, whiteMs: initialMs, blackMs: initialMs },
      bot: {
        color: playerColor === 'white' ? 'black' : 'white',
        level: options.botLevel ?? 2,
      },
      headers: {
        ...base.headers,
        White: playerColor === 'white' ? 'Player' : 'ASA Bot',
        Black: playerColor === 'black' ? 'Player' : 'ASA Bot',
      },
    };
  }
  return {
    ...base,
    clock: { initialMs, incrementMs, whiteMs: initialMs, blackMs: initialMs },
  };
}

export function flagChessTimeout(document: ChessDocument, loser: Color): ChessDocument {
  if (document.result !== '*' || document.termination !== 'ongoing') return document;
  return {
    ...document,
    clock:
      document.clock === null
        ? null
        : {
            ...document.clock,
            whiteMs: loser === 'white' ? 0 : document.clock.whiteMs,
            blackMs: loser === 'black' ? 0 : document.clock.blackMs,
          },
    result: loser === 'white' ? '0-1' : '1-0',
    termination: 'timeout',
  };
}
