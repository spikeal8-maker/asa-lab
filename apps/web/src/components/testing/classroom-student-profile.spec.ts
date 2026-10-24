// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
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
  const result = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
const manualRows = () =>
  host.querySelectorAll(
    '.teacher-profile-grades [data-grade-source="journal"], .participant-grade-list:first-of-type:not([aria-label="Оценки текущего класса"]) > li',
  );
const resultRows = () =>
  host.querySelectorAll(
    '.teacher-profile-grades [data-grade-source="results"], .participant-grade-list:nth-of-type(2) > li',
  );

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

it.each(['journal', 'results'])(
  'exhausts 100+100 independent cursors with %s first',
  async (first) => {
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockImplementation(async (_c, _s, o = 0, r = 0) => ok(page(100, 100, o, r)));
    await render();
    const labels =
      first === 'journal'
        ? ['Ещё ручные оценки', 'Ещё результаты']
        : ['Ещё результаты', 'Ещё ручные оценки'];
    for (const label of labels) for (let i = 0; i < 3; i++) await click(label);
    expect(manualRows()).toHaveLength(100);
    expect(resultRows()).toHaveLength(100);
    expect(read.mock.calls.map((call) => call.slice(2))).toEqual(
      first === 'journal'
        ? [
            [0, 0],
            [30, 0],
            [60, 0],
            [90, 0],
            [90, 30],
            [0, 30],
            [30, 30],
            [60, 30],
            [90, 60],
            [0, 60],
            [30, 60],
            [60, 60],
            [90, 90],
            [0, 90],
            [30, 90],
            [60, 90],
          ]
        : [
            [0, 0],
            [0, 30],
            [0, 60],
            [0, 90],
            [30, 90],
            [60, 90],
            [90, 90],
          ],
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(read.mock.calls.slice(-4).map((call) => call.slice(2))).toEqual([
      [0, 0],
      [30, 30],
      [60, 60],
      [90, 90],
    ]);
    expect(manualRows()).toHaveLength(100);
    expect(resultRows()).toHaveLength(100);
  },
);

it('does not rewind pagination when focus or another stream is requested during a pending result page', async () => {
  const pending = deferred<ApiResult<ParticipantGrades>>();
  const read = vi
    .spyOn(participantsApi, 'grades')
    .mockResolvedValueOnce(ok(page()))
    .mockResolvedValueOnce(ok(page(100, 100, 30, 0)))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(ok(page(100, 100, 0, 30)))
    .mockResolvedValueOnce(ok(page(100, 100, 60, 30)));
  await render();
  await click('Ещё ручные оценки');
  await act(async () => {
    button('Ещё результаты').click();
    window.dispatchEvent(new Event('focus'));
    button('Ещё ручные оценки').click();
  });
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => pending.resolve(ok(page(100, 100, 0, 30))));
  expect(manualRows()).toHaveLength(60);
  expect(resultRows()).toHaveLength(60);
  await click('Ещё ручные оценки');
  expect(read.mock.calls.at(-1)?.slice(2)).toEqual([60, 30]);
  expect(manualRows()).toHaveLength(90);
  expect(resultRows()).toHaveLength(60);
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

it.each([false, true])(
  'keeps authoritative manual revisions across pages and refresh (reverse=%s)',
  async (reverse) => {
    const original = { ...page(1, 0).journal.grades[0]!, value: 5 };
    const retracted = {
      ...original,
      id: 'revision-2',
      revision: 2,
      value: null,
      publishedAt: '2026-02-01T00:00:00Z',
    };
    const newerTie = { ...retracted, id: 'revision-2-later', publishedAt: '2026-02-02T00:00:00Z' };
    const response = (offset: number) => {
      const data = page(31, 100, offset, 0);
      data.journal.grades = data.journal.grades.filter((grade) => grade.columnId !== 'c0');
      data.journal.grades.push(...(offset ? [newerTie, retracted, original] : [original]));
      if (reverse) data.journal.grades.reverse();
      return data;
    };
    vi.spyOn(participantsApi, 'grades').mockImplementation(
      async (_c, _s, offset = 0, resultOffset = 0) =>
        ok({
          ...response(offset),
          ...{
            results: page(0, 100, 0, resultOffset).results,
            resultOffset,
            nextResultOffset: resultOffset + 30 < 100 ? resultOffset + 30 : null,
          },
        }),
    );
    const history = vi
      .spyOn(participantsApi, 'history')
      .mockResolvedValue(
        ok({ preset: 'five', items: [newerTie, original], nextBeforeRevision: null }),
      );
    await render();
    const column = () => [...manualRows()].filter((row) => row.textContent?.includes('Урок 0'));
    expect(column()).toHaveLength(1);
    expect(column()[0]!.querySelector('strong')?.textContent).toBe('5');
    await click('Ещё ручные оценки');
    for (let i = 0; i < 3; i++) await click('Ещё результаты');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(manualRows()).toHaveLength(31);
    expect(resultRows()).toHaveLength(100);
    expect(column()).toHaveLength(1);
    expect(column()[0]!.querySelector('strong')?.textContent).toBe('Отозвана');
    expect(column()[0]!.querySelector('button')).toBeNull();
    expect(history).not.toHaveBeenCalled();
  },
);

it.each([30, 100])(
  'reconciles companion retractions across %i loaded manual columns without advancing their pages',
  async (count) => {
    let retracted = false;
    const original = { ...page(1, 0).journal.grades[0]!, value: 5 };
    const latest = { ...original, id: 'rev2', revision: 2, value: null };
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockImplementation(async (_c, _s, o = 0, r = 0) => {
        const data = page(count === 100 ? 100 : 130, 100, o, r);
        data.journal.grades = data.journal.grades.map((g) =>
          g.columnId === 'c0' ? (retracted ? latest : original) : g,
        );
        // A shifted companion page may contain an as-yet unrequested column.
        if (retracted) {
          data.journal.columns.push({
            id: 'unrequested',
            date: '2026-01-01',
            category: 'NEW',
            preset: 'five',
          });
          data.journal.grades.push({ ...latest, columnId: 'unrequested', id: 'new' });
        }
        return ok(data);
      });
    vi.spyOn(participantsApi, 'history').mockResolvedValue(
      ok({ preset: 'five', items: [latest, original], nextBeforeRevision: null }),
    );
    await render();
    for (let o = 30; o < count; o += 30) await click('Ещё ручные оценки');
    const loaded = count;
    const manualOffset = count === 100 ? 90 : 0;
    const column = () => [...manualRows()].filter((r) => r.textContent?.includes('Урок 0'));
    expect(column()[0]!.querySelector('strong')?.textContent).toBe('5');
    const before = read.mock.calls.length;
    retracted = true;
    await click('Ещё результаты');
    expect(column()).toHaveLength(1);
    expect(column()[0]!.querySelector('strong')?.textContent).toBe('Отозвана');
    expect(manualRows()).toHaveLength(loaded);
    expect(host.textContent).not.toContain('NEW');
    expect([...manualRows()].some((r) => r.querySelector('strong')?.textContent === '0')).toBe(
      true,
    );
    expect(resultRows()).toHaveLength(60);
    expect(read.mock.calls.slice(before).map((c) => c.slice(2))).toEqual(
      count === 100
        ? [
            [90, 30],
            [0, 30],
            [30, 30],
            [60, 30],
          ]
        : [[0, 30]],
    );
    expect(column()[0]!.querySelector('button')).toBeNull();
    expect(host.querySelector('.participant-history')).toBeNull();
    if (count === 30) {
      await click('Ещё ручные оценки');
      expect(read.mock.calls.at(-1)?.slice(2)).toEqual([manualOffset + 30, 30]);
    } else expect(host.textContent).not.toContain('Ещё ручные оценки');
    const beforeRefresh = read.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(read.mock.calls.slice(beforeRefresh).map((c) => c.slice(2))).toEqual(
      count === 100
        ? [
            [0, 0],
            [30, 30],
            [60, 0],
            [90, 0],
          ]
        : [
            [0, 0],
            [30, 30],
          ],
    );
    await click('Ещё результаты');
    expect(read.mock.calls.at(-(count === 100 ? 4 : 2))?.slice(2)).toEqual([
      count === 100 ? 90 : 30,
      60,
    ]);
  },
);

it.each([false, true])(
  'keeps the newest whole result through paging and stale focus refresh (newerFirst=%s)',
  async (newerFirst) => {
    const old = { ...page(0, 1).results[0]!, display_grade: '5', raw_points: 5, feedback: 'OLD' };
    const latest = {
      ...old,
      published_at: '2026-02-01T00:00:00.000002Z',
      display_grade: null,
      raw_points: null,
      max_points: null,
      feedback: 'CURRENT RETRACTION',
    };
    let staleRefresh = false;
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockImplementation(async (_c, _s, o = 0, r = 0) => {
        const data = page(100, 100, o, r);
        data.results[0] = staleRefresh ? old : (r === 0) === newerFirst ? latest : old;
        return ok(data);
      });
    await render('seat-a', false);
    await click('Ещё результаты');
    const row = () => [...resultRows()].filter((r) => r.textContent?.includes('Задание 0'));
    expect(row()).toHaveLength(1);
    expect(row()[0]!.querySelector('strong')?.textContent).toBe('Без балла');
    expect(row()[0]!.textContent).toContain('CURRENT RETRACTION');
    expect(row()[0]!.textContent).not.toContain('OLD');
    staleRefresh = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(row()[0]!.querySelector('strong')?.textContent).toBe('Без балла');
    expect(row()[0]!.textContent).toContain('CURRENT RETRACTION');
    expect(manualRows()).toHaveLength(30);
    await click('Ещё ручные оценки');
    expect(read.mock.calls.at(-1)?.slice(2)).toEqual([30, 30]);
    await click('Ещё результаты');
    expect(read.mock.calls.slice(-2).map((c) => c.slice(2))).toEqual([
      [30, 60],
      [0, 60],
    ]);
    expect(row()[0]!.querySelector('strong')?.textContent).toBe('Без балла');
  },
);

it.each(
  ['+0300', '+03:00'].flatMap((offset) => [false, true].map((reverse) => ({ offset, reverse }))),
)(
  'fails closed for conflicting equal publication instants and retries canonical pages ($offset, reverse=$reverse)',
  async ({ offset, reverse }) => {
    const old = {
      ...page(0, 1).results[0]!,
      published_at: '2026-02-01T00:00:00.000001Z',
      display_grade: '5',
    };
    const conflicting = {
      ...old,
      published_at: `2026-02-01T03:00:00.000001${offset}`,
      display_grade: null,
      raw_points: null,
    };
    const first = page(30, 100);
    first.results[0] = reverse ? conflicting : old;
    const second = page(30, 100, 0, 30);
    second.results[0] = reverse ? old : conflicting;
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValueOnce(ok(second));
    await render();
    await click('Ещё результаты');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось определить актуальный результат',
    );
    expect(resultRows()).toHaveLength(0);
    const canonical = page(30, 100);
    canonical.results[0] = conflicting;
    read.mockResolvedValueOnce(ok(canonical));
    await click('Повторить');
    expect(read.mock.calls.at(-1)?.slice(2)).toEqual([0, 0]);
    expect(resultRows()).toHaveLength(30);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  },
);

it.each(
  [
    '2026-02-01T00:00:00.000002Z',
    '2026-02-01T03:00:00.000002+0300',
    '2026-02-01T03:00:00.000002+03:00',
    '2026-01-31T19:00:00.000002-0500',
    '2026-01-31T18:30:00.000002-05:30',
  ].flatMap((published_at) => [false, true].map((reverse) => ({ published_at, reverse }))),
)(
  'orders submillisecond publications and equivalent timestamp spellings ($published_at, reverse=$reverse)',
  async ({ published_at, reverse }) => {
    const old = {
      ...page(0, 1).results[0]!,
      published_at: '2026-02-01T00:00:00.000001Z',
      display_grade: '5',
    };
    const latest = {
      ...old,
      published_at,
      display_grade: null,
      raw_points: null,
    };
    const data = page(1, 1);
    data.results = [latest, old];
    if (reverse) data.results.reverse();
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
    await render();
    expect(resultRows()).toHaveLength(1);
    expect(resultRows()[0]!.querySelector('strong')?.textContent).toBe('Без балла');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  },
);

it.each([
  '2026-02-30T00:00:00Z',
  '2026-02-29T00:00:00Z',
  '1900-02-29T00:00:00Z',
  '2026-04-31T00:00:00Z',
  '2026-00-01T00:00:00Z',
  '2026-13-01T00:00:00Z',
  '2026-02-00T00:00:00Z',
  '2026-02-01T24:00:00Z',
  '2026-02-01T00:60:00Z',
  '2026-02-01T00:00:60Z',
  '2026-02-01T00:00:00+2400',
  '2026-02-01T00:00:00-24:00',
  '2026-02-01T00:00:00+03:60',
  '2026-02-01T00:00:00+0360',
  '2026-02-01T00:00:00',
  '2026-02-01',
  '2026-02-01T00:00Z',
  '2026-02-01T00:00:00.Z',
  '2026-02-01T00:00:00.0000001Z',
  '2026-02-01T00:00:00.12xZ',
  '2026-02-01T00:00:00Zjunk',
  '2026-02-01T00:00:00Z\n',
])(
  'rejects invalid publication %s without retaining grades and permits retry',
  async (published_at) => {
    const data = page(1, 1);
    data.results[0] = { ...data.results[0]!, published_at, display_grade: '5' };
    const read = vi.spyOn(participantsApi, 'grades').mockResolvedValueOnce(ok(data));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось определить актуальный результат',
    );
    expect(resultRows()).toHaveLength(0);
    expect(manualRows()).toHaveLength(0);
    read.mockResolvedValueOnce(ok(page(1, 1)));
    await click('Повторить');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(resultRows()).toHaveLength(1);
  },
);

