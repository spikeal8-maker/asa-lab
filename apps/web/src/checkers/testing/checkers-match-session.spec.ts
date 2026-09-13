import {
  createCheckersDrawTracker,
  createInitialCheckersDocument,
  createInitialCheckersProjectDocument,
  type CheckersGameSession,
} from '@asa-lab/checkers';
import { describe, expect, it } from 'vitest';
import {
  checkersMatchHistoryEntry,
  checkersMatchResultView,
  checkersMatchResumeView,
  classroomCheckersMatchSession,
  projectCheckersMatchSession,
  serviceCheckersMatchSession,
} from '../checkers-match-session';

const playedAt = '2026-09-13T10:00:00.000Z';

describe('CK-105 unified Checkers match-session projection', () => {
  it('keeps legacy bot play fail-closed until the human side is known', () => {
    const project = {
      ...createInitialCheckersProjectDocument('student-1'),
      education: {
        ...createInitialCheckersProjectDocument('student-1').education,
        lastActivityAt: playedAt,
      },
    };
    const unknown = projectCheckersMatchSession({
      project,
      botPlayerSide: 'light',
      botPlayerSideKnown: false,
    });
    expect(unknown).toMatchObject({
      mode: 'bot',
      status: 'active',
      viewerSide: null,
      readOnly: true,
      opponentLabel: 'Искра',
    });
    expect(checkersMatchResumeView(unknown)).toBeNull();

    const known = projectCheckersMatchSession({
      project,
      botPlayerSide: 'light',
      botPlayerSideKnown: true,
    });
    expect(known).toMatchObject({ viewerSide: 'light', readOnly: false, orientation: 'light' });
    expect(checkersMatchResumeView(known)?.title).toContain('Искра');
  });

  it('projects local play through the same contract with auto-flip and controls', () => {
    const base = createInitialCheckersProjectDocument('student-1');
    const project = {
      ...base,
      game: { ...base.game, sideToMove: 'dark' as const },
      activeMatch: { mode: 'local' as const, localAutoFlip: true },
      education: { ...base.education, lastActivityAt: playedAt },
    };
    const session = projectCheckersMatchSession({
      project,
      botPlayerSide: 'light',
      botPlayerSideKnown: false,
    });
    expect(session).toMatchObject({
      mode: 'local',
      status: 'active',
      orientation: 'dark',
      autoFlipBoard: true,
      canResign: true,
      canDraw: true,
    });
    expect(checkersMatchResumeView(session)?.detail).toContain('ход тёмных');
  });

  it('adapts classroom games without changing their server authority', () => {
    const document = createInitialCheckersDocument();
    const session = classroomCheckersMatchSession({
      id: 'class-game-1',
      mode: 'friendly',
      status: 'active',
      version: 7,
      side: 'dark',
      lightPlayer: { id: 'student-1', displayName: 'Маша' },
      darkPlayer: { id: 'student-2', displayName: 'Саша' },
      document: { ...document, sideToMove: 'light' },
      createdAt: playedAt,
      updatedAt: playedAt,
    });
    expect(session).toMatchObject({
      id: 'class-game-1',
      mode: 'classroom',
      source: 'classroom-server',
      viewerSide: 'dark',
      opponentLabel: 'Маша',
      readOnly: true,
    });

    const declined = classroomCheckersMatchSession({
      id: 'class-game-declined',
      mode: 'friendly',
      status: 'declined',
      version: 1,
      side: null,
      lightPlayer: { id: 'student-1', displayName: 'Маша' },
      darkPlayer: { id: 'student-2', displayName: 'Саша' },
      document,
      createdAt: playedAt,
      updatedAt: playedAt,
    });
    expect(declined).toMatchObject({
      status: 'abandoned',
      modeLabel: 'Игра класса · отклонена',
      readOnly: true,
    });
  });

  it('projects future rated sessions from the shared application service', () => {
    const document = createInitialCheckersDocument();
    const serviceSession: CheckersGameSession = {
      id: 'rated-1',
      projectId: 'project-1',
      classroomId: null,
      mode: 'rated',
      status: 'active',
      players: [
        { kind: 'student', participantId: 'student-1', side: 'light' },
        { kind: 'student', participantId: 'student-2', side: 'dark' },
      ],
      document,
      drawTracker: createCheckersDrawTracker(document),
      version: 1,
      createdAt: playedAt,
      updatedAt: playedAt,
    };
    const session = serviceCheckersMatchSession(serviceSession, 'student-1', {
      'student-2': 'Соперник 1450',
    });
    expect(session).toMatchObject({
      mode: 'rated',
      modeLabel: 'Рейтинговая игра',
      viewerSide: 'light',
      opponentLabel: 'Соперник 1450',
      readOnly: false,
      canResign: true,
    });

    const privacyFallback = serviceCheckersMatchSession(serviceSession, 'student-1');
    expect(privacyFallback.opponentLabel).toBe('Соперник');
    expect(privacyFallback.opponentLabel).not.toContain('student-2');
  });

  it('derives one result and history contract from a finished server session', () => {
    const document = { ...createInitialCheckersDocument(), result: '1-0' as const };
    const serviceSession: CheckersGameSession = {
      id: 'quick-1',
      projectId: 'project-1',
      classroomId: null,
      mode: 'quick',
      status: 'finished',
      players: [
        { kind: 'student', participantId: 'student-1', side: 'light' },
        { kind: 'student', participantId: 'student-2', side: 'dark' },
      ],
      document,
      drawTracker: createCheckersDrawTracker(document),
      version: 12,
      createdAt: playedAt,
      updatedAt: '2026-09-13T10:12:00.000Z',
    };
    const session = serviceCheckersMatchSession(serviceSession, 'student-1', {
      'student-2': 'Иван',
    });
    expect(checkersMatchResultView(session)).toEqual({
      tone: 'win',
      title: 'Вы победили: Иван',
      detail: 'Быстрая игра · вы играли светлыми.',
    });
    expect(checkersMatchHistoryEntry(session)).toEqual({
      id: 'quick-1',
      mode: 'quick',
      result: '1-0',
      opponentLabel: 'Иван',
      moveCount: 0,
      finishedAt: '2026-09-13T10:12:00.000Z',
    });
    expect(checkersMatchResumeView(session)).toBeNull();
  });
});
