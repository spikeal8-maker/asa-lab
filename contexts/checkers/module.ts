import { defineModule, type ModuleDiagnostic } from '@asa-lab/module-sdk';
import {
  createInitialCheckersDocument,
  validateCheckersDocument,
  type CheckersDocument,
} from './domain/document.js';

export interface CheckersAnalysisSummary {
  readonly lightMen: number;
  readonly lightKings: number;
  readonly darkMen: number;
  readonly darkKings: number;
  readonly moveCount: number;
  readonly result: CheckersDocument['result'];
}

const CHECKERS_MANIFEST = {
  moduleKey: 'checkers',
  moduleVersion: '0.1.0',
  displayName: 'ASA Шашки',
  shortDescription: 'Русские шашки: обучение, задания, боты и безопасная игра в классе.',
  projectType: 'checkers-game',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/checkers',
  viewerRoute: '/view/projects/:versionId/checkers',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'board',
  iconKey: 'checkers',
  categories: ['logic', 'games', 'training'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [
    {
      code: 'checkers_document_invalid',
      severity: 'error',
      message,
    },
  ];
}

export const CHECKERS_MODULE = defineModule<CheckersDocument, CheckersAnalysisSummary>(
  CHECKERS_MANIFEST,
  {
    createEmptyProject: () => createInitialCheckersDocument(),
    validate: (payload: unknown) => {
      const parsed = validateCheckersDocument(payload);
      if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
      return { ok: true, payload: parsed.value, diagnostics: [] };
    },
    createPreview: (payload: CheckersDocument) => ({
      kind: 'board',
      summary: `${payload.pieces.length} шашек · ${payload.moveHistory.length} ходов`,
      inlineData: JSON.stringify({
        ruleset: payload.ruleset,
        sideToMove: payload.sideToMove,
        pieces: payload.pieces,
      }),
    }),
    analyse: (payload: CheckersDocument) => ({
      lightMen: payload.pieces.filter((piece) => piece.side === 'light' && piece.kind === 'man')
        .length,
      lightKings: payload.pieces.filter((piece) => piece.side === 'light' && piece.kind === 'king')
        .length,
      darkMen: payload.pieces.filter((piece) => piece.side === 'dark' && piece.kind === 'man')
        .length,
      darkKings: payload.pieces.filter((piece) => piece.side === 'dark' && piece.kind === 'king')
        .length,
      moveCount: payload.moveHistory.length,
      result: payload.result,
    }),
  },
);
