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

function pendingCreation() {
  let resolve!: (value: ApiResult<unknown>) => void;
  const promise = new Promise<ApiResult<unknown>>((complete) => {
    resolve = complete;
  });
  vi.mocked(call).mockImplementation(async (path, init) => {
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
    );
    expect(creationCalls()).toHaveLength(1);
    expect(composer().value).toBe('');
    expect(composer().disabled).toBe(false);
  });
});
