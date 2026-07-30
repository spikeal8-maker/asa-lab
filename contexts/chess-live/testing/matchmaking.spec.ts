import { describe, expect, it } from 'vitest';
import {
  areMatchmakingTicketsCompatible,
  cancelMatchmakingTicket,
  createMatchmakingTicket,
  findMatchmakingPair,
  matchmakingRatingWindow,
  preferredColorForPair,
} from '../domain/matchmaking';

function ticket(
  id: string,
  playerId: string,
  rating: number,
  colorPreference: 'white' | 'black' | 'random' = 'random',
  createdAtMs = 1_000,
) {
  const result = createMatchmakingTicket({
    id,
    tenantId: 'tenant:1',
    playerId,
    timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    rated: true,
    colorPreference,
    rating,
    nowMs: createdAtMs,
    expiresAtMs: createdAtMs + 300_000,
    commandId: `command:${id}`,
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('live chess matchmaking', () => {
  it('assigns the rapid pool and opens a bounded rating window', () => {
    const value = ticket('ticket:1', 'user:1', 1200);
    expect(value.pool).toBe('rapid');
    expect(matchmakingRatingWindow(value, 1_000)).toBe(100);
    expect(matchmakingRatingWindow(value, 31_000)).toBe(150);
    expect(matchmakingRatingWindow(value, 10 * 60_000)).toBe(600);
  });

  it('requires same tenant, pool, rating mode and exact time control', () => {
    const left = ticket('ticket:1', 'user:1', 1200);
    const right = ticket('ticket:2', 'user:2', 1250);
    expect(areMatchmakingTicketsCompatible(left, right, 2_000)).toBe(true);
    expect(areMatchmakingTicketsCompatible(left, { ...right, tenantId: 'tenant:2' }, 2_000)).toBe(
      false,
    );
    expect(areMatchmakingTicketsCompatible(left, { ...right, rated: false }, 2_000)).toBe(false);
    expect(
      areMatchmakingTicketsCompatible(
        left,
        { ...right, timeControl: { initialMs: 300_000, incrementMs: 0 }, pool: 'blitz' },
        2_000,
      ),
    ).toBe(false);
  });

  it('rejects same-player and conflicting fixed-color tickets', () => {
    const white = ticket('ticket:1', 'user:1', 1200, 'white');
    expect(
      areMatchmakingTicketsCompatible(
        white,
        ticket('ticket:2', 'user:1', 1200, 'black'),
        2_000,
      ),
    ).toBe(false);
    expect(
      areMatchmakingTicketsCompatible(
        white,
        ticket('ticket:3', 'user:3', 1200, 'white'),
        2_000,
      ),
    ).toBe(false);
  });

  it('pairs the oldest ticket with the closest compatible rating deterministically', () => {
    const oldest = ticket('ticket:a', 'user:a', 1200, 'white', 1_000);
    const farther = ticket('ticket:b', 'user:b', 1280, 'black', 1_100);
    const closer = ticket('ticket:c', 'user:c', 1230, 'black', 1_200);
    const pair = findMatchmakingPair([farther, closer, oldest], 2_000);
    expect(pair).toMatchObject({
      white: { id: 'ticket:a', playerId: 'user:a' },
      black: { id: 'ticket:c', playerId: 'user:c' },
      pool: 'rapid',
      rated: true,
      ratingDifference: 30,
    });
    expect(preferredColorForPair(pair!, 'user:a')).toBe('white');
    expect(preferredColorForPair(pair!, 'user:c')).toBe('black');
  });

  it('widens compatibility only after both users have waited', () => {
    const left = ticket('ticket:1', 'user:1', 1200, 'random', 1_000);
    const right = ticket('ticket:2', 'user:2', 1500, 'random', 1_000);
    expect(areMatchmakingTicketsCompatible(left, right, 2_000)).toBe(false);
    expect(areMatchmakingTicketsCompatible(left, right, 181_000)).toBe(true);
  });

  it('allows only the owner to cancel a queued non-expired ticket', () => {
    const value = ticket('ticket:1', 'user:1', 1200);
    expect(cancelMatchmakingTicket(value, 'user:2', 2_000)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(cancelMatchmakingTicket(value, 'user:1', 2_000)).toMatchObject({
      ok: true,
      value: { status: 'cancelled', version: 2 },
    });
    expect(cancelMatchmakingTicket(value, 'user:1', value.expiresAtMs)).toMatchObject({
      ok: false,
      code: 'expired',
    });
  });
});
