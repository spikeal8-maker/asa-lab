import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialCheckersProjectDocument, type CheckersAssignment } from '@asa-lab/checkers';
import { newClientId } from '../../client-id';
import { CheckersBoard, type CheckersBoardPiece } from '../CheckersBoard';
import {
  buildCheckersTeacherModel,
  resolveCheckersLandingSurface,
} from '../CheckersModuleExperience';
import { CheckersStudentHome } from '../CheckersStudentHome';
import { CheckersTeacherDashboard } from '../CheckersTeacherDashboard';
import { CheckersWorkspace } from '../CheckersWorkspace';

const pieces: readonly CheckersBoardPiece[] = [
  { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
  { id: 'dark-d4', side: 'dark', kind: 'king', square: 'd4' },
];

describe('Checkers presentation contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates durable action ids when randomUUID is unavailable over plain HTTP', () => {
    let nextByte = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => {
          bytes[index] = nextByte++;
        });
        return bytes;
      },
    });

    expect(newClientId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('opens a classroom dashboard only for a user allowed to manage classes', () => {
    expect(resolveCheckersLandingSurface('classroom', true)).toBe('teacher');
    expect(resolveCheckersLandingSurface('classroom', false)).toBe('home');
    expect(resolveCheckersLandingSurface('personal', true)).toBe('home');
  });

  it('derives class completion and exact evidence from isolated learner progress', () => {
    const assignment: CheckersAssignment = {
      id: 'assignment-1',
      classroomId: 'class-1',
      teacherId: 'teacher-1',
      title: 'Обязательное взятие',
      kind: 'puzzle-set',
      targetRef: 'puzzle-set:starter',
      assigneeKind: 'group',
      assigneeIds: ['student-1'],
      dueAt: null,
      attemptLimit: null,
      hintsAllowed: true,
      maxHintLevel: 3,
      minimumScore: 70,
      requiredCompletions: 1,
      status: 'assigned',
    };
    const initial = createInitialCheckersProjectDocument('student-1');
    const model = buildCheckersTeacherModel(
      '5Б',
      [assignment],
      {
        assignments: [assignment],
        safetySignals: [],
        students: [
          {
            id: 'student-1',
            displayName: 'Маша',
            email: 'masha@test.local',
            lastActivityAt: '2026-08-14T10:00:00.000Z',
            progress: initial.education.progress,
            evidence: [
              {
                id: 'evidence-1',
                studentId: 'student-1',
                conceptId: 'mandatory-capture',
                kind: 'puzzle-attempt',
                outcome: 'correct',
                sourceId: 'capture-choice',
                occurredAt: '2026-08-14T10:00:00.000Z',
                firstAttempt: true,
                hintLevel: 0,
                transferPosition: false,
                score: 100,
              },
            ],
            completedPuzzleIds: ['capture-choice'],
            lastMove: {
              ply: 1,
              path: ['c3', 'e5'],
              capturedIds: ['dark-d4'],
            },
            revision: 1,
            updatedAt: '2026-08-14T10:00:00.000Z',
          },
        ],
      },
      Date.parse('2026-08-14T12:00:00.000Z'),
    );

    expect(model.studentCount).toBe(1);
    expect(model.activeThisWeek).toBe(1);
    expect(model.assignmentCompletionPercent).toBe(100);
    expect(model.assignments[0]).toMatchObject({ completed: 1, assigned: 1 });
    expect(model.students[0]?.lastEvidence).toContain('capture-choice · ход c3:e5 · 100%');
  });

  it('renders an accessible 8x8 board with 32 playable squares', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersBoard, {
        pieces,
        selectedPieceId: 'light-c3',
        legalDestinations: ['e5'],
      }),
    );

    expect(markup).toContain('aria-label="Доска для русских шашек, 8 на 8"');
    expect(markup.match(/data-square=/g)).toHaveLength(64);
    expect(markup.match(/checkers-square dark/g)).toHaveLength(32);
    expect(markup).toContain('c3: светлая шашка');
    expect(markup).toContain('d4: тёмная дамка');
    expect(markup).toContain('e5: допустимое поле хода');
  });

  it('renders the student aggregate around one clear next action', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersStudentHome, {
        model: {
          studentName: 'Маша',
          recommendation: {
            id: 'assignment-1',
            eyebrow: 'Сначала это',
            title: 'Обязательное взятие',
            description: 'Задание от педагога до завтра.',
            progressLabel: '2 из 5 позиций',
            progressPercent: 40,
            actionLabel: 'Продолжить',
          },
          assignments: [],
          reviewCount: 3,
          learningUnit: 4,
          learningUnitsTotal: 11,
          masteryPercent: 62,
          currentBotName: 'Следопыт',
          botRung: 2,
          botRungsTotal: 6,
          classPlayAvailable: true,
        },
        onOpen: () => undefined,
      }),
    );

    expect(markup).toContain('Маша, твой следующий ход');
    expect(markup).toContain('Здесь собраны задания, обучение, игры и повторение');
    expect(markup).toContain('Обязательное взятие');
    expect(markup).toContain('Вместе — без открытого чата');
  });

  it('keeps the Electronics-like ASA header and removes free-form child chat', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersWorkspace, {
        model: {
          projectTitle: 'Моя первая партия',
          saveState: 'saved',
          userName: 'Маша Иванова',
          mode: 'learn',
          modeLabel: 'Урок 3 · Обязательное взятие',
          opponentLabel: 'Учебная позиция',
          sideToMove: 'light',
          pieces,
          legalMoves: [{ pieceId: 'light-c3', path: ['c3', 'e5'], notation: 'c3:e5' }],
          moveHistory: [],
          instructionTitle: 'Найди обязательное взятие',
          instruction: 'Посмотри, какая шашка соперника стоит рядом по диагонали.',
          reactionsEnabled: true,
        },
        onBack: () => undefined,
        onRename: () => undefined,
        onModeChange: () => undefined,
        onMove: () => undefined,
        onReaction: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="ASA Lab"');
    expect(markup).toContain('Название шашечного проекта');
    expect(markup).toContain('Учусь');
    expect(markup).toContain('Играю');
    expect(markup).toContain('Разбор');
    expect(markup).toContain('Свободного чата здесь нет');
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('contenteditable');
  });

  it('renders teacher assignments, concept evidence and observable signals', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersTeacherDashboard, {
        model: {
          classroomTitle: '5Б · Логика',
          studentCount: 2,
          activeThisWeek: 1,
          assignmentCompletionPercent: 50,
          needsAttention: 1,
          assignments: [
            {
              id: 'assignment-1',
              title: 'Серии взятий',
              kindLabel: 'Набор задач',
              dueLabel: 'до 15 августа',
              completed: 1,
              assigned: 2,
              status: 'active',
            },
          ],
          students: [
            {
              id: 'student-1',
              displayName: 'Маша И.',
              masteryPercent: 72,
              activityLabel: 'сегодня',
              assignmentProgress: '1 из 1',
              signal: 'ok',
              signalLabel: 'Идёт по плану',
              accuracyLabel: '100%',
              hintUsageLabel: '0 из 1',
              mistakeTheme: 'нет повторяющейся ошибки',
              lastEvidence: 'c3:e5, без подсказки',
            },
            {
              id: 'student-2',
              displayName: 'Илья К.',
              masteryPercent: 38,
              activityLabel: '6 дней назад',
              assignmentProgress: '0 из 1',
              signal: 'repeated-error',
              signalLabel: 'Пропускает взятие назад',
              accuracyLabel: '33%',
              hintUsageLabel: '2 из 3',
              mistakeTheme: 'Взятие назад',
              lastEvidence: 'e5-c3, 3 попытки',
            },
          ],
          concepts: [{ id: 'capture', shortLabel: 'Взятие', fullLabel: 'Обязательное взятие' }],
          masteryByStudent: {
            'student-1': { capture: 82 },
            'student-2': { capture: 34 },
          },
          safetySignals: [
            {
              id: 'signal-1',
              reporterName: 'Маша И.',
              senderName: 'Илья К.',
              reactionLabel: 'Думаю…',
              status: 'open',
              createdLabel: 'сегодня',
            },
          ],
          games: [
            {
              id: 'game-1',
              playersLabel: 'Маша И. — Илья К.',
              modeLabel: 'Матч педагога',
              statusLabel: 'В процессе',
              moveCount: 4,
            },
          ],
        },
        onBack: () => undefined,
        onCreateAssignment: () => undefined,
        onCreateEvent: () => undefined,
        onEnrolStudent: () => undefined,
        onRefresh: () => undefined,
        onOpenAssignment: () => undefined,
        onOpenStudent: () => undefined,
        onOpenGame: () => undefined,
      }),
    );

    expect(markup).toContain('ASA Шашки · педагог');
    expect(markup).toContain('Освоение понятий');
    expect(markup).toContain('До конкретного хода');
    expect(markup).toContain('Пропускает взятие назад');
    expect(markup).toContain('c3:e5, без подсказки');
    expect(markup).toContain('Сигналы по реакциям');
    expect(markup).toContain('Партии и разбор');
    expect(markup).toContain('Матч педагога');
    expect(markup).toContain('Думаю…');
  });
});
