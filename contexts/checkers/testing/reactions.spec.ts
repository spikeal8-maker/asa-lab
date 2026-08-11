import { describe, expect, it } from 'vitest';
import {
  CHECKERS_REACTIONS,
  CHECKERS_REACTION_IDS,
  createCheckersReactionEvent,
  decideCheckersReaction,
  type CheckersReactionEvent,
  type CheckersReactionRequest,
} from '../domain/reactions';

const request: CheckersReactionRequest = {
  eventId: 'reaction-1',
  gameId: 'game-1',
  gameClassroomId: 'class-1',
  senderId: 'student-1',
  senderClassroomIds: ['class-1'],
  participantIds: ['student-1', 'student-2'],
  reactionId: 'good-move',
  sentAt: '2026-08-11T10:00:10.000Z',
  gameState: 'active',
};

function event(id: string, sentAt: string, gameState: 'active' | 'finished' = 'active') {
  return {
    id,
    gameId: 'game-1',
    classroomId: 'class-1',
    senderId: 'student-1',
    reactionId: 'applause' as const,
    sentAt,
    gameState,
  } satisfies CheckersReactionEvent;
}

describe('child-safe Checkers reactions', () => {
  it('exposes only the server-defined reaction allowlist', () => {
    expect(Object.keys(CHECKERS_REACTIONS)).toEqual(CHECKERS_REACTION_IDS);
    expect(CHECKERS_REACTIONS['thanks-for-game']).toBe('Спасибо за игру!');
  });

  it('requires same-class authorization and game participation', () => {
    expect(decideCheckersReaction({ ...request, senderClassroomIds: ['class-2'] }, [])).toEqual({
      allowed: false,
      code: 'not-class-authorized',
    });
    expect(decideCheckersReaction({ ...request, participantIds: ['student-2'] }, [])).toEqual({
      allowed: false,
      code: 'not-a-participant',
    });
  });

  it('enforces cooldown and a four-event rolling window', () => {
    expect(
      decideCheckersReaction(request, [event('previous', '2026-08-11T10:00:09.000Z')]),
    ).toEqual({
      allowed: false,
      code: 'cooldown',
    });
    const previous = [
      event('r1', '2026-08-11T10:00:01.000Z'),
      event('r2', '2026-08-11T10:00:03.000Z'),
      event('r3', '2026-08-11T10:00:05.000Z'),
      event('r4', '2026-08-11T10:00:07.000Z'),
    ];
    expect(decideCheckersReaction(request, previous)).toEqual({
      allowed: false,
      code: 'rate-limit',
    });
  });

  it('allows one sportsmanship reaction after the game and writes audit evidence', () => {
    const closing = {
      ...request,
      reactionId: 'thanks-for-game' as const,
      gameState: 'finished' as const,
    };
    expect(createCheckersReactionEvent(closing, [])).toEqual({
      ok: true,
      value: {
        id: 'reaction-1',
        gameId: 'game-1',
        classroomId: 'class-1',
        senderId: 'student-1',
        reactionId: 'thanks-for-game',
        sentAt: '2026-08-11T10:00:10.000Z',
        gameState: 'finished',
      },
    });
    expect(
      decideCheckersReaction({ ...closing, sentAt: '2026-08-11T10:00:20.000Z' }, [
        event('closing-before', '2026-08-11T10:00:10.000Z', 'finished'),
      ]),
    ).toEqual({ allowed: false, code: 'reaction-closed' });
    expect(decideCheckersReaction({ ...closing, reactionId: 'thinking' }, [])).toEqual({
      allowed: false,
      code: 'reaction-closed',
    });
  });
});
