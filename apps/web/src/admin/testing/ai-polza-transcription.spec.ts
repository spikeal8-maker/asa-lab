// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiAdminWorkspace } from '../AiAdminWorkspace';
import {
  AI_ADMIN_SECTIONS,
  navigateAiAdmin,
  readAiAdminNavigation,
} from '../ai-admin-navigation';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.mocked(call).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('preserves explicit Polza and transcription links without affecting existing providers', () => {
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=polza');
  expect(readAiAdminNavigation('admin-a').provider).toBe('polza');
  expect(AI_ADMIN_SECTIONS.map((item) => item.label).slice(-3)).toEqual([
    'Изображения',
    'Видео',
    'Транскрибация',
  ]);
  navigateAiAdmin({ section: 'transcription', provider: 'polza' });
  expect(readAiAdminNavigation('admin-a')).toEqual({
    section: 'transcription',
    provider: 'polza',
  });
  navigateAiAdmin({ section: 'connections', provider: 'openai' });
  expect(readAiAdminNavigation('admin-a').provider).toBe('openai');
});

it('shows Polza and transcription pages without a fake key-save or paid request', async () => {
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=polza');
  vi.mocked(call).mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    data: url === '/api/admin/v1/ai' ? aiAdminFixture() : { enabled: false },
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        createElement(AiAdminWorkspace, {
          principalId: 'admin-polza',
          onAccessDenied: vi.fn(),
        }),
      );
    });
    const polza = host.querySelector<HTMLElement>('[aria-label="Подключение Polza AI"]');
    expect(polza).not.toBeNull();
    expect(polza!.textContent).toContain('Polza AI');
    expect(polza!.textContent).toContain('не реализованы');
    expect(host.querySelector('input[type=password]')).toBeNull();
    expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

    const transcription = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
      (button) => button.textContent === 'Транскрибация',
    );
    expect(transcription).toBeDefined();
    await act(async () => transcription!.click());
    expect(host.querySelector('[aria-label="Настройки транскрибации"]')).not.toBeNull();
    expect(host.textContent).toContain('GigaAM-v3');
    expect(host.textContent).toContain('не доступны');
    expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    const video = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
      (button) => button.textContent === 'Видео',
    )!;
    await act(async () => video.click());
    expect(host.querySelector('[aria-label="Настройки видео"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
