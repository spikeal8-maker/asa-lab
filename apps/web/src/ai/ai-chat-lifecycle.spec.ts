// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, type ApiResult } from '../api-call';
import { AiChatWorkspace } from './AiChatWorkspace';
import { streamAiRequest } from './stream-ai-request';

vi.mock('../api-call', () => ({ call: vi.fn() }));
vi.mock('./stream-ai-request', () => ({
  streamAiRequest: vi.fn(),
  streamAiRegeneration: vi.fn(),
  AiStreamClientError: class extends Error {},
}));
vi.mock('./AiMessageContent', () => ({ AiMessageContent: () => null }));

const SEAT = '40000000-0000-4000-8000-000000000001';
const CREATED_THREAD = '10000000-0000-4000-8000-000000000001';
const PERSONAL_HISTORY = 'Личный сохранённый диалог';
const SCHOOL_HISTORY = 'Школьный сохранённый диалог';
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
let root: Root;
let host: HTMLDivElement;

function ok(data: unknown): ApiResult<unknown> {
  return { ok: true, status: 200, data };
}

function pendingCreation(webStatus?: unknown) {
  let resolve!: (value: ApiResult<unknown>) => void;
  const promise = new Promise<ApiResult<unknown>>((complete) => {
    resolve = complete;
  });
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path === '/api/ai/web-search/status' && webStatus) return ok(await webStatus);
    if (path === '/api/ai/web-search/status')
      return { ok: false, status: 404, error: { code: 'not_found', message: 'Old server' } };
    if (path === '/api/ai/scopes') {
      return ok({
        personal: true,
        items: [{ seatId: SEAT, classroomTitle: 'Школьный класс', displayName: 'Ученик' }],
      });
    }
    if (path === '/api/ai/status') {
      return ok({
        enabled: true,
        provider: 'openai',
        model: 'gpt-6-luna',
        availableModels: ['gpt-6-luna'],
      });
    }
    if (path === '/api/ai/threads' && init?.method === 'POST') return promise;
    if (path === '/api/ai/threads/' + CREATED_THREAD + '/working-files') return ok({ items: [] });
    if (path === '/api/ai/threads/' + CREATED_THREAD + '/messages')
      return ok({ items: [], nextCursor: null });
    if (path === '/api/ai/threads') {
      const school = new Headers(init?.headers).get('x-asa-ai-seat') === SEAT;
      return ok({
        items: [
          {
            id: school
              ? '20000000-0000-4000-8000-000000000002'
              : '20000000-0000-4000-8000-000000000001',
            title: school ? SCHOOL_HISTORY : PERSONAL_HISTORY,
            updatedAt: '2026-10-20T12:00:00Z',
          },
        ],
        nextCursor: null,
      });
    }
    throw new Error('Unexpected path ' + path);
  });
  return () => resolve(ok({ id: CREATED_THREAD }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(call).mockReset();
  vi.mocked(streamAiRequest).mockReset();
  vi.mocked(streamAiRequest).mockResolvedValue({ messages: [], replayed: false, stopped: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (scrollToDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(createElement(AiChatWorkspace)));
  await act(async () => vi.runOnlyPendingTimersAsync());
}

function composer() {
  return host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Сообщение ИИ"]')!;
}

async function enter(text: string) {
  const input = composer();
  expect(input.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(text: string) {
  await enter(text);
  await act(async () => {
    host
      .querySelector('form.chat-composer')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function chooseScope(value: string) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Контекст чата"]')!;
  expect(select.disabled).toBe(false);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => vi.runOnlyPendingTimersAsync());
}

function creationCalls() {
  return vi
    .mocked(call)
    .mock.calls.filter(([path, init]) => path === '/api/ai/threads' && init?.method === 'POST');
}

function historyTitles() {
  return [...host.querySelectorAll('.chat-history-item')].map((item) =>
    item.getAttribute('aria-label'),
  );
}

describe('first-send lifecycle', () => {
  it.each([true, false])(
    'retries the original UUID and payload when internet capabilities arrive after an uncertain send: configured=$0',
    async (configured) => {
      let release!: (data: unknown) => void;
      const webStatus = new Promise((resolve) => {
        release = resolve;
      });
      const completeCreation = pendingCreation(webStatus);
      vi.mocked(streamAiRequest).mockRejectedValueOnce(new Error('Uncertain provider result'));
      await mount();
      await submit('Первый вопрос');
      await act(async () => completeCreation());
      expect(streamAiRequest).toHaveBeenCalledTimes(1);
      const first = vi.mocked(streamAiRequest).mock.calls[0]!;
      expect(first).toHaveLength(11);
      expect(composer().value).toBe('Первый вопрос');
      expect(host.textContent).toContain('Извините, текстовая модель сейчас недоступна.');
      expect(host.textContent).not.toContain('Uncertain provider result');
      await act(async () =>
        release({
          schemaVersion: 1,
          provider: 'searxng',
          configured,
          enabled: true,
          weatherConfigured: true,
        }),
      );
      await submit('Первый вопрос');
      const retry = vi.mocked(streamAiRequest).mock.calls[1]!;
      expect(retry[2]).toBe(first[2]);
      expect(retry.slice(7, 10)).toEqual(first.slice(7, 10));
      expect(first.slice(7, 10)).toEqual([[], undefined, undefined]);
      expect(first[10]).toEqual(expect.any(Function));
      expect(retry).toHaveLength(11);
    },
  );
  it.each([
    {
      schemaVersion: 2,
      enabled: true,
      configured: true,
      weatherConfigured: true,
      provider: 'searxng',
    },
    {
      schemaVersion: 1,
      enabled: true,
      configured: true,
      weatherConfigured: true,
      provider: 'unknown',
    },
  ])(
    'keeps the original message protocol when web capabilities are incompatible: $provider/$schemaVersion',
    async (webStatus) => {
      const completeCreation = pendingCreation(webStatus);
      await mount();
      await submit('Первый вопрос');
      await act(async () => completeCreation());
      expect(streamAiRequest).toHaveBeenCalledTimes(1);
      expect(vi.mocked(streamAiRequest).mock.calls[0]).toHaveLength(11);
      expect(host.querySelector('[aria-label="Режим интернет-поиска"]')).toBeNull();
    },
  );
  it.each([
    { from: 'personal', to: SEAT, history: SCHOOL_HISTORY },
    { from: SEAT, to: 'personal', history: PERSONAL_HISTORY },
  ])('does not start a late $from stream after switching to $to', async ({ from, to, history }) => {
    const completeCreation = pendingCreation();
    await mount();
    if (from !== 'personal') await chooseScope(from);
    await submit('Вопрос из предыдущего контекста');
    expect(creationCalls()).toHaveLength(1);
    expect(new Headers(creationCalls()[0]?.[1]?.headers).get('x-asa-ai-seat')).toBe(
      from === 'personal' ? null : SEAT,
    );
    expect(streamAiRequest).not.toHaveBeenCalled();

    await chooseScope(to);
    expect(composer().value).toBe('');
    expect(historyTitles()).toEqual([history]);
    await enter('Черновик в новом контексте');
    const callsBeforeCompletion = vi.mocked(call).mock.calls.length;
    await act(async () => completeCreation());

    expect(streamAiRequest).not.toHaveBeenCalled();
    expect(vi.mocked(call).mock.calls).toHaveLength(callsBeforeCompletion);
    expect(composer().value).toBe('Черновик в новом контексте');
    expect(composer().disabled).toBe(false);
    expect(historyTitles()).toEqual([history]);
    expect(host.querySelector('.chat-history-item.active')).toBeNull();
  });

  it('does not start a stream after navigation unmounts the chat during creation', async () => {
    const completeCreation = pendingCreation();
    await mount();
    await submit('Вопрос перед переходом');
    expect(creationCalls()).toHaveLength(1);
    expect(streamAiRequest).not.toHaveBeenCalled();

    await act(async () => root.render(createElement('main', null, 'Другая страница')));
    const callsBeforeCompletion = vi.mocked(call).mock.calls.length;
    await act(async () => completeCreation());

    expect(streamAiRequest).not.toHaveBeenCalled();
    expect(vi.mocked(call).mock.calls).toHaveLength(callsBeforeCompletion);
    expect(host.textContent).toBe('Другая страница');
    expect(composer()).toBeNull();
  });

  it('starts exactly one stream when the first creation completes in the active scope', async () => {
    const completeCreation = pendingCreation();
    await mount();
    await submit('Первый вопрос');
    expect(creationCalls()).toHaveLength(1);
    expect(streamAiRequest).not.toHaveBeenCalled();
    await act(async () => completeCreation());

    expect(streamAiRequest).toHaveBeenCalledTimes(1);
    expect(streamAiRequest).toHaveBeenCalledWith(
      CREATED_THREAD,
      'Первый вопрос',
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
      'gpt-6-luna',
      {},
      [],
      undefined,
      undefined,
      expect.any(Function),
    );
    expect(creationCalls()).toHaveLength(1);
    expect(composer().value).toBe('');
    expect(composer().disabled).toBe(false);
  });
});

it('shows a tool while it executes, keeps the composer editable, then clears its activity', async () => {
  let finish!: (value: { messages: never[]; replayed: boolean; stopped: boolean }) => void;
  const waiting = new Promise<{ messages: never[]; replayed: boolean; stopped: boolean }>((r) => {
    finish = r;
  });
  const completeCreation = pendingCreation();
  vi.mocked(streamAiRequest).mockReturnValueOnce(waiting);
  await mount();
  await submit('Найди информацию');
  await act(async () => completeCreation());
  const args = vi.mocked(streamAiRequest).mock.calls[0]!;
  await act(async () => args[10]?.({ tool: 'read_page', state: 'running' }));
  expect(host.textContent).toContain('Читаю выбранные страницы');
  expect(composer().disabled).toBe(false);
  await act(async () => args[10]?.({ tool: 'read_page', state: 'complete' }));
  expect(host.textContent).not.toContain('Читаю выбранные страницы');
  await act(async () => finish({ messages: [], replayed: false, stopped: false }));
  expect(host.querySelector('.ai-activity')).toBeNull();
});

it('dismisses a model failure when the user edits without refreshing or automatically resending', async () => {
  const complete = pendingCreation();
  vi.mocked(streamAiRequest).mockRejectedValueOnce(new Error('private failure'));
  await mount();
  await submit('Вопрос');
  await act(async () => complete());
  expect(host.textContent).toContain('Извините, текстовая модель сейчас недоступна.');
  expect(host.textContent).not.toContain('Обновить переписку');
  await enter('Исправленный вопрос');
  expect(host.textContent).not.toContain('Извините, текстовая модель сейчас недоступна.');
  expect(streamAiRequest).toHaveBeenCalledTimes(1);
});
it('dismisses a model failure immediately after choosing a different model without a new request', async () => {
  const complete = pendingCreation();
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation((path, init) =>
    path === '/api/ai/status'
      ? Promise.resolve(
          ok({
            enabled: true,
            provider: 'openai',
            model: 'gpt-6-luna',
            availableModels: ['gpt-6-luna', 'deepseek-flash'],
          }),
        )
      : original(path, init),
  );
  vi.mocked(streamAiRequest).mockRejectedValueOnce(new Error('private failure'));
  await mount();
  await submit('Вопрос');
  await act(async () => complete());
  expect(host.textContent).toContain('Извините, текстовая модель сейчас недоступна.');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Модель ИИ"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(
    (n) => n.textContent?.trim() === 'deepseek-flash',
  );
  expect(option).toBeTruthy();
  await act(async () => option!.click());
  expect(host.textContent).not.toContain('Извините, текстовая модель сейчас недоступна.');
  expect(host.querySelector('[aria-label="Модель ИИ"]')?.textContent).toContain('deepseek-flash');
  expect(streamAiRequest).toHaveBeenCalledTimes(1);
});

it('shows image progress in an otherwise empty conversation, including recovery after reload', async () => {
  const complete = pendingCreation();
  const original = vi.mocked(call).getMockImplementation()!;
  const request = '50000000-0000-4000-8000-000000000005';
  const key = 'asa-ai-image:personal:' + CREATED_THREAD;
  sessionStorage.setItem(key, request);
  vi.mocked(call).mockImplementation((path, init) => {
    if (path === '/api/ai/image-generation/status')
      return Promise.resolve(
        ok({ enabled: true, ready: true, sizes: [1024], dailyLimit: 10, remainingToday: 10 }),
      );
    if (path.includes('/image-generations/'))
      return Promise.resolve(
        ok({
          threadId: CREATED_THREAD,
          requestId: request,
          state: 'running',
          prompt: 'Синяя мастерская',
          size: 1024,
          recipe: 'flux2-klein-4b-v1',
          cancelRequested: false,
          errorCode: null,
          image: null,
          createdAt: '2026-11-02T00:00:00Z',
        }),
      );
    return original(path, init);
  });
  try {
    await mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Создать новый диалог"]')!.click(),
    );
    await act(async () => complete());
    expect(host.querySelector('.ai-activity-image')).not.toBeNull();
    expect(host.querySelector('.ai-activity-canvas')).not.toBeNull();
    expect(host.querySelector('.asa-ai-chat.is-empty')).toBeNull();
    expect(host.textContent).toContain('Синяя мастерская');
    expect(composer().disabled).toBe(false);
    expect(streamAiRequest).not.toHaveBeenCalled();
  } finally {
    sessionStorage.removeItem(key);
  }
});

it('keeps voice activity inside the composer and preserves the draft without sending it', async () => {
  pendingCreation();
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation((path, init) =>
    path === '/api/ai/stt/status'
      ? Promise.resolve(ok({ enabled: true, model: 'fixture-stt', maxAudioSeconds: 20 }))
      : original(path, init),
  );
  const stopTrack = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
    },
  });
  class Recording {
    static isTypeSupported() {
      return true;
    }
    state: RecordingState = 'inactive';
    onstop: (() => void) | null = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', Recording);
  await mount();
  await enter('Неотправленный черновик');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Продиктовать сообщение"]')!.click(),
  );
  expect(
    host.querySelector('form.chat-composer .chat-voice-slot .ai-voice-panel[data-active="true"]'),
  ).not.toBeNull();
  expect(host.querySelector('.ai-voice-control .ai-voice-panel')).toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Распознать и отправить"]')!.disabled,
  ).toBe(false);
  await act(async () =>
    host
      .querySelector('form.chat-composer')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(creationCalls()).toHaveLength(0);
  expect(streamAiRequest).not.toHaveBeenCalled();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Отменить голосовой ввод"]')!.click(),
  );
  expect(composer().value).toBe('Неотправленный черновик');
  expect(document.activeElement).toBe(composer());
  expect(host.querySelector('.chat-voice-slot .ai-voice-panel')).toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Отправить сообщение"]')!.disabled,
  ).toBe(false);
  expect(stopTrack).toHaveBeenCalled();
});

