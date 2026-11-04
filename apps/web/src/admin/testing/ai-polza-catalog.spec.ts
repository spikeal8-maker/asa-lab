import { isAiAdminConfig } from '../ai-model-config';
import { aiAdminFixture } from './ai-admin-config.fixture';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { call } from '../admin-api';
import { AdminPolzaCatalog } from '../AdminPolzaCatalog';
import { AdminAiSpeechTest } from '../AdminAiSpeechTest';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const item = {
  id: 'polza/qwen/vision',
  upstream: 'qwen/vision',
  label: 'Qwen Vision',
  kind: 'chat',
  vision: true,
  tools: true,
  active: true,
  selected: false,
};
const catalog = {
  version: 4,
  checkedAt: '2026-11-02T00:00:00Z',
  credentialCurrent: true,
  items: [item],
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('shows Vision, preserves explicit selected IDs and sends no paid chat request when selecting models', async () => {
  const dirty = vi.fn();
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: catalog });
  await act(async () =>
    root.render(
      createElement(AdminPolzaCatalog, { onAccessDenied: vi.fn(), onDirtyChange: dirty }),
    ),
  );
  expect(host.textContent).toContain('Vision');
  const box = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  await act(async () => box.click());
  expect(dirty).toHaveBeenLastCalledWith(true);
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...catalog, version: 5, items: [{ ...item, selected: true }] },
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Сохранить выбор моделей')!
      .click(),
  );
  expect(vi.mocked(call).mock.calls[1]).toEqual([
    '/api/admin/v1/ai/polza/models',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ version: 4, ids: [item.id] }),
    }),
  ]);
  expect(
    vi
      .mocked(call)
      .mock.calls.some(([path]) => path.includes('/chat') || path.includes('/transcribe')),
  ).toBe(false);
  expect(dirty).toHaveBeenLastCalledWith(false);
});
it('keeps an incompatible catalogue visible as an error instead of crashing or granting models', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: { enabled: true } });
  await act(async () => root.render(createElement(AdminPolzaCatalog, { onAccessDenied: vi.fn() })));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Несовместимый');
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
});
it('sends the chosen short audio only after an explicit test click and displays the transcript', async () => {
  vi.stubGlobal(
    'FileReader',
    class {
      result = 'data:audio/webm;base64,dGVzdA==';
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    },
  );
  vi.mocked(call).mockImplementation(async (path) => ({
    ok: true,
    status: 200,
    data: path.endsWith('/status')
      ? { enabled: true, model: 'ai-sage/gigaam-v3', maxAudioSeconds: 20 }
      : { text: 'Проверка голоса', model: 'ai-sage/gigaam-v3' },
  }));
  await act(async () =>
    root.render(createElement(AdminAiSpeechTest, { enabled: true, maxSeconds: 20 })),
  );
  const upload = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(upload, 'files', {
    value: [new File(['12345678'], 'test.webm', { type: 'audio/webm' })],
  });
  await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
  expect(vi.mocked(call).mock.calls.some(([path]) => path.endsWith('/transcribe'))).toBe(false);
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Распознать файл')!.click(),
  );
  const sent = vi.mocked(call).mock.calls.find(([path]) => path.endsWith('/transcribe'))!;
  expect(JSON.parse(String(sent[1]?.body))).toMatchObject({
    mimeType: 'audio/webm',
    audioBase64: 'dGVzdA==',
    durationSeconds: 8,
  });
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Проверка голоса');
});

it('accepts an unconfigured Polza slot without accepting an unregistered chat default', () => {
  const old = aiAdminFixture();
  const snapshot = {
    ...old,
    modelCatalog: {
      ...old.modelCatalog,
      providers: [
        ...old.modelCatalog.providers,
        { id: 'polza', label: 'Polza AI', defaultModel: 'polza/unconfigured' },
      ],
    },
    providerConfigurations: [
      ...old.providerConfigurations,
      {
        provider: 'polza',
        model: 'polza/unconfigured',
        enabled: true,
        revision: 1,
        apiKeyConfigured: true,
        keyFingerprint: 'test',
        updatedAt: null,
      },
    ],
  };
  expect(isAiAdminConfig(snapshot)).toBe(true);
  expect(isAiAdminConfig({ ...snapshot, provider: 'polza', model: 'polza/unconfigured' })).toBe(
    false,
  );
});
