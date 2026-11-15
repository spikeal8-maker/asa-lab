import { describe, expect, it } from 'vitest';
import type { ChessNetworkMatch } from '@asa-lab/contracts';
import { isNewNetworkVictory, networkResultPresentation } from '../ChessNetworkLobby';

const match = (overrides: Partial<ChessNetworkMatch> = {}): ChessNetworkMatch => ({
  id: 'game',
  status: 'active',
  version: 1,
  sequence: 1,
  scope: 'platform',
  white: { playerId: 'white-player', displayAlias: 'Белые' },
  black: { playerId: 'black-player', displayAlias: 'Чёрные' },
  viewerColor: 'white',
  currentFen: '',
  moves: [],
  whiteRemainingMs: 0,
  blackRemainingMs: 60000,
  activeColor: 'white',
  serverNowMs: 1000,
  result: '*',
  termination: '',
  drawOfferedBy: null,
  updatedAt: 1000,
  ...overrides,
});

describe('server-confirmed personal Chess result', () => {
  it.each([
    ['white', '1-0', 'white-player', 'win', 'Вы победили'],
    ['white', '0-1', 'white-player', 'loss', 'Вы проиграли'],
    ['black', '0-1', 'black-player', 'win', 'Вы победили'],
    ['black', '1-0', 'black-player', 'loss', 'Вы проиграли'],
  ] as const)(
    'resolves %s/%s only for its actual opaque player',
    (viewerColor, result, viewer, kind, title) => {
      expect(
        networkResultPresentation(
          match({ status: 'finished', viewerColor, result, termination: 'checkmate' }),
          viewer,
        ),
      ).toMatchObject({ kind, title });
    },
  );
  it('does not invent a personal result for a missing or mismatched viewer', () => {
    const finished = match({ status: 'finished', result: '1-0' });
    expect(networkResultPresentation(finished).kind).toBe('finished');
    expect(networkResultPresentation(finished, 'black-player').kind).toBe('finished');
    expect(
      networkResultPresentation(match({ status: 'finished', result: '*' }), 'white-player').kind,
    ).toBe('finished');
  });
  it('keeps draw and policy abort distinct, regardless of a stale winner field', () => {
    expect(
      networkResultPresentation(match({ status: 'finished', result: '1/2-1/2' }), 'white-player'),
    ).toMatchObject({ kind: 'draw', title: 'Ничья' });
    expect(
      networkResultPresentation(match({ status: 'aborted', result: '1-0' }), 'white-player'),
    ).toMatchObject({
      kind: 'aborted',
      title: 'Партия остановлена',
      detail: expect.stringContaining('не засчитан'),
    });
  });
  it('requires a newer server-confirmed same-game victory before any celebration', () => {
    const active = match();
    const won = match({
      status: 'finished',
      version: 2,
      sequence: 2,
      result: '1-0',
      termination: 'timeout',
    });
    expect(isNewNetworkVictory(active, won, 'white-player')).toBe(true);
    for (const [previous, incoming, viewer] of [
      [null, won, 'white-player'], // reload/history is a first snapshot
      [won, won, 'white-player'], // replay/poll cannot repeat an effect
      [active, { ...won, id: 'another-game' }, 'white-player'],
      [active, { ...won, version: 1, sequence: 1 }, 'white-player'],
      [active, { ...won, result: '0-1' }, 'white-player'],
      [active, { ...won, result: '1/2-1/2' }, 'white-player'],
      [active, { ...won, status: 'aborted' }, 'white-player'],
      [active, active, 'white-player'], // a locally displayed zero clock is not a result
      [active, won, 'foreign-player'],
    ] as const)
      expect(isNewNetworkVictory(previous, incoming, viewer)).toBe(false);
  });
});
