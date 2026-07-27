import { describe, expect, it } from 'vitest';
import { createApiModuleRegistry } from './module-registry';
import { ModulesController } from './modules.controller';

describe('ModulesController', () => {
  it('returns one creatable electronics module and visible future environments', () => {
    const controller = new ModulesController(createApiModuleRegistry());
    const modules = controller.list().items;
    expect(modules.find((module) => module.moduleKey === 'electronics')).toMatchObject({
      displayName: 'Электроника',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
    });
    expect(modules.find((module) => module.moduleKey === 'blocks')).toMatchObject({
      availability: 'coming_soon',
      creatable: false,
    });
    expect(modules.map((module) => module.moduleKey)).toEqual(
      expect.arrayContaining(['electronics', 'blocks', 'checkers', 'three-d', 'robotics', 'drawing']),
    );
  });
});
