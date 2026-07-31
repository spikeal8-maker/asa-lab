import { describe, expect, it } from 'vitest';
import type { Project } from '../../apps/web/src/api';
import { creatorHomeState, recentProjects } from '../../apps/web/src/creator-portal/navigation';

function project(id: string, title: string, createdAt: string): Project {
  return {
    id,
    title,
    createdAt,
    scope: 'personal',
    classroomId: null,
    moduleKey: 'electronics',
    status: 'active',
  };
}

describe('Creator Home', () => {
  it('reports explicit loading, error, empty and ready states', () => {
    expect(creatorHomeState(null, null)).toBe('loading');
    expect(creatorHomeState(null, 'Сервер недоступен.')).toBe('error');
    expect(creatorHomeState([], null)).toBe('empty');
    expect(creatorHomeState([project('one', 'Первый', '2026-07-01T10:00:00Z')], null)).toBe(
      'ready',
    );
  });

  it('shows the four newest real projects without mutating the API result', () => {
    const projects = [
      project('one', 'Старый', '2026-07-01T10:00:00Z'),
      project('two', 'Новый', '2026-07-05T10:00:00Z'),
      project('three', 'Средний', '2026-07-03T10:00:00Z'),
      project('four', 'Ещё один', '2026-07-04T10:00:00Z'),
      project('five', 'Второй', '2026-07-02T10:00:00Z'),
    ];

    expect(recentProjects(projects).map((entry) => entry.id)).toEqual([
      'two',
      'four',
      'three',
      'five',
    ]);
    expect(projects.map((entry) => entry.id)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
});
