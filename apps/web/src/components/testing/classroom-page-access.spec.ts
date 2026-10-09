// @vitest-environment jsdom
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Classroom, type ClassroomStudentSeat } from '../../api';
import { ClassroomPage } from '../../pages/ClassroomPage';

vi.mock('../ClassJoinQr', () => ({ ClassJoinQr: () => null }));
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const classroomA: Classroom = {
  id: 'class-A',
  title: 'Закрытые данные класса A',
  status: 'active',
  ageBand: 'mixed',
  topicKeys: [],
  safeModeDefault: false,
  studentCount: 3,
  joinCode: 'ABC DEF 234',
  joinCodeVersion: 1,
  joinCodeStatus: 'active',
  teacherRole: 'owner',
  workspaceKind: 'personal',
  workspaceTitle: 'Личное пространство',
  createdAt: '2026-10-09T00:00:00.000Z',
  archivedAt: null,
};
const classroomB = {
  ...classroomA,
  id: 'class-B',
  title: 'Другой класс B',
  joinCode: 'QRT UVW 678',
};
const codeSeat: ClassroomStudentSeat = {
  id: 'seat-A',
  displayLabel: 'Ученик класса A',
  loginMethod: 'student_code',
  studentCode: 'Ab7kQ2',
  loginHandle: 'Ab7kQ2',
  safeMode: true,
  status: 'active',
  avatarKey: null,
  lastActiveAt: null,
  createdAt: classroomA.createdAt,
  assignedCount: 4,
  submittedCount: 2,
  awaitingReview: 1,
};
const otherSeat = {
  ...codeSeat,
  id: 'other-seat',
  displayLabel: 'Другой ученик',
  studentCode: 'Other7',
  loginHandle: 'Other7',
};
const accountSeat: ClassroomStudentSeat = {
  ...codeSeat,
  id: 'account-seat',
  displayLabel: 'Участник через аккаунт',
  loginMethod: 'account',
  studentCode: null,
  loginHandle: null,
};
const seatB = {
  ...codeSeat,
  id: 'seat-B',
  displayLabel: 'Ученик класса B',
  studentCode: 'Bcode9',
  loginHandle: 'Bcode9',
};
const refusal = {
  ok: false as const,
  status: 503,
  error: { code: 'temporary_unavailable', message: 'Данные недоступны.' },
};
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
beforeEach(() => {
  vi.spyOn(api, 'getClassroom').mockImplementation(async (id) =>
    ok({ classroom: id === classroomA.id ? classroomA : classroomB }),
  );
  vi.spyOn(api, 'listClassroomRoster').mockImplementation(async (id) =>
    ok({ items: id === classroomA.id ? [codeSeat, otherSeat, accountSeat] : [seatB] }),
  );
  vi.spyOn(api, 'classroomAwards').mockResolvedValue(ok({ items: {} }));
  vi.spyOn(api, 'classroomProgress').mockResolvedValue(refusal);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.classList.remove('student-access-printing');
});
function render(id: string) {
  root.render(
    createElement(ClassroomPage, {
      classroomId: id,
      onBack: vi.fn(),
      onOpenProjects: vi.fn(),
      onOpenProject: vi.fn(),
    }),
  );
}
function button(name: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name,
  );
  expect(found, `button ${name}`).toBeDefined();
  return found!;
}

