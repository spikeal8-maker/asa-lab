// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentJournalResults } from '../../components/StudentJournalResults';
import { journalApi, type JournalResultsPage } from '../../classroom-journal-api';
import type { ApiResult } from '../../api-call';

vi.mock('../../session-fetch', () => ({
  onSessionLoggedOut: (listener: () => void) => {
    window.addEventListener('asa-session-logout', listener);
    return () => window.removeEventListener('asa-session-logout', listener);
  },
}));
const column = '123e4567-e89b-42d3-a456-426614174000';
function page(value: number): ApiResult<JournalResultsPage> {
  return {
    ok: true,
    status: 200,
    data: {
      range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', timeZone: 'UTC' },
      offset: 0,
      nextOffset: null,
      items: [
        {
          id: 'grade-' + value,
          columnId: column,
          seatId: 'seat-' + value,
          revision: 1,
          value,
          reason: null,
          supersedesId: null,
          authorId: 'teacher',
          authorName: 'Преподаватель',
          publishedAt: '2026-10-10T10:00:00Z',
          date: '2026-10-09',
          category: 'Работа на уроке',
          preset: 'five',
          scaleVersion: 1,
          classroomId: 'class',
          classroomTitle: 'Мой класс',
          timeZone: 'UTC',
        },
      ],
    },
  };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  window.history.replaceState(null, '', '/#/learning');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(scope: 'seat' | 'account') {
  await act(async () => root.render(createElement(StudentJournalResults, { scope })));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe('explicit journal learner surface', () => {
  it('passes Seat scope, clears prior data on an auth error after cookie revalidation, and retries', async () => {
    const load = vi
      .spyOn(journalApi, 'results')
      .mockResolvedValueOnce(page(0))
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: { code: 'unauthorized', message: 'Войдите' },
      })
      .mockResolvedValueOnce(page(5));
    await render('seat');
    expect(host.querySelector('li b')?.textContent).toBe('0');
    expect(load).toHaveBeenLastCalledWith('seat', { offset: 0, columnId: undefined });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Войдите');
    await click('Повторить загрузку оценок');
    expect(host.querySelector('li b')?.textContent).toBe('5');
  });
  it('ignores a pending response from the old scope after switching to Account', async () => {
    let complete!: (value: ApiResult<JournalResultsPage>) => void;
    const load = vi
      .spyOn(journalApi, 'results')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(page(4));
    await render('seat');
    await render('account');
    expect(load).toHaveBeenLastCalledWith('account', { offset: 0, columnId: undefined });
    await act(async () => complete(page(0)));
    expect(host.querySelector('li b')?.textContent).toBe('4');
    await act(async () => window.dispatchEvent(new Event('asa-session-logout')));
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });
  it('opens the notification month/column and only requests the next server page', async () => {
    window.history.replaceState(
      null,
      '',
      `/#/learning?journalMonth=2026-09&journalColumn=${column}`,
    );
    const first = page(3);
    if (!first.ok) throw new Error('fixture');
    first.data.range.from = '2026-09-01';
    first.data.range.to = '2026-09-30';
    first.data.nextOffset = 20;
    const load = vi
      .spyOn(journalApi, 'results')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(page(5))
      .mockResolvedValueOnce(page(0));
    await render('account');
    expect(load).toHaveBeenLastCalledWith('account', {
      from: '2026-09-01',
      to: '2026-09-30',
      offset: 0,
      columnId: column,
    });
    await click('Следующая страница оценок');
    expect(load).toHaveBeenLastCalledWith('account', {
      from: '2026-09-01',
      to: '2026-09-30',
      offset: 20,
      columnId: column,
    });
    expect(load).toHaveBeenCalledTimes(2);
    await click('Предыдущий месяц');
    expect(load).toHaveBeenLastCalledWith('account', {
      from: '2026-08-01',
      to: '2026-08-31',
      offset: 0,
      columnId: undefined,
    });
    expect(host.querySelectorAll('li')).toHaveLength(1);
  });
});
