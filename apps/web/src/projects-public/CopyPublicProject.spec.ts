// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyPublicProject, copiedProjectHref } from './CopyPublicProject';
import { publicProjectsApi, type PublicProject, type PublicProjectCopy } from './api';
import type { ApiResult } from '../api-call';
import { setTelemetryContext } from '../telemetry-context';

const publication: PublicProject = {
  publicationId: 'public-id',
  revisionId: 'revision-v1',
  revisionNo: 1,
  versionNo: 1,
  title: 'Published V1',
  summary: null,
  description: null,
  tags: [],
  license: 'public-domain',
  moduleKey: 'electronics',
  authorLabel: 'Author A',
  featured: false,
  publishedAt: '2026-10-21T10:00:00Z',
  preview: null,
  capabilities: { viewer: 'static', canCopy: true, downloadFormats: [] },
};
const success: ApiResult<PublicProjectCopy> = {
  ok: true,
  status: 201,
  data: { projectId: 'my-private-copy', moduleKey: 'electronics', created: true },
};
let root: Root;
let container: HTMLDivElement;
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeEach(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  setTelemetryContext(null, true, 'public');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(source = publication): Promise<void> {
  await act(async () => root.render(createElement(CopyPublicProject, { publication: source })));
}
function button(): HTMLButtonElement {
  return container.querySelector('button')!;
}

describe('published private copy UI', () => {
  it('fences immediate double clicks and opens the canonical editor for the returned private ID', async () => {
    let finish!: (value: ApiResult<PublicProjectCopy>) => void;
    const copy = vi.spyOn(publicProjectsApi, 'copy').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await act(async () => {
      button().click();
      button().click();
    });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(container.textContent).toContain('Создаём копию');
    await act(async () => finish(success));
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Открыть мою копию');
    expect(link.getAttribute('href')).toBe(
      '/projects/my-private-copy/electronics/edit?returnTo=%23%2Fprojects',
    );
    expect(copy.mock.calls[0]?.slice(0, 2)).toEqual(['public-id', 'revision-v1']);
  });

  it('reuses the exact idempotency key after an unknown network result', async () => {
    const copy = vi
      .spyOn(publicProjectsApi, 'copy')
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        error: { code: 'network', message: 'network' },
      })
      .mockResolvedValueOnce(success);
    await render();
    await act(async () => button().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('неизвестен');
    await act(async () => button().click());
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[0]?.[2]).toBeTruthy();
    expect(copy.mock.calls[1]?.[2]).toBe(copy.mock.calls[0]?.[2]);
  });

  it('offers explicit sign-in without automatically retrying a 401', async () => {
    const copy = vi.spyOn(publicProjectsApi, 'copy').mockResolvedValue({
      ok: false,
      status: 401,
      error: { code: 'unauthorized', message: 'private' },
    });
    await render();
    await act(async () => button().click());
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/#/sign-in');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('private');
  });

  it.each([403, 404, 409])(
    'explains and blocks a definitive %s without exposing server details',
    async (status) => {
      vi.spyOn(publicProjectsApi, 'copy').mockResolvedValue({
        ok: false,
        status,
        error: { code: 'forbidden', message: 'source-private-id' },
      });
      await render();
      await act(async () => button().click());
      expect(button().disabled).toBe(true);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain('source-private-id');
    },
  );

  it('leaves unsupported publications visibly unavailable', async () => {
    const copy = vi.spyOn(publicProjectsApi, 'copy');
    await render({ ...publication, capabilities: { ...publication.capabilities, canCopy: false } });
    expect(button().disabled).toBe(true);
    expect(container.textContent).toContain('Другие лицензии и модули пока не поддерживаются');
    await act(async () => button().click());
    expect(copy).not.toHaveBeenCalled();
  });

  it('discards a late success when the session context changes', async () => {
    let finish!: (value: ApiResult<PublicProjectCopy>) => void;
    const copy = vi.spyOn(publicProjectsApi, 'copy').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await act(async () => button().click());
    await act(async () => setTelemetryContext(null, false, 'public'));
    expect(copy.mock.calls[0]?.[3].aborted).toBe(true);
    await act(async () => finish(success));
    expect(container.textContent).not.toContain('Открыть мою копию');
    expect(button().disabled).toBe(true);
  });

  it('aborts the request on navigation/unmount', async () => {
    const copy = vi.spyOn(publicProjectsApi, 'copy').mockReturnValue(new Promise(() => undefined));
    await render();
    await act(async () => button().click());
    await act(async () => root.render(null));
    expect(copy.mock.calls[0]?.[3].aborted).toBe(true);
  });

  it('uses the existing standalone 3D editor helper and rejects unsupported modules', () => {
    expect(copiedProjectHref({ projectId: 'copy', moduleKey: 'three-d', created: true })).toBe(
      '/#/3d/copy?returnTo=%2Fprojects',
    );
    expect(copiedProjectHref({ projectId: 'copy', moduleKey: 'blocks', created: true })).toBeNull();
  });
});
