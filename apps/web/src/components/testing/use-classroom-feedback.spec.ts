// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useClassroomFeedback } from '../useClassroomFeedback';
import { clearSystemFeedback, getSystemFeedbackSnapshot } from '../system-feedback';

const session = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('../../session-fetch', () => ({
  onSessionLoggedOut: vi.fn((listener: () => void) => {
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }),
}));

let root: Root | undefined;
let host: HTMLDivElement;
let current: ReturnType<typeof useClassroomFeedback>;
let captures: Array<ReturnType<typeof useClassroomFeedback>>;
let errors: ReturnType<typeof vi.spyOn>;
function Probe({ contextKey }: { contextKey: string }) {
  current = useClassroomFeedback(contextKey);
  captures.push(current);
  return null;
}
async function render(contextKey = 'class:a/pupil:a', strict = false) {
  await act(async () => {
    const child = createElement(Probe, { contextKey });
    root!.render(strict ? createElement(StrictMode, null, child) : child);
  });
}
function expectInert(callbacks: ReturnType<typeof useClassroomFeedback>) {
  const before = getSystemFeedbackSnapshot();
  callbacks.success('stale success');
  callbacks.error('stale error');
  callbacks.info('stale info');
  callbacks.warning('stale warning');
  callbacks.clear();
  expect(getSystemFeedbackSnapshot()).toBe(before);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  clearSystemFeedback();
  session.listeners.clear();
  captures = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  clearSystemFeedback();
  host.remove();
  const warnings = errors.mock.calls.map((args: unknown[]) => args.map(String).join(' '));
  const listeners = session.listeners.size;
  session.listeners.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(listeners).toBe(0);
  expect(warnings.filter((line: string) => /useInsertionEffect/i.test(line))).toEqual([]);
});

it('publishes every supported tone and clears the live scope', async () => {
  await render();
  expect(typeof current.scopeKey).toBe('string');
  expect(current.scopeKey.length).toBeGreaterThan(0);
  for (const tone of ['success', 'error', 'info', 'warning'] as const) {
    await act(async () => current[tone]('Сообщение ' + tone));
    expect(getSystemFeedbackSnapshot()).toMatchObject({ message: 'Сообщение ' + tone, tone });
  }
  await act(async () => current.clear());
  const empty = getSystemFeedbackSnapshot();
  await act(async () => current.info('Новое'));
  expect(getSystemFeedbackSnapshot()).not.toEqual(empty);
  await act(async () => current.clear());
  expect(getSystemFeedbackSnapshot()).toEqual(empty);
});

it('invalidates callbacks on pupil change and on return to a reused context', async () => {
  await render();
  const first = current;
  await render('class:a/pupil:b');
  const second = current;
  await act(async () => second.success('Текущий ученик'));
  expectInert(first);
  await render('class:a/pupil:a');
  await act(async () => current.info('Возвращение'));
  expectInert(first);
  expectInert(second);
  expect(getSystemFeedbackSnapshot()).toMatchObject({ message: 'Возвращение' });
});

it('invalidates callbacks after unmount and remount of the same context', async () => {
  await render();
  const old = current;
  await act(async () => old.error('Ошибка'));
  await act(async () => root!.unmount());
  root = undefined;
  expect(session.listeners.size).toBe(0);
  const empty = getSystemFeedbackSnapshot();
  expectInert(old);
  root = createRoot(host);
  await render();
  await act(async () => current.success('Новая установка'));
  expectInert(old);
  expect(getSystemFeedbackSnapshot()).not.toEqual(empty);
});

it('logout clears feedback and permanently invalidates previously captured callbacks', async () => {
  await render();
  const old = current;
  expect(session.listeners.size).toBe(1);
  await act(async () => old.error('До выхода'));
  const occupied = getSystemFeedbackSnapshot();
  await act(async () => {
    for (const listener of [...session.listeners]) listener();
  });
  expect(getSystemFeedbackSnapshot()).not.toEqual(occupied);
  expectInert(old);
  await render('class:a/pupil:b');
  await act(async () => current.success('Новая сессия'));
  expectInert(old);
});

it('survives StrictMode effect replay with one subscription and a working final handle', async () => {
  await render('class:a/pupil:a', true);
  expect(session.listeners.size).toBe(1);
  await act(async () => current.success('StrictMode работает'));
  expect(getSystemFeedbackSnapshot()).toMatchObject({
    message: 'StrictMode работает',
    tone: 'success',
  });
  const previous = [...captures];
  await render('class:a/pupil:b', true);
  await act(async () => current.warning('Новый ученик'));
  for (const old of previous) expectInert(old);
  expect(session.listeners.size).toBe(1);
  await act(async () => root!.unmount());
  root = undefined;
  for (const old of captures) expectInert(old);
  expect(session.listeners.size).toBe(0);
});
