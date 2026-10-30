// @vitest-environment jsdom
import type { AiImageGenerationAdminConfig } from '@asa-lab/contracts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { call } from '../../api-call';
import { AdminComfyImageTest } from '../AdminComfyImageTest';

vi.mock('../../api-call', () => ({ call: vi.fn() }));
const OLD = '10000000-0000-4000-8000-000000000001';
const NEW = '10000000-0000-4000-8000-000000000002';
const config: AiImageGenerationAdminConfig = {
  configurationVersion: 4,
  enabled: true,
  dailyLimit: 10,
  globalConcurrency: 1,
  sizes: [1024],
  ready: true,
  reason: null,
  recipe: 'flux2-klein-4b-v1',
};
const status = {
  enabled: true,
  ready: true,
  reason: null,
  sizes: [1024],
  dailyLimit: 10,
  remainingToday: 10,
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  sessionStorage.clear();
  sessionStorage.setItem('asa-ai-image-admin-preview:owner', OLD);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(createElement(AdminComfyImageTest, { principalId: 'owner', config })),
  );
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      'Робот на светлом фоне',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === label)!.click(),
  );
}
const replacement = () =>
  [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Новый диалог для пробы',
  );

it.each(['archived', 'deleted'])(
  'replaces a %s cached preview thread only after definite rejection and one explicit click',
  async () => {
    const imagePosts: string[] = [];
    vi.mocked(call).mockImplementation(async (path, init) => {
      if (path.endsWith('/status')) return { ok: true, status: 200, data: status };
      if (path.endsWith('/tool-image-generations')) return { ok: true, status: 200, data: [] };
      if (path === '/api/ai/threads' && init?.method === 'POST')
        return { ok: true, status: 201, data: { id: NEW } };
      if (path.endsWith('/image-generations') && init?.method === 'POST') {
        imagePosts.push(path);
        return imagePosts.length === 1
          ? {
              ok: false,
              status: 403,
              error: {
                code: 'ai_image_not_admitted',
                message: 'Нет доступа к генерации в этом диалоге.',
              },
            }
          : {
              ok: true,
              status: 200,
              data: {
                threadId: NEW,
                requestId: JSON.parse(String(init.body)).requestId,
                state: 'admitted',
                image: null,
                cancelRequested: false,
              },
            };
      }
      return { ok: false, status: 404, error: { code: 'not_found', message: 'not found' } };
    });
    await render();
    expect(replacement()).toBeUndefined();
    await click('Сгенерировать');
    expect(imagePosts).toEqual(['/api/ai/threads/' + OLD + '/image-generations']);
    expect(replacement()).toBeDefined();
    expect(sessionStorage.getItem('asa-ai-image:personal:' + OLD)).toBeNull();
    await click('Новый диалог для пробы');
    expect(sessionStorage.getItem('asa-ai-image-admin-preview:owner')).toBe(NEW);
    expect(imagePosts).toHaveLength(1);
    expect(host.querySelector('textarea')!.value).toBe('Робот на светлом фоне');
    await click('Сгенерировать');
    expect(imagePosts[1]).toBe('/api/ai/threads/' + NEW + '/image-generations');
  },
);

it.each(['uncertain', 'storage failure'])(
  'does not offer thread replacement while the receipt is %s',
  async (kind) => {
    if (kind === 'storage failure')
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });
    vi.mocked(call).mockImplementation(async (path, init) => {
      if (path.endsWith('/status')) return { ok: true, status: 200, data: status };
      if (path.endsWith('/tool-image-generations')) return { ok: true, status: 200, data: [] };
      if (path.endsWith('/image-generations') && init?.method === 'POST')
        return kind === 'uncertain'
          ? { ok: false, status: 0, error: { code: 'network', message: 'unknown' } }
          : {
              ok: false,
              status: 403,
              error: { code: 'ai_image_not_admitted', message: 'Нет доступа.' },
            };
      return { ok: false, status: 404, error: { code: 'not_found', message: 'not found' } };
    });
    await render();
    await click('Сгенерировать');
    expect(replacement()).toBeUndefined();
    expect(sessionStorage.getItem('asa-ai-image:personal:' + OLD)).not.toBeNull();
    expect(vi.mocked(call).mock.calls.filter(([path]) => path === '/api/ai/threads')).toHaveLength(
      0,
    );
  },
);
