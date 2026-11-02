// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AdminAiToolProbe } from '../AdminAiToolProbe';
import { call } from '../admin-api';
import { streamAiRequest } from '../../ai/stream-ai-request';
import { AI_TOOL_IDS, type AiToolId } from '@asa-lab/contracts';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
vi.mock('../../ai/stream-ai-request', () => ({
  streamAiRequest: vi.fn(),
  AiStreamClientError: class extends Error {},
}));
vi.mock('../../ai/AiWebEvidence', () => ({ AiWebEvidence: () => null }));
vi.mock('../../ai/AiGeneratedImage', () => ({ AiGeneratedImage: () => null }));
const thread = '10000000-0000-4000-8000-000000000001';
let root: Root, host: HTMLDivElement;
const busy = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  vi.mocked(streamAiRequest).mockReset();
  busy.mockReset();
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (path) => ({
      ok: true,
      status: 200,
      data:
        path === '/api/admin/v1/ai/tool-policy'
          ? {
              tools: AI_TOOL_IDS.map((id) => ({
                id,
                enabled: true,
                available: true,
                reason: null,
              })),
            }
          : path === '/api/ai/status'
            ? {
                enabled: true,
                model: 'ollama',
                modelChoices: [{ id: 'ollama', label: 'Local test' }],
              }
            : { id: thread },
    }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(tool: AiToolId = 'web_search', enabled = true, unsaved = false) {
  await act(async () =>
    root.render(
      createElement(AdminAiToolProbe, {
        principalId: 'admin-a',
        tool,
        rule: {
          id: tool,
          label: tool,
          enabled,
          instructions: '',
          available: true,
          reason: null,
          parameters: [],
          resultDescription: '',
          hardLimits: [],
        },
        unsaved,
        onBusyChange: busy,
        onAccessDenied: vi.fn(),
      }),
    ),
  );
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('does not mistake an ordinary model answer for a successful tool call', async () => {
  vi.mocked(streamAiRequest).mockImplementation(
    async (_t, _p, request) =>
      ({
        messages: [{ requestId: request, role: 'assistant', content: 'Готово' }],
        replayed: false,
        stopped: false,
      }) as never,
  );
  await render();
  await submit();
  expect(host.textContent).toContain('без подтверждённого вызова');
  expect(vi.mocked(streamAiRequest).mock.calls[0]![8]).toEqual({ mode: 'web' });
  expect(vi.mocked(streamAiRequest).mock.calls[0]![9]).toEqual({ mode: 'off', size: 1024 });
});
it('uses actual server evidence and reports an empty result instead of a green success', async () => {
  vi.mocked(streamAiRequest).mockImplementation(
    async (_t, _p, request, _d, _s, _m, _h, _a, _w, _i, activity) => {
      activity?.({ tool: 'web_search', state: 'running' });
      activity?.({ tool: 'web_search', state: 'complete' });
      return {
        messages: [
          {
            requestId: request,
            role: 'assistant',
            content: 'Ничего не найдено',
            webSearch: {
              schemaVersion: 1,
              provider: 'searxng',
              mode: 'web',
              status: 'empty',
              query: 'test',
              retrievedAt: '2026-11-03T00:00:00Z',
              sources: [],
              images: [],
            },
          },
        ],
        replayed: false,
        stopped: false,
      } as never;
    },
  );
  await render();
  await submit();
  expect(host.textContent).toContain('пустую выдачу');
});
it('never starts a paid request for disabled tools or unsaved settings', async () => {
  await render('weather', false);
  await submit();
  await render('weather', true, true);
  await submit();
  expect(streamAiRequest).not.toHaveBeenCalled();
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('blocks double submits and recovers an uncertain request with GET only', async () => {
  let reject!: (reason?: unknown) => void;
  vi.mocked(streamAiRequest).mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  await render();
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(streamAiRequest).toHaveBeenCalledOnce();
  const request = vi.mocked(streamAiRequest).mock.calls[0]![2];
  await act(async () => reject(new Error('lost stream')));
  expect(sessionStorage.getItem('asa-ai-tool-probe:v1:admin-a')).toContain(request);
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { items: [{ requestId: request, role: 'assistant', content: 'Saved response' }] },
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Проверить результат')!
      .click(),
  );
  expect(streamAiRequest).toHaveBeenCalledOnce();
  expect(vi.mocked(call).mock.calls.at(-1)![0]).toContain('/requests/' + request);
  expect(vi.mocked(call).mock.calls.at(-1)![1]?.method).toBeUndefined();
  expect(host.textContent).toContain('по потерянному потоку не подтверждён');
});
it('does not claim that a file was updated from model text alone', async () => {
  vi.mocked(call).mockImplementation(async (path) => ({
    ok: true,
    status: 200,
    data:
      path === '/api/admin/v1/ai/tool-policy'
        ? { tools: AI_TOOL_IDS.map((id) => ({ id, enabled: true, available: true, reason: null })) }
        : path === '/api/ai/status'
          ? { enabled: true, model: 'ollama' }
          : path.includes('working-files')
            ? { name: 'probe.txt', version: 1, content: 'old' }
            : { id: thread },
  }));
  vi.mocked(streamAiRequest).mockImplementation(
    async (_t, _p, request, _d, _s, _m, _h, _a, _w, _i, activity) => {
      activity?.({ tool: 'edit_working_file', state: 'complete' });
      return {
        messages: [{ requestId: request, role: 'assistant', content: 'Я обновил файл' }],
        replayed: false,
        stopped: false,
      } as never;
    },
  );
  await render('edit_working_file');
  await submit();
  expect(host.textContent).toContain('не подтверждено');
});

it('rechecks the saved policy immediately before starting a real operation', async () => {
  await render();
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      tools: [
        { id: 'web_search', enabled: false, available: false, reason: 'Отключено администратором' },
      ],
    },
  });
  await submit();
  expect(streamAiRequest).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Отключено администратором');
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('keeps an accepted image pending and checks its existing receipt without another generation', async () => {
  const imageRequest = '20000000-0000-4000-8000-000000000002';
  const job = {
    requestId: imageRequest,
    threadId: thread,
    state: 'running',
    prompt: 'Test',
    createdAt: '2026-11-03T00:00:00Z',
    cancelRequested: false,
    errorCode: null,
    image: null,
  };
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) =>
    path === '/api/ai/image-generation/status'
      ? { ok: true, status: 200, data: { sizes: [768] } }
      : original(path, init),
  );
  vi.mocked(streamAiRequest).mockResolvedValueOnce({
    messages: [],
    replayed: false,
    stopped: false,
    imageJob: job,
  } as never);
  await render('generate_image');
  await submit();
  expect(host.textContent).toContain('ещё создаётся');
  expect(sessionStorage.getItem('asa-ai-tool-probe:v1:admin-a')).not.toBeNull();
  expect(vi.mocked(streamAiRequest).mock.calls[0]![9]).toEqual({ mode: 'auto', size: 768 });
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...job, state: 'complete', image: { requestId: imageRequest } },
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Проверить результат')!
      .click(),
  );
  expect(streamAiRequest).toHaveBeenCalledOnce();
  expect(vi.mocked(call).mock.calls.at(-1)![0]).toMatch(/\/requests\/.+\/image-generation$/);
  expect(vi.mocked(call).mock.calls.at(-1)![1]?.method).toBeUndefined();
  expect(host.textContent).toContain('Изображение получено');
  expect(sessionStorage.getItem('asa-ai-tool-probe:v1:admin-a')).toBeNull();
});
