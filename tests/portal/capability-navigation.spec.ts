import { describe, expect, it } from 'vitest';
import { canUseClasses, portalNavigation } from '../../apps/web/src/creator-portal/navigation';

describe('capability-aware Portal navigation', () => {
  it('keeps Classes hidden for a creator and for an educator in personal scope', () => {
    expect(canUseClasses({ classes: false }, 'personal')).toBe(false);
    expect(canUseClasses({ classes: true }, 'personal')).toBe(false);
    expect(portalNavigation(false).some((item) => item.section === 'classes')).toBe(false);
  });

  it('shows Classes only from a server-issued educator capability in organization scope', () => {
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
});
