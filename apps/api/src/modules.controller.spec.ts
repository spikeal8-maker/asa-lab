import { describe, expect, it } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SeatContextUseCase } from './seat-context';

const request = { cookies: {} } as FastifyRequest;
const reply = { header: () => reply } as unknown as FastifyReply;
import { createApiModuleRegistry } from './module-registry';
import { ModulesController } from './modules.controller';

describe('ModulesController', () => {
  it('returns implemented environments including Robotics as creatable modules', async () => {
    const controller = new ModulesController(
      createApiModuleRegistry(),
      new SeatContextUseCase(null),
      null,
    );
    const modules = (await controller.list(request, reply)).items;
    expect(modules.find((module) => module.moduleKey === 'electronics')).toMatchObject({
      displayName: 'Электроника',
      defaultProjectTitlePrefix: 'Электрическая цепь',
      availability: 'active',
      creatable: true,
      safeModeSupported: true,
      learningCapabilities: {
        assignable: true,
        editableEvidence: true,
        submitProjectVersion: true,
        preview: 'snapshot',
      },
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
      learningCapabilities: { assignable: true },
    });
    expect(modules.find((module) => module.moduleKey === 'robotics')).toMatchObject({
      displayName: 'Виртуальная робототехника',
      defaultProjectTitlePrefix: 'Проект робототехники',
      projectType: 'robot-world',
      schemaVersion: 2,
      availability: 'active',
      creatable: true,
      editorRoute: '/projects/:projectId/robotics',
      viewerRoute: '/view/projects/:versionId/robotics',
      safeModeSupported: true,
      previewKind: 'scene',
      learningCapabilities: {
        assignable: false,
        editableEvidence: false,
        submitProjectVersion: false,
        preview: 'none',
      },
    });
  });

  it('keeps unimplemented environments visible but not creatable', async () => {
    const controller = new ModulesController(
      createApiModuleRegistry(),
      new SeatContextUseCase(null),
      null,
    );
    const modules = (await controller.list(request, reply)).items;
    expect(modules.find((module) => module.moduleKey === 'drawing')).toMatchObject({
      availability: 'coming_soon',
      creatable: false,
      learningCapabilities: { assignable: false },
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

  it('keeps game, Scratch and Robotics project activation separate from learning support', () => {
    const registry = createApiModuleRegistry();
    expect(
      registry
        .listLearningAssignable()
        .map((module) => module.moduleKey)
        .sort(),
    ).toEqual(['electronics', 'three-d']);
    expect(registry.list().find((module) => module.moduleKey === 'blocks')).toMatchObject({
      availability: 'active',
      creatable: true,
      learningCapabilities: { assignable: false },
    });
  });

  it.each([undefined, '0', '1'])(
    'keeps Scratch creatable with legacy preview flag %s',
    async (flag) => {
      const previous = process.env['ASA_BLOCKS_PREVIEW'];
      if (flag === undefined) delete process.env['ASA_BLOCKS_PREVIEW'];
      else process.env['ASA_BLOCKS_PREVIEW'] = flag;
      try {
        const controller = new ModulesController(
          createApiModuleRegistry(),
          new SeatContextUseCase(null),
          null,
        );
        expect(
          (await controller.list(request, reply)).items.find(
            (module) => module.moduleKey === 'blocks',
          ),
        ).toMatchObject({
          displayName: 'Scratch',
          availability: 'active',
          creatable: true,
        });
      } finally {
        if (previous === undefined) delete process.env['ASA_BLOCKS_PREVIEW'];
        else process.env['ASA_BLOCKS_PREVIEW'] = previous;
      }
    },
  );
});