it.each([
  '2000-02-29T23:59:59Z',
  '2024-02-29T00:00:00.1+0300',
  '2026-01-31T23:59:59.123456-05:30',
  '2026-02-01T00:00:00.000000Z',
  '2026-02-01T00:00:00.12Z',
  '2026-02-01T00:00:00.123Z',
  '2026-02-01T00:00:00.1234Z',
  '2026-02-01T00:00:00.12345Z',
])('accepts valid calendar and fractional publication %s', async (published_at) => {
  const data = page(0, 1);
  data.results[0] = { ...data.results[0]!, published_at };
  vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
  await render();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(resultRows()).toHaveLength(1);
});

it.each([false, true])(
  'coalesces equivalent UTC instants and fractional padding (reverse=%s)',
  async (reverse) => {
    const data = page(0, 1);
    const result = data.results[0]!;
    data.results = [
      '2026-02-01T00:00:00.1Z',
      '2026-02-01T03:00:00.100000+0300',
      '2026-02-01T03:00:00.100+03:00',
      '2026-01-31T19:00:00.100000-0500',
      '2026-01-31T18:30:00.100000-05:30',
    ].map((published_at) => ({ ...result, published_at }));
    if (reverse) data.results.reverse();
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
    await render();
    expect(resultRows()).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  },
);

