import { describe, expect, it } from 'vitest';
import {
  creatorViewFromHash,
  creatorViewToHash,
  portalNavigation,
  sectionForView,
  threeDEditorHash,
} from './navigation';

describe('separate learner achievements navigation', () => {
  it('does not replace the existing learning route', () => {
    expect(creatorViewFromHash('#/learning')).toEqual({ kind: 'learning' });
    expect(creatorViewFromHash('#/achievements')).toEqual({ kind: 'achievements' });
    expect(creatorViewToHash({ kind: 'achievements' })).toBe('#/achievements');
    expect(sectionForView({ kind: 'achievements' }, false)).toBe('achievements');
  });

  it('provides both destinations to a StudentSeat and a normal Account', () => {
    for (const nav of [
      portalNavigation(false, { seat: true }),
      portalNavigation(false, { classes: true }),
      portalNavigation(false),
    ]) {
      expect(nav.filter((entry) => entry.section === 'learning')).toEqual([
        { section: 'learning', label: 'Моё обучение' },
      ]);
      expect(nav.filter((entry) => entry.section === 'achievements')).toEqual([
        { section: 'achievements', label: 'Мои достижения' },
      ]);
    }
  });

  it('returns the learner to achievements after leaving a 3D work editor', () => {
    const url = threeDEditorHash('learner-work-id', { kind: 'achievements' });
    const view = creatorViewFromHash(url);
    expect(view.kind).toBe('editor');
    if (view.kind === 'editor') {
      expect(view.projectId).toBe('learner-work-id');
      expect(view.returnTo).toEqual({ kind: 'achievements' });
    }
  });
});
