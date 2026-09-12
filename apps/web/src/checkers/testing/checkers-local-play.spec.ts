import { createInitialCheckersProjectDocument } from '@asa-lab/checkers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckersLocalSetup } from '../CheckersLocalSetup';
import { CheckersWorkspace } from '../CheckersWorkspace';
import { shouldRunCheckersBotTurn } from '../use-checkers-project';

describe('CK-103 local two-player', () => {
  it('explains the two sides and optional automatic board rotation before start', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersLocalSetup, {
        autoFlip: true,
        onAutoFlipChange: () => undefined,
        onStart: () => undefined,
        onBack: () => undefined,
      }),
    );

    expect(markup).toContain('Два игрока за одним устройством');
    expect(markup).toContain('Игрок 1');
    expect(markup).toContain('Игрок 2');
    expect(markup).toContain('Автоповорот включён');
    expect(markup).toContain('Начать локальную партию');
    expect(markup).toContain('checked=""');
  });
  it('never starts the bot effect for a persisted local match', () => {
    const project = createInitialCheckersProjectDocument('student-1');
    const local = {
      ...project,
      activeMatch: { mode: 'local' as const, localAutoFlip: true },
      game: { ...project.game, sideToMove: 'dark' as const },
      education: { ...project.education, activeBotMode: 'campaign' as const },
    };
    expect(shouldRunCheckersBotTurn(local, true, 'light')).toBe(false);
    expect(shouldRunCheckersBotTurn(project, true, 'dark')).toBe(true);
  });

  it('renders the local board for the side to move with draw and resign controls', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersWorkspace, {
        model: {
          projectTitle: 'Партия вдвоём',
          saveState: 'saved',
          userName: 'Маша',
          mode: 'play',
          modeLabel: 'Игра вдвоём · одно устройство',
          opponentLabel: 'Игрок 1 — светлые · Игрок 2 — тёмные',
          sideToMove: 'dark',
          pieces: [],
          legalMoves: [],
          moveHistory: [],
          instructionTitle: 'Ход тёмных',
          instruction: 'Передайте устройство второму игроку.',
          reactionsEnabled: false,
          orientation: 'dark',
          autoFlipBoard: true,
          canRestart: true,
          canResign: true,
          canDraw: true,
        },
        onBack: () => undefined,
        onRename: () => undefined,
        onModeChange: () => undefined,
        onMove: () => undefined,
        onReaction: () => undefined,
        onRestart: () => undefined,
        onResign: () => undefined,
        onDraw: () => undefined,
      }),
    );

    expect(markup).toContain('data-orientation="dark"');
    expect(markup).toContain('Игра вдвоём · одно устройство');
    expect(markup).toContain('Ничья');
    expect(markup).toContain('Сдаться');
  });
});
