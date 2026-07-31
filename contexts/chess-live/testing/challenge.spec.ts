import { describe, expect, it } from 'vitest';
import {
  acceptLiveChessChallenge,
  cancelLiveChessChallenge,
  createLiveChessChallenge,
  effectiveChallengeStatus,
  expireLiveChessChallenge,
} from '../domain/challenge';

function challenge() {
  const created = createLiveChessChallenge({
    id: 'challenge:1',
    publicCode: 'ABCDEFGH',
    tenantId: 'tenant:1',
    creatorId: 'user:1',
    colorPreference: 'random',
    timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    rated: false,
    nowMs: 1_000,
    expiresAtMs: 121_000,
    commandId: 'command:create:1',
  });
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

describe('live chess challenge', () => {
  it('creates a bounded session-derived challenge', () => {
    expect(challenge()).toMatchObject({
      id: 'challenge:1',
      publicCode: 'ABCDEFGH',
      tenantId: 'tenant:1',
      creatorId: 'user:1',
      status: 'open',
      version: 1,
      acceptedById: null,
      gameId: null,
    });
  });

  it('rejects invalid controls, public codes and short lifetime', () => {
    expect(
      createLiveChessChallenge({
        id: 'challenge:1',
        publicCode: 'bad',
        tenantId: 'tenant:1',
        creatorId: 'user:1',
        colorPreference: 'white',
        timeControl: { initialMs: 1, incrementMs: 0 },
        rated: false,
        nowMs: 1_000,
        expiresAtMs: 2_000,
        commandId: 'command:create:1',
      }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('does not allow the creator to accept own challenge', () => {
    expect(acceptLiveChessChallenge(challenge(), 'user:1', 'game:1', 2_000)).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'challenge creator cannot accept own challenge',
    });
  });

  it('accepts exactly once and records the game', () => {
    const accepted = acceptLiveChessChallenge(challenge(), 'user:2', 'game:1', 2_000);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'accepted',
        acceptedById: 'user:2',
        acceptedAtMs: 2_000,
        gameId: 'game:1',
        version: 2,
      },
    });
    if (!accepted.ok) return;
    expect(acceptLiveChessChallenge(accepted.value, 'user:3', 'game:2', 3_000)).toEqual({
      ok: false,
      code: 'conflict',
      message: 'challenge is accepted',
    });
  });

  it('allows only the creator to cancel an open challenge', () => {
    expect(cancelLiveChessChallenge(challenge(), 'user:2', 2_000)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(cancelLiveChessChallenge(challenge(), 'user:1', 2_000)).toMatchObject({
      ok: true,
      value: { status: 'cancelled', version: 2 },
    });
  });

  it('expires by server time and cannot be accepted or cancelled afterward', () => {
    const value = challenge();
    expect(effectiveChallengeStatus(value, 121_000)).toBe('expired');
    expect(expireLiveChessChallenge(value, 121_000)).toMatchObject({
      status: 'expired',
      version: 2,
    });
    expect(acceptLiveChessChallenge(value, 'user:2', 'game:1', 121_000)).toMatchObject({
      ok: false,
      code: 'expired',
    });
    expect(cancelLiveChessChallenge(value, 'user:1', 121_000)).toMatchObject({
      ok: false,
      code: 'expired',
    });
  });
});
