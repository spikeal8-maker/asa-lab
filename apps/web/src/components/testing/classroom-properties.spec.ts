// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Classroom } from '../../api';
import { ClassroomPropertiesModal } from '../ClassroomPropertiesModal';

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const classroom: Classroom = {
  id: 'class-1',
  title: 'Исходное название',
  status: 'active',
  ageBand: 'mixed',
  topicKeys: [],
  safeModeDefault: true,
  studentCount: 2,
  joinCode: 'ABC DEF 234',
  joinCodeVersion: 1,
  joinCodeStatus: 'active',
  teacherRole: 'owner',
  workspaceKind: 'personal',
  workspaceTitle: 'Личное пространство',
  createdAt: '2026-10-09T00:00:00.000Z',
  archivedAt: null,
};
let root: Root;
let container: HTMLDivElement;
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
describe('classroom property saves', () => {
  it.each(['refusal', 'throw'] as const)(
    'keeps the draft, restores busy and retries after %s',
    async (failure) => {
      const onSaved = vi.fn();
      const serverClassroom = { ...classroom, title: 'Название, подтверждённое сервером' };
      const update = vi.spyOn(api, 'updateClassroom');
      if (failure === 'refusal')
        update.mockResolvedValueOnce({
          ok: false,
          status: 503,
          error: { code: 'unavailable', message: 'Настройки не сохранены.' },
        });
      else update.mockRejectedValueOnce(new Error('transport unavailable'));
      update.mockResolvedValueOnce({ ok: true, status: 200, data: { classroom: serverClassroom } });
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
      await act(async () =>
        root.render(
          createElement(ClassroomPropertiesModal, { classroom, onSaved, onClose: vi.fn() }),
        ),
      );
      const title = container.querySelector<HTMLInputElement>('#classroom-properties-title')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          title,
          'Черновик названия',
        );
        title.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      await act(async () => submit.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
        /не сохранены|Не удалось сохранить/,
      );
      expect(submit.disabled).toBe(false);
      expect(title.disabled).toBe(false);
      expect(title.value).toBe('Черновик названия');
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => submit.click());
      expect(onSaved).toHaveBeenCalledExactlyOnceWith(serverClassroom);
      expect(update).toHaveBeenLastCalledWith(classroom.id, {
        title: 'Черновик названия',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(submit.disabled).toBe(false);
    },
  );
});
