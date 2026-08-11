import { describe, expect, it } from 'vitest';
import { createChessGameDocument, flagChessTimeout } from '../domain/game-control';

describe('chess game controls', () => {
  it('creates a computer game with player color, bot level and exact clock', () => {
    expect(
      createChessGameDocument({
        mode: 'computer',
        playerColor: 'black',
        botLevel: 3,
        initialMs: 180000,
        incrementMs: 2000,
      }),
    ).toMatchObject({
      mode: 'computer',
      orientation: 'black',
      bot: { color: 'white', level: 3 },
      clock: {
        initialMs: 180000,
        incrementMs: 2000,
        whiteMs: 180000,
        blackMs: 180000,
      },
      headers: { White: 'ASA Bot', Black: 'Player' },
    });
  });

  it('creates a local game without a bot and an analysis board without clocks', () => {
    expect(
      createChessGameDocument({ mode: 'local', initialMs: 900000, incrementMs: 10000 }),
    ).toMatchObject({ mode: 'local', bot: null, clock: { initialMs: 900000, incrementMs: 10000 } });
    expect(createChessGameDocument({ mode: 'analysis' })).toMatchObject({
      mode: 'analysis',
      clock: null,
      bot: null,
    });
  });

  it.each([
    [{ mode: 'local', initialMs: 999 }, /initialMs/],
    [{ mode: 'local', initialMs: 180000, incrementMs: -1 }, /incrementMs/],
  ] as const)('rejects invalid setup %#', (options, pattern) => {
    expect(() => createChessGameDocument(options)).toThrow(pattern);
  });

  it('flags timeout once and leaves finished documents immutable', () => {
    const base = createChessGameDocument({ mode: 'local', initialMs: 60000, incrementMs: 0 });
    const timedOut = flagChessTimeout(base, 'black');
    expect(timedOut).toMatchObject({
      clock: { whiteMs: 60000, blackMs: 0 },
      result: '1-0',
      termination: 'timeout',
    });
    expect(flagChessTimeout(timedOut, 'white')).toBe(timedOut);
  });
});
