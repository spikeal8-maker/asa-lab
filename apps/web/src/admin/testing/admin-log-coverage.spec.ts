// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AdminLogsPage } from '../AdminLogsPage';
import { call } from '../admin-api';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

for (const hostCollection of ['unavailable', 'stale', 'invalid', 'ok'] as const) {
  it(`shows independent application logging and honest ${hostCollection} host coverage`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    vi.mocked(call)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          state: 'ok',
          applicationCollection: 'embedded',
          hostCollection,
          coverageComplete: false,
          sources: [],
          collectedAt: null,
          retentionDays: 7,
          bytes: 0,
          first: null,
          last: null,
          trimmed: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [], next: null, partial: false },
      });
    try {
      await act(async () => root.render(createElement(AdminLogsPage, { onAccessDenied: vi.fn() })));
      expect(host.textContent).toContain('Журналы приложения подключены автоматически');
      expect(host.textContent).toContain('не полная проверка всех системных источников');
      if (hostCollection === 'ok') expect(host.textContent).toContain('системы также доступен');
      else expect(host.textContent).toContain('недоступны или неполны');
      const download = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Скачать журналы приложения',
      );
      expect(download?.disabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.mocked(call).mockReset();
      vi.unstubAllGlobals();
    }
  });
}

it('exports the applied selection and copies counts without messages or identifiers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const entry = {
    id: 'private-event-id',
    requestId: 'private-request-id',
    time: '2026-11-10T08:00:00.000Z',
    source: 'api',
    module: 'scratch',
    subsystem: 'scratch',
    level: 'error',
    message: '{"code":"worker-timeout","secret":"private-log-text"}',
  };
  vi.mocked(call).mockImplementation(async (path) => {
    const data = path.endsWith('/status')
      ? {
          state: 'ok',
          requiredCoverage: {
            version: 1,
            policy: 'asa-connected-v1',
            state: 'incomplete',
            requiredSourceIds: ['docker-lifecycle', 'api:recent'],
            sources: [
              { source: 'docker-lifecycle', state: 'incomplete' },
              { source: 'api:recent', state: 'ok' },
            ],
          },
          sources: [],
        }
      : path.endsWith('/exports')
        ? { id: 'fixture-export', state: 'ready', count: 1 }
        : { items: [entry], next: { time: entry.time, id: entry.id }, partial: false };
    return { ok: true, status: 200, data };
  });
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((element) => element.textContent === label)!;
  try {
    await act(async () => root.render(createElement(AdminLogsPage, { onAccessDenied: vi.fn() })));
    expect(host.textContent).toContain('События контейнеров Docker');
    expect(host.querySelector('.admin-log-headline')?.textContent).toBe('worker-timeout');
    const module = [...host.querySelectorAll('select')].find((element) =>
      [...element.options].some((option) => option.text === 'Все модули'),
    )!;
    await act(async () => {
      module.value = 'scratch';
      module.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button('Подготовить ZIP выборки').disabled).toBe(true);
    await act(async () => button('Показать').click());
    // jsdom does not always implement the browser's button submission.
    if (button('Подготовить ZIP выборки').disabled)
      await act(async () =>
        host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    expect(button('Подготовить ZIP выборки').disabled).toBe(false);
    await act(async () => button('Подготовить ZIP выборки').click());
    const exportCall = vi.mocked(call).mock.calls.find(([path]) => path.endsWith('/exports'));
    expect(JSON.parse(String(exportCall?.[1]?.body))).toMatchObject({
      scope: 'application',
      module: 'scratch',
      level: 'error',
      search: '',
    });
    await act(async () => button('Скопировать сводку для бота').click());
    expect(writeText).toHaveBeenCalledOnce();
    const summary = writeText.mock.calls[0][0] as string;
    expect(summary).toContain('Scratch · Ошибка: 1');
    expect(summary).toContain('часть выборки');
    expect(summary).not.toMatch(/private-|worker-timeout/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.mocked(call).mockReset();
    vi.unstubAllGlobals();
  }
});
