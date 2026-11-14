// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api, type GradebookEntry } from '../../api';
import { ClassroomGradebook } from '../../components/ClassroomGradebook';

it('shows only waiting work in the review queue and restores the full gradebook', async () => {
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
    expect(host.querySelector('table')?.textContent).toContain('Готово');
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="Показывать столбец: Готово"]')!.click(),
    );
    expect(host.querySelector('table')?.textContent).not.toContain('Готово');
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
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.location.hash = hash;
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
    gradebook.mockRestore();
  }
});
