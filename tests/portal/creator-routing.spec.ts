import { describe, expect, it } from 'vitest';
import {
  creatorViewFromHash,
  creatorViewFromLocation,
  creatorViewToHash,
  creatorViewToHref,
  threeDEditorHash,
  type CreatorPortalView,
} from '../../apps/web/src/creator-portal/navigation';

describe('Creator Portal routing', () => {
  it.each([
    ['#/home', { kind: 'home' }],
    ['#/projects', { kind: 'my-projects' }],
    ['#/learning', { kind: 'learning' }],
    ['#/collections', { kind: 'collections' }],
    ['#/challenges', { kind: 'challenges' }],
    ['#/classrooms', { kind: 'classrooms' }],
    ['#/help', { kind: 'help' }],
    ['#/account', { kind: 'account' }],
  ] as const)('restores %s after a refresh', (hash, expected) => {
    expect(creatorViewFromHash(hash)).toEqual(expected);
    expect(creatorViewToHash(expected)).toBe(hash);
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
      returnTo: { kind: 'my-projects' },
    });
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
});
