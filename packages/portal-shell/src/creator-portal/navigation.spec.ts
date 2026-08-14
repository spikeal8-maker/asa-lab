import { describe, expect, it } from 'vitest';
import { creatorViewFromLocation, creatorViewToHref } from './navigation';

describe('canonical Electronics editor navigation', () => {
  it('creates a directly reloadable module route with an explicit Portal return target', () => {
    expect(
      creatorViewToHref({
        kind: 'editor',
        projectId: 'project-123',
        moduleKey: 'electronics',
        returnTo: { kind: 'my-projects' },
      }),
    ).toBe('/projects/project-123/electronics/edit?returnTo=%23%2Fprojects');
  });

  it('restores the Electronics project and its return target from the browser URL', () => {
    expect(
      creatorViewFromLocation({
        pathname: '/projects/project-123/electronics/edit',
        search: '?returnTo=%23%2Fhome',
        hash: '',
      }),
    ).toEqual({
      kind: 'editor',
      projectId: 'project-123',
      moduleKey: 'electronics',
      returnTo: { kind: 'home' },
    });
  });

  it('keeps historical project hashes readable until every module has a canonical route', () => {
    expect(
      creatorViewFromLocation({
        pathname: '/',
        search: '',
        hash: '#/home/legacy-project',
      }),
    ).toEqual({
      kind: 'editor',
      projectId: 'legacy-project',
      returnTo: { kind: 'home' },
    });
  });

  it('round-trips a classroom return target without losing its title', () => {
    const href = creatorViewToHref({
      kind: 'editor',
      projectId: 'class-project',
      moduleKey: 'electronics',
      returnTo: {
        kind: 'classroom-projects',
        classroomId: 'class-7',
        classroomTitle: 'Физика 7Б',
      },
    });
    const url = new URL(href, 'http://localhost:4610');
    expect(
      creatorViewFromLocation({
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
      }),
    ).toEqual({
      kind: 'editor',
      projectId: 'class-project',
      moduleKey: 'electronics',
      returnTo: {
        kind: 'classroom-projects',
        classroomId: 'class-7',
        classroomTitle: 'Физика 7Б',
      },
    });
  });
});
