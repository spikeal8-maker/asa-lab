import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckersBoard, type CheckersBoardPiece } from '../CheckersBoard';
import { CheckersStudentHome } from '../CheckersStudentHome';
import { CheckersWorkspace } from '../CheckersWorkspace';

const pieces: readonly CheckersBoardPiece[] = [
  { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
  { id: 'dark-d4', side: 'dark', kind: 'king', square: 'd4' },
];

describe('Checkers presentation contract', () => {
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
});
