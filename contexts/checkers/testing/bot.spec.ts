import { describe, expect, it } from 'vitest';
import {
  CHECKERS_BOTS,
  CHECKERS_BOT_IDS,
  chooseCheckersBotMove,
  type CheckersBotId,
} from '../domain/bot';
import {
  createInitialCheckersDocument,
  type CheckersDocument,
  type CheckersPiece,
} from '../domain/document';
import { generateLegalCheckersMoves } from '../domain/rules';

function position(pieces: readonly CheckersPiece[]): CheckersDocument {
  return {
    schemaVersion: 1,
    ruleset: 'russian-64',
    mode: 'position',
    sideToMove: 'light',
    pieces,
    moveHistory: [],
    result: '*',
  };
}

describe('calibrated Checkers bot ladder', () => {
  it('declares six transparent rungs with increasing search envelopes', () => {
    expect(CHECKERS_BOTS.map((bot) => [bot.id, bot.displayName, bot.rung])).toEqual([
      ['iskra', 'Искра', 1],
      ['sledopyt', 'Следопыт', 2],
      ['taktik', 'Тактик', 3],
      ['kombinator', 'Комбинатор', 4],
      ['strateg', 'Стратег', 5],
      ['master', 'Мастер', 6],
    ]);
    expect(CHECKERS_BOTS.map((bot) => bot.searchDepth)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each(CHECKERS_BOT_IDS)('%s always returns a legal deterministic move', (botId) => {
    const document = createInitialCheckersDocument();
    const legal = generateLegalCheckersMoves(document);
    const first = chooseCheckersBotMove(document, botId, {
      seed: 41,
      maxDepth: 2,
      maxNodes: 500,
      maxTimeMs: 5_000,
    });
    const second = chooseCheckersBotMove(document, botId, {
      seed: 41,
      maxDepth: 2,
      maxNodes: 500,
      maxTimeMs: 5_000,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) return;
    expect(
      legal.some(
        (move) =>
          move.pieceId === first.value.move.pieceId && move.notation === first.value.move.notation,
      ),
    ).toBe(true);
  });

  it('never weakens legality when a capture is mandatory', () => {
    const document = position([
      { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
      { id: 'light-g1', side: 'light', kind: 'man', square: 'g1' },
      { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
    ]);

    for (const botId of CHECKERS_BOT_IDS) {
      const result = chooseCheckersBotMove(document, botId, {
        maxDepth: 2,
        maxNodes: 100,
        maxTimeMs: 5_000,
      });
      expect(result.ok && result.value.move.notation).toBe('c3:e5');
      if (result.ok) expect(result.value.explanations).toContain('forced-capture');
    }
  });

  it('returns a legal fallback when cancellation stops deeper search', () => {
    const result = chooseCheckersBotMove(createInitialCheckersDocument(), 'master', {
      seed: 7,
      maxDepth: 5,
      maxNodes: 100_000,
      maxTimeMs: 5_000,
      shouldCancel: () => true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      botId: 'master',
      searchedNodes: 0,
      completedDepth: 0,
      cancelled: true,
    });
    expect(result.value.move.isCapture).toBe(false);
  });

  it('rejects every rung once no legal move remains', () => {
    const finished = { ...position([]), result: '0-1' as const };
    const errors = CHECKERS_BOT_IDS.map((botId: CheckersBotId) =>
      chooseCheckersBotMove(finished, botId),
    );
    expect(errors.every((result) => !result.ok)).toBe(true);
  });
});
