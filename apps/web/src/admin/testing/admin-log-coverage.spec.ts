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
