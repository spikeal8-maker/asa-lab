// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminComfyUiPage } from '../AdminComfyUiPage';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
const config = {
  configurationVersion: 1,
  baseUrl: 'http://host.docker.internal:8188',
  source: 'environment',
};
const details = {
  connected: true,
  baseUrl: config.baseUrl,
  version: '0.19.3',
  diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
  textEncoders: ['qwen_3_4b.safetensors'],
  vaeModels: ['flux2-vae.safetensors'],
  fluxKlein4bFound: true,
  recipeReady: false,
  devices: [{ name: 'RTX 3060', vramTotalBytes: 12 * 1024 ** 3 }],
  checkedAt: '2026-10-28T12:00:00Z',
};
let root: Root, host: HTMLDivElement;
const denied = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  denied.mockReset();
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (path, init) => ({
      ok: true,
      status: 200,
      data: path.endsWith('/settings')
        ? init?.method === 'PUT'
          ? {
              config: {
                ...config,
                configurationVersion: 2,
                baseUrl: JSON.parse(String(init.body)).baseUrl,
              },
              status: { ...details, baseUrl: JSON.parse(String(init.body)).baseUrl },
            }
          : config
        : path.endsWith('/probe')
          ? { ...details, baseUrl: JSON.parse(String(init?.body)).baseUrl }
          : path.endsWith('/images')
            ? {
                configurationVersion: 1,
                enabled: false,
                dailyLimit: 10,
                globalConcurrency: 1,
                sizes: [512],
                recipe: 'flux2-klein-4b-v1',
                ready: false,
                reason: null,
              }
            : details,
    }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(AdminComfyUiPage, { onAccessDenied: denied })));
}
async function input(value: string) {
  const field = host.querySelector<HTMLInputElement>('[aria-label="Адрес ComfyUI"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!.click(),
  );
}
it('shows the portable guide and GPU while keeping connection separate from recipe readiness', async () => {
  await render();
  expect(host.textContent).toContain('RTX 3060');
  expect(host.textContent).toContain('workflow ASA пока не совместим');
  expect(host.querySelector<HTMLAnchorElement>('a[href*="COMFYUI_LOCAL_IMAGES"]')?.href).toContain(
    '/docs/deployment/COMFYUI_LOCAL_IMAGES.md',
  );
  expect(host.textContent).toContain('qwen_3_4b_fp4_flux2.safetensors');
});
it('probes the entered LAN origin without saving and saves it explicitly with a version', async () => {
  await render();
  await input('http://192.168.5.20:8188');
  await click('Проверить');
  expect(vi.mocked(call).mock.calls.at(-1)?.[0]).toBe('/api/admin/v1/ai/comfyui/probe');
  expect(host.textContent).toContain('ещё не сохранён');
  await click('Сохранить адрес');
  const [path, init] = vi.mocked(call).mock.calls.at(-1)!;
  expect(path).toBe('/api/admin/v1/ai/comfyui/settings');
  expect(init?.method).toBe('PUT');
  expect(JSON.parse(String(init?.body))).toMatchObject({
    baseUrl: 'http://192.168.5.20:8188',
    configurationVersion: 1,
    requestId: expect.any(String),
  });
  expect(host.textContent).toContain('Адрес сохранён');
  expect(vi.mocked(call).mock.calls.some(([p]) => p.endsWith('/prompt'))).toBe(false);
});
it('shows a refused URL or busy-job error without hiding it in collapsed details', async () => {
  await render();
  await input('http://192.168.5.21:8188');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 409,
    error: { code: 'ai_comfy_jobs_active', message: 'Дождитесь завершения заданий' },
  });
  await click('Сохранить адрес');
  const alert = host.querySelector('[role=alert]')!;
  expect(alert.textContent).toContain('Дождитесь');
  expect(alert.closest('details')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Адрес ComfyUI"]')!.value).toBe(
    'http://192.168.5.21:8188',
  );
});