it.each(['switch', 'logout', 'denied'])(
  'guards every additional loaded-journal read during result paging (%s)',
  async (action) => {
    const pending = deferred<ApiResult<ParticipantGrades>>();
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockResolvedValueOnce(ok(page()))
      .mockResolvedValueOnce(ok(page(100, 100, 30, 0)))
      .mockResolvedValueOnce(ok(page(100, 100, 30, 30)))
      .mockReturnValueOnce(pending.promise);
    await render();
    await click('Ещё ручные оценки');
    await act(async () => button('Ещё результаты').click());
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls.at(-1)?.slice(2)).toEqual([0, 30]);
    if (action === 'switch') {
      read.mockResolvedValueOnce(ok(page(1, 1)));
      await render('seat-b');
    } else if (action === 'logout') await act(async () => notifySessionLoggedOut());
    await act(async () =>
      pending.resolve(action === 'denied' ? fail(403) : ok(page(100, 100, 0, 30))),
    );
    expect(manualRows()).toHaveLength(action === 'switch' ? 1 : 0);
    expect(resultRows()).toHaveLength(action === 'switch' ? 1 : 0);
    const before = read.mock.calls.length;
    if (action === 'logout') {
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(read).toHaveBeenCalledTimes(before);
    }
    if (action === 'denied') {
      read.mockResolvedValueOnce(ok(page(1, 1)));
      await click('Повторить');
      expect(read.mock.calls.at(-1)?.slice(2)).toEqual([0, 0]);
      expect(manualRows()).toHaveLength(1);
    }
  },
);

