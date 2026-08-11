import {
  ASA_BOT_PROFILES,
  createChessGameDocument,
  createEmptyChessDocument,
  validateChessDocument,
} from '@asa-lab/chess';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewGameDialog } from '../ChessEditor';
import { applyAsaBotProfile, botProfileUiSummary, resolveAsaBotProfile } from '../chess-ui';

describe('ASA bot profile game setup UI', () => {
  it('renders all 12 selectable original profiles and an explicit calibration warning', () => {
    const html = renderToStaticMarkup(
      createElement(NewGameDialog, { onClose: vi.fn(), onStart: vi.fn() }),
    );
    expect(html.match(/name="asa-bot-profile"/g)).toHaveLength(12);
    for (const profile of ASA_BOT_PROFILES) expect(html).toContain(profile.displayName);
    expect(html).toContain('Уровень локального движка');
    expect(html).toContain('Стиль');
    expect(html).toContain('Помощь');
    expect(html).toContain('Вызов');
    expect(html).toContain('Профиль не откалиброван по серии партий.');
    expect(html).not.toContain('подтверждённый рейтинг');
  });

  it('builds truthful level, style, assistance and challenge summaries', () => {
    for (const profile of ASA_BOT_PROFILES) {
      const summary = botProfileUiSummary(profile);
      expect(summary.levelLabel).toContain(`${profile.engine.level} из 3`);
      expect(summary.styleLabel).toContain('пока не влияющие на выбор хода');
      expect(summary.assistanceLabel).toContain('пока не управляющая контролами');
      expect(summary.challengeLabel).toContain('пока не управляющая сложностью');
      expect(summary.calibrationNote).toContain('Проектный Elo-ориентир');
      expect(summary.calibrationNote).toContain('не откалиброван');
    }
  });

  it('persists the chosen profile id, matching level and bot display name', () => {
    const profile = ASA_BOT_PROFILES.find((candidate) => candidate.id === 'asa-bot-comet')!;
    const base = createChessGameDocument({
      mode: 'computer',
      playerColor: 'black',
      botLevel: profile.engine.level,
    });
    const configured = applyAsaBotProfile(base, profile);
    expect(configured.bot).toEqual({
      color: 'white',
      level: profile.engine.level,
      profileId: profile.id,
    });
    expect(configured.headers.White).toBe(profile.displayName);
    expect(validateChessDocument(configured)).toEqual({ ok: true, value: configured });
  });

  it('keeps the default profile name consistent in the document and PGN headers', () => {
    const document = createEmptyChessDocument('computer');
    expect(document.bot?.profileId).toBe('asa-bot-compass');
    expect(document.headers.Black).toBe('Компас ASA');
  });

  it('resolves legacy documents deterministically by their stored level', () => {
    for (const level of [1, 2, 3] as const) {
      const first = resolveAsaBotProfile(undefined, level);
      const second = resolveAsaBotProfile(undefined, level);
      expect(second).toBe(first);
      expect(first.engine.level).toBe(level);
    }
  });
});
