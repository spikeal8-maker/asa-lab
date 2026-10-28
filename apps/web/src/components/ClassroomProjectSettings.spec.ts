// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomProjectSettings } from './ClassroomProjectSettings';
import { call } from '../api-call';
vi.mock('../api-call', () => ({ call: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
const defaults = {
  ok: true as const,
  status: 200,
  data: { publish: false, download: false, version: 0 },
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(classroomId = 'class-a', seatId?: string) {
  await act(async () => {
    root.render(
      createElement(ClassroomProjectSettings, {
        classroomId,
        ...(seatId === undefined ? {} : { seatId }),
      }),
    );
  });
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
describe('Classroom project permissions', () => {
  it('renders default OFF, independent switches, pending save and recoverable conflict', async () => {
    vi.mocked(call).mockResolvedValueOnce(defaults);
    await render();
    const inputs = host.querySelectorAll('input');
    expect([...inputs].every((input) => !input.checked)).toBe(true);
    await click(inputs[0]!);
    let resolve!: (value: unknown) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done as typeof resolve;
        }),
    );
    await click(
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Сохранить разрешения',
      )!,
    );
    expect([...inputs].every((input) => input.disabled)).toBe(true);
    expect(call).toHaveBeenLastCalledWith(expect.stringContaining('class-a/policy'), {
      method: 'PUT',
      body: JSON.stringify({ publish: true, download: false, expectedVersion: 0 }),
    });
    await act(async () => {
      resolve({ ok: false, status: 409, error: { code: 'version_conflict', message: 'conflict' } });
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Настройки уже изменились');
    vi.mocked(call).mockResolvedValueOnce({
      ...defaults,
      data: { publish: false, download: true, version: 1 },
    });
    await click(
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Обновить разрешения',
      )!,
    );
    expect(host.querySelectorAll('input')[1]!.checked).toBe(true);
  });
  it('does not adopt an old class response after switching context', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done as typeof resolve;
        }),
    );
    await render('old-class');
    vi.mocked(call).mockResolvedValueOnce(defaults);
    await render('new-class');
    await act(async () => {
      resolve({ ...defaults, data: { publish: true, download: true, version: 9 } });
    });
    expect([...host.querySelectorAll('input')].every((input) => !input.checked)).toBe(true);
  });
  it('keeps two independent per-Seat inherit/allow/deny controls', async () => {
    vi.mocked(call).mockResolvedValueOnce({
      ...defaults,
      data: { ...defaults.data, publishOverride: 'inherit', downloadOverride: 'inherit' },
    });
    await render('class-a', 'seat-a');
    const selects = host.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    await act(async () => {
      selects[0]!.value = 'allow';
      selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      selects[1]!.value = 'deny';
      selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    vi.mocked(call).mockResolvedValueOnce({
      ...defaults,
      data: { ...defaults.data, version: 1, publishOverride: 'allow', downloadOverride: 'deny' },
    });
    await click(
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Сохранить разрешения',
      )!,
    );
    expect(call).toHaveBeenLastCalledWith(expect.stringContaining('class-a/seats/seat-a'), {
      method: 'PUT',
      body: JSON.stringify({
        publishOverride: 'allow',
        downloadOverride: 'deny',
        expectedVersion: 0,
      }),
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Разрешения проектов сохранены.',
    );
  });
});