it.each([503, 403])(
  'shows the new learner error %i and retry while rejecting old grade/history responses and epoch reuse',
  async (status) => {
    const staleGrade = deferred<ApiResult<ParticipantGrades>>();
    const staleHistory =
      deferred<ApiResult<import('../../classroom-participants-api').ParticipantResultHistory>>();
    const read = vi
      .spyOn(participantsApi, 'grades')
      .mockResolvedValueOnce(ok(page()))
      .mockReturnValueOnce(staleGrade.promise)
      .mockResolvedValueOnce(fail(status));
    vi.spyOn(participantsApi, 'resultHistory').mockReturnValueOnce(staleHistory.promise);
    await render();
    await act(async () => button('Ещё ручные оценки').click());
    expect(host.textContent).not.toContain('История');
    await render('seat-b');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Ошибка страницы');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(manualRows()).toHaveLength(0);
    expect(resultRows()).toHaveLength(0);
    read.mockResolvedValueOnce(ok(page(1, 1)));
    await click('Повторить');
    expect(read.mock.calls.at(-1)?.slice(1)).toEqual(['seat-b', 0, 0]);
    expect(manualRows()).toHaveLength(1);
    read.mockResolvedValueOnce(ok(page(2, 2)));
    await render('seat-a');
    await act(async () => {
      staleGrade.resolve(ok(page(100, 100, 30)));
      staleHistory.resolve(
        ok({
          offset: 0,
          hasMore: false,
          items: [
            {
              id: 'stale',
              revision: 1,
              attempt_number: 1,
              raw_points: 99,
              max_points: 100,
              reason: null,
              feedback: 'STALE HISTORY',
              author: 'A',
              published_at: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      );
    });
    expect(manualRows()).toHaveLength(2);
    expect(resultRows()).toHaveLength(2);
    expect(host.textContent).not.toContain('STALE HISTORY');
  },
);

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

it.each([401, 403])(
  'purges current data and pending result history on grade denial %i',
  async (status) => {
    const pending =
      deferred<ApiResult<import('../../classroom-participants-api').ParticipantResultHistory>>();
    vi.spyOn(participantsApi, 'grades')
      .mockResolvedValueOnce(ok(page()))
      .mockResolvedValueOnce(fail(status))
      .mockResolvedValueOnce(ok(page(1, 1)));
    vi.spyOn(participantsApi, 'resultHistory').mockReturnValueOnce(pending.promise);
    await render('seat-a', false, false);
    await click('История результата');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(manualRows()).toHaveLength(0);
    expect(resultRows()).toHaveLength(0);
    await act(async () => pending.resolve(ok({ offset: 0, hasMore: false, items: [] })));
    expect(host.querySelector('.participant-history')).toBeNull();
    await click('Повторить');
    expect(manualRows()).toHaveLength(1);
    expect(resultRows()).toHaveLength(1);
  },
);

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
  expect(host.textContent).not.toContain('История');
  expect(history).not.toHaveBeenCalled();
  await render('seat-a', false, false);
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

it.each([true, false])(
  'suppresses teacher history in compact=%s without reading it',
  async (compact) => {
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(2, 2)));
    const manual = vi.spyOn(participantsApi, 'history');
    const results = vi.spyOn(participantsApi, 'resultHistory');
    await render('seat-a', compact);
    expect(host.textContent).not.toContain('История');
    expect(host.textContent).not.toContain('история');
    expect(manualRows()).toHaveLength(2);
    expect(resultRows()).toHaveLength(2);
    expect(host.textContent).toContain('0 / 10');
    expect(manual).not.toHaveBeenCalled();
    expect(results).not.toHaveBeenCalled();
  },
);

it('does not rewind an exhausted journal while paging overlapping assignment results', async () => {
  vi.spyOn(participantsApi, 'grades').mockImplementation(async (_c, _s, o = 0, r = 0) => {
    const next = page(1, 100, o, r);
    if (r > 0) next.results.push(page(1, 100).results[0]!);
    return ok(next);
  });
  await render();
  for (let i = 0; i < 3; i++) await click('Ещё результаты');
  expect(manualRows()).toHaveLength(1);
  expect(resultRows()).toHaveLength(100);
  expect(host.textContent).not.toContain('Ещё ручные оценки');
  expect(host.textContent).not.toContain('Ещё результаты');
});

it('orders published instants by time rather than the spelling of timezone offsets', async () => {
  const data = page(0, 2);
  data.results[0]!.published_at = '2026-01-01T00:00:00-12:00';
  data.results[1]!.published_at = '2026-01-01T05:00:00Z';
  vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
  await render();
  expect(
    [...resultRows()].map(
      (row) => row.querySelector('.participant-grade-context span')?.textContent,
    ),
  ).toEqual(['Задание 0', 'Задание 1']);
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

type SeatActions = NonNullable<ComponentProps<typeof ClassroomStudentPage>['seatActions']>;
function profileActions(overrides: Partial<SeatActions> = {}): SeatActions {
  return {
    busy: false,
    readOnly: false,
    studentCode: true,
    canOpenCard: true,
    error: null,
    onSettings: vi.fn(),
    onCode: vi.fn(),
    onAccessCard: vi.fn(),
    onSuspend: vi.fn(),
    onSafeMode: vi.fn(async () => null),
    ...overrides,
  };
}
function mockProfilePage(
  read = async (_class: string, seat: string) => {
    const data = profile();
    data.student.id = seat;
    data.student.displayLabel = seat;
    data.metrics.seatId = seat;
    return ok(data);
  },
) {
  vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
  vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(0, 0)));
  vi.spyOn(participantsApi, 'works').mockResolvedValue(
    ok({
      items: [],
      totalWorks: 0,
      visibleWorks: 0,
      filteredWorks: 0,
      offset: 0,
      hasMore: false,
    }),
  );
  return vi.spyOn(participantsApi, 'profile').mockImplementation(read);
}
async function renderProfileActions(actions: SeatActions, seatId = 'seat-a', revision = 0) {
  await act(async () =>
    root.render(
      createElement(ClassroomStudentPage, {
        classroomId: 'class',
        classroomTitle: 'Класс',
        seatId,
        navigation: null,
        onNavigateStudent: vi.fn(),
        onBack: vi.fn(),
        onOpenProject: vi.fn(),
        seatActions: actions,
        profileRevision: revision,
      }),
    ),
  );
}

it('keeps protection at the confirmed value until save and profile refresh complete', async () => {
  let safeMode = false;
  const read = mockProfilePage(async () => {
    const data = profile();
    data.student.displayLabel = 'seat-a';
    data.student.safeMode = safeMode;
    return ok(data);
  });
  const saved = deferred<string | null>();
  const actions = profileActions({ onSafeMode: vi.fn(() => saved.promise) });
  await renderProfileActions(actions);
  const protection = host.querySelector<HTMLInputElement>('[aria-label="Защита: seat-a"]')!;
  await act(async () => protection.click());
  expect(actions.onSafeMode).toHaveBeenCalledWith(true);
  expect(protection.checked).toBe(false);
  expect(protection.disabled).toBe(true);
  safeMode = true;
  await act(async () => saved.resolve(null));
  expect(protection.checked).toBe(true);
  expect(protection.disabled).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['switch', 'logout'] as const)(
  'ignores a pending protection failure after %s',
  async (boundary) => {
    const read = mockProfilePage();
    const saved = deferred<string | null>();
    const actions = profileActions({ onSafeMode: vi.fn(() => saved.promise) });
    await renderProfileActions(actions);
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="Защита: seat-a"]')!.click(),
    );
    if (boundary === 'switch') await renderProfileActions(actions, 'seat-b');
    else await act(async () => notifySessionLoggedOut());
    const calls = read.mock.calls.length;
    await act(async () => saved.resolve('STALE FORBIDDEN'));
    expect(host.textContent).not.toContain('STALE FORBIDDEN');
    expect(read).toHaveBeenCalledTimes(calls);
    if (boundary === 'switch') {
      expect(host.querySelector('.classroom-student-picker-name')?.textContent).toBe('seat-b');
      expect(host.querySelector<HTMLInputElement>('[aria-label="Защита: seat-b"]')!.checked).toBe(
        false,
      );
    } else expect(host.querySelector('.classroom-student-safety')).toBeNull();
  },
);

it('refreshes the saved name on revision without losing the selected profile tab', async () => {
  let name = 'До сохранения';
  mockProfilePage(async () => {
    const data = profile();
    data.student.displayLabel = name;
    return ok(data);
  });
  const actions = profileActions();
  await renderProfileActions(actions);
  await click('Активность');
  name = 'После сохранения';
  await renderProfileActions(actions, 'seat-a', 1);
  expect(host.querySelector('.classroom-student-picker-name')?.textContent).toBe(name);
  expect(button('Активность').getAttribute('aria-pressed')).toBe('true');
});

it('wires settings, credentials, access cards, suspension and the real class avatar panel', async () => {
  mockProfilePage();
  const actions = profileActions();
  await renderProfileActions(actions);
  await click('Настройки ученика: seat-a');
  await click('Изменить код');
  await click('Карточка доступа');
  await click('Приостановить доступ');
  expect(actions.onSettings).toHaveBeenCalledTimes(1);
  expect(actions.onCode).toHaveBeenCalledTimes(1);
  expect(actions.onAccessCard).toHaveBeenCalledTimes(1);
  expect(actions.onSuspend).toHaveBeenCalledTimes(1);
  await click('Аватары класса');
  const section = host.querySelector<HTMLElement>('section[aria-label="Аватары класса"]')!;
  expect(section).not.toBeNull();
  expect(section.contains(host.querySelector('.participant-recognition'))).toBe(true);
  expect(document.activeElement).toBe(section);
});

it('blocks suspended teacher avatar writes and uses the teacher endpoint after reactivation', async () => {
  const data = profile();
  data.student.status = 'suspended';
  data.merits = [
    { id: 'merit-a', title: 'Мастер', description: '', granted: false, grantedAt: null },
  ];
  data.avatars = ['saved', 'next'].map((id) => ({
    id,
    title: id,
    url: `/avatar/${id}`,
    secret: true,
    available: true,
    selected: id === 'saved',
    permitted: true,
  }));
  mockProfilePage(async () => ok({ ...data, student: { ...data.student } }));
  vi.spyOn(participantsApi, 'listSeatAwards').mockResolvedValue(ok({ items: [] }));
  const learnerSave = vi
    .spyOn(participantsApi, 'seatAvatar')
    .mockResolvedValue(ok({ saved: true }));
  const teacherSave = vi
    .spyOn(participantsApi, 'mutate')
    .mockResolvedValue(ok({}) as Awaited<ReturnType<typeof participantsApi.mutate>>);
  const actions = profileActions();
  await renderProfileActions(actions);
  expect(button('Аватары класса').disabled).toBe(true);
  await click('Заслуги');
  for (const label of [
    'Выбрать next',
    'Обычный аватар',
    'Сохранить аватар',
    'Отозвать доступ: next',
    'Выдать',
  ]) {
    expect(button(label).disabled).toBe(true);
    await click(label);
  }
  expect(
    host.querySelector<HTMLFieldSetElement>('.participant-recognition form fieldset')!.disabled,
  ).toBe(true);
  expect(
    host.querySelector<HTMLInputElement>('input[type="file"]')!.closest('fieldset')!.disabled,
  ).toBe(true);
  expect(button('Выбрать saved').getAttribute('aria-pressed')).toBe('true');
  expect(learnerSave).not.toHaveBeenCalled();
  expect(teacherSave).not.toHaveBeenCalled();

  data.student.status = 'active';
  await renderProfileActions(actions, 'seat-a', 1);
  expect(button('Выбрать next').disabled).toBe(false);
  expect(button('Сохранить аватар').disabled).toBe(false);
  await click('Выбрать next');
  await click('Сохранить аватар');
  expect(teacherSave).toHaveBeenCalledExactlyOnceWith(
    'class',
    'avatar_choose',
    { seatId: 'seat-a', id: 'next' },
    expect.any(String),
  );
  expect(learnerSave).not.toHaveBeenCalled();
});

it.each(['archive', 'suspended', 'pending'] as const)(
  'disables mutation controls for %s',
  async (mode) => {
    mockProfilePage(async () => {
      const data = profile();
      data.student.displayLabel = 'seat-a';
      if (mode === 'suspended') data.student.status = 'suspended';
      return ok(data);
    });
    const actions = profileActions({
      readOnly: mode === 'archive',
      busy: mode === 'pending',
      studentCode: false,
    });
    await renderProfileActions(actions);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Защита: seat-a"]')!.disabled).toBe(
      true,
    );
    expect(button('Настройки ученика: seat-a').disabled).toBe(true);
    expect(button('Карточка доступа').disabled).toBe(true);
    expect(host.textContent).not.toContain('Изменить код');
    if (mode === 'suspended') {
      expect(button('Вернуть доступ').disabled).toBe(false);
      await click('Вернуть доступ');
      expect(actions.onSuspend).toHaveBeenCalledTimes(1);
    } else expect(button('Приостановить доступ').disabled).toBe(true);
  },
);

