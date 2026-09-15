import { describe, expect, it } from 'vitest';
import { createApiModuleRegistry } from './module-registry';
import { ModulesController } from './modules.controller';

describe('ModulesController', () => {
  it('returns Electronics, ASA Chess, ASA Checkers and ASA 3D as creatable modules', () => {
    const controller = new ModulesController(createApiModuleRegistry());
    const modules = controller.list().items;
    expect(modules.find((module) => module.moduleKey === 'electronics')).toMatchObject({
      displayName: 'Электроника',
      defaultProjectTitlePrefix: 'Электрическая цепь',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
    });
    expect(modules.find((module) => module.moduleKey === 'chess')).toMatchObject({
      displayName: 'ASA Chess',
      defaultProjectTitlePrefix: 'Шахматная партия',
      projectType: 'chess-game',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
      previewKind: 'board',
      iconKey: 'chess',
    });
    expect(modules.find((module) => module.moduleKey === 'checkers')).toMatchObject({
      displayName: 'ASA Шашки',
      defaultProjectTitlePrefix: 'Шашечная партия',
      projectType: 'checkers-game',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
      previewKind: 'board',
      iconKey: 'checkers',
    });
    expect(modules.find((module) => module.moduleKey === 'three-d')).toMatchObject({
      displayName: '3D-моделирование',
      defaultProjectTitlePrefix: '3D модель',
      projectType: 'three-d-scene',
      availability: 'active',
      creatable: true,
      previewKind: 'scene',
    });
  });

  it('keeps unimplemented environments visible but not creatable', () => {
    const controller = new ModulesController(createApiModuleRegistry());
    const modules = controller.list().items;
    expect(modules.find((module) => module.moduleKey === 'drawing')).toMatchObject({
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

  it.each([undefined, '0', '1'])('keeps Scratch creatable with legacy preview flag %s', (flag) => {
    const previous = process.env['ASA_BLOCKS_PREVIEW'];
    if (flag === undefined) delete process.env['ASA_BLOCKS_PREVIEW'];
    else process.env['ASA_BLOCKS_PREVIEW'] = flag;
    try {
      const controller = new ModulesController(createApiModuleRegistry());
      expect(controller.list().items.find((module) => module.moduleKey === 'blocks')).toMatchObject(
        {
          displayName: 'Scratch',
          availability: 'active',
          creatable: true,
        },
      );
    } finally {
      if (previous === undefined) delete process.env['ASA_BLOCKS_PREVIEW'];
      else process.env['ASA_BLOCKS_PREVIEW'] = previous;
    }
  });
});
