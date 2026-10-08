// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiResult, type LearningNotification } from '../../apps/web/src/api';
import { LearningInbox } from '../../apps/web/src/components/LearningInbox';
import type { LearningInboxSnapshot } from '../../apps/web/src/components/learning-inbox-poller';

const notification: LearningNotification = {
  id: 'notification-1',
  kind: 'NF01',
  category: 'NC01',
  classroomId: 'class-1',
  classroomTitle: 'Класс',
  title: 'Учебная работа',
  assignmentId: 'assignment-1',
  seatId: 'seat-1',
  attemptId: null,
  courseRunId: null,
  joinRequestId: null,
  recipientKind: 'learner',
  createdAt: '2026-10-08T00:00:00Z',
  readAt: null,
};
const snapshot = (unread = 1): ApiResult<LearningInboxSnapshot> => ({
  ok: true,
  status: 200,
  data: { snapshot: '2026-10-08T01:00:00Z', unread, items: [notification] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(api, 'learningNotifications').mockResolvedValue(snapshot());
  vi.spyOn(api, 'readLearningNotifications').mockResolvedValue({
    ok: true,
    status: 200,
    data: { count: 1 },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const render = async (key = 'account:1') => {
  await act(async () => root.render(createElement(LearningInbox, { key })));
};
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const unreadStatus = () => container.querySelector<HTMLElement>('.learning-inbox-unread')!;
const periodicRefresh = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(19000);
  });
};
const readAll = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Отметить прочитанными',
  )!;

describe('compiled consumer contract for the learning inbox', () => {
  it.each([0, 1, 99, 100, 999999])(
    'shows exact unread %s inline without a button or nested dialog',
    async (unread) => {
      vi.mocked(api.learningNotifications).mockResolvedValue(snapshot(unread));
      await render();
      expect(unreadStatus().textContent).toBe(`Непрочитанных: ${unread}`);
      expect(container.querySelector('.learning-inbox-button, dialog')).toBeNull();
    },
  );

  it('marks using the displayed snapshot once and rejects an older GET after the read', async () => {
    await render();
    const old = deferred<ApiResult<LearningInboxSnapshot>>();
    vi.mocked(api.learningNotifications)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(snapshot(0));
    await periodicRefresh();
    const write = deferred<Awaited<ReturnType<typeof api.readLearningNotifications>>>();
    vi.mocked(api.readLearningNotifications).mockReturnValue(write.promise);
    await click(readAll());
    await click(readAll());
    expect(api.readLearningNotifications).toHaveBeenCalledTimes(1);
    expect(api.readLearningNotifications).toHaveBeenCalledWith(null, '2026-10-08T01:00:00Z');
    await act(async () => write.resolve({ ok: true, status: 200, data: { count: 1 } }));
    expect(api.learningNotifications).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(snapshot(999)));
    expect(api.learningNotifications).toHaveBeenCalledTimes(3);
    expect(unreadStatus().textContent).toBe('Непрочитанных: 0');
    expect(readAll().disabled).toBe(false);
  });

  it.each(['seat:2', 'account:1:workspace:2'])(
    'does not apply a delayed read or load to replacement context %s',
    async (nextKey) => {
      await render();
      await periodicRefresh();
      const old = deferred<ApiResult<LearningInboxSnapshot>>();
      vi.mocked(api.learningNotifications)
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue(snapshot(7));
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(1000);
      });
      // Explicit open does not rely on the passive activation window.
      await periodicRefresh();
      const write = deferred<Awaited<ReturnType<typeof api.readLearningNotifications>>>();
      vi.mocked(api.readLearningNotifications).mockReturnValue(write.promise);
      await click(readAll());
      await render(nextKey);
      const calls = vi.mocked(api.learningNotifications).mock.calls.length;
      await act(async () => {
        old.resolve(snapshot(99));
        write.resolve({
          ok: false,
          status: 503,
          error: { code: 'old', message: 'Старый пользователь' },
        });
      });
      expect(unreadStatus().textContent).toBe('Непрочитанных: 7');
      expect(container.textContent).not.toContain('Старый пользователь');
      expect(api.learningNotifications).toHaveBeenCalledTimes(calls);
    },
  );

  it('keeps read errors visible after a fresh GET and exposes an explicit retry inside the active panel', async () => {
    await render();
    await periodicRefresh();
    vi.mocked(api.readLearningNotifications).mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Чтение временно недоступно' },
    });
    await click(readAll());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Чтение временно недоступно',
    );
    expect(unreadStatus().textContent).not.toContain('!');
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Повторить',
    )!;
    await click(retry);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
