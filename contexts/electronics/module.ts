import { defineModule, type ModuleDiagnostic } from '@asa-lab/module-sdk';
import {
  EMPTY_DOCUMENT,
  parseElectronicsDocument,
  type ElectronicsDocument,
} from './domain/document.js';
import { solveCircuit, type SolveResult } from './domain/solver.js';

const ELECTRONICS_MANIFEST = {
  moduleKey: 'electronics',
  moduleVersion: '1.0.0',
  displayName: 'Электроника',
  shortDescription: 'Создание электрических схем, соединение компонентов и моделирование.',
  projectType: 'circuit',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/electronics',
  viewerRoute: '/view/projects/:versionId/electronics',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'schematic',
  iconKey: 'circuit',
  categories: ['engineering', 'electronics'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [
    {
      code: 'electronics_document_invalid',
      severity: 'error',
      message,
    },
  ];
}

/** First-party Electronics provider registered through the same contract that
 * future Blocks, 3D and board modules will use. */
export const ELECTRONICS_MODULE = defineModule<ElectronicsDocument, SolveResult>(
  ELECTRONICS_MANIFEST,
  {
    createEmptyProject: () => EMPTY_DOCUMENT,
    validate: (payload: unknown) => {
      const parsed = parseElectronicsDocument(payload);
      if (!parsed.ok) {
        return { ok: false, diagnostics: invalidDocument(parsed.message) };
      }
      return { ok: true, payload: parsed.document, diagnostics: [] };
    },
    createPreview: (payload: ElectronicsDocument) => ({
      kind: 'schematic',
      summary: `${payload.components.length} компонентов · ${payload.connections.length} соединений`,
    }),
    analyse: (payload: ElectronicsDocument) => solveCircuit(payload),
  },
);
