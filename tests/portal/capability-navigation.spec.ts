import { describe, expect, it } from 'vitest';
import { canUseClasses, portalNavigation } from '../../apps/web/src/creator-portal/navigation';

describe('capability-aware Portal navigation', () => {
  it('allows a server-enabled educator to manage personal classes', () => {
    expect(canUseClasses({ classes: false }, 'personal')).toBe(false);
    expect(canUseClasses({ classes: true }, 'personal')).toBe(true);
    expect(portalNavigation(false).map((item) => item.section)).toContain('classes');
  });

  it('also enables class management in organization scope', () => {
    expect(canUseClasses({ classes: true }, 'organization')).toBe(true);
    expect(portalNavigation(true).map((item) => item.section)).toContain('classes');
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
});
