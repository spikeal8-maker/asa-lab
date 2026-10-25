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
