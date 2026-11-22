// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api, type Classroom, type GradebookEntry } from '../../api';
import { ClassroomGradebook } from '../../components/ClassroomGradebook';

vi.mock('../../components/AssignLearningActivityDialog', () => ({
  AssignLearningActivityDialog: ({
    onAssigned,
  }: {
    onAssigned: (title: string, count: number, wholeClass: boolean) => void;
  }) =>
    createElement(
      'div',
      { role: 'dialog' },
      createElement(
        'button',
        {
          onClick: () => onAssigned('Первая работа', 12, true),
        },
        'Подтвердить выдачу',
      ),
    ),
}));

it('shows only waiting work in the review queue and restores the full gradebook', async () => {
  const teacher = vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, account: { id: 'teacher-1' } },
  } as Awaited<ReturnType<typeof api.me>>);
  const preferenceKey = 'asa-journal-columns:v1:teacher-1:class-1';
  const otherTeacherKey = 'asa-journal-columns:v1:teacher-2:class-1';
  localStorage.setItem(preferenceKey, JSON.stringify(['Готово']));
  localStorage.setItem(otherTeacherKey, JSON.stringify(['На проверку']));
  const entry = (id: string, state: GradebookEntry['state']): GradebookEntry => ({
    seatId: 'learner',
    displayLabel: 'Анна',
    assignmentId: id,
    assignmentTitle: id,
    state,
    attemptId: null,
    attemptNumber: null,
    submittedAt: null,
    points: null,
    maxPoints: null,
    percentage: null,
    displayGrade: null,
    outcome: null,
    feedback: null,
    publishedAt: null,
    canonicalState: null,
    compatibilityDiagnostic: null,
  });
  const gradebook = vi.spyOn(api, 'classroomGradebook').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      scheme: null,
      items: [entry('На проверку', 'submitted'), entry('Готово', 'completed')],
    },
  });
  const classroom = vi.spyOn(api, 'getClassroom').mockResolvedValue({
    ok: true,
    status: 200,
    data: { classroom: { status: 'archived' } as Classroom },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  const hash = window.location.hash;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '#/classrooms/class-1?assignment=pending';
  try {
    await act(async () =>
      root.render(createElement(ClassroomGradebook, { classroomId: 'class-1' })),
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((element) => element.textContent === label)!;
    expect(button('Выдать задание')).toBeUndefined();
    expect(host.querySelector('table')?.textContent).not.toContain('Готово');
    expect(host.querySelector('table')?.textContent).toContain('На проверку');
    await act(async () => button('Ждут проверки: 1').click());
    expect(host.querySelector('table')).toBeNull();
    const queue = host.querySelector('[aria-label="Работы на проверку"]');
    expect(queue?.textContent).toContain('На проверку');
    expect(queue?.textContent).not.toContain('Готово');
    expect(queue?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Проверить: На проверку · Анна',
    );
    await act(async () => button('К таблице оценок').click());
    await act(async () => button('Показать все столбцы').click());
    expect(host.querySelector('table')?.textContent).toContain('Готово');
    expect(localStorage.getItem(preferenceKey)).toBeNull();
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="Показывать столбец: Готово"]')!.click(),
    );
    expect(localStorage.getItem(preferenceKey)).toBe(JSON.stringify(['Готово']));
    expect(localStorage.getItem(otherTeacherKey)).toBe(JSON.stringify(['На проверку']));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.location.hash = hash;
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
    gradebook.mockRestore();
    classroom.mockRestore();
    teacher.mockRestore();
    localStorage.removeItem(preferenceKey);
    localStorage.removeItem(otherTeacherKey);
  }
});

it('issues a first assignment from an empty gradebook and reloads after confirmation', async () => {
  const teacher = vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: false },
  });
  const classroom = vi.spyOn(api, 'getClassroom').mockResolvedValue({
    ok: true,
    status: 200,
    data: { classroom: { status: 'active' } as Classroom },
  });
  const gradebook = vi.spyOn(api, 'classroomGradebook').mockResolvedValue({
    ok: true,
    status: 200,
    data: { scheme: null, items: [] },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  const hash = window.location.hash;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '#/classrooms/class-1?assignment=pending';
  try {
    await act(async () =>
      root.render(createElement(ClassroomGradebook, { classroomId: 'class-1' })),
    );
    expect(gradebook).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Здесь появятся работы и оценки.');
    const issue = [...host.querySelectorAll('button')].find(
      (element) => element.textContent === 'Выдать задание',
    );
    expect(issue).toBeDefined();
    await act(async () => issue!.click());
    const confirmation = document.body.querySelector<HTMLButtonElement>('[role="dialog"] button');
    expect(confirmation?.textContent).toBe('Подтвердить выдачу');
    await act(async () => confirmation!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('Первая работа');
    expect(gradebook).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.location.hash = hash;
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
    gradebook.mockRestore();
    classroom.mockRestore();
    teacher.mockRestore();
  }
});
