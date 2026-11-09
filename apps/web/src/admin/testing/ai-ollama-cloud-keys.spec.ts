// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OllamaCloudKeys, type CloudPoolSave } from '../OllamaCloudKeys';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root;
const saveRef = { current: null as CloudPoolSave | null };
const models = vi.fn(),
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
        saveRef,
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
it('shows five editable key rows, a visible balance and one shared model selector', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
  await render();
  expect(host.querySelectorAll('.asa-cloud-key-row')).toHaveLength(5);
  const fields = [...host.querySelectorAll<HTMLInputElement>('input[type=password]')];
  expect(fields).toHaveLength(5);
  expect(fields.every((field) => field.value === '')).toBe(true);
  expect(host.textContent).toContain('В тарифе:');
  expect(host.textContent).toContain('Куплено:');
  expect(host.querySelectorAll('.asa-cloud-model-row')).toHaveLength(1);
  expect(vi.mocked(call).mock.calls).toHaveLength(1);
});

it('saves an explicit shared selection for all five slots while preserving priority and secrets', async () => {
  const extended = {
    ...data,
    models: [
      ...data.models,
      {
        id: 'ollama-cloud/b',
        model: 'b',
        active: true,
        capabilities: ['completion', 'vision'],
      },
    ],
  };
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: extended });
  await render();
  await click('Выбрать модели');
  await act(async () =>
    host.querySelectorAll<HTMLInputElement>('.asa-cloud-model-row input')[1]!.click(),
  );
  await click('Поднять ключ 2');
  await act(async () => {
    await saveRef.current?.(7);
  });
  const [path, init] = vi.mocked(call).mock.calls[1]!;
  expect(path).toBe('/api/admin/v1/ai/ollama-cloud/keys');
  expect(init?.method).toBe('PUT');
  const payload = JSON.parse(String(init?.body));
  expect(payload.configurationVersion).toBe(7);
  expect(payload.keys).toHaveLength(5);
  expect(payload.keys).toContainEqual(expect.objectContaining({ slot: 2, priority: 1 }));
  expect(
    payload.keys.every(
      (key: { models: string[]; apiKey?: string }) =>
        key.models.join() === 'ollama-cloud/a,ollama-cloud/b' && !('apiKey' in key),
    ),
  ).toBe(true);
});

it('checks only the selected saved key and refreshes the catalog explicitly', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
  await render();
  await click('Проверить ключ 1');
  await click('Обновить каталог');
  expect(
    vi
      .mocked(call)
      .mock.calls.slice(1)
      .map(([path, init]) => [path, JSON.parse(String(init?.body))]),
  ).toEqual([
    ['/api/admin/v1/ai/ollama-cloud/keys/inspect', { configurationVersion: 7, slot: 1 }],
    ['/api/admin/v1/ai/ollama-cloud/keys/inspect', { configurationVersion: 7 }],
  ]);
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
  await act(async () => {
    await saveRef.current?.(7);
  });
  expect(host.textContent).toContain('Настройки изменились');
  expect(host.querySelector('.asa-cloud-key-row strong')?.textContent).toBe('Ключ 2');
});

it('keeps the saved key when a replacement fails verification', async () => {
  vi.mocked(call)
    .mockResolvedValueOnce({ ok: true, status: 200, data })
    .mockResolvedValueOnce({ ok: true, status: 200, data: { account: { status: 'invalid_key' } } });
  await render();
  const field = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      field,
      'invalid-key-example',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Проверить ключ 1');
  expect(host.querySelector('.asa-cloud-key-verification [data-tone=error]')?.textContent).toBe(
    'Ключ не принят',
  );
  expect(vi.mocked(call).mock.calls).toHaveLength(2);
  expect(vi.mocked(call).mock.calls[1]?.[0]).toBe('/api/admin/v1/ai/ollama-cloud/inspect');
});
