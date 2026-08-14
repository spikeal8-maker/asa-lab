import { describe, expect, it } from 'vitest';
import {
  creatorViewFromHash,
  creatorViewToHash,
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
      returnTo: { kind: 'home' },
    });
    expect(creatorViewFromHash(projects)).toEqual({
      kind: 'editor',
      projectId: '3d-project-two',
      returnTo: { kind: 'my-projects' },
    });
  });

  it('preserves classroom context and encoded title on deep links', () => {
    const view: CreatorPortalView = {
      kind: 'editor',
      projectId: 'class-project',
      returnTo: {
        kind: 'classroom-projects',
        classroomId: 'class-one',
        classroomTitle: '7 Б · Шахматы',
      },
    };

    expect(creatorViewFromHash(creatorViewToHash(view))).toEqual(view);
  });

  it('uses Home for the public root and unknown routes', () => {
    expect(creatorViewFromHash('#/')).toEqual({ kind: 'home' });
    expect(creatorViewFromHash('#/not-a-real-route')).toEqual({ kind: 'home' });
  });
});
