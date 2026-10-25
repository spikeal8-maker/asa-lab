import { adminApi, type ClassBindings } from '../admin-api';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CrmResponsibilities } from '../CrmResponsibilities';
import { responsibilitiesApi, type Responsibility } from '../crm-responsibilities-api';
let host: HTMLDivElement, root: Root;
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
const view = (targetId = 'target', onDenied = vi.fn()) =>
  createElement(CrmResponsibilities, {
    scopeKind: 'organization',
    scopeId: 'organization',
    targetId,
    onDenied,
  });
const record: Responsibility = {
  kind: 'organization',
  scopeId: 'organization',
  targetId: 'target',
  role: 'member',
  state: 'active',
  version: 'a'.repeat(64),
  allowedRoles: ['member', 'educator'],
};
async function load() {
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'Загрузить доступ')!
      .click();
  });
}
it('loads only on explicit request and requires reason before role mutation', async () => {
  const read = vi
    .spyOn(responsibilitiesApi, 'read')
    .mockResolvedValue({ ok: true, status: 200, data: record });
  await act(async () => root.render(view()));
  expect(read).not.toHaveBeenCalled();
  await load();
  expect(read).toHaveBeenCalledWith('organization', 'organization', 'target');
  expect(host.querySelectorAll('select option')).toHaveLength(2);
  expect(
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Назначить')!
      .disabled,
  ).toBe(true);
});
it('discards a delayed result when target changes', async () => {
  let finish!: (value: { ok: true; status: number; data: Responsibility }) => void;
  vi.spyOn(responsibilitiesApi, 'read').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(view()));
  await load();
  await act(async () => root.render(view('other')));
  await act(async () => finish({ ok: true, status: 200, data: record }));
  expect(host.textContent).not.toContain('Текущая роль');
});
it('clears authorization on denial without exposing old membership data', async () => {
  const denied = vi.fn();
  const read = vi
    .spyOn(responsibilitiesApi, 'read')
    .mockResolvedValueOnce({ ok: true, status: 200, data: record });
  await act(async () => root.render(view('target', denied)));
  await load();
  read.mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'crm_forbidden', message: 'Denied' },
  });
  await load();
  expect(denied).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Текущая роль');
});
const platformView = () =>
  createElement(CrmResponsibilities, {
    scopeKind: 'platform',
    scopeId: null,
    targetId: 'target',
    onDenied: vi.fn(),
  });
async function searchName(value: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'Найти по названию')!
      .click();
  });
}
async function select(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it.each(['organization', 'classroom'] as const)(
  'finds a named %s beyond the first 100 and loads only the selected exact resource',
  async (kind) => {
    const bindings = vi
      .spyOn(adminApi, 'classBindings')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          classes: Array.from({ length: 100 }, (_, n) => ({
            id: `c${n}`,
            title: `Класс ${n}`,
            workspaceId: null,
          })),
          organizations: Array.from({ length: 100 }, (_, n) => ({
            id: `o${n}`,
            title: `Организация ${n}`,
          })),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          classes: [{ id: 'class-153', title: 'Северный класс', workspaceId: null }],
          organizations: [{ id: 'org-153', title: 'Северная школа' }],
        },
      });
    const read = vi
      .spyOn(responsibilitiesApi, 'read')
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { ...record, kind, scopeId: kind === 'organization' ? 'org-153' : 'class-153' },
      });
    await act(async () => root.render(platformView()));
    if (kind === 'classroom') await select(host.querySelector('select')!, 'classroom');
    await searchName('');
    expect(host.textContent).toContain('Показаны первые 100 результатов');
    await searchName('Север');
    expect(bindings).toHaveBeenLastCalledWith('Север');
    expect(host.textContent).not.toContain('Код области');
    const chooser = host.querySelectorAll('select')[1]!;
    const chosen = kind === 'organization' ? 'org-153' : 'class-153';
    await select(chooser, chosen);
    await load();
    expect(read).toHaveBeenCalledWith(kind, chosen, 'target');
  },
);
it('discards stale search results after scope change and explains empty results', async () => {
  let finish!: (value: { ok: true; status: number; data: ClassBindings }) => void;
  vi.spyOn(adminApi, 'classBindings')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ok: true, status: 200, data: { classes: [], organizations: [] } });
  await act(async () => root.render(platformView()));
  await searchName('Старая школа');
  expect(host.textContent).toContain('Поиск областей');
  await select(host.querySelector('select')!, 'classroom');
  await act(async () =>
    finish({
      ok: true,
      status: 200,
      data: {
        classes: [{ id: 'stale', title: 'Устаревший класс', workspaceId: null }],
        organizations: [],
      },
    }),
  );
  expect(host.textContent).not.toContain('Устаревший класс');
  await searchName('Несуществующий класс');
  expect(host.textContent).toContain('Ничего не найдено');
  expect(
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Загрузить доступ')!
      .disabled,
  ).toBe(true);
});
