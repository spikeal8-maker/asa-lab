// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OllamaCloudKeys } from '../OllamaCloudKeys';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root;
const saved = vi.fn(),
  models = vi.fn(),
  denied = vi.fn();
const data = {
  configurationVersion: 7,
  managed: true,
  models: [{ id: 'ollama-cloud/a', model: 'a', active: true, capabilities: ['completion'] }],
  keys: [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    label: 'Key ' + slot,
    priority: slot,
    enabled: slot < 3,
    configured: slot < 3,
    fingerprint: slot < 3 ? 'hash-' + slot : null,
    models: slot < 3 ? ['ollama-cloud/a'] : [],
    account:
      slot === 1
        ? {
            status: 'ok',
            checkedAt: '2026-10-28T10:00:00Z',
            retryAfterSeconds: null,
            balance: {
              includedUsd: 12,
              purchasedUsd: 3,
              allowanceUsd: 60,
              resetsAt: null,
              sessionRemainingPercent: null,
              weeklyRemainingPercent: null,
            },
          }
        : null,
    blockedUntil: null,
    unavailableModels: [],
  })),
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockReset();
  saved.mockReset();
  models.mockReset();
  denied.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(
      createElement(OllamaCloudKeys, {
        version: 7,
        encryptionReady: true,
        onSaved: saved,
        onModels: models,
        onAccessDenied: denied,
      }),
    );
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  )!;
  await act(async () => button.click());
}
it('shows exactly five compact cards, separate balances, and no saved secret', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
  await render();
  expect(host.querySelectorAll('.asa-cloud-key-card')).toHaveLength(5);
  expect(host.querySelectorAll('input[type=password]')).toHaveLength(5);
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input[type=password]')].every(
      (i) => i.value === '',
    ),
  ).toBe(true);
  expect(host.textContent).toContain('В тарифе:');
  expect(host.textContent).toContain('Куплено:');
  expect(host.textContent).toContain('один баланс');
  expect(vi.mocked(call).mock.calls).toHaveLength(1);
  expect(vi.mocked(call).mock.calls[0]?.[0]).toBe('/api/admin/v1/ai/ollama-cloud/keys');
});
it('saves priority changes with a version and never starts a generation', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
  await render();
  await click('Поднять ключ 2');
  await click('Сохранить ключи и порядок');
  const [path, init] = vi.mocked(call).mock.calls[1]!;
  expect(path).toBe('/api/admin/v1/ai/ollama-cloud/keys');
  expect(init?.method).toBe('PUT');
  const payload = JSON.parse(String(init?.body));
  expect(payload.configurationVersion).toBe(7);
  expect(payload.keys.find((k: { slot: number }) => k.slot === 2).priority).toBe(1);
  expect(payload.keys).toHaveLength(5);
  expect(payload.keys.every((k: Record<string, unknown>) => !('apiKey' in k))).toBe(true);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(vi.mocked(call).mock.calls.some(([p]) => p.endsWith('/test'))).toBe(false);
});
it('refreshes balances explicitly without saving edits or calling the paid test', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
  await render();
  await click('Обновить остатки');
  expect(vi.mocked(call).mock.calls[1]?.[0]).toBe('/api/admin/v1/ai/ollama-cloud/keys/inspect');
  expect(saved).not.toHaveBeenCalled();
  expect(host.textContent).toContain('генерация не запускалась');
});
it('keeps edits when another administrator changed the version', async () => {
  vi.mocked(call)
    .mockResolvedValueOnce({ ok: true, status: 200, data })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'ai_config_changed', message: 'Changed' },
    });
  await render();
  await click('Поднять ключ 2');
  await click('Сохранить ключи и порядок');
  expect(host.textContent).toContain('ваши правки не сохранены');
  expect(host.querySelector('.asa-cloud-key-card strong')?.textContent).toBe('Key 2');
  expect(saved).not.toHaveBeenCalled();
});