it.each(['switch', 'logout'] as const)(
  'ignores a pending role mutation after %s',
  async (boundary) => {
    vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
    const read = vi.spyOn(participantsApi, 'profile').mockImplementation(async (_class, seat) => {
      const data = profile();
      data.student.id = seat;
      data.student.displayLabel = seat;
      data.metrics.seatId = seat;
      return ok(data);
    });
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(0, 0)));
    vi.spyOn(participantsApi, 'works').mockResolvedValue(
      ok({
        totalWorks: 0,
        visibleWorks: 0,
        filteredWorks: 0,
        offset: 0,
        hasMore: false,
        items: [],
      }),
    );
    const pending = deferred<Awaited<ReturnType<typeof participantsApi.mutate>>>();
    vi.spyOn(api, 'listClassroomRoster').mockResolvedValue(
      ok({
        items: ['seat-a', 'seat-b'].map((id) => ({
          ...profile().student,
          status: 'active' as const,
          id,
          displayLabel: id,
          studentCode: 'PRIVATE-CODE',
          loginMethod: 'student_code' as const,
          loginHandle: 'PRIVATE-HANDLE',
          createdAt: '',
        })),
      }),
    );
    const mutation = vi.spyOn(participantsApi, 'mutate').mockReturnValueOnce(pending.promise);
    const props = {
      classroomId: 'class',
      classroomTitle: 'Класс',
      seatId: 'seat-a',
      onBack: vi.fn(),
      onOpenProject: vi.fn(),
      navigation: null,
      onNavigateStudent: vi.fn(),
    };
    await act(async () => root.render(createElement(ClassroomStudentPage, props)));
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('[aria-label="Роль в классе"]')!;
      select.value = 'helper';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mutation).toHaveBeenCalledWith(
      'class',
      'role',
      { seatId: 'seat-a', role: 'helper' },
      expect.any(String),
    );
    if (boundary === 'switch')
      await act(async () =>
        root.render(createElement(ClassroomStudentPage, { ...props, seatId: 'seat-b' })),
      );
    else await act(async () => notifySessionLoggedOut());
    const calls = read.mock.calls.length;
    await act(async () =>
      pending.resolve(ok({}) as Awaited<ReturnType<typeof participantsApi.mutate>>),
    );
    expect(read).toHaveBeenCalledTimes(calls);
    if (boundary === 'switch') {
      expect(host.querySelector('.classroom-student-picker-name')?.textContent).toBe('seat-b');
      expect(host.querySelector<HTMLSelectElement>('[aria-label="Роль в классе"]')?.value).toBe(
        'student',
      );
      await click('Выбрать ученика: seat-b');
      const menu = host.querySelector('[role="dialog"][aria-label="Ученики класса"]')!;
      expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(menu.querySelector('[aria-current="page"] > span')?.textContent).toBe('seat-b');
      expect(menu.textContent).not.toContain('PRIVATE');
    } else {
      expect(host.querySelector('[aria-label="Роль в классе"]')).toBeNull();
      expect(host.textContent).toContain('Войдите');
    }
  },
);

