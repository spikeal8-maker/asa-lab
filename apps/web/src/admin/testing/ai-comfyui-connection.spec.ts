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
  const puts = vi
    .mocked(call)
    .mock.calls.filter(
      ([path, init]) => path === '/api/admin/v1/ai/comfyui/settings' && init?.method === 'PUT',
    );
  expect(puts).toHaveLength(1);
  const [, init] = puts[0]!;
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
it('invalidates a previously connected GPU when a fresh status check fails', async () => {
  await render();
  expect(host.textContent).toContain('ComfyUI подключён');
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path === '/api/admin/v1/ai/comfyui/status')
      return {
        ok: false,
        status: 503,
        error: { code: 'ai_comfy_unreachable', message: 'Нет связи с ComfyUI' },
      };
    return original(path, init);
  });
  await click('Проверить состояние');
  expect(host.textContent).toContain('Нет связи с ComfyUI');
  expect(host.querySelector('[aria-label="Состояние локальной генерации"]')).not.toBeNull();
  expect(host.textContent).not.toContain('ComfyUI подключён');
  expect(host.textContent).not.toContain('Workflow совместим');
});

it('fails closed when manual ComfyUI probe throws after previously confirmed GPU', async () => {
  await render();
  expect(host.textContent).toContain('ComfyUI подключён');
  vi.mocked(call).mockRejectedValueOnce(new TypeError('simulated network interruption'));
  await click('Проверить');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Нет связи с ComfyUI');
  expect(host.textContent).not.toContain('ComfyUI подключён');
  expect(host.textContent).not.toContain('Workflow совместим');
  await click('Проверить');
  expect(host.textContent).toContain('ComfyUI подключён');
});

it('preserves the request ID after uncertain settings PUT', async () => {
  await render();
  await input('http://192.168.5.20:8188');
  vi.mocked(call).mockRejectedValueOnce(new TypeError('simulated lost response'));
  await click('Сохранить адрес');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Результат сохранения адреса не подтверждён',
  );
  expect(host.textContent).not.toContain('ComfyUI подключён');
  await click('Сохранить адрес');
  const writes = vi
    .mocked(call)
    .mock.calls.filter(
      ([url, init]) => url === '/api/admin/v1/ai/comfyui/settings' && init?.method === 'PUT',
    );
  expect(writes).toHaveLength(2);
  expect(JSON.parse(String(writes[0]?.[1]?.body)).requestId).toBe(
    JSON.parse(String(writes[1]?.[1]?.body)).requestId,
  );
});

it('ignores a delayed background success after a newer manual probe fails', async () => {
  let resolveStatus!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path.endsWith('/status')) return pending as never;
    if (path.endsWith('/probe')) throw new TypeError('network lost');
    return original(path, init);
  });
  await render();
  await click('Проверить');
  await act(async () => resolveStatus({ ok: true, status: 200, data: details }));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Нет связи с ComfyUI');
  expect(host.textContent).not.toContain('ComfyUI подключён');
});

it('keeps an in-flight settings save authoritative when refresh is attempted', async () => {
  await render();
  const newUrl = 'http://192.168.5.20:8188';
  await input(newUrl);
  const imageReadsBefore = vi
    .mocked(call)
    .mock.calls.filter(([path]) => path.endsWith('/images')).length;
  let resolvePut!: (value: unknown) => void;
  const pendingPut = new Promise((resolve) => {
    resolvePut = resolve;
  });
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path.endsWith('/settings') && init?.method === 'PUT') return pendingPut as never;
    if (path.endsWith('/status'))
      return { ok: true, status: 200, data: { ...details, baseUrl: newUrl } };
    return original(path, init);
  });
  await click('Сохранить адрес');
  const refresh = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Проверить состояние',
  )!;
  expect(refresh.disabled).toBe(true);
  await click('Проверить состояние');
  await act(async () =>
    resolvePut({
      ok: true,
      status: 200,
      data: {
        config: { ...config, baseUrl: newUrl, configurationVersion: 2 },
        status: { ...details, baseUrl: newUrl },
      },
    }),
  );
  expect(host.querySelector<HTMLInputElement>('[aria-label="Адрес ComfyUI"]')!.value).toBe(newUrl);
  expect(host.textContent).toContain('Адрес сохранён');
  expect(host.textContent).toContain('ComfyUI подключён');
  expect(vi.mocked(call).mock.calls.filter(([path]) => path.endsWith('/images'))).toHaveLength(
    imageReadsBefore + 1,
  );
  expect(refresh.disabled).toBe(false);
});

it('reloads saved image readiness after explicitly changing the ComfyUI endpoint', async () => {
  await render();
  const before = vi.mocked(call).mock.calls.filter(([path]) => path.endsWith('/images')).length;
  await input('http://192.168.5.20:8188');
  await click('Сохранить адрес');
  expect(vi.mocked(call).mock.calls.filter(([path]) => path.endsWith('/images'))).toHaveLength(
    before + 1,
  );
  expect(host.querySelector<HTMLInputElement>('[aria-label="Адрес ComfyUI"]')!.value).toBe(
    'http://192.168.5.20:8188',
  );
});
