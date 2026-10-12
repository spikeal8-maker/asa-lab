// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomJoinRequests } from '../ClassroomJoinRequests';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { classroomJoinRequests: vi.fn(), decideClassroomJoin: vi.fn() },
}));
vi.mock('../../learning/use-learning-destination', () => ({
  useLearningDestination: () => ({ joinRequest: null }),
}));
const item = {
  id: 'request-1',
  classroom_id: 'class-1',
  classroom_title: 'Класс',
  display_label: 'Участник',
  status: 'pending' as const,
  reason: null,
};
let host: HTMLDivElement, root: Root;
const ready = () => ({ ok: true as const, data: { items: [item] }, status: 200 });
async function mount(classroomId = 'class-1') {
  await act(async () => {
    root.render(createElement(ClassroomJoinRequests, { classroomId, expanded: true }));
  });
}
async function enter(text: string) {
  const input = host.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => {
    button.click();
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.classroomJoinRequests).mockResolvedValue(ready());
  vi.mocked(api.decideClassroomJoin).mockResolvedValue({
    ok: true,
    status: 200,
    data: { ok: true },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
describe('classroom request replies', () => {
  it('has an open list and sends the optional reply with the existing decision', async () => {
    await mount();
    expect(host.querySelector('details')).toBeNull();
    await enter('  Начнём на следующем занятии.  ');
    await click('Принять заявку');
    expect(api.decideClassroomJoin).toHaveBeenCalledExactlyOnceWith(
      'class-1',
      'request-1',
      'approved',
      'Начнём на следующем занятии.',
    );
  });
  it('keeps the reply after a network refusal and allows an explicit retry', async () => {
    vi.mocked(api.decideClassroomJoin).mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Сервер недоступен' },
    });
    await mount();
    await enter('Проверьте класс.');
    await click('Отклонить');
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Проверьте класс.');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Сервер недоступен');
    await click('Отклонить');
    expect(api.decideClassroomJoin).toHaveBeenCalledTimes(2);
    expect(api.decideClassroomJoin).toHaveBeenLastCalledWith(
      'class-1',
      'request-1',
      'rejected',
      'Проверьте класс.',
    );
  });
  it('clears a draft and old rows when switching classroom', async () => {
    await mount();
    await enter('Личное сообщение');
    vi.mocked(api.classroomJoinRequests).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    await mount('class-2');
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).not.toContain('Личное сообщение');
  });
  it('does not retain private request data after access revocation', async () => {
    await mount();
    await enter('Ответ');
    vi.mocked(api.classroomJoinRequests).mockResolvedValue({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'Нет доступа' },
    });
    await click('Обновить заявки');
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).not.toContain('Участник');
  });
});
