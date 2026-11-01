// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type ApiResult, type CourseUsageRun } from '../../api';
import { CourseUsage } from '../../components/CourseUsage';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
async function mount(courseId = 'course-a', onNavigate = vi.fn()) {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(container);
  await act(async () =>
    root!.render(createElement(CourseUsage, { courseId, onNavigate, onClose: vi.fn() })),
  );
  return onNavigate;
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

it('shows loading, error, retry and an honest empty state', async () => {
  let finish!: (result: ApiResult<{ items: CourseUsageRun[] }>) => void;
  const read = vi
    .spyOn(api, 'courseUsage')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
  await mount();
  expect(container!.textContent).toContain('Загружаем использование');
  await act(async () =>
    finish({ ok: false, status: 403, error: { code: 'forbidden', message: 'Доступ отозван' } }),
  );
  expect(container!.querySelector('[role=alert]')?.textContent).toContain('Доступ отозван');
  await act(async () =>
    [...container!.querySelectorAll('button')]
      .find((button) => button.textContent === 'Повторить загрузку')!
      .click(),
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(container!.textContent).toContain('В доступных вам классах курс пока не используется');
});

it('uses exact run navigation and does not invent historical audience or completion', async () => {
  vi.spyOn(api, 'courseUsage').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'run-a',
          classroomId: 'class-a',
          classroomTitle: 'Long class name',
          classroomStatus: 'archived',
          courseVersionId: 'version-a',
          versionNumber: 3,
          title: 'Pinned course',
          status: 'closed',
          audienceType: null,
        },
      ],
    },
  });
  const navigate = await mount();
  expect(container!.textContent).toContain('Версия 3');
  expect(container!.textContent).toContain('Класс в архиве');
  expect(container!.textContent).toContain('Аудитория не указана');
  const link = container!.querySelector('a')!;
  expect(link.getAttribute('href')).toBe('#/classrooms/class-a?courseRun=run-a');
  await act(async () => link.click());
  expect(navigate).toHaveBeenCalledWith('#/classrooms/class-a?courseRun=run-a');
});

it('ignores stale responses after the selected course changes', async () => {
  let finish!: (result: ApiResult<{ items: CourseUsageRun[] }>) => void;
  vi.spyOn(api, 'courseUsage')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
  await mount('old-course');
  await mount('new-course');
  await act(async () =>
    finish({ ok: false, status: 403, error: { code: 'forbidden', message: 'Old course error' } }),
  );
  expect(container!.textContent).not.toContain('Old course error');
  expect(container!.textContent).toContain('курс пока не используется');
});
