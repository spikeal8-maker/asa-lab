// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { call as adminCall } from '../admin-api';
import { call as apiCall } from '../../api-call';
import { AdminComfyUiPage } from '../AdminComfyUiPage';
import { AdminComfyImageTest } from '../AdminComfyImageTest';

const submitted = vi.hoisted(() => vi.fn());
vi.mock('../admin-api', () => ({ call: vi.fn() }));
vi.mock('../../api-call', () => ({ call: vi.fn() }));
vi.mock('../../ai/AiImageGeneration', () => ({
  imageGenerationStatusShape: (value: { enabled?: boolean; ready?: boolean }) =>
    typeof value?.enabled === 'boolean' && typeof value?.ready === 'boolean',
  AiImageGeneration: ({
    controllerRef,
    onStateChange,
  }: {
    controllerRef: { current: unknown };
    onStateChange: (state: unknown) => void;
  }) => {
    useEffect(() => {
      controllerRef.current = { submit: submitted, cancel: vi.fn(), follow: vi.fn() };
      onStateChange({
        busy: false,
        canCancel: false,
        canSubmit: true,
        sizes: [1024],
        notice: '',
      });
    }, [controllerRef, onStateChange]);
    return null;
  },
}));

const cfg = {
  configurationVersion: 4,
  enabled: true,
  dailyLimit: 30,
  globalConcurrency: 1,
  sizes: [1024, 1280],
  ready: true,
  reason: null,
  recipe: 'flux2-klein-4b-fp8-izo-v1',
};
const legacy = {
  ...cfg,
  ready: false,
  recipe: 'flux2-klein-4b-v1',
  reason: 'Для профиля FP4 нет qwen_3_4b_fp4_flux2.safetensors',
};
const status = {
  connected: true,
  baseUrl: 'http://192.168.1.112:8188',
  version: '0.19.3',
  diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
  textEncoders: ['qwen_3_4b.safetensors'],
  vaeModels: ['flux2-vae.safetensors'],
  fluxKlein4bFound: true,
  checkedAt: '2026-10-29T12:00:00Z',
  recipe: 'flux2-klein-4b-fp8-izo-v1',
  recipeReady: true,
  recipeReason: null,
  devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 3060', vramTotalBytes: 12 * 1024 ** 3 }],
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  submitted.mockReset();
  vi.mocked(apiCall).mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      enabled: true,
      ready: true,
      sizes: [1024, 1280],
      remainingToday: 30,
      dailyLimit: 30,
      reason: null,
    },
  });
  vi.mocked(adminCall).mockReset().mockImplementation(async (path) => ({
    ok: true,
    status: 200,
    data:
      path === '/api/admin/v1/ai/images'
        ? cfg
        : path.endsWith('/settings')
          ? { configurationVersion: 2, baseUrl: status.baseUrl, source: 'saved' }
          : status,
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it(
  'shows a concise GPU summary and folds long connection/diagnostic content by default',
  async () => {
  await act(async () =>
    root.render(createElement(AdminComfyUiPage, { onAccessDenied: vi.fn() })),
  );
  expect(host.textContent).toContain('FLUX.2 · ИЗО FP8');
  expect(host.textContent).toContain('RTX 3060');
  expect(host.querySelector('[aria-label="Состояние локальной генерации"]')).not.toBeNull();
  const details = host.querySelectorAll('.asa-image-connection-detail');
  expect(details).toHaveLength(2);
  for (const item of details) expect(item.hasAttribute('open')).toBe(false);
  const sizes = host.querySelector('.asa-image-settings-details')!;
  expect(sizes.hasAttribute('open')).toBe(false);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(vi.mocked(adminCall).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  },
);

it(
  'keeps the API provider separate and does not ask for, send or expose an unimplemented key',
  async () => {
  await act(async () =>
    root.render(createElement(AdminComfyUiPage, { onAccessDenied: vi.fn() })),
  );
  const apiTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === 'API-провайдеры',
  )!;
  await act(async () => apiTab.click());
  expect(apiTab.getAttribute('aria-selected')).toBe('true');
  expect(host.textContent).toContain('Polza AI');
  expect(host.textContent).toContain('Не подключён');
  expect(host.querySelector('input[type=password]')).toBeNull();
  expect(host.querySelector('button[aria-label="Генерировать через Polza"]')).toBeNull();
  expect(vi.mocked(adminCall).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  },
);

it('requires an explicit user action before submitting the preview job', async () => {
  await act(async () =>
    root.render(createElement(AdminComfyImageTest, { principalId: 'owner-1', config: cfg })),
  );
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Создать тестовое изображение',
  )!;
  expect(button.disabled).toBe(true);
  expect(submitted).not.toHaveBeenCalled();
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
      .set!.call(textarea, 'Робот на светлом фоне');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(submitted).toHaveBeenCalledOnce();
  expect(submitted).toHaveBeenCalledWith('Робот на светлом фоне', 1024);
  expect(vi.mocked(apiCall).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('does not submit an image when the saved ComfyUI profile is incompatible', async () => {
  await act(async () =>
    root.render(createElement(AdminComfyImageTest, { principalId: 'owner-2', config: legacy })),
  );
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
      .set!.call(textarea, 'Робот');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Создать тестовое изображение',
  )!;
  expect(button.disabled).toBe(true);
  expect(submitted).not.toHaveBeenCalled();
});
