// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationOwnerActions } from './PublicationOwnerActions';
import { publicProjectsApi } from './api';
import { api, type Project } from '../api';
vi.mock('../components/ProjectProperties', () => ({
  ProjectProperties: ({ project }: { project: Project }) =>
    createElement('div', { 'data-private-project': project.id }, project.title),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const editor = { projectId: 'original', moduleKey: 'electronics' };
async function render() {
  await act(async () =>
    root.render(
      createElement(PublicationOwnerActions, { publicationId: 'published', onUpdated: vi.fn() }),
    ),
  );
}
it('shows neither edit control nor private project for another author', async () => {
  vi.spyOn(publicProjectsApi, 'editor').mockResolvedValue({
    ok: true,
    status: 200,
    data: { editor: null },
  });
  const open = vi.spyOn(api, 'openProject');
  await render();
  expect(host.querySelector('a')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
it('links the owner to the original and reads current private metadata before managing publication', async () => {
  vi.spyOn(publicProjectsApi, 'editor').mockResolvedValue({
    ok: true,
    status: 200,
    data: { editor },
  });
  const open = vi
    .spyOn(api, 'openProject')
    .mockResolvedValue({
      ok: true,
      status: 200,
      data: { project: { id: 'original', title: 'Последний черновик' } as Project, document: {} },
    } as never);
  await render();
  expect(host.querySelector('a')?.getAttribute('href')).toContain('original');
  expect(host.textContent).toContain('Редактировать');
  await act(async () => host.querySelector('button')!.click());
  expect(open).toHaveBeenCalledWith('original');
  expect(host.textContent).toContain('Последний черновик');
});
it('offers a retry on a failed ownership lookup without granting access', async () => {
  const lookup = vi
    .spyOn(publicProjectsApi, 'editor')
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Offline' },
    })
    .mockResolvedValueOnce({ ok: true, status: 200, data: { editor } });
  await render();
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Повторить проверку доступа');
  await act(async () => host.querySelector('button')!.click());
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Редактировать');
});