describe('classroom route and credential state ownership', () => {
  it('disposes A data and credential dialogs before B loads, refuses B without A controls, and retries B', async () => {
    const policy = vi.spyOn(api, 'updateClassroomPolicy');
    await act(async () => render(classroomA.id));
    await act(async () => button('Карточки доступа').click());
    expect(document.querySelector('.student-access-dialog')?.textContent).toContain(
      codeSeat.studentCode,
    );
    const next = deferred<Awaited<ReturnType<typeof api.listClassroomRoster>>>();
    vi.mocked(api.listClassroomRoster).mockReturnValueOnce(next.promise);
    await act(async () => {
      flushSync(() => render(classroomB.id));
      expect(document.body.textContent).not.toContain(classroomA.title);
      expect(document.body.textContent).not.toContain(classroomA.joinCode);
      expect(document.body.textContent).not.toContain(codeSeat.studentCode);
      expect(document.querySelector('.student-access-dialog')).toBeNull();
    });
    await act(async () => next.resolve(refusal));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось открыть класс',
    );
    expect(container.querySelector('.classroom-head')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(policy).not.toHaveBeenCalled();
    await act(async () => button('Повторить').click());
    expect(container.querySelector('.classroom-head')?.textContent).toContain(classroomB.title);
    expect(container.textContent).toContain(seatB.studentCode);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).not.toContain(codeSeat.studentCode);
    expect(api.listClassroomRoster).toHaveBeenLastCalledWith(classroomB.id);
  });

  it.each(['success', 'failure'] as const)(
    'ignores a late A %s after B, including after the current page is unmounted',
    async (outcome) => {
      const oldClass = deferred<Awaited<ReturnType<typeof api.getClassroom>>>();
      const oldRoster = deferred<Awaited<ReturnType<typeof api.listClassroomRoster>>>();
      vi.mocked(api.getClassroom).mockReturnValueOnce(oldClass.promise);
      vi.mocked(api.listClassroomRoster).mockReturnValueOnce(oldRoster.promise);
      await act(async () => render(classroomA.id));
      await act(async () => render(classroomB.id));
      expect(container.textContent).toContain(classroomB.title);
      await act(async () => {
        oldClass.resolve(ok({ classroom: classroomA }));
        oldRoster.resolve(outcome === 'success' ? ok({ items: [codeSeat] }) : refusal);
      });
      expect(container.textContent).toContain(classroomB.title);
      expect(container.textContent).not.toContain(classroomA.title);
      expect(container.textContent).not.toContain(codeSeat.studentCode);
      const last = deferred<Awaited<ReturnType<typeof api.listClassroomRoster>>>();
      vi.mocked(api.listClassroomRoster).mockReturnValueOnce(last.promise);
      await act(async () => render(classroomA.id));
      await act(async () => root.render(null));
      await act(async () => last.resolve(ok({ items: [codeSeat] })));
      expect(container.textContent).toBe('');
      expect(document.querySelector('.student-access-dialog')).toBeNull();
    },
  );

  it('projects a confirmed new code into only its Seat before a failed reload, and copies/prints that code', async () => {
    const copy = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const change = vi
      .spyOn(api, 'setStudentCode')
      .mockResolvedValue(ok({ studentCode: 'New7Ab', version: 2, reused: false }));
    await act(async () => render(classroomA.id));
    const row = [...container.querySelectorAll('.classroom-roster-row')].find((node) =>
      node.textContent?.includes(codeSeat.displayLabel),
    )!;
    await act(async () => button('Изменить код ученика', row).click());
    vi.mocked(api.listClassroomRoster).mockResolvedValueOnce(refusal);
    await act(async () => button('Сгенерировать новый').click());
    expect(change).toHaveBeenCalledExactlyOnceWith(classroomA.id, codeSeat.id, {
      requestId: expect.any(String),
    });
    expect(document.querySelector('.student-code-dialog')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось обновить данные класса',
    );
    expect(container.textContent).not.toContain('Не удалось получить подтверждение смены кода');
    expect(row.querySelector('.classroom-login-handle')?.textContent).toBe('New7Ab');
    expect(row.querySelector('.classroom-roster-progress')?.textContent).toContain('2 из 4');
    expect(container.textContent).toContain(otherSeat.studentCode);
    expect(container.textContent).toContain('Вход через аккаунт');
    await act(async () =>
      (row.querySelector('.classroom-login-handle') as HTMLButtonElement).click(),
    );
    expect(copy).toHaveBeenCalledExactlyOnceWith('New7Ab');
    await act(async () => button('Карточки доступа').click());
    const cards = document.querySelector('.student-access-dialog')!;
    expect(cards.textContent).toContain('New7Ab');
    expect(cards.textContent).toContain(otherSeat.studentCode);
    expect(cards.textContent).not.toContain(codeSeat.studentCode);
    expect(cards.querySelector('.is-account-entry code')).toBeNull();
    const printButton = [...cards.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
      node.textContent?.startsWith('Распечатать'),
    )!;
    await act(async () => printButton.click());
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('student-access-printing')).toBe(true);
    expect(cards.querySelector('.student-access-print-sheet')?.textContent).not.toContain(
      codeSeat.studentCode,
    );
  });
});
