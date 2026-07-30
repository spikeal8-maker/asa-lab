import { describe, expect, it } from 'vitest';
import { createApiModuleRegistry } from './module-registry';
import { ModulesController } from './modules.controller';

describe('ModulesController', () => {
  it('returns Electronics and ASA Chess as creatable first-party modules', () => {
    const controller = new ModulesController(createApiModuleRegistry());
    const modules = controller.list().items;
    expect(modules.find((module) => module.moduleKey === 'electronics')).toMatchObject({
      displayName: 'Электроника',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
    });
    expect(modules.find((module) => module.moduleKey === 'chess')).toMatchObject({
      displayName: 'ASA Chess',
      projectType: 'chess-game',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
      previewKind: 'board',
      iconKey: 'chess',
    });
  });

  it('keeps unimplemented environments visible but not creatable', () => {
    const controller = new ModulesController(createApiModuleRegistry());
    const modules = controller.list().items;
    expect(modules.find((module) => module.moduleKey === 'blocks')).toMatchObject({
      availability: 'coming_soon',
      creatable: false,
    });
    expect(modules.find((module) => module.moduleKey === 'checkers')).toMatchObject({
      displayName: 'Шашки',
      availability: 'coming_soon',
      creatable: false,
    });
    expect(modules.map((module) => module.moduleKey)).toEqual(
      expect.arrayContaining([
        'electronics',
        'chess',
        'blocks',
        'checkers',
        'three-d',
        'robotics',
        'drawing',
      ]),
    );
  });
});
