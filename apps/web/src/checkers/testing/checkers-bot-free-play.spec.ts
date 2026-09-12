import { CHECKERS_BOTS, createInitialCheckersProjectDocument } from '@asa-lab/checkers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckersBotSetup, resolveCheckersBotSideChoice } from '../CheckersBotSetup';
import { CheckersWorkspace } from '../CheckersWorkspace';
import { shouldProgressCheckersBotCampaign } from '../use-checkers-project';

describe('CK-102 bot free play', () => {
  it('resolves fixed and random player sides at game start', () => {
    expect(resolveCheckersBotSideChoice('light', 0.9)).toBe('light');
    expect(resolveCheckersBotSideChoice('dark', 0.1)).toBe('dark');
    expect(resolveCheckersBotSideChoice('random', 0.1)).toBe('light');
    expect(resolveCheckersBotSideChoice('random', 0.9)).toBe('dark');
  });

  it('renders every bot as immediately playable in free play', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersBotSetup, {
        bots: CHECKERS_BOTS,
        selectedBotId: 'master',
        sideChoice: 'random',
        onSideChoice: () => undefined,
        onStart: () => undefined,
        onOpenCampaign: () => undefined,
        onBack: () => undefined,
      }),
    );
    for (const bot of CHECKERS_BOTS) {
      expect(markup).toContain(bot.displayName);
      expect(markup).toContain(`Играть с ${bot.displayName}`);
    }
    expect(markup).toContain('Случайно — сторона выбирается при старте');
    expect(markup).toContain('Лестница ASA Bot');
    expect(markup).not.toContain('Сначала предыдущий уровень');
    expect(markup).not.toContain('disabled=""');
  });

  it('keeps free-play wins out of campaign progression', () => {
    const project = createInitialCheckersProjectDocument('student-1');
    const finished = {
      ...project,
      game: { ...project.game, result: '0-1' as const },
      education: { ...project.education, activeBotMode: 'free' as const },
    };
    expect(shouldProgressCheckersBotCampaign(finished, 'dark')).toBe(false);
  });

  it('credits campaign wins for either player side', () => {
    const project = createInitialCheckersProjectDocument('student-1');
    const darkWin = {
      ...project,
      game: { ...project.game, result: '0-1' as const },
      education: { ...project.education, activeBotMode: 'campaign' as const },
    };
    expect(shouldProgressCheckersBotCampaign(darkWin, 'dark')).toBe(true);
    expect(shouldProgressCheckersBotCampaign(darkWin, 'light')).toBe(false);
  });
  it('shows a finished bot game with rematch, opponent choice and review actions', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersWorkspace, {
        model: {
          projectTitle: 'Свободная партия',
          saveState: 'saved',
          userName: 'Маша',
          mode: 'play',
          modeLabel: 'Свободная игра · Мастер',
          opponentLabel: 'Мастер',
          sideToMove: 'dark',
          pieces: [],
          legalMoves: [],
          moveHistory: [],
          instructionTitle: 'Партия завершена',
          instruction: 'Можно сыграть ещё раз или открыть разбор.',
          reactionsEnabled: false,
          readOnly: true,
          canRestart: true,
          gameResult: {
            tone: 'win',
            title: 'Вы победили Мастера',
            detail: 'Свободная игра · вы играли тёмными.',
          },
        },
        onBack: () => undefined,
        onRename: () => undefined,
        onModeChange: () => undefined,
        onMove: () => undefined,
        onReaction: () => undefined,
        onRestart: () => undefined,
        onChooseOpponent: () => undefined,
      }),
    );

    expect(markup).toContain('Вы победили Мастера');
    expect(markup).toContain('Свободная игра · вы играли тёмными.');
    expect(markup).toContain('Реванш');
    expect(markup).toContain('Другой соперник');
    expect(markup).toContain('Разобрать партию');
  });
});
