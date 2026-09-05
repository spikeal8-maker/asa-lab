import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Project } from '../api';
import { isGameModule, projectEntries } from './game-catalog';
import { latestGameSave, openGame } from './open-game';

function save(id: string, moduleKey = 'chess', status: Project['status'] = 'active'): Project {
  return {
    id,
    moduleKey,
    status,
    title: id,
    scope: 'personal',
    classroomId: null,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    preview: null,
    snapshotRevision: null,
    copiedFrom: null,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Games entry', () => {
  it('hides both games from project lists without changing saved documents or unknown modules', () => {
    const records = [
      save('chess'),
      save('checkers', 'checkers'),
      save('circuit', 'electronics'),
      save('new-module', 'future'),
    ];
    expect(projectEntries(records).map((item) => item.id)).toEqual(['circuit', 'new-module']);
    expect(records).toHaveLength(4);
    expect(isGameModule('chess-live')).toBe(false);
  });

  it('resumes the latest active personal save and never selects a classroom, archived or other game', () => {
    const old = save('old');
    const latest = { ...save('latest'), updatedAt: '2026-09-05T11:00:00Z' };
    const records = [
      old,
      latest,
      save('trash', 'chess', 'trashed'),
      { ...latest, id: 'classroom', scope: 'classroom' as const },
      save('other', 'checkers'),
    ];
    expect(latestGameSave(records, 'chess')).toEqual(latest);
    expect(records[0]).toBe(old);
  });

  it('reuses an existing game without creating another document', async () => {
    const existing = save('existing');
    vi.spyOn(api, 'listProjects').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [existing] },
    });
    const create = vi.spyOn(api, 'createProject');
    expect(await openGame('chess')).toEqual(existing);
    expect(api.listProjects).toHaveBeenCalledWith({
      scope: 'personal',
      status: 'active',
      includeGames: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the same owner-scoped creation key for retries and parallel tabs', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
    const create = vi.spyOn(api, 'createProject').mockResolvedValue({
      ok: true,
      status: 201,
      data: { project: save('game', 'checkers'), created: true },
    });
    await Promise.all([openGame('checkers'), openGame('checkers')]);
    expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      scope: 'personal',
      module: 'checkers',
      title: 'Шашки',
      idempotencyKey: 'games-entry-v1-checkers',
    });
  });

  it('does not create a new game when reading saved games fails', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'unavailable' },
    });
    const create = vi.spyOn(api, 'createProject');
    await expect(openGame('chess')).rejects.toThrow('загрузить игры');
    expect(create).not.toHaveBeenCalled();
  });
});
