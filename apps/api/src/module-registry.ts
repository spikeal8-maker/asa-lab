import { CHESS_MODULE } from '@asa-lab/chess';
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
    moduleKey: 'checkers',
    moduleVersion: '0.1.0',
    displayName: 'Шашки',
    shortDescription: 'Позиции, задачи, партии и учебные комментарии по шашкам.',
    projectType: 'checkers-game',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/checkers',
    viewerRoute: '/view/projects/:versionId/checkers',
    safeModeSupported: true,
    previewKind: 'board',
    iconKey: 'checkers',
    categories: ['logic', 'games'],
  }),
  future({
    moduleKey: 'robotics',
    moduleVersion: '0.1.0',
    displayName: 'Виртуальная робототехника',
    shortDescription: 'Роботы, миры, датчики, исполнительные механизмы и программы.',
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
  return new ModuleRegistry([ELECTRONICS_MODULE, CHESS_MODULE, THREE_D_MODULE, ...FUTURE_MODULES]);
}
