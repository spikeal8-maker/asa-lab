import { describe, expect, it } from 'vitest';
import {
  ModuleRegistry,
  ModuleRegistryError,
  defineFutureModule,
  defineModule,
  type ModuleManifestV1,
} from './index';

const electronicsManifest: ModuleManifestV1 = {
  moduleKey: 'electronics',
  moduleVersion: '1.0.0',
  displayName: 'Электроника',
  shortDescription: 'Схемы и моделирование.',
  defaultProjectTitlePrefix: 'Электрическая цепь',
  projectType: 'circuit',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/electronics',
  viewerRoute: '/view/projects/:versionId/electronics',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'schematic',
  iconKey: 'circuit',
  categories: ['engineering'],
  learningCapabilities: {
    assignable: true,
    editableEvidence: true,
    submitProjectVersion: true,
    preview: 'snapshot',
  },
};

const electronics = defineModule(electronicsManifest, {
  createEmptyProject: () => ({ schemaVersion: 1, components: [], connections: [] }),
  validate: (payload: unknown) => ({ ok: true as const, payload, diagnostics: [] }),
  createPreview: () => ({ kind: 'schematic', summary: 'Пустая схема' }),
});

const blocks = defineFutureModule({
  moduleKey: 'blocks',
  moduleVersion: '0.1.0',
  displayName: 'Блочное программирование',
  shortDescription: 'Сцена, спрайты и блоки.',
  defaultProjectTitlePrefix: 'Блочный проект',
  projectType: 'block-program',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/blocks',
  viewerRoute: '/view/projects/:versionId/blocks',
  safeModeSupported: true,
  availability: 'coming_soon',
  previewKind: 'stage',
  iconKey: 'blocks',
  categories: ['coding'],
  learningCapabilities: {
    assignable: false,
    editableEvidence: false,
    submitProjectVersion: false,
    preview: 'none',
  },
});

describe('ModuleRegistry', () => {
  it('lists active and future modules while exposing only active providers as creatable', () => {
    const registry = new ModuleRegistry([electronics, blocks]);
    expect(
      registry
        .list()
        .map((module) => module.moduleKey)
        .sort(),
    ).toEqual(['blocks', 'electronics']);
    expect(registry.listCreatable().map((module) => module.moduleKey)).toEqual(['electronics']);
    expect(registry.listLearningAssignable().map((module) => module.moduleKey)).toEqual([
      'electronics',
    ]);
    expect(registry.getCreatable('electronics')?.provider?.createEmptyProject()).toEqual({
      schemaVersion: 1,
      components: [],
      connections: [],
    });
    expect(registry.getCreatable('blocks')).toBeNull();
  });

  it('rejects duplicate keys and active modules without providers', () => {
    expect(() => new ModuleRegistry([electronics, electronics])).toThrow(ModuleRegistryError);
    expect(
      () =>
        new ModuleRegistry([
          {
            manifest: { ...electronicsManifest, moduleKey: 'broken' },
          },
        ]),
    ).toThrow(/requires a provider/);
  });

  it('rejects malformed manifests before they enter the product catalog', () => {
    expect(() =>
      defineFutureModule({
        ...blocks.manifest,
        moduleKey: 'Bad Key',
      }),
    ).not.toThrow();
    expect(
      () =>
        new ModuleRegistry([
          defineFutureModule({
            ...blocks.manifest,
            moduleKey: 'Bad Key',
          }),
        ]),
    ).toThrow(/invalid moduleKey/);
  });

  it('adds an active future subject to the learning chooser solely through capabilities', () => {
    const futureSubject = defineModule(
      {
        ...electronicsManifest,
        moduleKey: 'future-subject',
        displayName: 'Новая лаборатория',
        learningCapabilities: {
          assignable: true,
          editableEvidence: true,
          submitProjectVersion: true,
          preview: 'interactive',
        },
      },
      electronics.provider!,
    );
    const registry = new ModuleRegistry([electronics, futureSubject, blocks]);
    expect(
      registry
        .listLearningAssignable()
        .map((module) => module.moduleKey)
        .sort(),
    ).toEqual(['electronics', 'future-subject']);
    expect(
      registry.listLearningAssignable().find((module) => module.moduleKey === 'future-subject')
        ?.learningCapabilities.preview,
    ).toBe('interactive');
  });

  it('fails closed on absent or incoherent learning capabilities', () => {
    const invalid = [
      { ...electronicsManifest, learningCapabilities: undefined },
      {
        ...electronicsManifest,
        learningCapabilities: {
          assignable: false,
          editableEvidence: true,
          submitProjectVersion: true,
          preview: 'snapshot',
        },
      },
      {
        ...electronicsManifest,
        learningCapabilities: {
          assignable: true,
          editableEvidence: false,
          submitProjectVersion: true,
          preview: 'none',
        },
      },
    ];
    for (const manifest of invalid) {
      expect(
        () =>
          new ModuleRegistry([
            { manifest: manifest as ModuleManifestV1, provider: electronics.provider },
          ]),
      ).toThrow(/invalid learningCapabilities/);
    }
    expect(
      () =>
        new ModuleRegistry([
          defineFutureModule({
            ...blocks.manifest,
            learningCapabilities: {
              assignable: true,
              editableEvidence: true,
              submitProjectVersion: true,
              preview: 'snapshot',
            },
          }),
        ]),
    ).toThrow(/invalid learningCapabilities/);
  });
});
