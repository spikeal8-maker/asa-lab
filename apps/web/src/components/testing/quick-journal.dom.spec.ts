// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { journalApi, type JournalGrade, type JournalSnapshot } from '../../classroom-journal-api';
import { ManualClassroomJournal } from '../ManualClassroomJournal';

const empty: JournalSnapshot = {
  status: 'active',
  timeZone: 'Europe/Moscow',
  scale: { preset: 'five', version: 0 },
  range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-11', timeZone: 'Europe/Moscow' },
  offset: 0,
  nextOffset: null,
  students: [{ id: 'seat', name: '1Иван', status: 'active' }],
  columns: [],
  grades: [],
};
const column = {
  id: 'column',
  date: '2026-10-11',
  category: 'Работа 1',
  slotKey: '2026-10:1',
  preset: 'five' as const,
  scaleVersion: 1,
  headerRevision: 0,
};
const grade: JournalGrade = {
  id: 'grade',
  columnId: column.id,
  seatId: 'seat',
  value: 0,
  revision: 1,
  reason: null,
  supersedesId: null,
  authorId: 'teacher',
  authorName: 'Teacher',
  publishedAt: '2026-10-11T10:00:00Z',
};
const confirmed: JournalSnapshot = {
  ...empty,
  scale: { preset: 'five', version: 1 },
  columns: [column],
  grades: [grade],
};
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root, container: HTMLDivElement;
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});
async function mount() {
  window.location.hash = '#/classrooms';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(ManualClassroomJournal, { classroomId: 'class' })),
  );
}
function button(text: string, scope: ParentNode = container) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function cell() {
  return container.querySelector<HTMLButtonElement>('tbody td button')!;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function focusRead() {
  await act(async () => window.dispatchEvent(new Event('focus')));
}
async function reason(value: string) {
  const input = container.querySelector<HTMLInputElement>('.manual-journal-editor input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const lost = {
  ok: false as const,
  status: 0,
  error: { code: 'network', message: 'сервер недоступен' },
};
describe('quick journal DOM regressions', () => {
  it('renders ten slots on pure GET, enters inline and returns keyboard focus', async () => {
    vi.spyOn(journalApi, 'read').mockResolvedValue({ ok: true, status: 200, data: empty });
    const quick = vi.spyOn(journalApi, 'quick');
    await mount();
    expect(container.querySelectorAll('thead th')).toHaveLength(11);
    expect(quick).not.toHaveBeenCalled();
    const first = cell();
    await click(first);
    const zero = button('0', container.querySelector('.manual-journal-editor')!);
    expect(document.activeElement).toBe(zero);
    await act(async () =>
      zero.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(document.activeElement).toBe(
      button('1', container.querySelector('.manual-journal-editor')!),
    );
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(first);
    expect(quick).not.toHaveBeenCalled();
  });
  it('replays first zero exactly after lost commit, focus GET and slot remapping, without a new reason', async () => {
    let snapshot = empty;
    vi.spyOn(journalApi, 'read').mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: snapshot,
    }));
    const legacy = vi.spyOn(journalApi, 'grade');
    const quick = vi
      .spyOn(journalApi, 'quick')
      .mockImplementationOnce(async () => {
        snapshot = confirmed;
        return lost;
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { column, grade, scale: confirmed.scale },
      });
    await mount();
    await click(cell());
    await click(button('0', container.querySelector('.manual-journal-editor')!));
    const original = structuredClone(quick.mock.calls[0][1]);
    expect(cell().textContent).toBe('—');
    await focusRead();
    expect(cell().textContent).toBe('0');
    expect(container.querySelector('.manual-journal-editor input')).toBeNull();
    await click(button('Повторить сохранение'));
    expect(quick.mock.calls[1][1]).toEqual(original);
    expect(original).toMatchObject({
      slotKey: '2026-10:1',
      value: 0,
      expectedRevision: 0,
      expectedHeaderRevision: 0,
      reason: null,
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(container.querySelector('.manual-journal-editor')).toBeNull();
    expect(container.querySelectorAll('thead th')).toHaveLength(11);
  });
  it('keeps the exact correction reason and versions after lost response and fresh grade', async () => {
    let snapshot = confirmed;
    const corrected = {
      ...grade,
      id: 'corrected',
      value: 5,
      revision: 2,
      reason: 'Original reason',
      supersedesId: grade.id,
    };
    vi.spyOn(journalApi, 'read').mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: snapshot,
    }));
    const quick = vi
      .spyOn(journalApi, 'quick')
      .mockImplementationOnce(async () => {
        snapshot = { ...confirmed, grades: [corrected] };
        return lost;
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { column, grade: corrected, scale: confirmed.scale },
      });
    await mount();
    await click(cell());
    await reason('Original reason');
    await click(button('5', container.querySelector('.manual-journal-editor')!));
    const original = structuredClone(quick.mock.calls[0][1]);
    await focusRead();
    expect(cell().textContent).toBe('5');
    await click(button('Повторить сохранение'));
    expect(quick.mock.calls[1][1]).toEqual(original);
    expect(original).toMatchObject({
      columnId: column.id,
      reason: 'Original reason',
      expectedRevision: 1,
      expectedHeaderRevision: 0,
    });
  });
  it('guards persisted columns, treats 409 as definite and refreshes moved metadata without losing the reason', async () => {
    let snapshot = confirmed;
    const read = vi
      .spyOn(journalApi, 'read')
      .mockImplementation(async () => ({ ok: true, status: 200, data: snapshot }));
    const moved = { ...column, date: '2026-09-30', category: 'Other teacher', headerRevision: 1 };
    const quick = vi
      .spyOn(journalApi, 'quick')
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { code: 'revision_conflict', message: 'Уже изменились' },
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { column: moved, grade: { ...grade, value: 5, revision: 2 }, scale: confirmed.scale },
      });
    await mount();
    await click(cell());
    await reason('Keep draft');
    await click(button('5', container.querySelector('.manual-journal-editor')!));
    expect(quick.mock.calls[0][1]).toMatchObject({
      columnId: column.id,
      date: column.date,
      category: column.category,
      expectedHeaderRevision: 0,
    });
    expect(container.textContent).not.toContain('Повторить сохранение');
    snapshot = { ...confirmed, columns: [moved] };
    await click(button('Обновить журнал', container.querySelector('.manual-journal-editor')!));
    expect(read.mock.calls.at(-1)?.[1]).toMatchObject({ columnId: column.id });
    expect(container.querySelector<HTMLInputElement>('.manual-journal-editor input')?.value).toBe(
      'Keep draft',
    );
    expect(container.querySelector('.manual-journal-editor header')?.textContent).toContain(
      '2026-09-30',
    );
    await click(button('5', container.querySelector('.manual-journal-editor')!));
    expect(quick.mock.calls[1][1]).toMatchObject({
      columnId: column.id,
      date: moved.date,
      category: moved.category,
      expectedHeaderRevision: 1,
      reason: 'Keep draft',
    });
    expect(quick.mock.calls[1][1].requestId).not.toBe(quick.mock.calls[0][1].requestId);
  });
});
