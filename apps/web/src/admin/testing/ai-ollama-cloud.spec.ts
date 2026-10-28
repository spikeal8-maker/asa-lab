// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OllamaCloudStatus } from '../OllamaCloudStatus';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root, host: HTMLDivElement;
const models = vi.fn(),
  denied = vi.fn();
const info = {
  models: [
    {
      id: 'ollama-cloud/future:27b',
      model: 'future:27b',
      active: true,
      capabilities: ['completion'],
    },
  ],
  catalogCheckedAt: '2026-10-28T10:00:00Z',
  catalogError: null,
  account: {
    status: 'ok',
    checkedAt: '2026-10-28T10:00:00Z',
    retryAfterSeconds: null,
    balance: {
      includedUsd: 12.5,
      purchasedUsd: 3,
      allowanceUsd: 60,
      resetsAt: '2026-11-28T10:00:00Z',
      sessionRemainingPercent: null,
      weeklyRemainingPercent: null,
    },
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockReset();
  models.mockReset();
  denied.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(key = '') {
  await act(async () =>
    root.render(
      createElement(OllamaCloudStatus, {
        version: 4,
        draftKey: key,
        disabled: false,
        onModels: models,
        onAccessDenied: denied,
      }),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}
it('loads metadata for the saved key without generation or a second key field', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: info });
  await render();
  expect(call).toHaveBeenCalledWith(
    '/api/admin/v1/ai/ollama-cloud/inspect',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ configurationVersion: 4 }) }),
  );
  expect(host.textContent).toContain('Ключ подтверждён');
  expect(host.textContent).toMatch(/15,50/);
  expect(host.querySelectorAll('input')).toHaveLength(0);
  expect(models).toHaveBeenCalledWith(info.models);
  expect(host.textContent).toContain('не подтверждает доступ');
  expect(vi.mocked(call).mock.calls.some(([path]) => path.endsWith('/test'))).toBe(false);
});
it('checks a draft key but never saves it or marks it as stored', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: info });
  await render('test-secret-draft-key');
  expect(JSON.parse(String(vi.mocked(call).mock.calls[0]?.[1]?.body))).toEqual({
    configurationVersion: 4,
    apiKey: 'test-secret-draft-key',
  });
  expect(host.textContent).toContain('ещё не сохранён');
  expect(host.textContent).not.toContain('test-secret-draft-key');
});
it('does not treat an unknown bucket as zero in the total', async () => {
  vi.mocked(call).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ...info,
      account: { ...info.account, balance: { ...info.account.balance, purchasedUsd: null } },
    },
  });
  await render();
  expect(host.querySelector('strong')?.textContent).toBe('Осталось: неизвестно');
  expect(host.textContent).toContain('Купленные кредиты: неизвестно');
});
it('rejects malformed metadata and keeps the refresh action available', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: { bad: true } });
  await render();
  expect(host.textContent).toContain('несовместимые данные');
  expect(host.querySelector('button')!.disabled).toBe(false);
});
it('does not display a stale key response after the input changes', async () => {
  let resolveFirst!: (v: unknown) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve as typeof resolveFirst;
        }),
    )
    .mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...info, account: { ...info.account, status: 'invalid_key', balance: null } },
    });
  await render('first-private-key-123');
  await render('second-private-key-123');
  await act(async () => resolveFirst({ ok: true, status: 200, data: info }));
  expect(host.textContent).toContain('Ключ не принят');
  expect(host.querySelector('strong')).toBeNull();
  expect(models).toHaveBeenCalledTimes(1);
});