it.each(['api error', 'rejection'] as const)(
  'retries the learner roster after an initial %s and caches the successful read',
  async (failure) => {
    vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
    vi.spyOn(participantsApi, 'profile').mockResolvedValue(ok(profile()));
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(page(0, 0)));
    vi.spyOn(participantsApi, 'works').mockResolvedValue(
      ok({
        items: [],
        totalWorks: 0,
        visibleWorks: 0,
        filteredWorks: 0,
        offset: 0,
        hasMore: false,
      }),
    );
    const roster = vi.spyOn(api, 'listClassroomRoster').mockResolvedValue(
      ok({
        items: [
          {
            ...profile().student,
            status: 'active' as const,
            studentCode: 'PRIVATE-CODE',
            loginMethod: 'student_code' as const,
            loginHandle: 'PRIVATE-HANDLE',
            createdAt: '',
          },
        ],
      }),
    );
    if (failure === 'api error') roster.mockResolvedValueOnce(fail());
    else roster.mockRejectedValueOnce(new Error('Network unavailable'));
    await act(async () =>
      root.render(
        createElement(ClassroomStudentPage, {
          classroomId: 'class',
          classroomTitle: 'Класс',
          seatId: 'seat-a',
          onBack: vi.fn(),
          onOpenProject: vi.fn(),
          navigation: null,
          onNavigateStudent: vi.fn(),
        }),
      ),
    );
    const open = `Выбрать ученика: ${profile().student.displayLabel}`;
    await click(open);
    expect(roster).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
    await click('Повторить');
    expect(roster).toHaveBeenCalledTimes(2);
    expect(roster).toHaveBeenLastCalledWith('class');
    const menu = host.querySelector('[role="dialog"]')!;
    expect(menu.querySelector('[role="alert"]')).toBeNull();
    expect(menu.querySelector('[aria-current="page"] > span')?.textContent).toBe(
      profile().student.displayLabel,
    );
    expect(menu.textContent).not.toContain('PRIVATE');
    await click(open);
    await click(open);
    expect(roster).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="dialog"] [aria-current="page"]')).not.toBeNull();
  },
);

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
    .mockResolvedValueOnce(ok({ ...works, offset: 30, hasMore: true }))
    .mockResolvedValueOnce(fail(403))
    .mockResolvedValueOnce(ok({ ...works, hasMore: false }));
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
          previous: { id: 'seat-a', displayLabel: 'Иванов Иван Петрович' },
          next: { id: 'seat-a', displayLabel: 'Петрова Анна Сергеевна' },
        },
      }),
    ),
  );
  expect(host.querySelectorAll('.classroom-student-navrow nav')).toHaveLength(1);
  expect(host.querySelectorAll('.student-pager-name')[0]?.textContent).toBe('Иванов Иван');
  expect(host.querySelectorAll('.student-pager-name')[1]?.textContent).toBe('Петрова Анна');
  expect(
    host
      .querySelector('[aria-label="Предыдущий ученик: Иванов Иван Петрович"]')
      ?.getAttribute('title'),
  ).toBe('Иванов Иван Петрович');
  expect(host.querySelectorAll('.classroom-student-navrow button:disabled')).toHaveLength(2);
  const protection = host.querySelector<HTMLInputElement>(
    `input[type="checkbox"][aria-label="Защита: ${profile().student.displayLabel}"]`,
  );
  expect(protection).not.toBeNull();
  expect(protection!.checked).toBe(false);
  expect(protection!.disabled).toBe(true);
  expect(host.textContent).toContain('39.05');
  const tabs = host.querySelectorAll<HTMLButtonElement>('.participant-tabs button');
  expect(tabs).toHaveLength(9);
  expect(
    Array.from(
      host.querySelectorAll<HTMLSelectElement>('select[aria-label="Раздел профиля"] option'),
    ).map((option) => option.textContent),
  ).toEqual([
    'Все работы',
    'Оценки',
    'Задания',
    '3D',
    'Электроника',
    'Scratch',
    'Заслуги',
    'Активность',
    'Настройки',
  ]);
  tabs[0]!.focus();
  await act(async () =>
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[8]);
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Статус работ"]')!;
    select.value = 'awaiting';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).toContain(
    'Среди загруженных работ нет ожидающих проверки. Загрузите ещё работы.',
  );
  expect(host.textContent).toContain('Часть личных работ закрыта');
  await click('Ещё работы');
  await click('Повторить');
  expect(read.mock.calls.map((args) => args[4])).toEqual([0, 30, 30]);
  await click('Ещё работы');
  expect(host.textContent).not.toContain('Часть личных работ закрыта');
  expect(host.textContent).not.toContain('Ещё работы');
  await click('Повторить');
  expect(read.mock.calls.map((args) => args[4])).toEqual([0, 30, 30, 60, 0]);
  await click('← К классу');
  expect(back).toHaveBeenCalledOnce();

  await act(async () => tabs[8]!.click());
  const settingsCategories = host.querySelectorAll<HTMLButtonElement>(
    '.classroom-student-settings-category',
  );
  expect(settingsCategories).toHaveLength(4);
  expect(host.querySelector('.classroom-student-settings-editor')).toBeNull();
  await act(async () => settingsCategories[1]!.click());
  expect(settingsCategories[1]!.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelectorAll('.classroom-student-settings-editor')).toHaveLength(1);
  expect(host.textContent).toContain('Управление Student Code недоступно.');
  await act(async () => settingsCategories[2]!.click());
  expect(settingsCategories[1]!.getAttribute('aria-expanded')).toBe('false');
  expect(settingsCategories[2]!.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelectorAll('.classroom-student-settings-editor')).toHaveLength(1);
  await act(async () => settingsCategories[2]!.click());
  expect(host.querySelector('.classroom-student-settings-editor')).toBeNull();
});
