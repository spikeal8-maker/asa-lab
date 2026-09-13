import { describe, expect, it } from 'vitest';
import { CheckersGameService } from '../application/game-service';
import { createInitialCheckersDocument } from '../domain/document';
import { InMemoryCheckersGameRepository } from '../infrastructure/in-memory-game-repository';

function service(): CheckersGameService {
  return new CheckersGameService(new InMemoryCheckersGameRepository());
}

const createCommand = {
  id: 'session-1',
  projectId: 'project-1',
  classroomId: null,
  mode: 'bot' as const,
  players: [
    { kind: 'student' as const, participantId: 'student-1', side: 'light' as const },
    {
      kind: 'bot' as const,
      participantId: 'bot:iskra',
      side: 'dark' as const,
      botId: 'iskra' as const,
    },
  ],
  document: createInitialCheckersDocument(),
  occurredAt: '2026-08-11T10:00:00.000Z',
};

const humanPlayers = [
  { kind: 'student' as const, participantId: 'student-1', side: 'light' as const },
  { kind: 'student' as const, participantId: 'student-2', side: 'dark' as const },
];

describe('Checkers game application service', () => {
  it('creates a versioned independent session and returns defensive copies', async () => {
    const games = service();
    const created = await games.createSession(createCommand);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      id: 'session-1',
      projectId: 'project-1',
      mode: 'bot',
      status: 'active',
      version: 1,
      createdAt: '2026-08-11T10:00:00.000Z',
    });
    expect(created.value.drawTracker.positionOccurrences).toHaveLength(1);
    expect((await games.getSession('session-1')).ok).toBe(true);
    expect(await games.createSession(createCommand)).toEqual({
      ok: false,
      message: 'Checkers session already exists',
    });
  });

  it('enforces assigned side, turn and optimistic session version', async () => {
    const games = service();
    await games.createSession(createCommand);

    expect(
      await games.playMove({
        sessionId: 'session-1',
        actorId: 'student-2',
        expectedVersion: 1,
        pieceId: 'light-09',
        path: ['a3', 'b4'],
        occurredAt: '2026-08-11T10:01:00.000Z',
      }),
    ).toEqual({ ok: false, message: 'only an assigned student player can make this move' });

    const moved = await games.playMove({
      sessionId: 'session-1',
      actorId: 'student-1',
      expectedVersion: 1,
      pieceId: 'light-09',
      path: ['a3', 'b4'],
      occurredAt: '2026-08-11T10:01:00.000Z',
    });
    expect(moved.ok && moved.value).toMatchObject({
      status: 'active',
      version: 2,
      updatedAt: '2026-08-11T10:01:00.000Z',
    });

    expect(
      await games.playMove({
        sessionId: 'session-1',
        actorId: 'student-1',
        expectedVersion: 1,
        pieceId: 'light-10',
        path: ['c3', 'd4'],
        occurredAt: '2026-08-11T10:02:00.000Z',
      }),
    ).toEqual({ ok: false, message: 'session version conflict: current version is 2' });
  });

  it('runs the assigned bot through the same legal move engine', async () => {
    const games = service();
    await games.createSession(createCommand);
    await games.playMove({
      sessionId: 'session-1',
      actorId: 'student-1',
      expectedVersion: 1,
      pieceId: 'light-09',
      path: ['a3', 'b4'],
      occurredAt: '2026-08-11T10:01:00.000Z',
    });

    const botTurn = await games.playBotMove({
      sessionId: 'session-1',
      expectedVersion: 2,
      botId: 'iskra',
      occurredAt: '2026-08-11T10:01:01.000Z',
      search: { seed: 17 },
    });

    expect(botTurn.ok).toBe(true);
    if (!botTurn.ok) return;
    expect(botTurn.value.session).toMatchObject({ status: 'active', version: 3 });
    expect(botTurn.value.session.document.sideToMove).toBe('light');
    expect(botTurn.value.session.document.moveHistory).toHaveLength(2);
    expect(botTurn.value.decision.move.side).toBe('dark');
  });

  it('accepts the future human-v-human friend, quick and rated modes', async () => {
    for (const mode of ['friend', 'quick', 'rated'] as const) {
      const games = service();
      const created = await games.createSession({
        ...createCommand,
        id: `session-${mode}`,
        mode,
        players: humanPlayers,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      expect(created.value).toMatchObject({
        id: `session-${mode}`,
        mode,
        status: 'active',
        classroomId: null,
      });
    }
  });

  it('rejects invalid mode/player and education-scope combinations before persistence', async () => {
    const games = service();
    expect(
      await games.createSession({
        ...createCommand,
        mode: 'class',
        players: humanPlayers,
      }),
    ).toEqual({ ok: false, message: 'class mode requires a classroom id' });

    expect(
      await games.createSession({
        ...createCommand,
        id: 'rated-with-bot',
        mode: 'rated',
      }),
    ).toEqual({ ok: false, message: 'bot players are only allowed in bot mode' });

    expect(
      await games.createSession({
        ...createCommand,
        id: 'rated-with-classroom',
        mode: 'rated',
        classroomId: 'classroom-1',
        players: humanPlayers,
      }),
    ).toEqual({ ok: false, message: 'online public/private modes cannot carry a classroom id' });
  });

  it('marks a pre-finished session as finished and blocks additional moves', async () => {
    const games = service();
    const created = await games.createSession({
      ...createCommand,
      id: 'finished-friend',
      mode: 'friend',
      players: humanPlayers,
      document: { ...createInitialCheckersDocument(), result: '1-0' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe('finished');
    expect(
      await games.playMove({
        sessionId: 'finished-friend',
        actorId: 'student-1',
        expectedVersion: 1,
        pieceId: 'light-09',
        path: ['a3', 'b4'],
        occurredAt: '2026-08-11T10:05:00.000Z',
      }),
    ).toEqual({ ok: false, message: 'Checkers session is already finished' });
  });
});
