import { defineModule, type ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import type { BlocksProjectDocumentV1 } from './domain/document.js';
import { validateBlocksDocument } from './domain/validation.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function spriteCount(projectJson: Record<string, unknown> | null): number {
  if (!projectJson || !Array.isArray(projectJson.targets)) return 0;
  return projectJson.targets.filter((target) => isRecord(target) && target.isStage !== true).length;
}

function createPreview(document: BlocksProjectDocumentV1): ModulePreviewDescriptor {
  if (document.projectJson === null) {
    return {
      kind: 'stage',
      summary: 'Scratch 3 · проект ещё не инициализирован',
    };
  }
  return {
    kind: 'stage',
    summary: `Scratch 3 · спрайтов: ${spriteCount(document.projectJson)} · ресурсов: ${document.assets.length}`,
  };
}

export const BLOCKS_MODULE = defineModule<BlocksProjectDocumentV1>(
  {
    moduleKey: 'blocks',
    moduleVersion: '0.1.1',
    displayName: 'Визуальное программирование',
    shortDescription: 'Блочное программирование, совместимое с проектами Scratch 3.',
    defaultProjectTitlePrefix: 'Визуальный проект',
    projectType: 'scratch-3',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/blocks',
    viewerRoute: '/view/projects/:versionId/blocks',
    safeModeSupported: true,
    // M1-001 is structural only. Durable save/load arrives in later M1 slices.
    availability: 'coming_soon',
    previewKind: 'stage',
    iconKey: 'blocks',
    categories: ['coding', 'creative'],
  },
  {
    createEmptyProject: () => ({
      schemaVersion: 1,
      format: 'scratch-3',
      projectJson: null,
      assets: [],
    }),
    validate: validateBlocksDocument,
    createPreview,
  },
);
