import { describe, expect, it } from 'vitest';
import { canUseClasses, portalNavigation } from '../../apps/web/src/creator-portal/navigation';

describe('capability-aware Portal navigation', () => {
  it('allows a server-enabled educator to manage personal classes', () => {
    expect(canUseClasses({ classes: false }, 'personal')).toBe(false);
    expect(canUseClasses({ classes: true }, 'personal')).toBe(true);
    expect(portalNavigation(false, { classes: true }).map((item) => item.section)).toContain(
      'classes',
    );
  });

  it('also enables class management in organization scope', () => {
    expect(canUseClasses({ classes: true }, 'organization')).toBe(true);
    expect(portalNavigation(true, { classes: true }).map((item) => item.section)).toContain(
      'classes',
    );
  });

  it('does not derive capabilities from the selected workspace', () => {
    const serverNavigation = { classes: false };
    const beforeSwitch = canUseClasses(serverNavigation, 'personal');
    const afterSwitch = canUseClasses(serverNavigation, 'organization');

    expect(beforeSwitch).toBe(false);
    expect(afterSwitch).toBe(false);
    expect(serverNavigation).toEqual({ classes: false });
  });

  it('does not remove a server capability when the workspace changes', () => {
    expect(canUseClasses({ classes: true }, 'personal')).toBe(true);
    expect(canUseClasses({ classes: true }, 'organization')).toBe(true);
  });

  it('does not infer staff links from a client teacher flag or missing server state', () => {
    for (const value of [false, true]) {
      const sections = portalNavigation(value).map((item) => item.section);
      expect(sections).not.toContain('classes');
      expect(sections).not.toContain('challenges');
      expect(sections).toEqual(
        expect.arrayContaining(['projects', 'learning', 'knowledge', 'account']),
      );
    }
  });

  it('author-only and seat navigation do not contain staff classes', () => {
    const author = portalNavigation(false, { contentAuthoring: true }).map((item) => item.section);
    expect(author).toContain('challenges');
    expect(author).not.toContain('classes');
    expect(
      portalNavigation(true, { seat: true, classes: true, contentAuthoring: true }).map(
        (item) => item.section,
      ),
    ).toEqual(['learning', 'projects', 'help', 'account']);
  });
});
