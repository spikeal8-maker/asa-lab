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

it('exports a fresh rolling Moscow range with only the applied query filters', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T11:13:57Z'));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const ready = { ok: true, status: 200, data: { state: 'ok', sources: [] } } as const;
  const page = { ok: true, status: 200, data: { items: [], next: null, partial: false } } as const;
  const api = vi.mocked(call);
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((element) => element.textContent === label)!;
  api.mockResolvedValueOnce(ready).mockResolvedValueOnce(page);
  try {
    await act(async () => root.render(createElement(AdminLogsPage, { onAccessDenied: vi.fn() })));
    const module = [...host.querySelectorAll('label')]
      .find((label) => label.textContent?.startsWith('Модуль'))!
      .querySelector('select')!;
    await act(async () => {
      module.value = 'electronics';
      module.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button('Скачать по фильтрам').disabled).toBe(true);

    now.mockReturnValue(Date.parse('2026-10-07T21:00:59Z'));
    api.mockResolvedValueOnce(ready).mockResolvedValueOnce(page);
    await act(async () => button('Последние 24 часа').click());
    const query = api.mock.calls.at(-1)?.[0];
    const criteria = Object.fromEntries(new URL(query!, 'http://localhost').searchParams);
    expect(criteria).toMatchObject({
      from: '2026-10-07T00:00:59+03:00',
      to: '2026-10-08T00:00:59+03:00',
      module: 'electronics',
    });
    expect(button('Скачать по фильтрам').disabled).toBe(false);

    api.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'export-1', state: 'ready', count: 1, bytes: 1024, error: null },
    });
    await act(async () => button('Скачать по фильтрам').click());
    expect(api.mock.calls.at(-1)).toEqual([
      '/api/admin/v1/logs/exports',
      { method: 'POST', body: expect.any(String) },
    ]);
    expect(JSON.parse(api.mock.calls.at(-1)![1]!.body as string)).toEqual(criteria);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    api.mockReset();
    now.mockRestore();
    vi.unstubAllGlobals();
  }
});