it('clears only the draft using the button beside the model picker', async () => {
  pendingCreation();
  await mount();
  await enter('Набранный текст');
  const titles = historyTitles();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Очистить текст"]')!.click(),
  );
  expect(composer().value).toBe('');
  expect(document.activeElement).toBe(composer());
  expect(host.querySelector('[aria-label="Очистить текст"]')).toBeNull();
  expect(historyTitles()).toEqual(titles);
  expect(creationCalls()).toHaveLength(0);
  expect(streamAiRequest).not.toHaveBeenCalled();
});

it.each([false, true])(
  'voice arrow submits once only when the full transcript fits: overflow=%s',
  async (overflow) => {
    const complete = pendingCreation();
    const original = vi.mocked(call).getMockImplementation()!;
    const speech = overflow ? 'Р'.repeat(6000) : 'Голосовой вопрос';
    vi.mocked(call).mockImplementation((path, init) =>
      path === '/api/ai/stt/status'
        ? Promise.resolve(ok({ enabled: true, model: 'fixture-stt', maxAudioSeconds: 20 }))
        : path === '/api/ai/stt/transcribe'
          ? Promise.resolve(ok({ text: speech, model: 'fixture-stt' }))
          : original(path, init),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      },
    });
    class Recording {
      static isTypeSupported() {
        return true;
      }
      state: RecordingState = 'inactive';
      onstop: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
        });
        this.onstop?.();
      }
    }
    class Reader {
      result = 'data:audio/webm;base64,AQI=';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    vi.stubGlobal('MediaRecorder', Recording);
    vi.stubGlobal('FileReader', Reader);
    await mount();
    await enter('До');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Продиктовать сообщение"]')!.click(),
    );
    const arrow = host.querySelector<HTMLButtonElement>('[aria-label="Распознать и отправить"]')!;
    expect(arrow.disabled).toBe(false);
    await act(async () => {
      arrow.click();
      arrow.click();
    });
    expect(
      vi.mocked(call).mock.calls.filter(([path]) => path === '/api/ai/stt/transcribe'),
    ).toHaveLength(1);
    if (overflow) {
      expect(creationCalls()).toHaveLength(0);
      expect(streamAiRequest).not.toHaveBeenCalled();
      expect(composer().value).toBe('До');
      expect(host.textContent).toContain('Расшифровка не поместилась');
    } else {
      expect(creationCalls()).toHaveLength(1);
      await act(async () => complete());
      expect(streamAiRequest).toHaveBeenCalledTimes(1);
      expect(vi.mocked(streamAiRequest).mock.calls[0]![1]).toBe('До Голосовой вопрос');
    }
  },
);
