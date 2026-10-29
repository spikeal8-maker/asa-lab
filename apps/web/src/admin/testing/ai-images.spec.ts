import { AI_IMAGE_PRESETS } from '@asa-lab/contracts';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { call } from '../admin-api';
import { AdminAiImages } from '../AdminAiImages';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root;
const denied = vi.fn();
const config = {
  configurationVersion: 4,
  enabled: false,
  dailyLimit: 10,
  globalConcurrency: 1,
  sizes: [768],
  ready: false,
  reason: 'model_missing',
  recipe: 'flux2-klein-4b-v1',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  denied.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: config });
  await act(async () => root.render(createElement(AdminAiImages, { onAccessDenied: denied })));
}
async function save() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('keeps default OFF and readiness separate; saves revisioned settings without generating', async () => {
  await render();
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect(host.textContent).toContain('Генерация не готова');
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...config, configurationVersion: 5 },
  });
  await save();
  const writes = vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(writes).toHaveLength(1);
  expect(writes[0]![0]).toBe('/api/admin/v1/ai/images');
  expect(JSON.parse(String(writes[0]![1]!.body))).toMatchObject({
    configurationVersion: 4,
    enabled: false,
    dailyLimit: 10,
    globalConcurrency: 1,
    sizes: [768],
  });
  expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(host.textContent).toContain('Генерация не запускалась');
});
it('retains the write UUID after an unknown save and requires reload on revision conflict', async () => {
  await render();
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 0,
    error: { code: 'network', message: 'Неизвестный результат' },
  });
  await save();
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 409,
    error: { code: 'changed', message: 'changed' },
  });
  await save();
  const writes = vi
    .mocked(call)
    .mock.calls.filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)));
  expect(writes[0].requestId).toBe(writes[1].requestId);
  expect(host.textContent).toContain('Загрузите актуальную версию');
});
it('does not invent controls for an older API', async () => {
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 404,
    error: { code: 'missing', message: 'missing' },
  });
  await act(async () => root.render(createElement(AdminAiImages, { onAccessDenied: denied })));
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('Проверьте обновление API');
});
it('rejects 101 locally even when submit bypasses native number validation', async () => {
  await render();
  const input = host.querySelector<HTMLInputElement>('input[type=number]')!;
  expect(input.max).toBe('100');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '101');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await save();
  expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('offers exactly the six agreed image presets and no 512 square', async () => {
  await render();
  const sizes = host.querySelector('fieldset')!;
  expect(sizes.querySelectorAll('input[type=checkbox]')).toHaveLength(6);
  for (const preset of AI_IMAGE_PRESETS) expect(sizes.textContent).toContain(preset.label);
  expect(sizes.textContent).not.toContain('512');
});

it('selects a distinct FP8 profile in the revisioned admin write without generation', async () => {
  await render();
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'flux2-klein-4b-fp8-izo-v1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...config, recipe: 'flux2-klein-4b-fp8-izo-v1' },
  });
  await save();
  const write = vi.mocked(call).mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(String(write[1]!.body)).recipe).toBe('flux2-klein-4b-fp8-izo-v1');
  expect(host.textContent).toContain('SHA-256');
  expect(host.textContent).toContain('не подтверждены');
});
