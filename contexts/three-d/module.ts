import { defineModule, type ModuleDiagnostic } from '@asa-lab/module-sdk';
import {
  createEmptyThreeDDocument,
  parseThreeDDocument,
  type ThreeDDocument,
} from './domain/document.js';

export interface ThreeDAnalysisSummary {
  readonly objectCount: number;
  readonly solidCount: number;
  readonly holeCount: number;
  readonly approximateBoundingVolumeMm3: number;
}

const THREE_D_MANIFEST = {
  moduleKey: 'three-d',
  moduleVersion: '0.1.0',
  displayName: 'ASA 3D',
  shortDescription: 'Браузерное 3D-моделирование из простых форм с точными размерами.',
  projectType: 'three-d-scene',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/three-d',
  viewerRoute: '/view/projects/:versionId/three-d',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'scene',
  iconKey: 'three-d',
  categories: ['design', 'engineering', 'creative'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [{ code: 'three_d_document_invalid', severity: 'error', message }];
}

function analyse(document: ThreeDDocument): ThreeDAnalysisSummary {
  return {
    objectCount: document.nodes.length,
    solidCount: document.nodes.filter((node) => node.operation === 'solid').length,
    holeCount: document.nodes.filter((node) => node.operation === 'hole').length,
    approximateBoundingVolumeMm3: document.nodes.reduce(
      (sum, node) => sum + node.dimensions.width * node.dimensions.depth * node.dimensions.height,
      0,
    ),
  };
}

export const THREE_D_MODULE = defineModule<ThreeDDocument, ThreeDAnalysisSummary>(
  THREE_D_MANIFEST,
  {
    createEmptyProject: createEmptyThreeDDocument,
    validate: (payload: unknown) => {
      const parsed = parseThreeDDocument(payload);
      if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
      return { ok: true, payload: parsed.value, diagnostics: [] };
    },
    createPreview: (payload) => ({
      kind: 'scene',
      summary: `${analyse(payload).objectCount} объектов · ${payload.units}`,
      inlineData: JSON.stringify({ objectCount: analyse(payload).objectCount }),
    }),
    analyse,
  },
);
