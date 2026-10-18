// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ApiResult } from '../../api-call';
import { api } from '../../api';
import {
  participantsApi,
  type ParticipantGrades,
  type ParticipantProfile,
  type ParticipantWorks,
} from '../../classroom-participants-api';
import { ParticipantGradeHistory } from '../ClassroomParticipantPanels';
import { ClassroomStudentPage } from '../../pages/ClassroomStudentPage';
import { notifySessionLoggedOut } from '../../session-fetch';

let root: Root, host: HTMLDivElement;
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
const fail = (status = 503): ApiResult<never> => ({
  ok: false,
  status,
  error: { code: 'unavailable', message: 'Ошибка страницы' },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(seatId = 'seat-a', compact = true, teacher = true) {
  await act(async () =>
    root.render(
      createElement(ParticipantGradeHistory, {
        classroomId: 'class',
        seatId,
        compact,
        ...(teacher ? { variant: 'teacherProfile' as const } : {}),
      }),
    ),
  );
}
function button(label: string) {
  const result = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(result, label).toBeDefined();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
const manualRows = () => host.querySelectorAll('[aria-label="Ручные оценки"] > li');
const resultRows = () => host.querySelectorAll('[aria-label="Результаты заданий"] > li');

function page(manual = 100, results = 100, offset = 0, resultOffset = 0): ParticipantGrades {
  const ids = Array.from(
    { length: Math.min(30, Math.max(0, manual - offset)) },
    (_, i) => offset + i,
  );
  return {
    journal: {
      offset,
      nextOffset: offset + 30 < manual ? offset + 30 : null,
      columns: ids.map((id) => ({
        id: `c${id}`,
        date: `202${(id % 5) + 1}-01-01`,
        category: `Урок ${id}`,
        preset: 'five',
      })),
      grades: ids.map((id) => ({
        id: `g${id}`,
        columnId: `c${id}`,
        seatId: 'seat-a',
        revision: 1,
        value: id === 1 ? null : id % 6,
        reason: null,
        authorName: 'Учитель',
        publishedAt: '2026-01-01T23:30:00Z',
      })),
    },
    resultOffset,
    nextResultOffset: resultOffset + 30 < results ? resultOffset + 30 : null,
    results: Array.from({ length: Math.min(30, Math.max(0, results - resultOffset)) }, (_, i) => {
      const id = resultOffset + i;
      return {
        assignment_id: `a${id}`,
        assignment_title: `Задание ${id}`,
        raw_points: id === 1 ? null : 0,
        max_points: 10,
        display_grade: null,
        published_at: '2026-01-01T23:30:00Z',
        feedback: `Отзыв ${id}`,
      };
    }),
  };
}

it.each([0, 1, 30, 100])(
  'shows all %i grades of both streams through controlled pagination',
  async (count) => {
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockImplementation(async (_c, _s, o = 0, r = 0) => ok(page(count, count, o, r)));
    await render();
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.querySelector('h2')?.textContent).toBe('Оценки этого класса');
    for (let offset = 30; offset < count; offset += 30) {
      await click('Ещё ручные оценки');
      await click('Ещё результаты');
    }
    expect(manualRows()).toHaveLength(count);
    expect(resultRows()).toHaveLength(count);
    expect(new Set([...manualRows()].map((r) => r.textContent)).size).toBe(count);
    expect(host.textContent).not.toContain('Ещё ручные оценки');
    expect(host.textContent).not.toContain('Ещё результаты');
    if (count === 0) expect(host.textContent).toContain('Оценок пока нет.');
  },
);

it('keeps the exhausted companion cursor and loaded records when streams finish at different offsets', async () => {
  const read = vi
    .spyOn(participantsApi, 'grades')
    .mockImplementation(async (_c, _s, o = 0, r = 0) => ok(page(100, 31, o, r)));
  await render();
  await click('Ещё результаты');
  await click('Ещё ручные оценки');
  await click('Ещё ручные оценки');
  await click('Ещё ручные оценки');
  expect(manualRows()).toHaveLength(100);
  expect(resultRows()).toHaveLength(31);
  expect(host.textContent).not.toContain('Ещё результаты');
  expect(read.mock.calls.at(-1)?.slice(2)).toEqual([90, 30]);
  const before = read.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(read.mock.calls.length - before).toBe(4);
  expect(manualRows()).toHaveLength(100);
  expect(resultRows()).toHaveLength(31);
  expect(host.textContent).not.toContain('Ещё результаты');
});

it('locks repeated calls synchronously, deduplicates overlap, retains records and retries the failed page', async () => {
  const pending = deferred<ApiResult<ParticipantGrades>>();
  const read = vi
    .spyOn(participantsApi, 'grades')
    .mockResolvedValueOnce(ok(page()))
    .mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => {
    button('Ещё ручные оценки').click();
    button('Ещё ручные оценки').click();
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(fail()));
  expect(manualRows()).toHaveLength(30);
  const incoming = page(100, 100, 30, 0);
  incoming.journal.grades.push(page().journal.grades[0]!);
  incoming.journal.columns.push(page().journal.columns[0]!);
  read.mockResolvedValueOnce(ok(incoming));
  await click('Повторить');
  expect(read.mock.calls.at(-1)?.slice(2)).toEqual([30, 0]);
  expect(manualRows()).toHaveLength(60);
  expect(resultRows()).toHaveLength(30);
});

it('preserves all loaded pages on failed focus refresh and does not eagerly fetch unrequested pages', async () => {
  const read = vi
    .spyOn(participantsApi, 'grades')
    .mockImplementation(async (_c, _s, o = 0, r = 0) => ok(page(100, 100, o, r)));
  await render();
  await click('Ещё ручные оценки');
  read.mockResolvedValueOnce(ok(page())).mockResolvedValueOnce(fail());
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(manualRows()).toHaveLength(60);
  await click('Повторить');
  expect(manualRows()).toHaveLength(60);
  expect(resultRows()).toHaveLength(30);
  expect(read.mock.calls.some((args) => args[2] === 60 || args[3] === 30)).toBe(false);
});

it('rejects delayed previous-seat responses and clears protected data on logout and denied reads', async () => {
  const pending = deferred<ApiResult<ParticipantGrades>>();
  const read = vi
    .spyOn(participantsApi, 'grades')
    .mockResolvedValueOnce(ok(page()))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(ok(page(1, 1)));
  await render();
  await act(async () => button('Ещё ручные оценки').click());
  await render('seat-b');
  await act(async () => pending.resolve(ok(page(100, 100, 30))));
  expect(manualRows()).toHaveLength(1);
  read.mockResolvedValueOnce(fail(403));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(manualRows()).toHaveLength(0);
  await act(async () => notifySessionLoggedOut());
  const calls = read.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(read).toHaveBeenCalledTimes(calls);
  expect(host.textContent).toContain('Войдите');
});

it('keeps zero, retracted grade, null result, calendar dates and full revision feedback distinct', async () => {
  vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(2, 2)));
  const history = vi.spyOn(participantsApi, 'history').mockResolvedValue(
    ok({
      preset: 'five',
      items: [{ ...page(1, 0).journal.grades[0]!, reason: 'Исправлена оценка', revision: 2 }],
      nextBeforeRevision: null,
    }),
  );
  vi.spyOn(participantsApi, 'resultHistory').mockResolvedValue(
    ok({
      offset: 0,
      hasMore: false,
      items: [
        {
          id: 'revision',
          revision: 2,
          attempt_number: 1,
          raw_points: 0,
          max_points: 10,
          reason: 'Уточнение',
          feedback: 'Полный отзыв',
          author: 'Учитель',
          published_at: '2026-01-01T23:30:00Z',
        },
      ],
    }),
  );
  await render();
  expect([...manualRows()].map((r) => r.querySelector('strong')?.textContent).sort()).toEqual([
    '0',
    'Отозвана',
  ]);
  expect(host.textContent).toContain('0 / 10');
  expect(host.textContent).toContain('Без балла');
  expect(host.querySelector('time[datetime="2021-01-01"]')?.textContent).toBe('01.01.2021');
  await click('История');
  expect(history).toHaveBeenCalled();
  expect(host.textContent).toContain('Исправлена оценка');
  await click('История результата');
  expect(host.textContent).toContain('Полный отзыв');
});

