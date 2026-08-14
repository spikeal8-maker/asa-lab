import { describe, expect, it } from 'vitest';
import { canUseClasses, portalNavigation } from '../../apps/web/src/creator-portal/navigation';

describe('capability-aware Portal navigation', () => {
  it('keeps class management disabled in personal scope while the Classes section stays visible', () => {
    expect(canUseClasses({ classes: false }, 'personal')).toBe(false);
    expect(canUseClasses({ classes: true }, 'personal')).toBe(false);
    expect(portalNavigation(false).map((item) => item.section)).toContain('classes');
  });

  it('enables class management only from a server-issued capability in organization scope', () => {
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
