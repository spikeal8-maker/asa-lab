import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectDraftMutationId } from '../project-draft-mutation';

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
});
