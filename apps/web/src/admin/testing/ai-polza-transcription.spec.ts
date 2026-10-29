// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiAdminWorkspace } from '../AiAdminWorkspace';
import { AI_ADMIN_SECTIONS, navigateAiAdmin, readAiAdminNavigation } from '../ai-admin-navigation';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
const saved = {
  configurationVersion: 1,
  enabled: false,
  transcriptionEnabled: false,
  dailySecondsLimit: 600,
  globalDailySecondsLimit: 7200,
  maxAudioSeconds: 20,
  apiKeyConfigured: false,
  keyFingerprint: null,
  updatedAt: '2026-10-29T09:00:00.000Z',
  encryptionReady: true,
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.mocked(call).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    data:
      url === '/api/admin/v1/ai'
        ? aiAdminFixture()
        : url === '/api/admin/v1/ai/polza'
          ? saved
          : { enabled: false },
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('keeps explicit Polza links and appends Video / Transcription to admin navigation', () => {
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
});

it('shows compact real credential controls and a separate STT budget, without spending money', async () => {
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=polza');
  await act(async () => {
    root.render(
      createElement(AiAdminWorkspace, {
        principalId: 'admin-polza',
        onAccessDenied: vi.fn(),
      }),
    );
  });
  expect(host.querySelector('[aria-label="Подключение Polza AI"]')).not.toBeNull();
  const key = host.querySelector<HTMLInputElement>('[aria-label="API-ключ Polza AI"]');
  expect(key).not.toBeNull();
  expect(key?.value).toBe('');
  expect(host.textContent).toContain('Текст');
  expect(host.textContent).toContain('Адаптер планируется');
  expect(host.querySelector<HTMLButtonElement>('.asa-polza-primary')?.disabled).toBe(true);
  expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

  const transcription = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
    (button) => button.textContent === 'Транскрибация',
  );
  await act(async () => transcription!.click());
  expect(host.querySelector('[aria-label="Настройки транскрибации"]')).not.toBeNull();
  expect(host.textContent).toContain('GigaAM-v3');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Дневной лимит платформы"]')?.value).toBe(
    '7200',
  );
  expect(host.querySelector<HTMLButtonElement>('.asa-polza-primary')?.disabled).toBe(true);
  expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

  const video = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
    (button) => button.textContent === 'Видео',
  );
  await act(async () => video!.click());
  expect(host.querySelector('[aria-label="Настройки видео"]')).not.toBeNull();
});

it('refuses to expose or persist a key without the encrypted server endpoint', async () => {
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=polza');
  await act(async () => {
    root.render(
      createElement(AiAdminWorkspace, {
        principalId: 'admin-polza',
        onAccessDenied: vi.fn(),
      }),
    );
  });
  const key = host.querySelector<HTMLInputElement>('[aria-label="API-ключ Polza AI"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      key,
      'pza_test_secret_for_ci_only',
    );
    key.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = host.querySelector<HTMLButtonElement>('.asa-polza-primary')!;
  expect(button.disabled).toBe(false);
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 503,
    error: { code: 'ai_polza_unavailable', message: 'Настройки недоступны.' },
  });
  await act(async () => {
    button.closest('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  expect(host.textContent).toContain('Настройки недоступны.');
  expect(host.textContent).not.toContain('pza_test_secret_for_ci_only');
  expect(localStorage.length).toBeLessThanOrEqual(1);
});
