// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CourseAssignDialog, type CourseAssignAttempt } from '../../components/CourseAssignDialog';

it('retries the same published course version for the selected pupils', async () => {
  const classrooms = vi.spyOn(api, 'listClassrooms').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [], meta: { total: 0 } },
  });
  const roster = vi.spyOn(api, 'listClassroomRoster').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        { id: 'first', displayLabel: 'Анна', status: 'active' },
        { id: 'second', displayLabel: 'Борис', status: 'issued' },
      ],
    },
  } as Awaited<ReturnType<typeof api.listClassroomRoster>>);
  const assign = vi
    .spyOn(api, 'assignCourseToClassroom')
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Повторите' },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { runId: 'run-1', versionNumber: 2, reused: true },
    });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const attempt: CourseAssignAttempt = {
    classroomId: 'class-1',
    dueDate: '2027-04-01',
    audienceType: 'named_learners',
  };
  try {
    await act(async () => {
      root.render(
        createElement(CourseAssignDialog, {
          courseId: 'course',
          version: { id: 'version', versionNumber: 2 },
          attempt,
          onClose: vi.fn(),
          onBusyChange: vi.fn(),
        }),
      );
    });
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((element) => element.textContent === label)!;
    expect(roster).toHaveBeenCalledWith('class-1');
    expect(button('Назначить').disabled).toBe(true);
    const pupil = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => pupil.click());
    const time = host.querySelector<HTMLInputElement>('input[type="time"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        time,
        '16:30',
      );
      time.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => button('Назначить').click());
    await act(async () => button('Повторить назначение').click());
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign.mock.calls[0]).toEqual(assign.mock.calls[1]);
    expect(assign.mock.calls[0]?.[2]).toBe(new Date('2027-04-01T16:30').toISOString());
    expect(assign.mock.calls[0]?.[3]).toMatchObject({
      audienceType: 'named_learners',
      seatIds: ['first'],
      versionNumber: 2,
    });
    expect(attempt.completed?.runId).toBe('run-1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
    classrooms.mockRestore();
    roster.mockRestore();
    assign.mockRestore();
  }
});
