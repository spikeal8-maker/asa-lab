import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { projectDraftMutationId, projectDraftMutationIdSync } from '../project-draft-mutation';

describe('project draft mutation identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is stable for an exact retry and remains a UUID v4', async () => {
    const document = { nodes: [{ id: 'a', x: 12 }], title: 'Проект' };
    const first = await projectDraftMutationId('project-a', 7, document);
    const retry = await projectDraftMutationId('project-a', 7, document);

    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('changes when the project, base revision or document changes', async () => {
    const baseline = await projectDraftMutationId('project-a', 7, { value: 1 });
    const candidates = await Promise.all([
      projectDraftMutationId('project-b', 7, { value: 1 }),
      projectDraftMutationId('project-a', 8, { value: 1 }),
      projectDraftMutationId('project-a', 7, { value: 2 }),
    ]);

    expect(new Set([baseline, ...candidates]).size).toBe(4);
  });

  it('remains stable on private HTTP hosts where Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    const first = await projectDraftMutationId('project-http', 3, { value: 'draft' });
    const retry = await projectDraftMutationId('project-http', 3, { value: 'draft' });

    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('starts an unload save before yielding with the same retry identity', async () => {
    const document = { nodes: [{ id: 'a', x: 12 }] };
    const fetchMock = vi.fn(async (_path: string, _init: RequestInit) => {
      void _path;
      void _init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ draft: { document, revision: 8 }, result: null }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = api.saveDraft('project-a', document, 7, { unloading: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(path).toBe('/api/projects/project-a/draft');
    expect(init).toMatchObject({ method: 'PUT', keepalive: true, credentials: 'same-origin' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      document,
      baseRevision: 7,
      mutationId: projectDraftMutationIdSync('project-a', 7, document),
    });
    expect(projectDraftMutationIdSync('project-a', 7, document)).toBe(
      await projectDraftMutationId('project-a', 7, document),
    );
    expect((await request).ok).toBe(true);
  });

  it('starts an oversized unload request without exceeding the keepalive quota', async () => {
    const fetchMock = vi.fn(async (_path: string, _init: RequestInit) => {
      void _path;
      void _init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ draft: { revision: 8 }, result: null }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const document = { note: 'x'.repeat(70_000) };

    const request = api.saveDraft('project-a', document, 7, { unloading: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.keepalive).toBeUndefined();
    expect(JSON.parse(init.body as string).document).toEqual(document);
    expect((await request).ok).toBe(true);
  });
});
