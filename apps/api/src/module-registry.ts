import { CHESS_MODULE } from '@asa-lab/chess';
import { CHECKERS_MODULE } from '@asa-lab/checkers';
import { ELECTRONICS_MODULE } from '@asa-lab/electronics';
import { THREE_D_MODULE } from '@asa-lab/three-d';
import {
  ModuleRegistry,
  defineFutureModule,
  type ModuleManifestV1,
  type RegisteredModule,
} from '@asa-lab/module-sdk';

function future(manifest: Omit<ModuleManifestV1, 'availability'>): RegisteredModule {
  return defineFutureModule({ ...manifest, availability: 'coming_soon' });
}

const FUTURE_MODULES: readonly RegisteredModule[] = [
  future({
    moduleKey: 'blocks',
    moduleVersion: '0.1.0',
    displayName: 'Блочное программирование',
    shortDescription: 'Сцена, спрайты, события, переменные и блоки.',
    defaultProjectTitlePrefix: 'Блочный проект',
    projectType: 'block-program',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/blocks',
    viewerRoute: '/view/projects/:versionId/blocks',
    safeModeSupported: true,
    previewKind: 'stage',
    iconKey: 'blocks',
    categories: ['coding', 'creative'],
  }),
  future({
    moduleKey: 'robotics',
    moduleVersion: '0.1.0',
    displayName: 'Виртуальная робототехника',
    shortDescription: 'Роботы, миры, датчики, исполнительные механизмы и программы.',
    defaultProjectTitlePrefix: 'Проект робототехники',
    projectType: 'robot-world',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/robotics',
    viewerRoute: '/view/projects/:versionId/robotics',
    safeModeSupported: true,
    previewKind: 'scene',
    iconKey: 'robot',
    categories: ['robotics', 'coding'],
  }),
  future({
    moduleKey: 'drawing',
    moduleVersion: '0.1.0',
    displayName: 'Рисование и черчение',
    shortDescription: 'Векторные работы, технические документы и размеры.',
    defaultProjectTitlePrefix: 'Чертёж',
    projectType: 'vector-document',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/drawing',
    viewerRoute: '/view/projects/:versionId/drawing',
    safeModeSupported: true,
    previewKind: 'drawing',
    iconKey: 'drawing',
    categories: ['design', 'creative'],
  }),
];

/** One server-side source of truth for the create chooser and project core. */
export function createApiModuleRegistry(): ModuleRegistry {
  return new ModuleRegistry([
    ELECTRONICS_MODULE,
    CHESS_MODULE,
    CHECKERS_MODULE,
    THREE_D_MODULE,
    ...FUTURE_MODULES,
  ]);
}
