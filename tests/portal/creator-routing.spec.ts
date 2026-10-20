import { describe, expect, it } from 'vitest';
import {
  creatorViewFromHash,
  creatorViewFromLocation,
  creatorViewToHash,
  creatorViewToHref,
  isPublicProjectView,
  sectionForView,
  threeDEditorHash,
  type CreatorPortalView,
} from '../../apps/web/src/creator-portal/navigation';

describe('Creator Portal routing', () => {
  it('keeps module, search, status, sort and page through both editor routes', () => {
    const list = {
      kind: 'my-projects',
      module: 'three-d',
      search: 'Модель 10',
      status: 'archived',
      sort: 'title',
      cursor: 'test-cursor',
    } as const;
    expect(creatorViewFromHash(creatorViewToHash(list))).toEqual(list);
    expect(creatorViewFromHash(threeDEditorHash('model-1', list))).toMatchObject({
      returnTo: list,
    });
    const electronics = creatorViewToHref({
      kind: 'editor',
      projectId: 'circuit-1',
      moduleKey: 'electronics',
      returnTo: list,
    });
    const location = new URL(electronics, 'http://localhost');
    expect(creatorViewFromLocation(location)).toMatchObject({ returnTo: list });
    expect(
      creatorViewFromHash(
        creatorViewToHash({
          kind: 'editor',
          projectId: 'model-1',
          moduleKey: 'three-d',
          returnTo: list,
        }),
      ),
    ).toMatchObject({ returnTo: list });
  });
  it.each([
    ['#/home', { kind: 'home' }],
    ['#/projects', { kind: 'my-projects' }],
    ['#/games', { kind: 'games' }],
    ['#/learning', { kind: 'learning' }],
    ['#/explore', { kind: 'public-projects' }],
    [
      '#/public-projects/publication-one',
      { kind: 'public-project', publicationId: 'publication-one' },
    ],
    ['#/knowledge', { kind: 'knowledge' }],
    ['#/collections', { kind: 'collections' }],
    ['#/challenges', { kind: 'challenges' }],
    ['#/classrooms', { kind: 'classrooms' }],
    ['#/help', { kind: 'help' }],
    ['#/account', { kind: 'account' }],
  ] as const)('restores %s after a refresh', (hash, expected) => {
    expect(creatorViewFromHash(hash)).toEqual(expected);
    expect(creatorViewToHash(expected)).toBe(hash);
  });

  it('marks public child routes in their own top section, without selecting personal work', () => {
    for (const [route, section] of [
      ['#/gallery', 'gallery'],
      ['#/gallery/public-work', 'gallery'],
      ['#/explore', 'gallery'],
      ['#/public-projects/publication-one', 'gallery'],
      ['#/knowledge', 'knowledge'],
      ['#/knowledge/public-course', 'knowledge'],
    ] as const) {
      expect(sectionForView(creatorViewFromHash(route), false)).toBe(section);
    }
  });

  it('aliases the old Gallery catalog and preserves public search through refresh', () => {
    const view = { kind: 'public-projects', search: 'Дом и мост', module: 'three-d' } as const;
    expect(
      creatorViewFromHash(
        '#/gallery?q=%D0%94%D0%BE%D0%BC+%D0%B8+%D0%BC%D0%BE%D1%81%D1%82&module=three-d',
      ),
    ).toEqual(view);
    expect(creatorViewToHash(view)).toMatch(/^#\/explore\?/);
    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('keeps publication IDs and legacy Gallery IDs out of private editor routes', () => {
    const id = 'same-id';
    expect(creatorViewFromHash(`#/projects/${id}`)).toEqual({
      kind: 'editor',
      projectId: id,
      returnTo: { kind: 'my-projects' },
    });
    expect(creatorViewFromHash(`#/public-projects/${id}`)).toEqual({
      kind: 'public-project',
      publicationId: id,
    });
    expect(creatorViewFromHash(`#/gallery/${id}`)).toEqual({
      kind: 'gallery-work',
      projectId: id,
    });
    for (const hash of [`#/public-projects/${id}`, `#/gallery/${id}`]) {
      expect(isPublicProjectView(creatorViewFromHash(hash))).toBe(true);
      expect(creatorViewFromHash(hash).kind).not.toBe('editor');
    }
  });

  it('round-trips encoded publication routes and rejects malformed IDs without opening an editor', () => {
    const view = { kind: 'public-project', publicationId: 'publication / один' } as const;
    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
    expect(creatorViewToHref(view)).toBe(
      '/#/public-projects/publication%20%2F%20%D0%BE%D0%B4%D0%B8%D0%BD',
    );
    expect(creatorViewFromHash('#/public-projects/%E0%A4%A')).toEqual({ kind: 'public-projects' });
    expect(creatorViewFromHash('#/gallery/%E0%A4%A')).toEqual({ kind: 'public-projects' });
  });

  it('bounds public filter input independently of personal project filters', () => {
    expect(creatorViewFromHash(`#/explore?q=${'я'.repeat(140)}&module=bad/key`)).toEqual({
      kind: 'public-projects',
      search: 'я'.repeat(120),
    });
    expect(creatorViewFromHash('#/projects?search=Личная&filter=three-d')).toEqual({
      kind: 'my-projects',
      search: 'Личная',
      module: 'three-d',
    });
  });

  it('preserves the return route for projects opened from Home and Projects', () => {
    const homeEditor: CreatorPortalView = {
      kind: 'editor',
      projectId: 'project-home',
      returnTo: { kind: 'home' },
    };
    const projectsEditor: CreatorPortalView = {
      kind: 'editor',
      projectId: 'project-list',
      returnTo: { kind: 'my-projects' },
    };

    expect(creatorViewFromHash(creatorViewToHash(homeEditor))).toEqual(homeEditor);
    expect(creatorViewFromHash(creatorViewToHash(projectsEditor))).toEqual(projectsEditor);
  });

  it('gives the standalone 3D editor a canonical document URL with a durable return route', () => {
    const home = threeDEditorHash('3d project/one', { kind: 'home' });
    const projects = threeDEditorHash('3d-project-two', { kind: 'my-projects' });

    expect(home).toBe('#/3d/3d%20project%2Fone?returnTo=%2Fhome');
    expect(creatorViewFromHash(home)).toEqual({
      kind: 'editor',
      projectId: '3d project/one',
      moduleKey: 'three-d',
      returnTo: { kind: 'home' },
    });
    expect(creatorViewFromHash(projects)).toEqual({
      kind: 'editor',
      projectId: '3d-project-two',
      moduleKey: 'three-d',
      returnTo: { kind: 'my-projects' },
    });
  });

  it('gives Electronics a browser-native URL that restores after a direct reload', () => {
    const href = creatorViewToHref({
      kind: 'editor',
      projectId: 'electronics project/one',
      moduleKey: 'electronics',
      returnTo: { kind: 'home' },
    });

    expect(href).toBe('/projects/electronics%20project%2Fone/electronics/edit?returnTo=%23%2Fhome');
    const url = new URL(href, 'http://localhost:4610');
    expect(creatorViewFromLocation(url)).toEqual({
      kind: 'editor',
      projectId: 'electronics project/one',
      moduleKey: 'electronics',
      returnTo: { kind: 'home' },
    });
  });

  it('keeps historical project hashes readable during the Electronics migration', () => {
    expect(
      creatorViewFromLocation({
        pathname: '/',
        search: '',
        hash: '#/projects/legacy-electronics',
      }),
    ).toEqual({
      kind: 'editor',
      projectId: 'legacy-electronics',
      returnTo: { kind: 'my-projects' },
    });
  });

  it('preserves classroom context and encoded title on deep links', () => {
    const view: CreatorPortalView = {
      kind: 'editor',
      projectId: 'class-project',
      moduleKey: 'chess',
      returnTo: {
        kind: 'classroom-projects',
        classroomId: 'class-one',
        classroomTitle: '7 Б · Шахматы',
      },
    };

    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('keeps the module key across a personal editor refresh', () => {
    const view: CreatorPortalView = {
      kind: 'editor',
      projectId: 'personal-project',
      moduleKey: 'checkers',
      returnTo: { kind: 'home' },
    };

    expect(creatorViewToHash(view)).toBe('#/home/personal-project?module=checkers');
    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('restores the module key from canonical Chess URLs', () => {
    expect(creatorViewFromHash('#/chess/chess-project/home')).toEqual({
      kind: 'editor',
      projectId: 'chess-project',
      moduleKey: 'chess',
      returnTo: { kind: 'games' },
    });
  });

  it.each(['chess', 'checkers'])('restores %s and returns to Games after reload', (moduleKey) => {
    const view: CreatorPortalView = {
      kind: 'editor',
      projectId: 'saved game/one',
      moduleKey,
      returnTo: { kind: 'games' },
    };
    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('keeps a co-teacher invitation token through sign-in and refresh navigation', () => {
    const view: CreatorPortalView = {
      kind: 'teacher-invite',
      token: 'teacher_invitation-token-123456',
    };

    expect(creatorViewToHash(view)).toBe('#/teacher-invite/teacher_invitation-token-123456');
    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('uses Home for the public root and unknown routes', () => {
    expect(creatorViewFromHash('#/')).toEqual({ kind: 'home' });
    expect(creatorViewFromHash('#/not-a-real-route')).toEqual({ kind: 'home' });
  });
  it('keeps Knowledge list and course deep links distinct from personal learning', () => {
    for (const view of [
      { kind: 'knowledge' },
      { kind: 'knowledge-course', courseId: 'course-one' },
    ] as const) {
      expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
    }
  });
});