it('preserves default compact pupil semantics and the seat-only API', async () => {
  const read = vi.spyOn(participantsApi, 'seatGrades').mockResolvedValue(ok(page()));
  const teacher = vi.spyOn(participantsApi, 'grades');
  await act(async () =>
    root.render(
      createElement(ParticipantGradeHistory, {
        classroomId: 'class',
        seatId: 'seat-a',
        compact: true,
        seatSession: true,
      }),
    ),
  );
  expect(host.querySelector('h2')?.textContent).toBe('Последние оценки');
  expect(host.querySelectorAll('.participant-grade-row')).toHaveLength(6);
  expect(host.textContent).not.toContain('Ещё ручные оценки');
  expect(read).toHaveBeenCalledWith(0, 0);
  expect(teacher).not.toHaveBeenCalled();
});

const profile = (): ParticipantProfile => ({
  status: 'active',
  student: {
    id: 'seat-a',
    displayLabel: 'Александра Константинопольская-Долгорукова',
    avatarKey: null,
    status: 'active',
    safeMode: false,
    lastActiveAt: null,
  },
  metrics: {
    seatId: 'seat-a',
    totalWorks: 10,
    archivedWorks: 1,
    score: 39.05,
    rank: 1,
    role: 'student',
    avatarUrl: null,
    factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
    sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
  },
  settings: {
    revision: 0,
    periodDays: 30,
    factors: { projects: true, logins: true, days: true, time: true, grades: true },
  },
  submittedCount: 0,
  awaitingReview: 0,
  helperClasses: [],
  activity: [],
  builtinAwards: [],
  merits: [],
  avatars: [],
});
it('renders one navigation row, truthful safety, all eight keyboard-reachable sections and works retry offset', async () => {
  vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
  vi.spyOn(participantsApi, 'profile').mockResolvedValue(ok(profile()));
  vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(0, 0)));
  const works: ParticipantWorks = {
    offset: 0,
    hasMore: true,
    items: [],
    totalWorks: 10,
    visibleWorks: 8,
    filteredWorks: 8,
  };
  const read = vi
    .spyOn(participantsApi, 'works')
    .mockResolvedValueOnce(ok(works))
    .mockResolvedValueOnce(fail())
    .mockResolvedValueOnce(ok({ ...works, offset: 30, hasMore: false }));
  const back = vi.fn(),
    navigate = vi.fn();
  await act(async () =>
    root.render(
      createElement(ClassroomStudentPage, {
        classroomId: 'class',
        classroomTitle: 'Класс',
        seatId: 'seat-a',
        onBack: back,
        onNavigateStudent: navigate,
        onOpenProject: vi.fn(),
        navigation: {
          total: 1,
          position: 1,
          previous: { id: 'seat-a', displayLabel: 'Ученик' },
          next: { id: 'seat-a', displayLabel: 'Ученик' },
        },
      }),
    ),
  );
  expect(host.querySelectorAll('.classroom-student-navrow nav')).toHaveLength(1);
  expect(host.querySelectorAll('.classroom-student-navrow button:disabled')).toHaveLength(2);
  expect(host.textContent).toContain('Защита выключена');
  expect(host.textContent).toContain('39.05');
  const tabs = host.querySelectorAll<HTMLButtonElement>('.participant-tabs button');
  expect(tabs).toHaveLength(8);
  tabs[0]!.focus();
  await act(async () =>
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[7]);
  await click('Ждут проверки · среди загруженных');
  expect(host.textContent).toContain(
    'Среди загруженных работ нет ожидающих проверки. Загрузите ещё работы.',
  );
  expect(host.textContent).toContain('Часть личных работ закрыта');
  await click('Ещё работы');
  await click('Повторить');
  expect(read.mock.calls.map((args) => args[4])).toEqual([0, 30, 30]);
  await click('← К классу');
  expect(back).toHaveBeenCalledOnce();
});
